// src/services/municipalityService.ts
import bcrypt from 'bcryptjs';
import { Db } from '../types/db';

const ADMIN_ROLE_ID = 1;
const MUNICIPAL_WORKER_ROLE_ID = 2;

/** Qué hacer con el administrador vigente al nombrar uno nuevo. */
export type AccionAdminActual = 'degradar' | 'desactivar';

export type MunicipalityAdminInput = {
  username: string;
  password: string;
  email: string;
  nombre: string;
  rut: string;
};

export async function listMunicipalities(db: Db) {
  const { rows } = await db.query(
    `SELECT municipality_id, name, shortname, is_active, center_seq_counter, created_at
     FROM Municipalities
     ORDER BY name`
  );
  return rows;
}

/**
 * Crea una municipalidad junto con su primer Administrador.
 *
 * Es la única operación de escritura del Super Administrador. El municipality_id del
 * admin se toma de la comuna recién creada, no del body.
 */
export async function createMunicipalityWithAdmin(
  db: Db,
  input: { name: string; shortname: string; admin: MunicipalityAdminInput }
) {
  const { rows: muniRows } = await db.query(
    `INSERT INTO Municipalities (name, shortname)
     VALUES ($1, $2)
     RETURNING municipality_id, name, shortname, is_active, created_at`,
    [input.name, input.shortname.toUpperCase()]
  );
  const municipality = muniRows[0];

  const passwordHash = await bcrypt.hash(input.admin.password, 10);
  const { rows: userRows } = await db.query(
    `INSERT INTO Users (username, password_hash, email, role_id, nombre, rut, is_active, es_apoyo_admin, municipality_id)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE, $7)
     RETURNING user_id, username, email, nombre, role_id, municipality_id`,
    [
      input.admin.username,
      passwordHash,
      input.admin.email,
      ADMIN_ROLE_ID,
      input.admin.nombre,
      input.admin.rut,
      municipality.municipality_id,
    ]
  );

  return { municipality, admin: userRows[0] };
}

/** Administrador vigente de una comuna (role_id = 1 y activo). Null si no hay. */
export async function getCurrentAdmin(db: Db, municipalityId: number) {
  const { rows } = await db.query(
    `SELECT user_id, username, email, nombre, rut, is_active, role_id
       FROM Users
      WHERE municipality_id = $1 AND role_id = $2 AND is_active = TRUE`,
    [municipalityId, ADMIN_ROLE_ID]
  );
  return rows[0] ?? null;
}

export async function getMunicipalityDetail(db: Db, municipalityId: number) {
  const { rows } = await db.query(
    `SELECT m.municipality_id, m.name, m.shortname, m.is_active, m.center_seq_counter, m.created_at,
            (SELECT COUNT(*) FROM Users u WHERE u.municipality_id = m.municipality_id) AS total_usuarios,
            (SELECT COUNT(*) FROM Centers c WHERE c.municipality_id = m.municipality_id) AS total_centros
       FROM Municipalities m
      WHERE m.municipality_id = $1`,
    [municipalityId]
  );
  if (!rows[0]) return null;
  return { ...rows[0], administrador: await getCurrentAdmin(db, municipalityId) };
}

export async function listMunicipalityUsers(db: Db, municipalityId: number) {
  const { rows } = await db.query(
    `SELECT u.user_id, u.username, u.email, u.nombre, u.rut, u.role_id, r.role_name,
            u.is_active, u.es_apoyo_admin, u.created_at
       FROM Users u
       LEFT JOIN Roles r ON r.role_id = u.role_id
      WHERE u.municipality_id = $1
      ORDER BY u.role_id, u.nombre`,
    [municipalityId]
  );
  return rows;
}

export type ReplaceAdminInput = {
  /** Qué pasa con el administrador vigente. Obligatorio si existe uno. */
  accion_actual?: AccionAdminActual;
  /** Promover a un usuario que ya existe en la comuna. */
  promover_user_id?: number;
  /** O crear uno nuevo desde cero. */
  nuevo?: { username: string; password: string; email: string; nombre: string; rut: string };
};

