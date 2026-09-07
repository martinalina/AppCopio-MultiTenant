// src/routes/emergencyRoutes.ts
//
// Colaboración intermunicipal: declarar emergencias, invitar comunas, responder la
// invitación, cerrar y vincular activaciones (una a una o en lote).
//
// Una comuna NO se auto-inscribe: se la invita (status 'invitada') y ella acepta o
// rechaza. Solo con 'participando' se comparten prioridades (política cip_intermunicipal_read).
//
// Quién declara qué (las políticas RLS de 002a lo refuerzan en la BD):
//  - Admin municipal: emergencias a nombre de SU comuna (created_by_municipality_id = su comuna),
//    y queda inscrita como primer participante.
//  - Super Administrador: emergencias regionales (created_by_municipality_id = NULL).
import { Router, RequestHandler } from 'express';
import pool from '../config/db';
import { requireUser, requireTenant, SUPERADMIN_ROLE_ID, ADMIN_ROLE_ID } from '../auth/requireUser';
import { createNotification } from '../services/notificationService';

const router = Router();

const listEmergencies: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    // RLS ya limita el listado: superadmin ve todas; una comuna ve las suyas y
    // aquellas en las que participa.
    const { rows } = await pool.query(
      `SELECT e.emergency_id, e.name, e.type, e.started_at, e.ended_at,
              e.created_by_municipality_id,
              (SELECT ep.status FROM EmergencyParticipants ep
                WHERE ep.emergency_id = e.emergency_id
                  AND ep.municipality_id = current_tenant()) AS mi_estado,
              (SELECT COUNT(*) FROM emergency_participants_of(e.emergency_id) p
                WHERE p.status = 'participando') AS total_participando
       FROM Emergencies e
       ORDER BY e.started_at DESC`
    );
    res.json(rows);
  } catch (err: any) {
    if (err?.status) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Error en listEmergencies:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const createEmergency: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const { name, type } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'El campo name es requerido.' });
      return;
    }

    const isSuperadmin = user.role_id === SUPERADMIN_ROLE_ID;
    // El alcance NUNCA viene del body: se deriva del rol y de la comuna del JWT.
    const scopeMunicipalityId = isSuperadmin ? null : user.municipality_id;

    const { rows } = await pool.query(
      `INSERT INTO Emergencies (name, type, created_by, created_by_municipality_id)
       VALUES ($1, $2, $3, $4)
       RETURNING emergency_id, name, type, started_at, created_by_municipality_id`,
      [name.trim(), type ?? null, user.user_id, scopeMunicipalityId]
    );
    const emergency = rows[0];

    // Quien declara una emergencia local queda inscrito de inmediato.
    if (scopeMunicipalityId != null) {
      await pool.query(
        `INSERT INTO EmergencyParticipants (emergency_id, municipality_id, status, responded_at)
         VALUES ($1, $2, 'participando', now())
         ON CONFLICT DO NOTHING`,
        [emergency.emergency_id, scopeMunicipalityId]
      );
    }

    res.status(201).json(emergency);
  } catch (err: any) {
    if (err?.status) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Error en createEmergency:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

/** Asocia una activación ya existente a una emergencia (o la desasocia con null). */
const linkActivation: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const activationId = parseInt(req.params.activationId, 10);
    const { emergency_id } = req.body ?? {};
    if (isNaN(activationId)) {
      res.status(400).json({ error: 'activation_id inválido.' });
      return;
    }

    // RLS acota el UPDATE a activaciones de la propia comuna.
    const { rows } = await pool.query(
      `UPDATE CentersActivations
          SET emergency_id = $1
        WHERE activation_id = $2
        RETURNING activation_id, center_id, emergency_id`,
      [emergency_id ?? null, activationId]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Activación no encontrada.' });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    if (err?.status) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err?.code === '23503') {
      res.status(400).json({ error: 'La emergencia indicada no existe o no es visible para tu comuna.' });
      return;
    }
    console.error('Error en linkActivation:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

/** Comunas de la emergencia con su estado de participación. */
const listParticipants: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const emergencyId = parseInt(req.params.emergencyId, 10);
    if (isNaN(emergencyId)) {
      res.status(400).json({ error: 'emergency_id inválido.' });
      return;
    }
    // Via funcion SECURITY DEFINER: la politica de EmergencyParticipants solo deja ver
    // la fila propia, asi que una consulta directa nunca mostraria a las demas comunas.
    const { rows } = await pool.query(
      `SELECT * FROM emergency_participants_of($1)`,
      [emergencyId]
    );
    res.json(rows);
  } catch (err: any) {
    manejarError(res, err, 'listParticipants');
  }
};

/**
 * Invita comunas a la emergencia: crea la fila en 'invitada' y una notificación
 * municipal por comuna.
 *
 * Se usa createNotification y NO sendNotification: esta última dispara el envío de
 * correo, y el requisito es aviso solo por aplicación.
 */
