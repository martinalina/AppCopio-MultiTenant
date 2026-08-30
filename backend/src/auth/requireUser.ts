// src/auth/requireUser.ts
import type { Request } from "express";
import type { JwtUser } from "./tokens";

export const SUPERADMIN_ROLE_ID = 4;
export const ADMIN_ROLE_ID = 1;
export const MUNICIPAL_WORKER_ROLE_ID = 2;

export function requireUser(req: Request): JwtUser {
  if (!req.user) {
    const e = new Error("AUTH_REQUIRED");
    (e as any).status = 401;
    throw e;
  }
  return req.user;
}

/** Solo el Super Administrador. Se usa en la gestión de municipalidades. */
export function requireSuperAdmin(req: Request): JwtUser {
  const u = requireUser(req);
  if (u.role_id !== SUPERADMIN_ROLE_ID) {
    const e = new Error("SUPERADMIN_REQUIRED");
    (e as any).status = 403;
    throw e;
  }
  return u;
}

/**
 * Devuelve la comuna del usuario autenticado. Es la ÚNICA fuente válida de
 * municipality_id para cualquier escritura: nunca se toma del body, así un usuario
 * no puede crear datos a nombre de otra comuna.
 *
 * El Super Administrador no tiene comuna, así que no puede crear datos operativos.
 */
export function requireTenant(req: Request): number {
  const u = requireUser(req);
  if (u.municipality_id == null) {
    const e = new Error("TENANT_REQUIRED");
    (e as any).status = 403;
    (e as any).publicMessage =
      "El Super Administrador no opera datos de una comuna; debe hacerlo un usuario municipal.";
    throw e;
  }
  return u.municipality_id;
}

/** Roles que pueden crear y administrar centros dentro de su comuna. */
export function requireCenterManager(req: Request): JwtUser {
  const u = requireUser(req);
  const allowed =
    u.role_id === ADMIN_ROLE_ID ||
    u.role_id === MUNICIPAL_WORKER_ROLE_ID ||
    u.es_apoyo_admin === true;
  if (!allowed) {
    const e = new Error("CENTER_MANAGER_REQUIRED");
    (e as any).status = 403;
    (e as any).publicMessage = "No tienes permisos para administrar centros.";
    throw e;
  }
  return u;
}
