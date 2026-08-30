// src/services/municipalityService.ts
import bcrypt from 'bcryptjs';
import { Db } from '../types/db';

const ADMIN_ROLE_ID = 1;

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