const inviteMunicipalities: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const emergencyId = parseInt(req.params.emergencyId, 10);
    const { municipality_ids } = req.body ?? {};

    if (isNaN(emergencyId)) {
      res.status(400).json({ error: 'emergency_id inválido.' });
      return;
    }
    if (!Array.isArray(municipality_ids) || municipality_ids.length === 0) {
      res.status(400).json({ error: 'municipality_ids debe ser un arreglo con al menos una comuna.' });
      return;
    }

    const { rows: emRows } = await pool.query(
      `SELECT emergency_id, name FROM Emergencies WHERE emergency_id = $1`,
      [emergencyId]
    );
    const emergencia = emRows[0];
    if (!emergencia) {
      res.status(404).json({ error: 'La emergencia no existe o no es visible para ti.' });
      return;
    }

    const invitadas: number[] = [];
    const yaEstaban: number[] = [];

    for (const rawId of municipality_ids) {
      const municipalityId = Number(rawId);
      if (!Number.isFinite(municipalityId)) continue;

      // La política emergency_participants_write restringe quién puede invitar:
      // superadmin, o la comuna que declaró la emergencia.
      const { rowCount } = await pool.query(
        `INSERT INTO EmergencyParticipants (emergency_id, municipality_id, status, invited_by)
         VALUES ($1, $2, 'invitada', $3)
         ON CONFLICT (emergency_id, municipality_id) DO NOTHING`,
        [emergencyId, municipalityId, user.user_id]
      );

      if (!rowCount) {
        yaEstaban.push(municipalityId);
        continue;
      }

      // La invitación va dirigida a quienes pueden aceptarla: el administrador de la
      // comuna y los trabajadores con es_apoyo_admin, que son exactamente los que el
      // guard de rutas deja entrar a /emergencias.
      //
      // Se inserta UNA FILA POR PERSONA en vez de un solo aviso de comuna: read_at es
      // por fila, así que con una fila compartida el primero que la lee apaga el badge
      // de todos los demás.
      const { rows: destinatarios } = await pool.query(
        `SELECT user_id FROM Users
          WHERE municipality_id = $1 AND is_active = TRUE
            AND (role_id = 1 OR es_apoyo_admin = TRUE)`,
        [municipalityId]
      );

      const mensaje =
        `Tu comuna fue invitada a participar en "${emergencia.name}". Al aceptar, ` +
        `compartirás las prioridades de tus centros activos con las demás comunas participantes.`;

      // Si la comuna no tiene a nadie que pueda aceptarla, queda como aviso de comuna
      // (destinatary null) para que la invitación no se pierda.
      const paraQuien: (number | undefined)[] =
        destinatarios.length > 0 ? destinatarios.map((d: any) => d.user_id) : [undefined];

      for (const destinatary of paraQuien) {
        await createNotification(pool, {
          municipality_id: municipalityId,
          emergency_id: emergencyId,
          destinatary,
          title: 'Invitación a emergencia',
          message: mensaje,
          channel: 'system',
          kind: 'emergency_invitation',
        });
      }
      invitadas.push(municipalityId);
    }

    res.status(201).json({ emergency_id: emergencyId, invitadas, ya_estaban: yaEstaban });
  } catch (err: any) {
    manejarError(res, err, 'inviteMunicipalities');
  }
};

