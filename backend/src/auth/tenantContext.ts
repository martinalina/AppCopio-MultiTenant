// src/auth/tenantContext.ts
import { Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import pool, { tenantStorage, type TenantStore } from '../config/db';

const SUPERADMIN_ROLE_ID = 4;

/**
 * Fija una variable de sesión acotada a la transacción actual.
 *
 * Ojo: NO se puede usar `SET LOCAL app.current_tenant = $1`. El comando SET de
 * Postgres solo acepta literales o identificadores, no parámetros de bind, así que
 * esa forma revienta con un error de sintaxis. `set_config(name, value, true)` es
 * el equivalente parametrizable y `true` lo hace LOCAL (vive hasta el COMMIT/ROLLBACK).
 */
function setLocal(client: PoolClient, name: string, value: string) {
  return client.query('SELECT set_config($1, $2, true)', [name, value]);
}

/**
 * Debe ir DESPUÉS de requireAuth. Abre una transacción por request, fija
 * app.current_tenant (o app.is_superadmin), y hace COMMIT/ROLLBACK automáticamente
 * al terminar el request.
 */
export async function withTenant(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  const isSuperadmin = user?.role_id === SUPERADMIN_ROLE_ID;

  // Un usuario municipal sin comuna no puede resolverse a ningún tenant. Antes esto
  // caía a un tenant '-1' y el usuario veía todo vacío sin entender por qué; es
  // preferible cortar la sesión para que el frontend fuerce un login nuevo.
  if (!isSuperadmin && user?.municipality_id == null) {
    res.status(401).json({
      error: 'TENANT_MISSING',
      message: 'La sesión no tiene municipalidad asociada. Vuelve a iniciar sesión.',
    });
    return;
  }

  const client = await pool.connect(); // acá tenantStorage aún no tiene store -> conexión real
  try {
    await client.query('BEGIN');

    if (isSuperadmin) {
      await setLocal(client, 'app.is_superadmin', 'true');
    } else {
      await setLocal(client, 'app.current_tenant', String(user!.municipality_id));
    }

    runWithClient(client, res, next);
  } catch (err) {
    await abandonTx(client);
    next(err);
  }
}

/** Igual que withTenant, pero para endpoints públicos (sin JWT): solo habilita is_public_context(). */
export async function withPublicContext(_req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setLocal(client, 'app.public_access', 'true');
    runWithClient(client, res, next);
  } catch (err) {
    await abandonTx(client);
    next(err);
  }
}

/**
 * Para endpoints de doble uso (anónimos y autenticados sobre la misma URL).
 * Debe ir después de optionalAuth.
 *
 * Con sesión resuelve por tenant (el admin ve TODOS los centros de su comuna); sin
 * sesión cae al contexto público (solo lo que la policy pública permite). Nunca los
 * dos a la vez: si se activara public_access dentro de una request autenticada, las
 * policies permisivas se combinarían con OR y se filtrarían datos de otras comunas.
 */
export async function withTenantOrPublic(req: Request, res: Response, next: NextFunction) {
  if (req.user) {
    return withTenant(req, res, next);
  }
  return withPublicContext(req, res, next);
}

/**
 * Estado de cierre POR REQUEST.
 *
 * Ojo: esta marca no puede vivir en el PoolClient ni en un WeakSet indexado por él.
 * Las conexiones se reciclan: al liberarlas vuelven al pool y otra request recibe el
 * mismo objeto. Marcar el client hacía que la request siguiente viera la marca de la
 * anterior, saliera antes de tiempo y dejara su transacción abierta para siempre
 * (fuga de conexiones hasta agotar el pool).
 */
type TxState = TenantStore & { settled: boolean };

function runWithClient(client: PoolClient, res: Response, next: NextFunction) {
  const store: TxState = { client, settled: false };

  // Si Postgres corta la conexión (por ejemplo idle_in_transaction_session_timeout),
  // el client emite 'error'. Sin listener, Node lo trata como excepción no capturada
  // y se cae el proceso entero.
  client.on('error', (err) => {
    console.error('Conexión de tenant caída:', err.message);
    if (!store.settled) {
      store.settled = true;
      client.release(err); // release(err) hace que el pool descarte la conexión
    }
  });

  // El store se captura por closure a propósito: los listeners de 'finish'/'close' se
  // emiten fuera del scope de tenantStorage.run(), así que un getStore() ahí adentro
  // podría devolver undefined y perderíamos el flag de rollback.
  tenantStorage.run(store, () => {
    res.on('finish', () => void finishTx(store, res.statusCode));
    res.on('close', () => void finishTx(store, res.statusCode || 499));
    next();
  });
}

async function finishTx(store: TxState, statusCode: number) {
  if (store.settled) return; // 'finish' y 'close' pueden dispararse ambos
  store.settled = true;

  // rollbackRequested lo marca config/db.ts cuando un service ejecuta su propio
  // ROLLBACK. Ese ROLLBACK interno es no-op (la transacción es de este middleware),
  // así que sin mirar el flag se commitearía justamente lo que se quiso descartar.
  const shouldRollback = statusCode >= 400 || store.rollbackRequested === true;
  const client = store.client;

  try {
    await client.query(shouldRollback ? 'ROLLBACK' : 'COMMIT');
    client.release();
  } catch (e) {
    console.error('Error cerrando transacción de tenant:', e);
    client.release(e as Error); // conexión en estado dudoso: que el pool la descarte
  }
}

/** Cierra una transacción que nunca llegó a entrar al store (fallo durante el setup). */
async function abandonTx(client: PoolClient) {
  try {
    await client.query('ROLLBACK');
    client.release();
  } catch (e) {
    client.release(e as Error);
  }
}
