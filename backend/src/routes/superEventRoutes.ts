// src/routes/superEventRoutes.ts
//
// SuperEventos: el contenedor donde vive TODA la colaboración intermunicipal.
//
// Tres caminos llegan a un SuperEvento, y los tres terminan en la misma entidad:
//   1. El Super Administrador lo crea vacío e invita comunas  -> POST /
//   2. El Super Administrador agrupa emergencias existentes   -> POST /:id/group-emergencies
//   3. Una comuna quiere colaborar y se autocrea              -> POST /from-emergency/:id
//
// Desde que existe, invita CUALQUIER comuna participante, no solo la que lo
// originó: es la política sep_write de 002d. Cerrarlo, en cambio, queda
// reservado al Super Administrador o a la comuna originaria, porque le corta la
// colaboración a todos los demás.
//
// Aceptar la invitación OBLIGA a aportar una emergencia (existente o nueva): una
// comuna 'participando' siempre tiene la suya, así el tablero nunca muestra
// participantes vacíos.
import { Router, RequestHandler } from 'express';
import pool from '../config/db';
import {
  requireUser, requireTenant, requireSuperAdmin,
  SUPERADMIN_ROLE_ID, ADMIN_ROLE_ID,
} from '../auth/requireUser';
import { createEmergency } from '../services/emergencyService';
import {
  listSuperEvents, listParticipants, estadoDe, getSuperEventVigente,
  createSuperEvent, createFromEmergency, groupEmergencies, listEmergenciasHuerfanas,
  inviteMunicipalities, aportarEmergenciaExistente,
  marcarInvitacionLeida, esNivelValido,
} from '../services/superEventService';

const router = Router();

function manejarError(res: any, err: any, contexto: string) {
  if (err?.status) {
    res.status(err.status).json({ error: err.message, message: err.publicMessage });
    return;
  }
  if (err?.code === '23503') {
    res.status(404).json({ error: 'El SuperEvento, la emergencia o la comuna indicada no existe.' });
    return;
  }
  if (err?.code === '42501') {
    res.status(403).json({ error: 'No tienes permiso para esta operación sobre el SuperEvento.' });
    return;
  }
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}

/**
 * La colaboración intermunicipal la decide el administrador de la comuna (o un
 * trabajador con es_apoyo_admin). El Super Administrador también entra: crea y
 * agrupa SuperEventos, aunque no pueda aportar emergencias.
 *
 * Hace falta acá y no solo en el guard del frontend: sin esto, cualquier
 * trabajador municipal podría invitar comunas llamando directo a la API.
 */
const soloAdminOApoyo: RequestHandler = (req, res, next) => {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (u.role_id === ADMIN_ROLE_ID || u.role_id === SUPERADMIN_ROLE_ID || u.es_apoyo_admin === true) {
    next();
    return;
  }
  res.status(403).json({
    error: 'SOLO_ADMIN',
    message: 'Solo el administrador de la comuna gestiona la colaboración intercomunal.',
  });
};

function idValido(res: any, valor: string, campo: string): number | null {
  const n = parseInt(valor, 10);
  if (isNaN(n)) {
    res.status(400).json({ error: `${campo} inválido.` });
    return null;
  }
  return n;
}

/** La comuna del request debe haber ACEPTADO, no solo estar invitada. */
async function comunaParticipa(superEventId: number, municipalityId: number, res: any) {
  const estado = await estadoDe(pool, superEventId, municipalityId);
  if (estado !== 'participando') {
    res.status(403).json({
      error: 'NO_PARTICIPA',
      message: 'Tu comuna debe aceptar la invitación al SuperEvento antes de operar sobre él.',
    });
    return false;
  }
  return true;
}

const list: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    res.json(await listSuperEvents(pool));
  } catch (err: any) {
    manejarError(res, err, 'listSuperEvents');
  }
};

