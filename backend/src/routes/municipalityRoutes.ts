// src/routes/municipalityRoutes.ts
import { Router, RequestHandler } from 'express';
import pool from '../config/db';
import { requireSuperAdmin } from '../auth/requireUser';
import {
  listMunicipalities,
  createMunicipalityWithAdmin,
  getMunicipalityDetail,
  listMunicipalityUsers,
  replaceMunicipalityAdmin,
} from '../services/municipalityService';

const router = Router();

/** Traduce los errores del servicio a respuestas HTTP, reutilizado por los handlers. */
function responderError(res: any, err: any, contexto: string) {
  if (err?.status) {
    res.status(err.status).json({ error: err.message, message: err.publicMessage });
    return;
  }
  if (err?.code === '23505') {
    res.status(409).json({
      error: 'DUPLICADO',
      message: 'Ya existe un usuario con ese username, email o RUT, o la comuna ya tiene administrador.',
    });
    return;
  }
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

const list: RequestHandler = async (req, res) => {
  try {
    requireSuperAdmin(req);
    const rows = await listMunicipalities(pool);
    res.json(rows);
  } catch (err: any) {
    if (err?.status) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Error en listMunicipalities:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const create: RequestHandler = async (req, res) => {
  try {
    requireSuperAdmin(req);

    const { name, shortname, admin } = req.body ?? {};
    if (!name || !shortname || !admin?.username || !admin?.password || !admin?.email || !admin?.rut) {
      res.status(400).json({
        error: 'Faltan campos: name, shortname, admin.{username,password,email,rut,nombre}',
      });
      return;
    }
    if (typeof shortname !== 'string' || shortname.length < 2 || shortname.length > 5) {
      res.status(400).json({ error: 'shortname debe tener entre 2 y 5 letras.' });
      return;
    }

    const result = await createMunicipalityWithAdmin(pool, { name, shortname, admin });
    res.status(201).json(result);
  } catch (err: any) {
    if (err?.status) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err?.code === '23505') {
      res.status(409).json({ error: 'Ya existe una municipalidad con ese shortname, o un usuario con ese username/email/rut.' });
      return;
    }
    console.error('Error en createMunicipality:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const detail: RequestHandler = async (req, res) => {
  try {
    requireSuperAdmin(req);
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'municipality_id inválido.' });
      return;
    }
    const data = await getMunicipalityDetail(pool, id);
    if (!data) {
      res.status(404).json({ error: 'Municipalidad no encontrada.' });
      return;
    }
    res.json(data);
  } catch (err) {
    responderError(res, err, 'getMunicipalityDetail');
  }
};

const users: RequestHandler = async (req, res) => {
  try {
    requireSuperAdmin(req);
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'municipality_id inválido.' });
      return;
    }
    res.json(await listMunicipalityUsers(pool, id));
  } catch (err) {
    responderError(res, err, 'listMunicipalityUsers');
  }
};

/**
 * Nombra al administrador de la comuna. Si ya hay uno, el body DEBE traer
 * accion_actual ('degradar' | 'desactivar'); si no, responde 409 explicando por qué.
 */
const setAdmin: RequestHandler = async (req, res) => {
  try {
    requireSuperAdmin(req);
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'municipality_id inválido.' });
      return;
    }

    const { accion_actual, promover_user_id, nuevo } = req.body ?? {};
    if (accion_actual && !['degradar', 'desactivar'].includes(accion_actual)) {
      res.status(400).json({ error: "accion_actual debe ser 'degradar' o 'desactivar'." });
      return;
    }
    if (promover_user_id == null && !nuevo) {
      res.status(400).json({ error: 'Debes indicar promover_user_id o los datos de nuevo.' });
      return;
    }
    if (!promover_user_id && nuevo &&
        (!nuevo.username || !nuevo.password || !nuevo.email || !nuevo.rut || !nuevo.nombre)) {
      res.status(400).json({ error: 'nuevo requiere username, password, email, rut y nombre.' });
      return;
    }

    const result = await replaceMunicipalityAdmin(pool, id, { accion_actual, promover_user_id, nuevo });
    res.status(201).json(result);
  } catch (err) {
    responderError(res, err, 'replaceMunicipalityAdmin');
  }
};

router.get('/', list);
router.post('/', create);
router.get('/:id', detail);
router.get('/:id/users', users);
router.post('/:id/admin', setAdmin);

export default router;