/** La comuna acepta o rechaza la invitación. Solo su administrador decide. */
const respondInvitation: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const municipalityId = requireTenant(req);
    const emergencyId = parseInt(req.params.emergencyId, 10);
    const { accept } = req.body ?? {};

    if (isNaN(emergencyId)) {
      res.status(400).json({ error: 'emergency_id inválido.' });
      return;
    }
    if (typeof accept !== 'boolean') {
      res.status(400).json({ error: 'Se requiere el campo accept (boolean).' });
      return;
    }
    if (user.role_id !== ADMIN_ROLE_ID && !user.es_apoyo_admin) {
      res.status(403).json({
        error: 'ADMIN_REQUERIDO',
        message: 'Solo el administrador de la comuna puede responder una invitación a emergencia.',
      });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE EmergencyParticipants
          SET status = $1, responded_at = now()
        WHERE emergency_id = $2 AND municipality_id = $3
        RETURNING emergency_id, municipality_id, status, responded_at`,
      [accept ? 'participando' : 'rechazada', emergencyId, municipalityId]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Tu comuna no tiene una invitación a esa emergencia.' });
      return;
    }

    // Cierra el aviso en pantalla del administrador para que no vuelva a saltar.
    // Solo el suyo: los avisos por activación (activation_id) los responde su encargado.
    await pool.query(
      `UPDATE CenterNotifications
          SET read_at = now(), updated_at = now()
        WHERE emergency_id = $1 AND municipality_id = $2
          AND activation_id IS NULL AND read_at IS NULL`,
      [emergencyId, municipalityId]
    );

    // Al aceptar, cada centro con activación vigente decide por su cuenta si se suma.
    let avisosEnviados = 0;
    if (accept) {
      const { rows: emRows } = await pool.query(
        `SELECT name FROM Emergencies WHERE emergency_id = $1`,
        [emergencyId]
      );
      avisosEnviados = await avisarEncargadosDeActivaciones(
        emergencyId,
        emRows[0]?.name ?? 'la emergencia',
        municipalityId
      );
    }

    res.json({ ...rows[0], avisos_a_encargados: avisosEnviados });
  } catch (err: any) {
    manejarError(res, err, 'respondInvitation');
  }
};

/**
 * Cierra la emergencia (ended_at).
 *
 * OJO: el cierre es INFORMATIVO. No corta el acceso intercomunal: las prioridades se
 * dejan de compartir al cerrar las activaciones vinculadas o al desvincularlas. Por eso
 * la respuesta devuelve cuántas activaciones siguen abiertas, para que la UI lo advierta.
 */
const closeEmergency: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const emergencyId = parseInt(req.params.emergencyId, 10);
    if (isNaN(emergencyId)) {
      res.status(400).json({ error: 'emergency_id inválido.' });
      return;
    }

    // RLS (emergencies_update) ya restringe a superadmin o comuna creadora.
    const { rows } = await pool.query(
      `UPDATE Emergencies
          SET ended_at = COALESCE(ended_at, now())
        WHERE emergency_id = $1
        RETURNING emergency_id, name, started_at, ended_at`,
      [emergencyId]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'La emergencia no existe o no puedes cerrarla.' });
      return;
    }

    const { rows: pendientes } = await pool.query(
      `SELECT COUNT(*)::int AS abiertas
         FROM CentersActivations
        WHERE emergency_id = $1 AND ended_at IS NULL`,
      [emergencyId]
    );

    res.json({ ...rows[0], activaciones_abiertas: pendientes[0]?.abiertas ?? 0 });
  } catch (err: any) {
    manejarError(res, err, 'closeEmergency');
  }
};

/** Vinculación masiva de activaciones abiertas de la propia comuna. */
const linkActivationsBulk: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const emergencyId = parseInt(req.params.emergencyId, 10);
    const { activation_ids, all_open } = req.body ?? {};

    if (isNaN(emergencyId)) {
      res.status(400).json({ error: 'emergency_id inválido.' });
      return;
    }
    if (!all_open && (!Array.isArray(activation_ids) || activation_ids.length === 0)) {
      res.status(400).json({ error: 'Indica activation_ids o all_open: true.' });
      return;
    }
    if (!(await comunaParticipa(emergencyId, res))) return;

    // RLS acota el UPDATE a activaciones de la propia comuna.
    const { rows } = all_open
      ? await pool.query(
          `UPDATE CentersActivations SET emergency_id = $1
            WHERE ended_at IS NULL AND emergency_id IS DISTINCT FROM $1
            RETURNING activation_id, center_id`,
          [emergencyId]
        )
      : await pool.query(
          `UPDATE CentersActivations SET emergency_id = $1
            WHERE activation_id = ANY($2::int[]) AND ended_at IS NULL
            RETURNING activation_id, center_id`,
          [emergencyId, activation_ids.map(Number)]
        );

    res.json({ emergency_id: emergencyId, vinculadas: rows.length, activaciones: rows });
  } catch (err: any) {
    manejarError(res, err, 'linkActivationsBulk');
  }
};

/** Activaciones abiertas de la comuna, para elegir cuáles vincular. */
const listOwnOpenActivations: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const { rows } = await pool.query(
      `SELECT ca.activation_id, ca.center_id, c.name AS center_name,
              ca.started_at, ca.emergency_id
         FROM CentersActivations ca
         JOIN Centers c ON c.center_id = ca.center_id
        WHERE ca.ended_at IS NULL
        ORDER BY c.name`
    );
    res.json(rows);
  } catch (err: any) {
    manejarError(res, err, 'listOwnOpenActivations');
  }
};

/** La comuna del request debe haber ACEPTADO la invitación, no solo tenerla. */
async function comunaParticipa(emergencyId: number, res: any): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT status FROM EmergencyParticipants
      WHERE emergency_id = $1 AND municipality_id = current_tenant()`,
    [emergencyId]
  );
  if (rows[0]?.status !== 'participando') {
    res.status(403).json({
      error: 'NO_PARTICIPA',
      message: 'Tu comuna debe aceptar la invitación a la emergencia antes de vincular activaciones.',
    });
    return false;
  }
  return true;
}