/** Crea un SuperEvento vacío. Solo el Super Administrador. */
const create: RequestHandler = async (req, res) => {
  try {
    const user = requireSuperAdmin(req);
    const { name, level, type, description } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'El campo name es requerido.' });
      return;
    }
    if (!esNivelValido(level)) {
      res.status(400).json({
        error: 'NIVEL_INVALIDO',
        message: "level debe ser 'mayor', 'desastre' o 'catastrofe'.",
      });
      return;
    }

    res.status(201).json(await createSuperEvent(pool, {
      name, level, type: type ?? null, description: description ?? null,
      created_by: user.user_id,
    }));
  } catch (err: any) {
    manejarError(res, err, 'createSuperEvent');
  }
};

/**
 * AUTOCREADO: la comuna ya tiene su emergencia y quiere colaborar.
 *
 * Es el caso que motivó el rediseño. Crea el SuperEvento, mete la emergencia
 * existente dentro, inscribe a la comuna e invita a las demás — todo en la
 * transacción del request, así que si algo falla no queda un SuperEvento vacío.
 */
const fromEmergency: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const municipalityId = requireTenant(req);
    const emergencyId = idValido(res, req.params.emergencyId, 'emergency_id');
    if (emergencyId == null) return;
    const { name, level, type, description, municipality_ids } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'El campo name es requerido.' });
      return;
    }
    if (!esNivelValido(level)) {
      res.status(400).json({
        error: 'NIVEL_INVALIDO',
        message: "level debe ser 'mayor', 'desastre' o 'catastrofe'.",
      });
      return;
    }

    const superEvento = await createFromEmergency(pool, {
      emergency_id: emergencyId,
      name, level, type: type ?? null, description: description ?? null,
      created_by: user.user_id,
      municipality_id: municipalityId,
    });

    let invitadas: number[] = [];
    if (Array.isArray(municipality_ids) && municipality_ids.length > 0) {
      const r = await invitarYAvisar(
        superEvento.super_event_id, municipality_ids, user.user_id, municipalityId
      );
      invitadas = r.invitadas;
    }

    res.status(201).json({ ...superEvento, invitadas });
  } catch (err: any) {
    manejarError(res, err, 'createFromEmergency');
  }
};

/** Agrupa emergencias que ya existen y no tienen SuperEvento. Solo el Super Administrador. */
const group: RequestHandler = async (req, res) => {
  try {
    requireSuperAdmin(req);
    const superEventId = idValido(res, req.params.superEventId, 'super_event_id');
    if (superEventId == null) return;
    const { emergency_ids } = req.body ?? {};

    if (!Array.isArray(emergency_ids) || emergency_ids.length === 0) {
      res.status(400).json({ error: 'emergency_ids debe ser un arreglo con al menos una emergencia.' });
      return;
    }
    await getSuperEventVigente(pool, superEventId);

    res.json(await groupEmergencies(
      pool, superEventId, emergency_ids.map(Number).filter(Number.isFinite)
    ));
  } catch (err: any) {
    manejarError(res, err, 'groupEmergencies');
  }
};

/** Emergencias abiertas sin SuperEvento. Para agrupar (SuperAdmin) y para aceptar (comuna). */
const orphans: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    res.json(await listEmergenciasHuerfanas(pool));
  } catch (err: any) {
    manejarError(res, err, 'listEmergenciasHuerfanas');
  }
};

const participants: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const superEventId = idValido(res, req.params.superEventId, 'super_event_id');
    if (superEventId == null) return;
    res.json(await listParticipants(pool, superEventId));
  } catch (err: any) {
    manejarError(res, err, 'listParticipants');
  }
};

/**
 * Manda las invitaciones y sus avisos en pantalla.
 *
 * El aviso NO se inserta desde acá: la política centernotif_tenant solo deja
 * escribir notificaciones para la PROPIA comuna, y una invitación tiene que
 * aterrizar en la comuna de enfrente. Antes no se notaba porque en la práctica
 * solo invitaba el Super Administrador; ahora invita cualquier participante.
 *
 * Por eso va por notify_super_event_invitation, una función SECURITY DEFINER
 * estrecha —solo recibe qué SuperEvento y a qué comuna, y exige que la fila de
 * invitación ya exista— que compone el mensaje del lado de la base de datos.
 * Tampoco pasa por sendNotification, que dispararía correo.
 */