/**
 * Nombra al administrador de una comuna respetando la regla del proyecto: solo puede
 * haber UN administrador (role_id = 1) activo por comuna, así que para poner uno nuevo
 * hay que degradar al actual a Trabajador Municipal o desactivar su cuenta.
 *
 * El orden importa: el índice único parcial users_one_active_admin_per_municipality_uq
 * se evalúa por sentencia, así que primero se libera el puesto y recién después se
 * nombra al reemplazo. Ambas sentencias corren en la transacción del request.
 */
export async function replaceMunicipalityAdmin(
  db: Db,
  municipalityId: number,
  input: ReplaceAdminInput
) {
  const actual = await getCurrentAdmin(db, municipalityId);

  if (actual) {
    if (!input.accion_actual) {
      const e: any = new Error('ADMIN_ACTUAL_REQUIERE_ACCION');
      e.status = 409;
      e.publicMessage =
        `La comuna ya tiene administrador (${actual.nombre ?? actual.username}). ` +
        `Debes degradarlo a Trabajador Municipal o desactivar su cuenta para nombrar otro.`;
      throw e;
    }
    if (input.promover_user_id === actual.user_id) {
      const e: any = new Error('ADMIN_ES_EL_MISMO');
      e.status = 400;
      e.publicMessage = 'El usuario indicado ya es el administrador vigente.';
      throw e;
    }

    // 1) Liberar el puesto ANTES de nombrar al nuevo.
    if (input.accion_actual === 'degradar') {
      // es_apoyo_admin se apaga junto con el rol: si quedara encendido, el usuario
      // seguiría pasando isAdminOrSupport y vería el menú de Administración con el
      // badge de Administrador, que es justo lo que la degradación busca quitarle.
      await db.query(
        `UPDATE Users SET role_id = $1, es_apoyo_admin = FALSE WHERE user_id = $2`,
        [MUNICIPAL_WORKER_ROLE_ID, actual.user_id]
      );
    } else {
      await db.query(`UPDATE Users SET is_active = FALSE WHERE user_id = $1`, [actual.user_id]);
    }
  }

  // 2) Nombrar al nuevo.
  if (input.promover_user_id != null) {
    const { rows } = await db.query(
      `UPDATE Users
          SET role_id = $1, is_active = TRUE, es_apoyo_admin = FALSE
        WHERE user_id = $2 AND municipality_id = $3 AND role_id = $4 AND is_active = TRUE
        RETURNING user_id, username, email, nombre, rut, role_id, is_active`,
      [ADMIN_ROLE_ID, input.promover_user_id, municipalityId, MUNICIPAL_WORKER_ROLE_ID]
    );
    if (!rows[0]) {
      const e: any = new Error('USUARIO_NO_PROMOVIBLE');
      e.status = 400;
      e.publicMessage =
        'Solo se puede promover a un Trabajador Municipal activo de esta comuna. ' +
        'Un Contacto Ciudadano es enlace con la comunidad, no personal municipal.';
      throw e;
    }
    return { anterior: actual, administrador: rows[0], accion_actual: input.accion_actual ?? null };
  }

  if (!input.nuevo) {
    const e: any = new Error('FALTA_NUEVO_ADMIN');
    e.status = 400;
    e.publicMessage = 'Debes indicar promover_user_id o los datos del nuevo administrador.';
    throw e;
  }

  const passwordHash = await bcrypt.hash(input.nuevo.password, 10);
  const { rows } = await db.query(
    `INSERT INTO Users (username, password_hash, email, role_id, nombre, rut, is_active, es_apoyo_admin, municipality_id)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE, $7)
     RETURNING user_id, username, email, nombre, rut, role_id, is_active`,
    [
      input.nuevo.username,
      passwordHash,
      input.nuevo.email,
      ADMIN_ROLE_ID,
      input.nuevo.nombre,
      input.nuevo.rut,
      municipalityId,
    ]
  );

  return { anterior: actual, administrador: rows[0], accion_actual: input.accion_actual ?? null };
}