function manejarError(res: any, err: any, contexto: string) {
  if (err?.status) {
    res.status(err.status).json({ error: err.message, message: err.publicMessage });
    return;
  }
  if (err?.code === '23503') {
    res.status(404).json({ error: 'La emergencia o la comuna indicada no existe.' });
    return;
  }
  if (err?.code === '42501') {
    res.status(403).json({ error: 'No tienes permiso para esta operación sobre la emergencia.' });
    return;
  }
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}


/**
 * Al aceptar una emergencia, la comuna NO vincula sus centros de golpe: se avisa al
 * encargado de cada activación vigente para que decida si su centro se suma.
 *
 * El destinatario es el encargado asignado a la activación (ActivationAssignments
 * vigente); si no hay ninguno, se usa el encargado municipal del centro. Si tampoco
 * hay, no se manda nada: ese centro lo vincula el administrador desde /emergencias.
 */
async function avisarEncargadosDeActivaciones(
  emergencyId: number,
  emergencyName: string,
  municipalityId: number
): Promise<number> {
  const { rows: activaciones } = await pool.query(
    `SELECT ca.activation_id, ca.center_id, c.name AS center_name,
            COALESCE(
              array_remove(array_agg(DISTINCT aa.user_id) FILTER (WHERE aa.end_date IS NULL), NULL),
              ARRAY[]::int[]
            ) AS encargados,
            c.municipal_manager_id
       FROM CentersActivations ca
       JOIN Centers c ON c.center_id = ca.center_id
       LEFT JOIN ActivationAssignments aa ON aa.activation_id = ca.activation_id
      WHERE ca.ended_at IS NULL
        AND ca.emergency_id IS DISTINCT FROM $1
      GROUP BY ca.activation_id, ca.center_id, c.name, c.municipal_manager_id`,
    [emergencyId]
  );

  let enviadas = 0;
  for (const act of activaciones) {
    const destinatarios: number[] = act.encargados?.length
      ? act.encargados
      : act.municipal_manager_id
      ? [act.municipal_manager_id]
      : [];

    for (const destinatary of destinatarios) {
      await createNotification(pool, {
        center_id: act.center_id,
        activation_id: act.activation_id,
        municipality_id: municipalityId,
        emergency_id: emergencyId,
        destinatary,
        kind: 'activation_invitation',
        title: 'Tu centro puede sumarse a una emergencia',
        message:
          `Tu comuna se sumó a "${emergencyName}". ¿Quieres que ${act.center_name} participe? ` +
          `Al aceptar, las demás comunas participantes podrán ver las prioridades de este centro.`,
        channel: 'system',
      });
      enviadas++;
    }
  }
  return enviadas;
}

/**
 * El encargado de un centro decide si su activación se suma a la emergencia.
 * El administrador de la comuna puede corregirlo después desde /emergencias.
 */
const respondActivation: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const emergencyId = parseInt(req.params.emergencyId, 10);
    const activationId = parseInt(req.params.activationId, 10);
    const { accept } = req.body ?? {};

    if (isNaN(emergencyId) || isNaN(activationId)) {
      res.status(400).json({ error: 'Identificadores inválidos.' });
      return;
    }
    if (typeof accept !== 'boolean') {
      res.status(400).json({ error: 'Se requiere el campo accept (boolean).' });
      return;
    }
    if (!(await comunaParticipa(emergencyId, res))) return;

    // RLS acota el UPDATE a activaciones de la propia comuna.
    const { rows } = await pool.query(
      `UPDATE CentersActivations
          SET emergency_id = $1
        WHERE activation_id = $2 AND ended_at IS NULL
        RETURNING activation_id, center_id, emergency_id`,
      [accept ? emergencyId : null, activationId]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Activación no encontrada o ya cerrada.' });
      return;
    }

    // Cierra el aviso en pantalla de esa activación.
    await pool.query(
      `UPDATE CenterNotifications
          SET read_at = now(), updated_at = now()
        WHERE emergency_id = $1 AND activation_id = $2 AND read_at IS NULL`,
      [emergencyId, activationId]
    );

    res.json(rows[0]);
  } catch (err: any) {
    manejarError(res, err, 'respondActivation');
  }
};

router.get('/', listEmergencies);
router.post('/', createEmergency);
// Ojo: las rutas de 'activations' van antes de '/:emergencyId/...' para que el router
// no interprete "activations" como un emergency_id.
router.get('/activations/open', listOwnOpenActivations);
router.patch('/activations/:activationId', linkActivation);
router.get('/:emergencyId/participants', listParticipants);
router.post('/:emergencyId/invite', inviteMunicipalities);
router.post('/:emergencyId/respond', respondInvitation);
router.post('/:emergencyId/link-activations', linkActivationsBulk);
router.post('/:emergencyId/activations/:activationId/respond', respondActivation);
router.patch('/:emergencyId/close', closeEmergency);

export default router;
