import { Router, RequestHandler } from "express";
import pool from "../config/db";
import {
  updateStatus as updateStatusService,
  markRead,
  listByUser,
  listByCenter,
  getNotificationById,
  sendNotification
} from "../services/notificationService";
import type { NotificationStatus } from "../types/notification";
import { requireUser } from "../auth/requireUser";

const router = Router();

const allowedStatus = new Set(['queued', 'sent', 'failed']);
//La cosa del token

// ---------------------------------------------
// POST /notifications  (crear/enviar notificación)
// ---------------------------------------------
const createNotification: RequestHandler = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      center_id,
      activation_id = null,
      destinatary = null,           
      title,
      message,
      event_at = null,
      channel = 'system',
    } = req.body || {};

    if (!center_id || !title || !message) {
      client.release();
      return res.status(400).json({ error: "center_id, title y message son obligatorios" });
    }

    await client.query("BEGIN");
    const result = await sendNotification(client, {
      center_id,
      activation_id,
      destinatary,
      title,
      message,
      event_at,
      channel,
    });
    await client.query("COMMIT");
    client.release();
    
    return res.status(201).json(result);
  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    next(err);
  }
};

// ---------------------------------------------
// PATCH /notifications/:id/status  (actualizar estado)
// body: { status: 'queued'|'sent'|'failed', error?: string }
// ---------------------------------------------
const updateStatus : RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    const { status, error = null, sent_at = null } = req.body || {}; // <-- leer sent_at del body
    if (!id || !status || !allowedStatus.has(status)) {
      return res.status(400).json({ error: "Parámetros inválidos (status debe ser 'queued'|'sent'|'failed')." });
    }
    const row = await updateStatusService(
      pool,
      id,
      status as NotificationStatus,
      error,
      status === 'sent' ? sent_at : null
    );
    return res.json({ data: row });
  } catch (err) {
    if ((err as Error).message === "NOT_FOUND") {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }
    next(err);
  }
};

// ---------------------------------------------
// PATCH /notifications/:id/mark-read  (set read_at)
// body opcional: { read_at: ISO }
// ---------------------------------------------
const markMessageAsRead : RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    const { read_at = null } = req.body || {};
    const row = await markRead(pool, id, read_at);
    return res.json({ data: row });
  } catch (err) {
    if ((err as Error).message === "NOT_FOUND") {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }
    next(err);
  }
};

// ---------------------------------------------
// GET /notifications/:id  (opcional: obtener por id)
// ---------------------------------------------
const getById: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    
    if (id === 'me') {
      const userId = (req as any).user?.user_id; 
      
      if (!userId) {
        return res.status(401).json({ error: "No autenticado" });
      }
      
      const rows = await listByUser(pool, userId);
      return res.json(rows);
    }
    
    const row = await getNotificationById(pool, id);
    if (!row) {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }
    return res.json({ data: row });
  } catch (err) {
    next(err);
  }
};
// ---------------------------------------------
// GET /notifications/by-user/:userId
// query: ?limit=&offset=&status=(queued|sent|failed|any)&since=&until=
// ---------------------------------------------
const getByUser: RequestHandler = async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: "userId inválido" });

    const rows = await listByUser(pool, userId);
    return res.json( rows );
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------
// GET /notifications/by-center/:centerId
// query: ?limit=&offset=&status=&since=&until=
// ---------------------------------------------
const getByCenter: RequestHandler = async (req, res, next) => {
  try {
    const centerId = req.params.centerId;
    const rows = await listByCenter(pool, centerId);
    return res.json(rows );    
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------
// GET /notifications/me  (inbox del usuario autenticado)
//
// El frontend ya llamaba a este endpoint y a /mark-all-read desde
// services/notifications.service.ts, pero NINGUNO existía: daban 404.
// Incluye lo dirigido personalmente al usuario y los avisos de su comuna
// (las invitaciones a emergencias llegan por esta vía). RLS ya acota todo
// lo demás al tenant del request.
// ---------------------------------------------
const getMine: RequestHandler = async (req, res, next) => {
  try {
    const user = requireUser(req);
    const { rows } = await pool.query(
      `SELECT cn.notification_id, cn.center_id, COALESCE(c.name, '') AS center_name,
              cn.municipality_id, cn.emergency_id, e.name AS emergency_name,
              e.ended_at AS emergency_ended_at,
              cn.activation_id, cn.destinatary AS destinatary_id,
              cn.kind, cn.title, cn.message, cn.event_at, cn.channel, cn.status,
              cn.sent_at, cn.read_at, cn.error, cn.created_at, cn.updated_at
         FROM CenterNotifications cn
         LEFT JOIN Centers c ON c.center_id = cn.center_id
         LEFT JOIN Emergencies e ON e.emergency_id = cn.emergency_id
        WHERE cn.destinatary = $1
           OR (cn.municipality_id IS NOT NULL AND cn.destinatary IS NULL)
        ORDER BY cn.event_at DESC
        LIMIT 100`,
      [user.user_id]
    );
    return res.json(rows);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------
// PATCH /notifications/mark-all-read
// ---------------------------------------------
const markAllAsRead: RequestHandler = async (req, res, next) => {
  try {
    const user = requireUser(req);
    const { rowCount } = await pool.query(
      `UPDATE CenterNotifications
          SET read_at = now(), updated_at = now()
        WHERE read_at IS NULL
          AND (destinatary = $1 OR (municipality_id IS NOT NULL AND destinatary IS NULL))`,
      [user.user_id]
    );
    return res.json({ marcadas: rowCount ?? 0 });
  } catch (err) {
    next(err);
  }
};

// Mount
router.post("/", createNotification);
router.patch("/:id/status", updateStatus);
router.patch("/:id/mark-read", markMessageAsRead);

// Ojo: /me y /mark-all-read van ANTES de "/:id", que si no los captura como id.
router.get("/me", getMine);
router.patch("/mark-all-read", markAllAsRead);

router.get("/:id", getById);
router.get("/by-user/:userId", getByUser);
router.get("/by-center/:centerId", getByCenter);

export default router;