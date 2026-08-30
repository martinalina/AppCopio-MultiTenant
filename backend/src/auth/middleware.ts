// src/auth/middleware.ts
import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "./tokens";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.get("authorization") ?? "";
  const [scheme, rawToken] = header.split(" ");

  if ((scheme || "").toLowerCase() !== "bearer" || !rawToken?.trim()) {
    res.status(401)
      .set("WWW-Authenticate", 'Bearer error="invalid_request"')
      .json({ error: "Missing token" });
    return;
  }

  try {
    const payload = verifyAccessToken(rawToken.trim());
    req.user = payload;
    next();
  } catch (err: any) {
    if (err?.name === "TokenExpiredError") {
      res.status(401)
        .set("WWW-Authenticate", 'Bearer error="invalid_token", error_description="expired"')
        .json({ error: "TOKEN_EXPIRED" });
      return;
    }
    res.status(401)
      .set("WWW-Authenticate", 'Bearer error="invalid_token"')
      .json({ error: "Invalid/expired token" });
    return;
  }
}

/**
 * Autenticación opcional, para endpoints de doble uso (ej. GET /api/centers, que
 * alimenta tanto el mapa público como el listado del panel municipal).
 *
 * Si viene un Bearer válido, deja req.user seteado; si no viene o es inválido, sigue
 * como anónimo en vez de responder 401. Combinar con withTenantOrPublic.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.get("authorization") ?? "";
  const [scheme, rawToken] = header.split(" ");
  if ((scheme || "").toLowerCase() === "bearer" && rawToken?.trim()) {
    try {
      req.user = verifyAccessToken(rawToken.trim());
    } catch {
      // Token vencido o inválido: se atiende como público, no se corta el request.
    }
  }
  next();
}

/**
 * Administrar centros: Administrador (1), Trabajador Municipal (2) o apoyo admin.
 * Deja fuera a Contacto Ciudadano (3), que hasta ahora podía crear centros porque la
 * ruta solo exigía estar autenticado. El Super Administrador (4) tampoco crea centros:
 * solo administra municipalidades.
 */
export function requireCenterManagement(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (u.role_id === 1 || u.role_id === 2 || u.es_apoyo_admin === true) {
    next();
    return;
  }
  res.status(403).json({ error: "Forbidden", message: "No tienes permisos para administrar centros." });
}

export function requireRole(...roleIds: number[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = req.user;
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roleIds.includes(u.role_id)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}