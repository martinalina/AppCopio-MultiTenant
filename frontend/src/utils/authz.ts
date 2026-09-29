import type { User } from "@/types/user";

export const ROLE_ID_ADMIN = 1;
export const ROLE_ID_TMO = 2; // trabajador municipal
export const ROLE_ID_CC  = 3; // contacto comunidad
export const ROLE_ID_SUPERADMIN = 4; // super administrador (sin comuna)

export function isAdminOrSupport(u?: User | null) {
  if (!u) return false;
  return u.role_id === ROLE_ID_ADMIN || !!u.es_apoyo_admin;
}

/**
 * Super Administrador: no pertenece a ninguna comuna. Solo crea municipalidades y su
 * primer administrador; el resto del sistema lo ve, no lo opera. Por eso NO entra en
 * isAdminOrSupport ni en isFieldUser: los menús municipales no le aplican.
 */
export function isSuperAdmin(u?: User | null) {
  if (!u) return false;
  return u.role_id === ROLE_ID_SUPERADMIN;
}

/** Tiene comuna asociada, es decir puede operar datos municipales. */
export function hasTenant(u?: User | null) {
  return !!u && u.municipality_id != null;
}

/**
 * Puede crear y administrar centros: Administrador, Trabajador Municipal o apoyo admin.
 * Debe coincidir con requireCenterManagement del backend.
 */
export function canManageCenters(u?: User | null) {
  if (!u) return false;
  return u.role_id === ROLE_ID_ADMIN || u.role_id === ROLE_ID_TMO || !!u.es_apoyo_admin;
}
export function isFieldUser(u?: User | null) {
  if (!u) return false;
  return (u.role_id === ROLE_ID_TMO || u.role_id === ROLE_ID_CC) && !u.es_apoyo_admin;
}

export function isMunicipalWorker(u?: User | null) {
  if (!u) return false;
  return u.role_id === ROLE_ID_TMO;
}

/**
 * Puede consultar el tablero intercomunal y redactar borradores de oferta.
 *
 * Incluye al trabajador municipal, que es quien está en terreno y sabe qué puede
 * ofrecer su centro, pero deja fuera al Contacto Ciudadano: el tablero expone
 * centros y necesidades de OTRAS comunas.
 *
 * Debe coincidir con soloPersonalMunicipal del backend y con los allowedRoleIds de
 * las rutas del tablero y las ofertas en App.tsx.
 */
export function canSeeIntermunicipal(u?: User | null) {
  if (!u) return false;
  return u.role_id === ROLE_ID_ADMIN || u.role_id === ROLE_ID_TMO || !!u.es_apoyo_admin;
}
