// src/routes/emergencyRoutes.ts
//
// Emergencias LOCALES de una comuna: crear, cerrar y gestionar qué centros
// participan en ellas.
//
// Desde 002d acá NO hay colaboración intermunicipal. Invitar comunas, el tablero
// y las ofertas viven en el SuperEvento (superEventRoutes.ts / crossSupportRoutes.ts).
// Una emergencia es siempre de UNA comuna: created_by_municipality_id es NOT NULL
// y la política emergencies_tenant_isolation impide ver las ajenas.
//
// El Super Administrador NO crea emergencias: no tiene comuna. Crea SuperEventos.
//
// Consentimiento por centro: al crear la emergencia se avisa a los encargados de
// las activaciones SUELTAS para que decidan si su centro se suma. Después, el
// administrador puede invitar a cualquier activación abierta desde
// POST /:id/invite-activations, incluidas las que rechazaron o las que están en
// otra emergencia y deben trasladarse.
import { Router, RequestHandler } from 'express';
import pool from '../config/db';
import { requireUser, requireTenant } from '../auth/requireUser';
import {
  createEmergency as crearEmergencia,
  invitarActivaciones,
  listActivationsStatus,
  listLinkedActivations,
  responderActivacion,
  vincularActivaciones,
} from '../services/emergencyService';

const router = Router();

function manejarError(res: any, err: any, contexto: string) {
  if (err?.status) {
    res.status(err.status).json({ error: err.message, message: err.publicMessage });
    return;
  }
  if (err?.code === '23503') {
    res.status(404).json({ error: 'La emergencia o la activación indicada no existe.' });
    return;
  }
  if (err?.code === '42501') {
    res.status(403).json({ error: 'No tienes permiso para esta operación sobre la emergencia.' });
    return;
  }
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}

/** La emergencia existe y es de mi comuna (RLS ya lo garantiza; esto da el 404). */
async function emergenciaPropia(emergencyId: number, res: any) {
  const { rows } = await pool.query(
    `SELECT emergency_id, name, ended_at, super_event_id FROM Emergencies
      WHERE emergency_id = $1`,
    [emergencyId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'La emergencia no existe o no pertenece a tu comuna.' });
    return null;
  }
  return rows[0];
}

function idValido(res: any, valor: string, campo: string): number | null {
  const n = parseInt(valor, 10);
  if (isNaN(n)) {
    res.status(400).json({ error: `${campo} inválido.` });
    return null;
  }
  return n;
}

const listEmergencies: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    // RLS ya limita el listado a las emergencias de la propia comuna. El JOIN a
    // SuperEvents pasa por super_events_read, que solo muestra aquellos en los
    // que la comuna participa — y si aporta la emergencia, participa.
    const { rows } = await pool.query(
      `SELECT e.emergency_id, e.name, e.type, e.started_at, e.ended_at,
              e.created_by_municipality_id,
              e.super_event_id, se.name AS super_event_name, se.level AS super_event_level,
              se.ended_at AS super_event_ended_at,
              (SELECT COUNT(*) FROM CentersActivations ca
                WHERE ca.emergency_id = e.emergency_id AND ca.ended_at IS NULL)::int
                AS centros_vinculados
         FROM Emergencies e
         LEFT JOIN SuperEvents se ON se.super_event_id = e.super_event_id
        ORDER BY e.started_at DESC`
    );
    res.json(rows);
  } catch (err: any) {
    manejarError(res, err, 'listEmergencies');
  }
};

const createEmergency: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    // requireTenant rechaza al Super Administrador con 403 TENANT_REQUIRED: no
    // tiene comuna, y toda emergencia es local. Él crea SuperEventos.
    const municipalityId = requireTenant(req);
    const { name, type } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'El campo name es requerido.' });
      return;
    }

    // La comuna NUNCA viene del body: sale del JWT verificado.
    const emergencia = await crearEmergencia(pool, {
      name,
      type: type ?? null,
      created_by: user.user_id,
      municipality_id: municipalityId,
    });

    res.status(201).json(emergencia);
  } catch (err: any) {
    manejarError(res, err, 'createEmergency');
  }
};

