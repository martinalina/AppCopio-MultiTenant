// src/routes/municipalityRoutes.ts
import { Router, RequestHandler } from 'express';
import pool from '../config/db';
import { requireSuperAdmin } from '../auth/requireUser';
import { listMunicipalities, createMunicipalityWithAdmin } from '../services/municipalityService';

const router = Router();

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

router.get('/', list);
router.post('/', create);

export default router;
