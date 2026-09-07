// src/routes/crossSupportRoutes.ts
//
// Tablero intercomunal y ofertas de apoyo entre comunas participantes de una
// misma emergencia.
//
// Quién puede cambiar el estado de una oferta:
//   - la comuna que la ENVIÓ  -> cancelled
//   - la comuna que la RECIBE -> accepted / rejected
// Se valida acá y además en la política cmso_update de la base de datos.
import { Router, RequestHandler } from 'express';
import pool from '../config/db';
import { requireUser, requireTenant, ADMIN_ROLE_ID } from '../auth/requireUser';
import {
  getBoard, listOffers, createOffer, getOfferForUpdate, setOfferStatus,
  type EstadoOferta,
} from '../services/crossSupportService';

const router = Router();

/**
 * La colaboración intercomunal la decide el administrador de la comuna (o un
 * trabajador con es_apoyo_admin), los mismos que el guard de rutas del frontend deja
 * entrar a /emergencias.
 *
 * Hacía falta acá y no solo en el frontend: sin esto, cualquier trabajador municipal
 * podía pedir el tablero directamente a la API y ver los centros y necesidades de las
 * otras comunas.
 */
const soloAdminOApoyo: RequestHandler = (req, res, next) => {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (u.role_id === ADMIN_ROLE_ID || u.es_apoyo_admin === true) {
    next();
    return;
  }
  res.status(403).json({
    error: 'SOLO_ADMIN',
    message: 'Solo el administrador de la comuna gestiona la colaboración intercomunal.',
  });
};

function manejarError(res: any, err: any, contexto: string) {
  if (err?.status) {
    res.status(err.status).json({ error: err.message, message: err.publicMessage });
    return;
  }
  if (err?.code === '23503') {
    res.status(404).json({ error: 'La emergencia o el centro indicado no existe.' });
    return;
  }
  if (err?.code === '42501') {
    res.status(403).json({ error: 'No tienes permiso para esta operación.' });
    return;
  }
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}

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
      message: 'Tu comuna debe estar participando en la emergencia para usar el tablero intercomunal.',
    });
    return false;
  }
  return true;
}

/** Centros activos de las otras comunas participantes, con sus prioridades. */
const board: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const emergencyId = parseInt(req.params.emergencyId, 10);
    if (isNaN(emergencyId)) {
      res.status(400).json({ error: 'emergency_id inválido.' });
      return;
    }
    if (!(await comunaParticipa(emergencyId, res))) return;

    res.json(await getBoard(pool, emergencyId, user.municipality_id));
  } catch (err: any) {
    manejarError(res, err, 'board');
  }
};

const list: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const box = (req.query.box as string) === 'enviadas'
      ? 'enviadas'
      : (req.query.box as string) === 'recibidas'
      ? 'recibidas'
      : 'todas';
    res.json(await listOffers(pool, user.municipality_id, box));
  } catch (err: any) {
    manejarError(res, err, 'listOffers');
  }
};

const create: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const fromMunicipalityId = requireTenant(req);
    const { emergency_id, target_center_id, item_id, message } = req.body ?? {};

    const emergencyId = Number(emergency_id);
    if (!Number.isFinite(emergencyId) || !target_center_id) {
      res.status(400).json({ error: 'Se requieren emergency_id y target_center_id.' });
      return;
    }
    if (!(await comunaParticipa(emergencyId, res))) return;

    // El centro destino debe ser uno de los compartidos por esta emergencia: así no
    // se puede ofrecer apoyo a un centro que la emergencia no expone.
    const { rows: compartidos } = await pool.query(
      `SELECT center_id, municipality_id FROM emergency_shared_centers($1) WHERE center_id = $2`,
      [emergencyId, target_center_id]
    );
    if (compartidos.length === 0) {
      res.status(400).json({
        error: 'CENTRO_NO_DISPONIBLE',
        message: 'Ese centro no participa en la emergencia o no está activo.',
      });
      return;
    }
    if (compartidos[0].municipality_id === fromMunicipalityId) {
      res.status(400).json({
        error: 'CENTRO_PROPIO',
        message: 'El apoyo intercomunal es para centros de otras comunas.',
      });
      return;
    }

    const oferta = await createOffer(pool, {
      emergency_id: emergencyId,
      target_center_id,
      item_id: item_id ?? null,
      message: message ?? null,
      created_by: user.user_id,
      from_municipality_id: fromMunicipalityId,
    });

    // Avisa a la comuna que recibe.
    //
    // No se puede insertar la notificación directamente: la política
    // centernotif_tenant solo deja escribir avisos para la PROPIA comuna, y acá
    // hay que escribirle a otra. notify_support_offer es una función SECURITY
    // DEFINER estrecha —solo recibe el id de la oferta y verifica que quien llama
    // sea su comuna de origen— que compone el mensaje del lado de la base de datos.
    // Tampoco pasa por sendNotification, que dispararía correo.
    await pool.query(`SELECT notify_support_offer($1)`, [oferta.offer_id]);

    res.status(201).json(oferta);
  } catch (err: any) {
    manejarError(res, err, 'createOffer');
  }
};

const updateStatus: RequestHandler = async (req, res) => {
  try {
    const municipalityId = requireTenant(req);
    const offerId = parseInt(req.params.offerId, 10);
    const status = req.body?.status as EstadoOferta;

    if (isNaN(offerId)) {
      res.status(400).json({ error: 'offer_id inválido.' });
      return;
    }
    if (!['accepted', 'rejected', 'cancelled'].includes(status)) {
      res.status(400).json({ error: "status debe ser 'accepted', 'rejected' o 'cancelled'." });
      return;
    }

    const oferta = await getOfferForUpdate(pool, offerId);
    if (!oferta) {
      res.status(404).json({ error: 'La oferta no existe o no es visible para tu comuna.' });
      return;
    }
    if (oferta.status !== 'pending') {
      res.status(409).json({
        error: 'OFERTA_YA_RESUELTA',
        message: `Esta oferta ya está en estado "${oferta.status}".`,
      });
      return;
    }

    const soyOrigen = oferta.from_municipality_id === municipalityId;
    const soyDestino = oferta.target_municipality_id === municipalityId;

    if (status === 'cancelled' && !soyOrigen) {
      res.status(403).json({
        error: 'SOLO_ORIGEN',
        message: 'Solo la comuna que hizo la oferta puede cancelarla.',
      });
      return;
    }
    if ((status === 'accepted' || status === 'rejected') && !soyDestino) {
      res.status(403).json({
        error: 'SOLO_DESTINO',
        message: 'Solo la comuna que recibe la oferta puede aceptarla o rechazarla.',
      });
      return;
    }

    res.json(await setOfferStatus(pool, offerId, status));
  } catch (err: any) {
    manejarError(res, err, 'updateOfferStatus');
  }
};

router.get('/board/:emergencyId', soloAdminOApoyo, board);
router.get('/offers', soloAdminOApoyo, list);
router.post('/offers', soloAdminOApoyo, create);
router.patch('/offers/:offerId', soloAdminOApoyo, updateStatus);

export default router;