/**
 * Cierra la emergencia.
 *
 * Ya no hace falta la advertencia sobre acceso intercomunal que traía antes: desde
 * 002d el acceso lo corta el cierre del SUPEREVENTO, no el de la emergencia. Se
 * sigue devolviendo el conteo de activaciones abiertas como dato operativo.
 */
const closeEmergency: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const emergencyId = idValido(res, req.params.emergencyId, 'emergency_id');
    if (emergencyId == null) return;

    const { rows } = await pool.query(
      `UPDATE Emergencies SET ended_at = COALESCE(ended_at, now())
        WHERE emergency_id = $1
        RETURNING emergency_id, name, started_at, ended_at, super_event_id`,
      [emergencyId]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'La emergencia no existe o no puedes cerrarla.' });
      return;
    }

    const { rows: pendientes } = await pool.query(
      `SELECT COUNT(*)::int AS abiertas FROM CentersActivations
        WHERE emergency_id = $1 AND ended_at IS NULL`,
      [emergencyId]
    );

    res.json({ ...rows[0], activaciones_abiertas: pendientes[0]?.abiertas ?? 0 });
  } catch (err: any) {
    manejarError(res, err, 'closeEmergency');
  }
};

/** Activaciones abiertas de la comuna que todavía no tienen emergencia. */
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

/** Asocia una activación a una emergencia, o la desasocia con null. */
const linkActivation: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const activationId = idValido(res, req.params.activationId, 'activation_id');
    if (activationId == null) return;
    const { emergency_id } = req.body ?? {};

    // RLS acota el UPDATE a activaciones de la propia comuna.
    const { rows } = await pool.query(
      `UPDATE CentersActivations SET emergency_id = $1
        WHERE activation_id = $2
        RETURNING activation_id, center_id, emergency_id`,
      [emergency_id ?? null, activationId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Activación no encontrada.' });
      return;
    }

    if (emergency_id != null) {
      await pool.query(
        `INSERT INTO EmergencyActivationInvitations
           (emergency_id, activation_id, status, invited_by, responded_by, responded_at)
         VALUES ($1, $2, 'aceptada', $3, $3, now())
         ON CONFLICT (emergency_id, activation_id) DO UPDATE
           SET status = 'aceptada', responded_by = EXCLUDED.responded_by, responded_at = now()`,
        [emergency_id, activationId, user.user_id]
      );
    }

    res.json(rows[0]);
  } catch (err: any) {
    if (err?.code === '23503') {
      res.status(400).json({ error: 'La emergencia indicada no existe o no es de tu comuna.' });
      return;
    }
    manejarError(res, err, 'linkActivation');
  }
};

// =================================================================
// GESTIÓN CONTINUA DE CENTROS
//
// La tanda de invitaciones que sale al crear la emergencia es solo la primera.
// Estos tres endpoints cubren todo el ciclo posterior.
// =================================================================

/**
 * TODAS las activaciones abiertas de la comuna con su estado frente a esta
 * emergencia: sin_invitar / invitada / aceptada / rechazada, y en qué emergencia
 * están hoy. Es la pantalla de gestión de centros.
 */
const listActivations: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const emergencyId = idValido(res, req.params.emergencyId, 'emergency_id');
    if (emergencyId == null) return;
    if (!(await emergenciaPropia(emergencyId, res))) return;

    res.json(await listActivationsStatus(pool, emergencyId));
  } catch (err: any) {
    manejarError(res, err, 'listActivations');
  }
};

