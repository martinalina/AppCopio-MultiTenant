// src/routes/emergencyRoutes.ts
//
// Base de la colaboración intermunicipal. Alcance de esta fase: declarar una
// emergencia, listarlas y que una comuna se una. La UI de invitación, la notificación
// en pantalla y la vinculación masiva de activaciones quedan para la iteración siguiente.
//
// Quién declara qué (las políticas RLS de 002a lo refuerzan en la BD):
//  - Admin municipal: emergencias a nombre de SU comuna (created_by_municipality_id = su comuna),
//    y queda inscrita como primer participante.
//  - Super Administrador: emergencias regionales (created_by_municipality_id = NULL).
import { Router, RequestHandler } from 'express';
import pool from '../config/db';
import { requireUser, SUPERADMIN_ROLE_ID } from '../auth/requireUser';

const router = Router();

const listEmergencies: RequestHandler = async (req, res) => {
  try {
    requireUser(req);
    // RLS ya limita el listado: superadmin ve todas; una comuna ve las suyas y
    // aquellas en las que participa.
    const { rows } = await pool.query(
      `SELECT e.emergency_id, e.name, e.type, e.started_at, e.ended_at,
              e.created_by_municipality_id,
              EXISTS (
                SELECT 1 FROM EmergencyParticipants ep
                WHERE ep.emergency_id = e.emergency_id
                  AND ep.municipality_id = current_tenant()
              ) AS soy_participante
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
        `INSERT INTO EmergencyParticipants (emergency_id, municipality_id)
         VALUES ($1, $2)
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

/** Una comuna se une a sí misma a una emergencia; nadie inscribe a otra. */
const joinEmergency: RequestHandler = async (req, res) => {
  try {
    const user = requireUser(req);
    const emergencyId = parseInt(req.params.emergencyId, 10);
    if (isNaN(emergencyId)) {
      res.status(400).json({ error: 'emergency_id inválido.' });
      return;
    }
    if (user.municipality_id == null) {
      res.status(403).json({ error: 'El Super Administrador no participa como comuna.' });
      return;
    }

    const { rowCount } = await pool.query(
      `INSERT INTO EmergencyParticipants (emergency_id, municipality_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [emergencyId, user.municipality_id]
    );

    res.status(rowCount ? 201 : 200).json({
      emergency_id: emergencyId,
      municipality_id: user.municipality_id,
      ya_participaba: rowCount === 0,
    });
  } catch (err: any) {
    if (err?.status) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // FK violada => la emergencia no existe o no es visible para esta comuna.
    if (err?.code === '23503') {
      res.status(404).json({ error: 'La emergencia no existe.' });
      return;
    }
    console.error('Error en joinEmergency:', err);
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

router.get('/', listEmergencies);
router.post('/', createEmergency);
router.post('/:emergencyId/join', joinEmergency);
router.patch('/activations/:activationId', linkActivation);

export default router;
