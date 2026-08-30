// src/config/db.ts
import { Pool, PoolClient, QueryResult } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';

// Carga dotenv SOLO en desarrollo (para no pisar env de Render)
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
}

const isProd = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || ''; // Render

// Render/Postgres gestionado requiere SSL
const sslConfig = { require: true, rejectUnauthorized: false } as const;

// Con una transacción por request, cada request retiene una conexión durante toda su
// duración. El default de 10 se agota rápido con cargas como la subida de CSV, que
// itera cientos de filas dentro de la transacción.
const poolTuning = {
  max: Number(process.env.DB_POOL_MAX || 30),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30_000),
  idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TX_TIMEOUT_MS || 60_000),
};

// Si existe DATABASE_URL => úsala (Render). Si no, usa las DB_* (local).
const pool = connectionString
  ? new Pool({ connectionString, ssl: sslConfig, ...poolTuning })
  : new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      // YA NO 'postgres' por defecto: los superusuarios ignoran RLS incluso con FORCE.
      user: process.env.DB_USER || 'appcopio_app',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'postgres',
      ssl: isProd ? sslConfig : undefined, // en local normalmente sin SSL
      ...poolTuning,
    });

// Logs útiles para confirmar que NO está usando localhost en prod
pool.on('connect', () => {
  const safeUrl = connectionString
    ? connectionString.replace(/:\/\/.*@/, '://****@')
    : `${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 5432}`;
  console.log('✅ Conexión PostgreSQL OK →', safeUrl);
});

pool.on('error', (err) => {
  console.error('❌ Error en el pool de PostgreSQL', err);
});

// ---------------------------------------------------------------
// Contexto de tenant por request (AsyncLocalStorage)
//
// El repo tiene 13 archivos con BEGIN/COMMIT/ROLLBACK propios y 31 llamadas a
// pool.connect() repartidas en 11 routers. En vez de convertir cada uno en un
// SAVEPOINT a mano, se interceptan pool.query() y pool.connect() una sola vez acá:
// dentro de un request que ya pasó por withTenant/withPublicContext, todo termina
// usando el mismo cliente con el tenant seteado, y los BEGIN/COMMIT internos quedan
// como no-op porque la transacción real la controla el middleware.
// ---------------------------------------------------------------
export type TenantStore = { client: PoolClient; rollbackRequested?: boolean };
export const tenantStorage = new AsyncLocalStorage<TenantStore>();

const CONTROL_STATEMENTS = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);
function isControlStatement(text: unknown): text is string {
  return typeof text === 'string' && CONTROL_STATEMENTS.has(text.trim().toUpperCase());
}

function fakeControlResult(statement: string): Partial<QueryResult> {
  return { rows: [], rowCount: 0, command: statement } as any;
}

const originalQuery = pool.query.bind(pool);
(pool as any).query = (textOrConfig: any, params?: any, callback?: any): any => {
  const store = tenantStorage.getStore();
  if (store) {
    if (isControlStatement(textOrConfig)) {
      const t = textOrConfig.trim().toUpperCase();
      // Un ROLLBACK interno no puede revertir por sí solo (la transacción es del
      // middleware), así que se registra para que finishTx cierre con ROLLBACK.
      if (t === 'ROLLBACK') store.rollbackRequested = true;
      const fake = fakeControlResult(t);
      return callback ? callback(null, fake) : Promise.resolve(fake);
    }
    return (store.client.query as any)(textOrConfig, params, callback);
  }
  return (originalQuery as any)(textOrConfig, params, callback);
};

// Si hay un client de request activo, pool.connect() entrega un Proxy sobre ESE mismo
// client en vez de abrir una conexión nueva (que perdería el SET LOCAL del tenant).
// .release() se vuelve no-op: lo libera el middleware al final del request.
const originalConnect = pool.connect.bind(pool);
(pool as any).connect = async (...args: any[]): Promise<PoolClient> => {
  const store = tenantStorage.getStore();
  if (store) {
    const real = store.client;
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'release') return () => {};
        if (prop === 'query') {
          return (textOrConfig: any, params?: any) => {
            if (isControlStatement(textOrConfig)) {
              const t = textOrConfig.trim().toUpperCase();
              if (t === 'ROLLBACK') store.rollbackRequested = true;
              return Promise.resolve(fakeControlResult(t) as any);
            }
            return (target.query as any)(textOrConfig, params);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as PoolClient;
  }
  return (originalConnect as any)(...args);
};

export default pool;