/** Centros efectivamente vinculados. Vista previa de "qué voy a compartir". */
const listLinked: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const emergencyId = idValido(res, req.params.emergencyId, 'emergency_id');
    if (emergencyId == null) return;
    if (!(await emergenciaPropia(emergencyId, res))) return;

    res.json(await listLinkedActivations(pool, emergencyId));
  } catch (err: any) {
    manejarError(res, err, 'listLinked');
  }
};

/**
 * Invita o REINVITA a las activaciones indicadas, sin importar su estado previo.
 *
 * Es la corrección posterior: sirve para las que rechazaron, para las que están en
 * otra emergencia y deben trasladarse, y para las que quedaron fuera de la primera
 * tanda porque entonces pertenecían a una emergencia que ya terminó.
 */
const inviteActivations: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const municipalityId = requireTenant(req);
    const emergencyId = idValido(res, req.params.emergencyId, 'emergency_id');
    if (emergencyId == null) return;
    const { activation_ids } = req.body ?? {};

    if (!Array.isArray(activation_ids) || activation_ids.length === 0) {
      res.status(400).json({ error: 'activation_ids debe ser un arreglo con al menos una activación.' });
      return;
    }
    const emergencia = await emergenciaPropia(emergencyId, res);
    if (!emergencia) return;
    if (emergencia.ended_at != null) {
      res.status(409).json({
        error: 'EMERGENCIA_CERRADA',
        message: 'No se pueden sumar centros a una emergencia cerrada.',
      });
      return;
    }

    const r = await invitarActivaciones(pool, {
      emergency_id: emergencyId,
      emergency_name: emergencia.name,
      municipality_id: municipalityId,
      activation_ids: activation_ids.map(Number).filter(Number.isFinite),
      invited_by: user.user_id,
    });

    res.status(201).json({
      emergency_id: emergencyId,
      invitadas: r.activaciones,
      avisos_a_encargados: r.avisos,
    });
  } catch (err: any) {
    manejarError(res, err, 'inviteActivations');
  }
};

/** Vinculación en lote, sin preguntarle al encargado. */
const linkActivationsBulk: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const emergencyId = idValido(res, req.params.emergencyId, 'emergency_id');
    if (emergencyId == null) return;
    const { activation_ids, all_open } = req.body ?? {};

    if (!all_open && (!Array.isArray(activation_ids) || activation_ids.length === 0)) {
      res.status(400).json({ error: 'Indica activation_ids o all_open: true.' });
      return;
    }
    if (!(await emergenciaPropia(emergencyId, res))) return;

    res.json(await vincularActivaciones(pool, {
      emergency_id: emergencyId,
      activation_ids,
      all_open,
      user_id: user.user_id,
    }));
  } catch (err: any) {
    manejarError(res, err, 'linkActivationsBulk');
  }
};

/**
 * El encargado del centro responde la invitación.
 *
 * Rechazar NO desvincula: solo registra el rechazo. Antes ponía emergency_id en
 * NULL, lo que sacaba al centro incluso de la emergencia en la que ya estaba.
 */
const respondActivation: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const emergencyId = idValido(res, req.params.emergencyId, 'emergency_id');
    if (emergencyId == null) return;
    const activationId = idValido(res, req.params.activationId, 'activation_id');
    if (activationId == null) return;
    const { accept } = req.body ?? {};

    if (typeof accept !== 'boolean') {
      res.status(400).json({ error: 'Se requiere el campo accept (boolean).' });
      return;
    }
    if (!(await emergenciaPropia(emergencyId, res))) return;

    res.json(await responderActivacion(pool, {
      emergency_id: emergencyId,
      activation_id: activationId,
      accept,
      user_id: user.user_id,
    }));
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
router.get('/:emergencyId/activations', listActivations);
router.get('/:emergencyId/linked-activations', listLinked);
router.post('/:emergencyId/invite-activations', inviteActivations);
router.post('/:emergencyId/link-activations', linkActivationsBulk);
router.post('/:emergencyId/activations/:activationId/respond', respondActivation);
router.patch('/:emergencyId/close', closeEmergency);

export default router;
