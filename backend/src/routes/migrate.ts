import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../config/db';
import { requireSuperAdmin } from '../auth/requireUser';

const router = Router();

// Endpoint protegido para ejecutar la migración
// IMPORTANTE: Eliminar este endpoint después de usarlo o protegerlo adecuadamente
router.post('/migrate-zones', async (req, res) => {
  try {
    // Verificar un token de seguridad (configúralo en .env como MIGRATION_SECRET)
    // OJO: si MIGRATION_SECRET no está definido en el .env, esta comparación es
    // `undefined !== undefined` => false, y el endpoint quedaba ABIERTO a cualquiera.
    // Por eso ahora se exige el secreto configurado Y un Super Administrador.
    const secret = req.headers['x-migration-secret'];
    if (!process.env.MIGRATION_SECRET || secret !== process.env.MIGRATION_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    requireSuperAdmin(req);

    // Las zonas municipales sembradas por este endpoint son de Valparaíso.
    const { rows: valpoRows } = await db.query(
      `SELECT municipality_id FROM Municipalities WHERE shortname = 'VALPO'`
    );
    if (!valpoRows[0]) {
      return res.status(400).json({ error: 'Municipalidad VALPO no encontrada. Corre el seed (003_datos.sql) primero.' });
    }
    const valpoId = valpoRows[0].municipality_id;

    // OMZ Zonas
    // En producción, la ruta es relativa al directorio raíz del proyecto
    const omzZonesPath = path.join(__dirname, '../../../frontend/public/data/omz_zones.json');
    
    // Verificar si el archivo existe
    if (!fs.existsSync(omzZonesPath)) {
      return res.status(400).json({ 
        error: 'Archivo omz_zones.json no encontrado',
        path: omzZonesPath,
        __dirname,
        cwd: process.cwd()
      });
    }

    const omzZones = JSON.parse(fs.readFileSync(omzZonesPath, 'utf8'));
    
    let omzZonesCount = 0;
    for (const feature of omzZones.features) {
      // Verificar si ya existe antes de insertar
      const existing = await db.query(
        'SELECT id FROM municipal_zones WHERE name = $1 AND type = $2',
        [feature.properties.name, 'OMZ']
      );
      
      if (existing.rows.length === 0) {
        await db.query(
          'INSERT INTO municipal_zones (name, type, geojson, icon, color, municipality_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            feature.properties.name,
            'OMZ',
            feature,
            feature.properties.icon || null,
            feature.properties['icon-color'] || null,
            valpoId
          ]
        );
        omzZonesCount++;
      }
    }

    // OMZ Offices
    const omzOfficesPath = path.join(__dirname, '../../../frontend/public/data/omz_offices1.json');
    
    if (!fs.existsSync(omzOfficesPath)) {
      return res.status(400).json({ 
        error: 'Archivo omz_offices1.json no encontrado',
        path: omzOfficesPath,
        __dirname,
        cwd: process.cwd()
      });
    }

    const omzOffices = JSON.parse(fs.readFileSync(omzOfficesPath, 'utf8'));
    
    let omzOfficesCount = 0;
    for (const feature of omzOffices.features) {
      // Verificar si ya existe antes de insertar
      const existing = await db.query(
        'SELECT id FROM municipal_zones WHERE name = $1 AND type = $2',
        [feature.properties.name, 'OMZ_OFFICE']
      );
      
      if (existing.rows.length === 0) {
        await db.query(
          'INSERT INTO municipal_zones (name, type, geojson, icon, color, municipality_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            feature.properties.name,
            'OMZ_OFFICE',
            feature,
            feature.properties.icon || null,
            feature.properties['icon-color'] || null,
            valpoId
          ]
        );
        omzOfficesCount++;
      }
    }

    res.json({ 
      success: true,
      message: 'Migración completada',
      details: {
        omzZones: omzZonesCount,
        omzOffices: omzOfficesCount
      }
    });
  } catch (error) {
    console.error('Error en migración:', error);
    res.status(500).json({ 
      error: 'Error en la migración',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