async function invitarYAvisar(
  superEventId: number,
  municipalityIds: any[],
  invitedBy: number,
  invitedByMunicipalityId: number | null
) {
  const r = await inviteMunicipalities(
    pool, superEventId, municipalityIds.map(Number), invitedBy, invitedByMunicipalityId
  );

  for (const municipalityId of r.invitadas) {
    await pool.query(`SELECT notify_super_event_invitation($1, $2)`, [superEventId, municipalityId]);
  }

  return r;
}

const invite: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const superEventId = idValido(res, req.params.superEventId, 'super_event_id');
    if (superEventId == null) return;
    const { municipality_ids } = req.body ?? {};

    if (!Array.isArray(municipality_ids) || municipality_ids.length === 0) {
      res.status(400).json({ error: 'municipality_ids debe ser un arreglo con al menos una comuna.' });
      return;
    }
    const superEvento = await getSuperEventVigente(pool, superEventId);

    // Cualquier comuna participante puede invitar; el Super Administrador también.
    // La política sep_write lo refuerza en la base, esto solo da el mensaje claro.
    const esSuperadmin = user.role_id === SUPERADMIN_ROLE_ID;
    if (!esSuperadmin && !(await comunaParticipa(superEventId, requireTenant(req), res))) return;

    const r = await invitarYAvisar(
      superEventId, municipality_ids,
      user.user_id, esSuperadmin ? null : user.municipality_id
    );

    res.status(201).json({ super_event_id: superEventId, invitadas: r.invitadas, ya_estaban: r.yaEstaban });
  } catch (err: any) {
    manejarError(res, err, 'inviteMunicipalities');
  }
};

/**
 * La comuna acepta o rechaza. Aceptar OBLIGA a aportar una emergencia.
 *
 * Con emergency_id (una que ya existe) NO se avisa a los encargados de centro:
 * esa emergencia ya convocó a sus centros cuando se creó, y volver a preguntar
 * sería ruido. Con new_emergency SÍ se avisa, porque la emergencia nace acá.
 *
 * Por eso la UI debe mostrar, antes de confirmar con una emergencia existente,
 * qué centros quedarán compartidos (GET /emergencies/:id/linked-activations).
 */
const respond: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const municipalityId = requireTenant(req);
    const superEventId = idValido(res, req.params.superEventId, 'super_event_id');
    if (superEventId == null) return;
    const { accept, emergency_id, new_emergency } = req.body ?? {};

    if (typeof accept !== 'boolean') {
      res.status(400).json({ error: 'Se requiere el campo accept (boolean).' });
      return;
    }
    if (user.role_id !== ADMIN_ROLE_ID && !user.es_apoyo_admin) {
      res.status(403).json({
        error: 'ADMIN_REQUERIDO',
        message: 'Solo el administrador de la comuna puede responder una invitación a un SuperEvento.',
      });
      return;
    }

    const estado = await estadoDe(pool, superEventId, municipalityId);
    if (estado == null) {
      res.status(404).json({ error: 'Tu comuna no tiene una invitación a ese SuperEvento.' });
      return;
    }

    if (!accept) {
      const { rows } = await pool.query(
        `UPDATE SuperEventParticipants SET status = 'rechazada', responded_at = now()
          WHERE super_event_id = $1 AND municipality_id = $2
          RETURNING super_event_id, municipality_id, status, responded_at`,
        [superEventId, municipalityId]
      );
      await marcarInvitacionLeida(pool, superEventId, municipalityId);
      res.json(rows[0]);
      return;
    }

    const superEvento = await getSuperEventVigente(pool, superEventId);

    const traeExistente = emergency_id != null;
    const traeNueva = new_emergency != null && typeof new_emergency?.name === 'string'
      && new_emergency.name.trim() !== '';
    if (traeExistente === traeNueva) {
      res.status(400).json({
        error: 'FALTA_EMERGENCIA',
        message: 'Para aceptar debes aportar exactamente una emergencia: indica emergency_id ' +
                 'de una existente, o new_emergency con su nombre para crearla.',
      });
      return;
    }

    let emergencia: any;
    let avisos = 0;
    if (traeExistente) {
      emergencia = await aportarEmergenciaExistente(pool, superEventId, Number(emergency_id));
    } else {
      // La emergencia nace acá, así que sí hay que preguntarle a cada centro.
      const creada = await createEmergency(pool, {
        name: new_emergency.name,
        type: new_emergency.type ?? null,
        created_by: user.user_id,
        municipality_id: municipalityId,
        super_event_id: superEventId,
      });
      emergencia = creada;
      avisos = creada.avisos_a_encargados;
    }

    // El estado cambia DESPUÉS de aportar: si la vinculación falla, la comuna no
    // queda marcada como participando sin emergencia.
    const { rows } = await pool.query(
      `UPDATE SuperEventParticipants SET status = 'participando', responded_at = now()
        WHERE super_event_id = $1 AND municipality_id = $2
        RETURNING super_event_id, municipality_id, status, responded_at`,
      [superEventId, municipalityId]
    );
    await marcarInvitacionLeida(pool, superEventId, municipalityId);

    res.json({
      ...rows[0],
      super_event_name: superEvento.name,
      emergency_id: emergencia.emergency_id,
      emergency_name: emergencia.name,
      avisos_a_encargados: avisos,
    });
  } catch (err: any) {
    manejarError(res, err, 'respondSuperEvent');
  }
};

/**
 * Cierra el SuperEvento. A diferencia del cierre de una emergencia, este SÍ corta
 * el acceso: las funciones super_event_* exigen ended_at IS NULL, así que el
 * tablero queda vacío y no se pueden crear ofertas nuevas.
 *
 * La política super_events_update lo limita al Super Administrador o a la comuna
 * originaria; un participante cualquiera obtiene 0 filas y recibe un 404.
 */
const close: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    const superEventId = idValido(res, req.params.superEventId, 'super_event_id');
    if (superEventId == null) return;

    const { rows } = await pool.query(
      `UPDATE SuperEvents SET ended_at = COALESCE(ended_at, now())
        WHERE super_event_id = $1
        RETURNING super_event_id, name, level, started_at, ended_at`,
      [superEventId]
    );
    if (!rows[0]) {
      res.status(404).json({
        error: 'NO_PUEDES_CERRARLO',
        message: 'El SuperEvento no existe, o solo pueden cerrarlo el Super Administrador y la comuna que lo originó.',
      });
      return;
    }

    // Las emergencias locales NO se cierran: cada comuna sigue organizándose con
    // la suya. Lo que termina es la colaboración.
    const { rows: emergencias } = await pool.query(
      `SELECT COUNT(*)::int AS abiertas FROM Emergencies
        WHERE super_event_id = $1 AND ended_at IS NULL`,
      [superEventId]
    );

    res.json({ ...rows[0], emergencias_abiertas: emergencias[0]?.abiertas ?? 0 });
  } catch (err: any) {
    manejarError(res, err, 'closeSuperEvent');
  }
};

router.get('/', list);
router.post('/', soloAdminOApoyo, create);
// Van antes de '/:superEventId/...' para que el router no las tome por un id.
router.get('/emergencies/orphans', soloAdminOApoyo, orphans);
router.post('/from-emergency/:emergencyId', soloAdminOApoyo, fromEmergency);
router.get('/:superEventId/participants', participants);
router.post('/:superEventId/invite', soloAdminOApoyo, invite);
router.post('/:superEventId/group-emergencies', soloAdminOApoyo, group);
router.post('/:superEventId/respond', soloAdminOApoyo, respond);
router.patch('/:superEventId/close', soloAdminOApoyo, close);

export default router;
