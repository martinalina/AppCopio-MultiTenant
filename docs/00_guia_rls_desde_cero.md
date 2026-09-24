# Guía multi-tenant y RLS en AppCopio

> Guía de entrada, a prueba de desinformados. Asume que conoces el AppCopio
> single-tenant, pero **nada** sobre Row-Level Security. Los otros documentos de esta
> carpeta suponen que ya leíste este.

AppCopio pasó de servir a una municipalidad a servir a muchas sobre la misma base de
datos, y el aislamiento entre ellas no se dejó en manos del código de aplicación sino
de PostgreSQL. Esta guía explica desde cero qué es Row-Level Security, por qué obligó a
crear un usuario de base de datos nuevo, qué hace cada middleware y cómo encaja todo.

---

## 1. Qué problema hay que resolver

**Multi-tenant** significa: un solo sistema, una sola base de datos, un solo despliegue
— pero varias organizaciones (aquí, varias municipalidades) usándolo a la vez sin verse
entre sí. Cada organización se llama **tenant** (inquilino). El edificio es uno; los
departamentos están cerrados con llave.

El AppCopio que ya conoces era **single-tenant**: toda la base de datos pertenecía
implícitamente a una municipalidad. `SELECT * FROM Centers` devolvía "los centros", sin
más, porque no había otros. Esa suposición está escrita en cientos de consultas SQL a
mano por todo el backend.

### Lo que pasa si solo agregas una columna

El instinto es agregar `municipality_id` a cada tabla y filtrar por ella. El problema es
que eso convierte el aislamiento en **una cuestión de disciplina humana**: basta que una
consulta de las cientos que hay olvide el `WHERE` para que una comuna vea los datos de
otra.

```sql
-- Lo que se esperaba que escribiera siempre el programador
SELECT * FROM Centers WHERE municipality_id = 3;

-- Lo que escribió el martes a las 19:40, apurado
SELECT * FROM Centers;   -- ← fuga de datos entre municipalidades
```

Y no es una fuga cualquiera. AppCopio guarda nombres, RUT y composición familiar de
personas damnificadas. Un `WHERE` olvidado no es un bug de presentación: es un incidente
de datos personales.

Hay además una vuelta de tuerca propia del dominio: las comunas a veces **tienen que**
colaborar (un incendio que cruza límites comunales). O sea que la respuesta no puede ser
"aislar y listo": hace falta un aislamiento que sepa abrirse de forma controlada, para
ciertos datos, entre ciertas comunas, durante cierto tiempo.

### La pregunta central de toda la migración

> ¿Cómo se consigue que una consulta que **olvida** filtrar sea inofensiva, en vez de
> peligrosa?

Todo lo que viene a continuación —RLS, un usuario de base de datos nuevo, los
middlewares, las funciones especiales— es la respuesta a esa única pregunta.

---

## 2. Las tres estrategias, y por qué se eligió esta

Para hacer multi-tenant una base relacional hay tres caminos clásicos.

| Estrategia | Cómo se ve | Aislamiento | Costo | Por qué se descartó |
| --- | --- | --- | --- | --- |
| Una base por comuna | 10 comunas = 10 bases | Máximo | Alto: 10 migraciones, 10 respaldos | Inviable para un equipo pequeño; la colaboración intercomunal exigiría consultas entre bases |
| Un esquema por comuna | 1 base, 10 esquemas | Alto | Medio: 10 esquemas que sincronizar | Mismo problema de migraciones multiplicadas |
| **Esquema compartido + columna discriminadora** | 1 base, 1 esquema, `municipality_id` | **Depende del mecanismo** | **Bajo: una migración, un respaldo** | **Elegida** |

Se eligió la tercera, pero **con una condición**: que el aislamiento no dependa del
código de aplicación. Y ahí entra Row-Level Security.

### La idea en una frase

En vez de pedirle al programador que escriba el filtro, se le pide **al motor de
PostgreSQL** que lo agregue solo, en cada consulta, siempre, sin excepción.

```sql
-- Lo que escribe el backend (sin filtro):
SELECT * FROM Centers;

-- Lo que EJECUTA PostgreSQL, porque hay una política RLS activa:
SELECT * FROM Centers WHERE municipality_id = <la comuna de esta sesión>;
```

El programador no puede olvidarse de algo que no escribe. Eso convierte la consulta
descuidada del ejemplo anterior en una consulta **inofensiva**: devuelve solo lo propio,
igual que si hubiera filtrado bien.

### El aislamiento quedó en tres capas

Ninguna capa se confía sola; cada una tapa lo que la anterior podría dejar pasar.

```
┌──────────────────────────────────────────────────────────┐
│ 1. AUTENTICACIÓN                                         │
│    El JWT lleva municipality_id, firmado por el servidor │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 2. MIDDLEWARE withTenant                                 │
│    Abre transacción y fija app.current_tenant            │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 3. POSTGRESQL CON RLS                                    │
│    Filtra cada fila. Es la capa que REALMENTE aísla      │
└──────────────────────────────────────────────────────────┘
```

La capa 1 dice **quién eres** y no se puede falsificar (va firmada). La capa 2 se lo
**cuenta a la base**. La capa 3 es la que **realmente** impide leer de más, y funciona
aunque las dos primeras tuvieran un bug de filtrado.

---

## 3. Row-Level Security explicado desde cero

**RLS = Row-Level Security = seguridad a nivel de fila.** Es una función nativa de
PostgreSQL desde la versión 9.5. Hasta ahora conocías permisos a nivel de *tabla*
(`GRANT SELECT ON Centers TO alguien`). RLS baja un nivel: permite decir **qué filas**
de esa tabla puede ver o tocar cada quien.

La metáfora: `GRANT` decide si tienes llave de la sala de archivadores. RLS decide qué
carpetas de adentro puedes sacar.

### Los tres pasos, siempre en este orden

```sql
-- PASO 1: encender RLS en la tabla.
-- Efecto inmediato y brutal: sin políticas, la tabla queda VACÍA para todos.
-- "Niega todo salvo lo que una política permita expresamente."
ALTER TABLE Centers ENABLE ROW LEVEL SECURITY;

-- PASO 2: forzarlo también para el DUEÑO de la tabla (explicado más abajo).
ALTER TABLE Centers FORCE ROW LEVEL SECURITY;

-- PASO 3: abrir la puerta justa con una política.
CREATE POLICY centers_tenant_isolation ON Centers
  USING      (municipality_id = current_tenant() OR is_superadmin())
  WITH CHECK (municipality_id = current_tenant() OR is_superadmin());
```

Esas tres líneas, repetidas sobre más de 40 tablas, **son** la migración multi-tenant.
Todo lo demás es consecuencia.

### `ENABLE` vs `FORCE`: la diferencia que arruina todo si se omite

- `ENABLE ROW LEVEL SECURITY` activa las políticas… **para todos menos para el dueño de
  la tabla**. PostgreSQL asume que quien creó la tabla debe poder verla entera.
- `FORCE ROW LEVEL SECURITY` elimina esa excepción: **también el dueño queda sujeto a
  las políticas**.

Sin `FORCE`, si el backend se conectara con el usuario que creó las tablas, todas las
políticas serían decorativas: las vería pasar de largo. Por eso en este repo **no hay
una sola tabla con `ENABLE` sin `FORCE`**.

### `USING` vs `WITH CHECK`: leer vs escribir

Esta es la distinción que más cuesta al principio, y es simple:

| Cláusula | Cuándo actúa | Sobre qué fila | Si falla |
| --- | --- | --- | --- |
| `USING` | `SELECT`, `UPDATE`, `DELETE` | La fila **que ya existe** | La fila simplemente **no aparece** |
| `WITH CHECK` | `INSERT`, `UPDATE` | La fila **como quedaría después** | Error explícito, la escritura se rechaza |

La asimetría importa y confunde:

```sql
-- Intento leer un centro de otra comuna:
SELECT * FROM Centers WHERE center_id = 'VINA-C001';
--> 0 filas. NO da error. Para ti, ese centro no existe.

-- Intento crear un centro a nombre de otra comuna:
INSERT INTO Centers (name, municipality_id) VALUES ('Trampa', 99);
--> ERROR: new row violates row-level security policy for table "centers"
```

Leer de más devuelve vacío; escribir de más revienta. Por eso el backend traduce el
código de error `42501` a un 403 HTTP, y los 0 resultados a un 404.

### Un `UPDATE` pasa por las dos

Un `UPDATE` es leer y escribir a la vez, así que PostgreSQL aplica `USING` a la fila
original y `WITH CHECK` a la fila resultante. Eso bloquea el ataque de "mover una fila a
otra comuna":

```sql
-- USING dice: sí, ese centro es tuyo, puedes tocarlo.
-- WITH CHECK dice: pero NO puedes dejarlo perteneciendo a la comuna 7.
UPDATE Centers SET municipality_id = 7 WHERE center_id = 'VALPO-C003';
--> ERROR: new row violates row-level security policy
```

### Varias políticas sobre la misma tabla se suman con OR

Por defecto las políticas son **permisivas**: si hay tres políticas de `SELECT`, basta
que **una** se cumpla para ver la fila. Se suman, no se restan.

`CenterItemPriority` (las necesidades de cada centro) tiene exactamente tres, y el
resultado es la unión de las tres:

```sql
-- 1) Mis propios centros (db/002b)
CREATE POLICY cip_own_read ON CenterItemPriority FOR SELECT
  USING (center_id IN (SELECT c.center_id FROM Centers c
                        WHERE c.municipality_id = current_tenant()));

-- 2) El mapa público, sin sesión, solo centros activos (db/002b)
CREATE POLICY cip_public_read ON CenterItemPriority FOR SELECT
  USING (is_public_context()
         AND center_id IN (SELECT c.center_id FROM Centers c WHERE c.is_active = TRUE));

-- 3) Centros de otras comunas que comparten un SuperEvento conmigo (db/002d)
CREATE POLICY cip_intermunicipal_read ON CenterItemPriority FOR SELECT
  USING (is_superadmin()
         OR center_id IN (SELECT s.center_id FROM super_event_shared_center_ids() s));
```

Que se sumen con OR tiene una consecuencia peligrosa que se explica más abajo (problema
P2): si por error se activara el contexto público dentro de una sesión autenticada, la
política 2 se sumaría a la 1 y un administrador vería los centros activos **de todas las
comunas**. Por eso los contextos son mutuamente excluyentes.

### El truco de "RLS activo y ninguna política" = denegar todo

Como sin políticas no se ve nada, encender RLS y no escribir ninguna política es la
forma de **cerrar una tabla por completo**. Se usó para `RefreshTokens`:

```sql
-- Nadie, por ninguna consulta SQL de la aplicación, puede tocar esta tabla.
-- El único acceso es por funciones controladas (sección 8).
ALTER TABLE RefreshTokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE RefreshTokens FORCE ROW LEVEL SECURITY;
-- (y aquí, deliberadamente, NO va ningún CREATE POLICY)
```

Ni un error de programación ni una inyección SQL pueden leer los tokens de sesión: no
hay puerta que forzar.

---

## 4. Por qué hubo que crear `appcopio_app`

Esta es la parte que parece burocracia y en realidad es **la condición sin la cual nada
de lo anterior existe**.

### La regla de PostgreSQL que lo obliga

> **Un superusuario de PostgreSQL ignora RLS. Siempre. Aunque la tabla tenga
> `FORCE ROW LEVEL SECURITY`.**

No hay forma de apagar eso. Es una decisión de diseño del motor: el superusuario existe
justamente para poder rescatar la base cuando algo sale mal, así que ninguna política lo
detiene.

El AppCopio single-tenant se conectaba como `postgres`, el superusuario que crea Docker
por defecto. Si eso se hubiera dejado así, **las 40+ tablas con RLS habrían quedado
exactamente igual de desprotegidas que antes**, y peor: con la falsa sensación de estar
protegidas. Todas las políticas escritas, ninguna aplicada.

Hay un segundo atributo que produce el mismo desastre: `BYPASSRLS`. Un rol con ese
atributo tampoco pasa por las políticas.

### El rol nuevo

```sql
-- db/002a_multitenant_schema.sql, sección 12
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'appcopio_app') THEN
    CREATE ROLE appcopio_app LOGIN PASSWORD 'CAMBIA_ESTA_PASSWORD_EN_.env';
  END IF;
END $$;

-- Puede hacer su trabajo: leer y escribir datos.
GRANT USAGE ON SCHEMA public TO appcopio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appcopio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appcopio_app;

-- Y sobre las tablas que se creen DESPUÉS, para no tener que acordarse.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appcopio_app;
```

Lo clave es lo que **no** lleva: `CREATE ROLE` sin más no otorga `SUPERUSER` ni
`BYPASSRLS`. El comentario en el archivo lo deja por escrito: *"No cambiar esto: sin
ello todo el RLS de arriba es decorativo."*

### Entonces, ¿quién usa cada rol?

| Rol | Quién lo usa | Pasa por RLS | Para qué |
| --- | --- | --- | --- |
| `postgres` (superusuario) | Solo los scripts de `db_init/` al arrancar el contenedor | No | Crear tablas, roles y políticas; sembrar datos |
| `appcopio_app` | **El backend, siempre** | **Sí** | Toda la operación normal |

Hace falta que sean dos porque **crear un rol requiere ser superusuario**:
`appcopio_app` no puede crearse a sí mismo. El superusuario levanta el escenario;
después se va y no vuelve.

En la práctica eso se ve así:

```yaml
# docker-compose.yml — solo para inicializar la base
POSTGRES_USER: postgres
POSTGRES_DB: appcopio_mt_db
```

```bash
# backend/.env — lo que usa la aplicación
DB_USER=appcopio_app
DB_NAME=appcopio_mt_db
```

Y en el código, el valor por defecto también cambió, porque un defecto malo es una
trampa esperando:

```ts
// backend/src/config/db.ts
// YA NO 'postgres' por defecto: los superusuarios ignoran RLS incluso con FORCE.
user: process.env.DB_USER || 'appcopio_app',
```

### Cómo comprobarlo en 5 segundos

```sql
SELECT rolname, rolsuper, rolbypassrls
  FROM pg_roles WHERE rolname = 'appcopio_app';
--  rolname     | rolsuper | rolbypassrls
-- -------------+----------+--------------
--  appcopio_app| f        | f              ← las dos en 'f' o el aislamiento es falso
```

Si alguna vez ves `t` en cualquiera de esas dos columnas, deja todo lo demás y arregla
eso primero.

---

## 5. Cómo la base de datos sabe de qué comuna eres

Las políticas de la sección 3 dicen `municipality_id = current_tenant()`. Falta explicar
de dónde sale ese `current_tenant()`, porque ahí está el engranaje central.

El detalle importante: **el backend se conecta siempre con el mismo usuario de base de
datos** (`appcopio_app`), sea quien sea la persona que usó la aplicación. Así que la
comuna no puede deducirse del usuario de PostgreSQL. Hay que **decírsela a la sesión**,
en cada petición.

### Variables de sesión: el recado que se le deja a la conexión

PostgreSQL permite guardar variables arbitrarias en la sesión y leerlas después. Son
como un post-it pegado a la conexión.

```sql
-- Dejar el recado (el tercer parámetro true = LOCAL, dura hasta el fin de la transacción)
SELECT set_config('app.current_tenant', '3', true);

-- Leerlo (el segundo parámetro true = no reventar si no existe, devolver NULL)
SELECT current_setting('app.current_tenant', true);   --> '3'
```

El prefijo `app.` es una convención: PostgreSQL acepta cualquier variable con un punto en
el nombre, y `app.` deja claro que es de la aplicación y no del motor.

### Las tres funciones de contexto

En vez de repetir `current_setting(...)` en cada política, se envuelve en tres funciones
pequeñas:

```sql
-- db/002a_multitenant_schema.sql, sección 6

-- ¿De qué comuna es esta sesión? NULL si no se fijó ninguna.
-- NULLIF(..., '') convierte la cadena vacía en NULL antes de castear a INT,
-- porque ''::INT daría error.
CREATE OR REPLACE FUNCTION current_tenant() RETURNS INT AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::INT;
$$ LANGUAGE sql STABLE;

-- ¿Es el Super Administrador? (no tiene comuna, ve todo)
CREATE OR REPLACE FUNCTION is_superadmin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.is_superadmin', true), 'false') = 'true';
$$ LANGUAGE sql STABLE;

-- ¿Es una visita anónima del mapa público?
CREATE OR REPLACE FUNCTION is_public_context() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.public_access', true), 'false') = 'true';
$$ LANGUAGE sql STABLE;
```

`STABLE` le dice al planificador que dentro de una misma sentencia la función devuelve
siempre lo mismo, así que puede evaluarla una vez en vez de una por fila. Sin eso, una
tabla de 100.000 filas haría 100.000 llamadas.

### Por qué `LOCAL` — y por qué obliga a usar transacciones

El `true` final de `set_config` significa **LOCAL**: el valor vive **solo hasta el
`COMMIT` o `ROLLBACK`**. Y eso no es un detalle, es una decisión de seguridad.

Las conexiones de un *pool* se reciclan: la conexión que atendió a Valparaíso vuelve al
pool y la toma la petición siguiente, que puede ser de Viña. Si el tenant fuera de
sesión y no local, Viña heredaría el post-it de Valparaíso.

**Consecuencia directa:** para que `SET LOCAL` sirva de algo, **toda la petición tiene
que correr dentro de una transacción explícita**. De ahí nace el middleware de la
sección 6. Un `pool.query()` suelto fuera de esa transacción perdería el tenant en la
sentencia siguiente.

### La trampa de sintaxis que costó tiempo

El instinto es escribir esto, y **no compila**:

```sql
SET LOCAL app.current_tenant = $1;
-- ERROR: syntax error at or near "$1"
```

El comando `SET` de PostgreSQL solo acepta literales o identificadores, **no parámetros
de bind**. Y concatenar el valor a mano (`SET LOCAL app.current_tenant = ${id}`) sería
abrir la puerta a inyección SQL justo en el mecanismo que protege todo.

La forma parametrizable es la función:

```ts
// backend/src/auth/tenantContext.ts
function setLocal(client: PoolClient, name: string, value: string) {
  // set_config(nombre, valor, is_local) SÍ acepta parámetros $1/$2.
  return client.query('SELECT set_config($1, $2, true)', [name, value]);
}
```

---

## 6. Los middlewares: quién le cuenta a la base quién eres

Un **middleware** de Express es una función que se ejecuta *antes* del manejador de la
ruta y puede enriquecer la petición, cortarla o dejarla pasar con `next()`. Se encadenan
en orden.

En AppCopio multi-tenant la cadena típica es:

```ts
// backend/src/index.ts
app.use('/api/emergencies', requireAuth, withTenant, emergencyRoutes);
//                          ↑            ↑           ↑
//                          |            |           manejadores de la ruta
//                          |            abre transacción y fija el tenant
//                          verifica el JWT y rellena req.user
```

### `requireAuth` — ¿quién eres?

Lee la cabecera `Authorization: Bearer <token>`, verifica la firma del JWT y deja el
contenido en `req.user`. Si no hay token o está vencido, responde 401 y el request
termina ahí.

El JWT lleva `user_id`, `role_id`, `es_apoyo_admin` y **`municipality_id`**. Que vaya
firmado es lo que lo hace confiable: el cliente no puede cambiarlo sin invalidar la
firma. Por eso existe la regla dura del proyecto:

> La comuna **nunca** se toma del cuerpo de la petición. Siempre de
> `req.user.municipality_id`.

Hay una variante, `optionalAuth`, para rutas de doble uso (el listado de centros
alimenta el mapa público *y* el panel municipal): si hay token válido rellena
`req.user`, si no, sigue como anónimo en vez de cortar.

### `withTenant` — contárselo a PostgreSQL

Es el middleware central de toda la migración. Hace cuatro cosas:

```ts
// backend/src/auth/tenantContext.ts (simplificado)
export async function withTenant(req, res, next) {
  const user = req.user;
  const isSuperadmin = user?.role_id === 4;

  // 1. Un usuario municipal sin comuna no puede resolverse a ningún tenant.
  //    Antes caía a un tenant '-1' y el usuario veía TODO vacío sin entender por qué.
  if (!isSuperadmin && user?.municipality_id == null) {
    res.status(401).json({ error: 'TENANT_MISSING', message: 'Vuelve a iniciar sesión.' });
    return;
  }

  const client = await pool.connect();
  try {
    // 2. UNA transacción para toda la petición (obligatorio: SET LOCAL vive dentro de ella).
    await client.query('BEGIN');

    // 3. Fijar el contexto.
    if (isSuperadmin) await setLocal(client, 'app.is_superadmin', 'true');
    else              await setLocal(client, 'app.current_tenant', String(user.municipality_id));

    // 4. Correr el resto del request con ESE cliente, y cerrar al terminar.
    runWithClient(client, res, next);
  } catch (err) {
    await abandonTx(client);
    next(err);
  }
}
```

El cierre es automático, colgado de los eventos de la respuesta:

```ts
async function finishTx(store, statusCode) {
  if (store.settled) return;              // 'finish' y 'close' pueden dispararse ambos
  store.settled = true;

  const shouldRollback = statusCode >= 400 || store.rollbackRequested === true;
  await store.client.query(shouldRollback ? 'ROLLBACK' : 'COMMIT');
  store.client.release();
}
```

O sea: **si la respuesta sale con un código de error, la transacción se revierte
entera**. Eso da atomicidad gratis a operaciones compuestas — por ejemplo, crear un
SuperEvento e invitar comunas: si la invitación falla, no queda un SuperEvento huérfano.

### Los tres modos de contexto

| Middleware | Cuándo | Qué fija | Qué ve |
| --- | --- | --- | --- |
| `withTenant` | Rutas autenticadas | `app.current_tenant` o `app.is_superadmin` | Lo de su comuna (o todo, si es Super Administrador) |
| `withPublicContext` | Rutas públicas sin sesión | `app.public_access` | Solo lo que las políticas públicas permiten |
| `withTenantOrPublic` | Rutas de doble uso | Uno **u** otro, nunca ambos | Según haya sesión o no |

```ts
export async function withTenantOrPublic(req, res, next) {
  // Nunca los dos a la vez: si se activara public_access dentro de una request
  // autenticada, las policies permisivas se combinarían con OR y se filtrarían
  // datos de otras comunas.
  if (req.user) return withTenant(req, res, next);
  return withPublicContext(req, res, next);
}
```

Ese comentario describe un problema real que se encontró y se corrigió (P2 en la
sección 10).

### Los guardias de rol, que son otra cosa

No hay que confundir el contexto de tenant con los permisos por rol. Son capas
distintas:

- **`withTenant`** responde "¿de qué comuna son los datos que puedes tocar?" → lo
  resuelve PostgreSQL.
- **`requireSuperAdmin`, `requireTenant`, `soloAdminOApoyo`** responden "¿tienes el cargo
  para hacer esta acción?" → lo resuelve el backend.

```ts
// backend/src/auth/requireUser.ts
// Devuelve la comuna del usuario. Es la ÚNICA fuente válida de municipality_id
// para cualquier escritura: nunca se toma del body.
export function requireTenant(req: Request): number {
  const u = requireUser(req);
  if (u.municipality_id == null) {
    const e = new Error('TENANT_REQUIRED');
    (e as any).status = 403;
    // El Super Administrador no tiene comuna, así que no puede crear datos operativos.
    throw e;
  }
  return u.municipality_id;
}
```

---

## 7. El interceptor del pool: cómo no reescribir 31 servicios

Hasta aquí hay un problema práctico grande. `withTenant` fija el tenant en **un cliente
concreto** del pool. Pero el código del repo está lleno de esto:

```ts
import pool from '../config/db';
// ...
const { rows } = await pool.query('SELECT * FROM Centers');
//                     ↑ ¡esto pide una conexión CUALQUIERA del pool!
```

Esa conexión cualquiera **no tiene el tenant fijado**, porque el `SET LOCAL` se hizo en
otra. Resultado: cero filas, o peor, comportamiento errático según qué conexión toque.

El repo tenía, al momento de migrar:

- **31 llamadas a `pool.connect()`** repartidas en 11 routers,
- **13 archivos con sus propios `BEGIN`/`COMMIT`/`ROLLBACK`**,
- **23 servicios con `db: Db` inyectado y 8 que importan `pool` directo** — dos estilos
  conviviendo.

Reescribirlos todos a mano habría sido semanas de trabajo y una fuente enorme de errores
por omisión.

### La solución: `AsyncLocalStorage` + un pool que miente amablemente

`AsyncLocalStorage` es una utilidad de Node que mantiene un "contexto" disponible durante
toda una cadena de llamadas asíncronas, sin pasarlo por parámetro. Es, en esencia, una
variable global **por petición**.

```ts
// backend/src/config/db.ts
export type TenantStore = { client: PoolClient; rollbackRequested?: boolean };
export const tenantStorage = new AsyncLocalStorage<TenantStore>();
```

`withTenant` guarda ahí el cliente con el tenant fijado. Y entonces se **intercepta
`pool.query`** una sola vez, en el módulo de configuración:

```ts
const originalQuery = pool.query.bind(pool);

(pool as any).query = (textOrConfig, params?, callback?) => {
  const store = tenantStorage.getStore();

  if (store) {
    // Estamos dentro de un request que ya pasó por withTenant.

    // Los BEGIN/COMMIT/ROLLBACK internos de los servicios viejos se vuelven no-op:
    // la transacción real la controla el middleware.
    if (isControlStatement(textOrConfig)) {
      const t = textOrConfig.trim().toUpperCase();
      // Un ROLLBACK interno no puede revertir por sí solo, así que se ANOTA
      // para que finishTx cierre con ROLLBACK al final del request.
      if (t === 'ROLLBACK') store.rollbackRequested = true;
      const fake = fakeControlResult(t);
      return callback ? callback(null, fake) : Promise.resolve(fake);
    }

    // Cualquier otra consulta va al cliente CON el tenant fijado.
    return store.client.query(textOrConfig, params, callback);
  }

  // Fuera de un request (scripts, arranque): comportamiento normal.
  return originalQuery(textOrConfig, params, callback);
};
```

Y también `pool.connect()`, que devuelve un **Proxy** sobre el mismo cliente en vez de
abrir una conexión nueva:

```ts
(pool as any).connect = async (...args) => {
  const store = tenantStorage.getStore();
  if (store) {
    return new Proxy(store.client, {
      get(target, prop, receiver) {
        // .release() se vuelve no-op: lo libera el middleware al final del request.
        // Si un servicio liberara la conexión a mitad, el tenant se perdería.
        if (prop === 'release') return () => {};
        if (prop === 'query') { /* mismo filtro de BEGIN/COMMIT/ROLLBACK */ }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
  return originalConnect(...args);
};
```

### Qué se ganó con esto

**Ni un solo servicio tuvo que cambiar.** El código que escribe `pool.query(...)` o
`pool.connect()` sigue viendo lo mismo, pero ahora corre dentro de la transacción del
request, con el tenant puesto y sujeto a RLS. Los dos estilos que conviven en el repo
quedan cubiertos por el mismo mecanismo.

### El detalle del `rollbackRequested`

Merece una línea aparte porque es sutil. Si un servicio hace su propio `ROLLBACK`, ese
comando se anula (es no-op) — pero el servicio lo pidió por una razón. Sin la marca, el
middleware haría `COMMIT` al final y **se guardaría justo lo que el servicio quiso
descartar**. La bandera propaga la intención hasta el cierre real.

---

## 8. `SECURITY DEFINER`: la válvula de escape controlada

RLS aísla tan bien que aparece un problema nuevo: **a veces hay que leer legítimamente
más allá del propio tenant**, y desde dentro de una política eso es imposible —
cualquier subconsulta también pasa por RLS y devuelve solo lo propio.

### Qué significa

Toda función de PostgreSQL corre en uno de dos modos:

| Modo | Con qué permisos corre | Es el defecto |
| --- | --- | --- |
| `SECURITY INVOKER` | Los de **quien la llama** — pasa por RLS normalmente | Sí |
| `SECURITY DEFINER` | Los de **quien la creó** (aquí, el dueño de las tablas) — **no pasa por RLS** | No |

La analogía: `SECURITY DEFINER` es una ventanilla. Tú no entras al archivo; le pides algo
concreto a la persona que sí puede entrar, y ella decide si te lo entrega. **La función
es la ventanilla, y su cuerpo es la política de la ventanilla.**

Por eso el peligro es real: dentro de una función `SECURITY DEFINER` **el aislamiento no
existe**. Lo que la vuelve segura es que sea **estrecha**: pocos parámetros, sin texto
libre, con verificación explícita adentro y devolviendo solo las columnas justas.

Todas llevan además `SET search_path = public`, para que nadie pueda anteponer un esquema
propio con tablas falsas y secuestrar la función.

### Caso 1 — El login, que no puede tener tenant todavía

El huevo y la gallina: para saber de qué comuna es alguien hay que leer `Users`; pero
`Users` tiene RLS por comuna; pero la comuna aún no se conoce. Con RLS activo, un
`SELECT` directo devuelve 0 filas y **el login falla para todo el mundo**.

```sql
-- db/002a, sección 6b. La ÚNICA vía de lectura de Users sin tenant,
-- y está acotada a un username exacto: no permite listar ni explorar.
CREATE OR REPLACE FUNCTION auth_lookup_user(p_username TEXT)
RETURNS TABLE (user_id INT, username TEXT, password_hash TEXT, is_active BOOLEAN,
               role_id INT, es_apoyo_admin BOOLEAN, /* ... */ municipality_id INT,
               municipality_shortname TEXT, municipality_name TEXT, role_name TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.user_id, u.username::TEXT, /* ... */ m.name::TEXT, r.role_name::TEXT
  FROM Users u
  LEFT JOIN Roles r ON r.role_id = u.role_id
  LEFT JOIN Municipalities m ON m.municipality_id = u.municipality_id
  WHERE u.username = p_username;   -- ← exacto, no LIKE, no sin WHERE
$$;
```

### Caso 2 — Encapsular una tabla cerrada a cal y canto

Recuerda `RefreshTokens`: RLS activo, cero políticas, nadie entra. Sus siete operaciones
se convirtieron en siete funciones:

```sql
-- db/002c, sección 5
CREATE OR REPLACE FUNCTION refresh_token_find(p_user_id INT, p_token_hash TEXT)
RETURNS TABLE (id BIGINT, user_id INT, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at
  FROM RefreshTokens rt
  WHERE rt.user_id = p_user_id AND rt.token_hash = p_token_hash;
$$;
-- Fijate que NO devuelve token_hash: ni siquiera la ventanilla entrega el secreto.
```

### Caso 3 — Un trigger que necesita escribir donde el usuario no puede

Los identificadores de centro son `VALPO-C001`, con correlativo por comuna. El trigger
que los genera incrementa un contador en `Municipalities`, tabla que solo el Super
Administrador puede modificar:

```sql
-- db/002a, sección 5
-- SECURITY DEFINER es obligatorio: el trigger hace UPDATE sobre Municipalities,
-- que tiene FORCE RLS. Sin esto, el UPDATE afecta 0 filas, v_seq queda NULL
-- y ningún admin municipal puede crear un centro.
CREATE OR REPLACE FUNCTION generate_center_id() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shortname TEXT; v_seq INT;
BEGIN
  IF NEW.center_id IS NOT NULL THEN RETURN NEW; END IF;

  UPDATE Municipalities
     SET center_seq_counter = center_seq_counter + 1
   WHERE municipality_id = NEW.municipality_id
   RETURNING center_seq_counter, shortname INTO v_seq, v_shortname;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'Municipality % no existe', NEW.municipality_id;
  END IF;

  NEW.center_id := v_shortname || '-C' || LPAD(v_seq::text, 3, '0');
  RETURN NEW;
END;
$$;
```

### Caso 4 — La colaboración entre comunas

Aquí está el uso más interesante, y el que muestra cómo se hace una ventanilla
**segura**. El tablero intercomunal tiene que mostrar centros de otras comunas — pero
solo algunos, y solo algunas columnas.

```sql
-- db/002d, 7c. Devuelve SOLO lo que la regla del proyecto permite cruzar:
-- ubicación, capacidad, % de llenado y estado operacional.
-- NUNCA CentersDescription, FamilyGroups, Persons ni cantidades de inventario.
CREATE OR REPLACE FUNCTION super_event_shared_centers(p_super_event_id INT)
RETURNS TABLE (
  center_id VARCHAR, name TEXT, latitude DECIMAL, longitude DECIMAL,
  capacity INT, fullness_percentage INT, operational_status TEXT,
  municipality_id INT, municipality_shortname TEXT, activation_id INT,
  emergency_id INT, emergency_name TEXT
)   -- ↑ el límite está escrito AQUÍ, en la base, no en TypeScript
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.center_id, c.name::TEXT, c.latitude, c.longitude, /* ... */
  FROM Centers c
  JOIN CentersActivations ca ON ca.center_id = c.center_id AND ca.ended_at IS NULL
  JOIN Emergencies e ON e.emergency_id = ca.emergency_id
                    AND e.super_event_id = p_super_event_id
  JOIN SuperEvents se ON se.super_event_id = e.super_event_id
                    AND se.ended_at IS NULL        -- el evento sigue abierto
  JOIN SuperEventParticipants duena                -- la comuna DUEÑA participa
    ON duena.super_event_id = se.super_event_id
   AND duena.municipality_id = c.municipality_id
   AND duena.status = 'participando'
  WHERE c.is_active = TRUE
    AND (
      is_superadmin()
      OR EXISTS (                                  -- y QUIEN LEE también participa
        SELECT 1 FROM SuperEventParticipants yo
        WHERE yo.super_event_id = p_super_event_id
          AND yo.municipality_id = current_tenant()
          AND yo.status = 'participando'
      )
    );
$$;
```

Los cuatro candados de esa función: el evento abierto, la comuna dueña participando, la
comuna lectora participando, y el conjunto de columnas fijado en la firma. **Que el
límite de columnas viva en la base y no en el servicio significa que nadie puede
ampliarlo por descuido escribiendo TypeScript.**

Hay una variante del mismo patrón para **escribir** en otra comuna:
`notify_super_event_invitation` y `notify_support_offer` existen porque la política de
notificaciones solo deja escribir avisos para la propia comuna, y una invitación tiene
que aterrizar en la de enfrente. Ambas verifican antes de escribir:

```sql
-- db/002d, 7e. Lo único que impide notificar a nombre de otra comuna,
-- porque la lectura de arriba omitió RLS por ser SECURITY DEFINER.
IF v_offer.from_municipality_id IS DISTINCT FROM current_tenant() THEN
  RAISE EXCEPTION 'SOLO_LA_COMUNA_DE_ORIGEN_PUEDE_AVISAR';
END IF;
```

### Los permisos de las funciones

Crear la ventanilla no basta; hay que decidir quién puede tocar el timbre. Por defecto
**cualquiera** puede ejecutar una función nueva, así que se revoca y se otorga
explícitamente:

```sql
REVOKE ALL ON FUNCTION super_event_shared_centers(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION super_event_shared_centers(INT) TO appcopio_app;
```

---

## 9. Cómo se cubrieron más de 40 tablas: cuatro patrones

No todas las tablas se parecen. `Centers` tiene comuna propia; `DatasetFieldOptions`
cuelga de un campo, que cuelga de un dataset, que sí tiene comuna. Se usó el patrón más
barato en cada caso.

### Patrón A — Columna directa (lo más simple)

La tabla lleva su propio `municipality_id`. Como son varias tablas idénticas, se aplicó
en bucle:

```sql
-- db/002a, sección 7
-- Ojo: los nombres van en minúscula. Las tablas se crearon sin comillas, así que
-- en pg_class son 'users', 'centers', etc. format('%I','Users') produciría "Users"
-- (con comillas) y fallaría: esa tabla no existe.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','centers','centersactivations','familygroups',
                           'persons','centerinventoryitems','datasets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I
         USING      (municipality_id = current_tenant() OR is_superadmin())
         WITH CHECK (municipality_id = current_tenant() OR is_superadmin())',
      t, t);
  END LOOP;
END $$;
```

Caso especial: **`Persons` lleva columna propia aunque podría deducirla** por
subconsulta. Es dato sensible que nunca cruza de comuna, así que se prefiere un
`WITH CHECK` real (no `true`) y evitar un join de tres tablas por fila en cada lectura.

### Patrón B — Catálogo dual: `NULL` significa "de todos"

Productos, categorías, plantillas y zonas pueden ser globales (sembrados por la
plataforma) o propios de una comuna:

```sql
-- db/002a, sección 8
CREATE POLICY categories_tenant_or_global ON Categories
  USING      (municipality_id IS NULL          -- ← catálogo global, visible para todos
              OR municipality_id = current_tenant()
              OR is_superadmin())
  WITH CHECK (municipality_id IS NULL
              OR municipality_id = current_tenant()
              OR is_superadmin());
```

Eso obligó además a repensar los índices únicos. El original era `UNIQUE(name)` global,
lo que impedía que dos comunas tuvieran un producto con el mismo nombre:

```sql
ALTER TABLE Products DROP CONSTRAINT products_name_key;

-- Únicos entre los globales...
CREATE UNIQUE INDEX products_name_global_uq ON Products (name)
  WHERE municipality_id IS NULL;
-- ...y únicos por comuna entre sí.
CREATE UNIQUE INDEX products_name_tenant_uq ON Products (name, municipality_id)
  WHERE municipality_id IS NOT NULL;
```

### Patrón C — Subconsulta al padre (tablas satélite)

Para tablas de poco volumen que cuelgan de otra, no vale la pena agregar columna: la
política pregunta al padre.

```sql
-- db/002c, sección 3
CREATE POLICY datasetfields_via_padre ON DatasetFields
  USING (dataset_id IN (SELECT d.dataset_id FROM Datasets d));
```

Lo elegante: esa subconsulta **también pasa por RLS**. `Datasets` ya está aislada, así
que solo devuelve los datasets de mi comuna, y la política hereda el aislamiento sin
repetir la condición. El aislamiento se propaga solo.

### Patrón D — Columna + trigger de herencia (tablas hoja de volumen)

Para tablas grandes (`InventoryLog`, `DatasetRecords`, turnos, asignaciones), la
subconsulta en cada lectura sería cara. Llevan columna propia, pero **rellenada
automáticamente** para que ningún `INSERT` del backend tenga que cambiar:

```sql
-- db/002c, sección 1
-- Corre como INVOCADOR a propósito (NO SECURITY DEFINER): la consulta al padre
-- pasa por RLS, así que si el centro no es de tu comuna la subconsulta devuelve
-- NULL y el NOT NULL rechaza la fila. El aislamiento de ESCRITURA se aplica solo.
CREATE OR REPLACE FUNCTION heredar_comuna_de_centro() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.municipality_id IS NULL THEN   -- solo si no vino explícito
    NEW.municipality_id := (
      SELECT c.municipality_id FROM Centers c WHERE c.center_id = NEW.center_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventorylog_comuna BEFORE INSERT ON InventoryLog
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_de_centro();
```

Ese comentario esconde algo bonito: **el trigger se convierte en un mecanismo de
seguridad por accidente feliz**. Si intentas registrar un movimiento de inventario sobre
un centro ajeno, el `SELECT` interno no lo encuentra (RLS), la columna queda `NULL`, y el
`NOT NULL` rechaza la fila.

Y el orden de las sentencias importa:

```sql
-- El NOT NULL se aplica DESPUÉS de crear los triggers: así el seed puede insertar
-- sin declarar la columna y el trigger la completa.
ALTER TABLE InventoryLog ALTER COLUMN municipality_id SET NOT NULL;
```

### Resumen de dónde está cada cosa

| Archivo | Qué contiene |
| --- | --- |
| `db/001_tablas.sql` | El esquema single-tenant original, sin tocar |
| `db/002a_multitenant_schema.sql` | `Municipalities`, rol `appcopio_app`, funciones de contexto, RLS del núcleo |
| `db/002b_emergencias_y_notificaciones.sql` | Notificaciones municipales, un solo admin activo, lecturas de prioridades |
| `db/002c_rls_tablas_restantes.sql` | Triggers de herencia, tablas satélite, `RefreshTokens`, ofertas |
| `db/002d_supereventos.sql` | SuperEventos y toda la colaboración intercomunal |
| `db/003_datos.sql` y `005_datos_validacion.sql` | Datos sembrados |

El orden alfabético **es** el orden de ejecución: Docker corre los scripts de ese
directorio en ese orden. Por eso los sufijos `a`, `b`, `c`, `d`. Y por eso nunca se hace
un `ALTER` a mano contra una base viva: el entorno se recrea entero con
`docker compose down -v && docker compose up`.

---

## 10. Los tropiezos reales (y qué enseña cada uno)

El catálogo completo está en `docs/02_implementacion_tecnica.md`, sección 6, con 39
problemas numerados. Aquí van los que mejor explican **cómo se comporta RLS en la
práctica**, que es distinto de cómo se lee en la documentación.

### P1 — Activar RLS sobre `Users` rompió el login de todos

**Síntoma:** nadie podía entrar. **Causa:** el login lee `Users` para averiguar la
comuna, pero RLS ya exigía saber la comuna para leer `Users`. **Lección:** toda tabla que
se consulta *antes* de conocer el tenant necesita una vía `SECURITY DEFINER` acotada.

### P2 — Fuga de tenant por montar `withPublicContext` a nivel de prefijo

**Síntoma:** un administrador municipal veía centros activos de otras comunas.
**Causa:** el middleware público se había montado sobre todo el prefijo `/api/centers`,
así que `app.public_access` quedaba activo **también** en peticiones autenticadas — y
como las políticas permisivas se suman con OR, la política pública ampliaba lo que veía
el admin.

**Lección:** los contextos tienen que ser mutuamente excluyentes, y los routers que
mezclan endpoints públicos y privados aplican el middleware **por ruta**, nunca por
prefijo. En `index.ts` está escrito:

```ts
// Los routers que MEZCLAN endpoints públicos y privados bajo el mismo prefijo
// (centerRoutes, prioritiesRoutes, volunteerRoutes, serviceRequestRoutes) NO reciben
// middleware acá: lo aplican por ruta en su propio archivo.
app.use("/api/centers", centerRoutes);
```

### P11 — Una comuna no podía leer sus **propias** prioridades

**Causa:** en el primer diseño la única política de `SELECT` sobre `CenterItemPriority`
era la intercomunal. Al ser RLS "denegar por defecto", no tener política propia
significaba **no ver lo propio**.

**Lección:** con RLS hay que acordarse de permitir explícitamente lo obvio. Lo que no
está escrito, no existe.

### P12 — El conteo de participantes siempre daba 1

**Causa:** `SELECT COUNT(*) FROM SuperEventParticipants WHERE super_event_id = 5`
devolvía 1 porque la política `sep_read` solo deja ver **la fila propia**. El conteo era
correcto: contaba lo que la comuna podía ver.

**Lección:** con RLS, los agregados (`COUNT`, `SUM`, `AVG`) se calculan **sobre las filas
visibles**. Si necesitas contar lo que no puedes ver, necesitas una ventanilla. Se
resolvió así:

```sql
(SELECT COUNT(*) FROM super_event_participants_of(se.super_event_id) p
  WHERE p.status = 'participando')::int AS total_participando
```

### P19 — Fuga de conexiones que agotaba el pool y caía el proceso

**Causa:** la marca de "esta transacción ya se cerró" se guardaba en el objeto
`PoolClient`. Pero **las conexiones se reciclan**: al liberarlas vuelven al pool y otra
petición recibe el mismo objeto, ya marcado. Esa petición salía antes de tiempo y dejaba
su transacción abierta para siempre.

**Lección:** nunca guardes estado por petición en un objeto que el pool reutiliza. El
estado se movió al store del `AsyncLocalStorage`, que sí es por petición.

Del mismo problema salió otra pieza: hay que escuchar el evento `error` del cliente,
porque si PostgreSQL corta la conexión y nadie escucha, Node lo trata como excepción no
capturada y **se cae el proceso entero**.

### P38 y P39 — Las dos trampas de RLS al invitar comunas

Estas dos son las más instructivas de todas, porque muestran que **RLS no solo filtra
lecturas: cambia la forma del código que escribes**.

Al invitar una comuna se crea una fila cuyo `municipality_id` es el de la comuna
**invitada**. La política `sep_read` solo deja ver la fila propia → **quien invita no
puede ver la fila que acaba de crear**. De ahí salen dos consecuencias:

**P38 — No se puede avisarle a la comuna invitada.** La política de notificaciones solo
deja escribir avisos para la propia comuna. Se resolvió con
`notify_super_event_invitation`, una ventanilla que compone el mensaje en la base y exige
que la fila de invitación ya exista.

**P39 — `ON CONFLICT` bloquea un `INSERT` que el `WITH CHECK` sí permite.** PostgreSQL
exige que la fila nueva sea visible bajo la política de `SELECT` cuando hay
`ON CONFLICT`, y aborta con *"new row violates row-level security policy"* aunque el
`WITH CHECK` se cumpla. Se verificó que falla incluso con `WITH CHECK (true)`, y que deja
de fallar si `sep_read` fuera `USING(true)`.

La solución final tiene tres piezas, y ninguna es obvia:

```ts
// backend/src/services/superEventService.ts
for (const raw of municipalityIds) {
  const municipalityId = Number(raw);

  // 1. SAVEPOINT: todo el request es UNA transacción, así que sin esto la
  //    primera comuna repetida abortaría la transacción entera.
  await db.query('SAVEPOINT invitacion');
  try {
    // 2. INSERT a secas: sin ON CONFLICT (P39) y sin RETURNING (no se ve la fila).
    await db.query(
      `INSERT INTO SuperEventParticipants
         (super_event_id, municipality_id, status, invited_by, invited_by_municipality_id)
       VALUES ($1, $2, 'invitada', $3, $4)`,
      [superEventId, municipalityId, invitedBy, invitedByMunicipalityId]
    );
    await db.query('RELEASE SAVEPOINT invitacion');
    invitadas.push(municipalityId);
  } catch (err: any) {
    await db.query('ROLLBACK TO SAVEPOINT invitacion');
    await db.query('RELEASE SAVEPOINT invitacion');
    // 3. El ÚNICO modo fiable de saber que ya estaba invitada: las comprobaciones
    //    de unicidad de Postgres SÍ ignoran RLS, así que el 23505 sí llega.
    if (err?.code === '23505') { yaEstaban.push(municipalityId); continue; }
    throw err;
  }
}
```

Un `SELECT` previo tampoco habría servido: no vería la fila ajena y siempre diría "no
existe".

### El patrón común de todos estos errores

Casi todos comparten una misma forma: **algo que funcionaba se volvió invisible**, y el
síntoma fue cero filas en vez de un error. Con RLS activo, la primera hipótesis ante un
resultado vacío no debe ser "el `WHERE` está mal" sino "¿qué política me lo está
escondiendo, y estoy en el contexto correcto?".

---

## 11. Cómo comprobar que el aislamiento es real

La trampa de RLS es que **una implementación rota se ve exactamente igual que una
correcta** mientras uses la aplicación con un solo usuario. Hay que ir a buscarla.

### Paso 0 — Recrear el entorno desde cero

```bash
docker compose down -v && docker compose up
```

El `-v` borra los volúmenes. Sin él, los scripts de `db_init/` **no vuelven a correr**
(Docker solo los ejecuta cuando el volumen está vacío) y estarías probando el esquema
viejo.

### Paso 1 — El rol no debe poder saltarse RLS

Si esto falla, todo lo demás da igual.

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'appcopio_app';
-- se espera: f | f
```

### Paso 2 — Todas las tablas con RLS activo y forzado

```sql
-- Tablas SIN row security: deberían ser solo las que no llevan datos de comuna.
SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class
 WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
   AND (relrowsecurity = false OR relforcerowsecurity = false)
 ORDER BY relname;
```

Busca especialmente `relforcerowsecurity = false` con `relrowsecurity = true`: esa
combinación es la que deja al dueño pasar de largo.

### Paso 3 — La prueba más directa: sin tenant, sin datos

Esta es la más contundente porque no depende de la aplicación en absoluto.

```bash
# Como appcopio_app, SIN fijar ningún tenant.
docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAc \
  "SELECT COUNT(*) FROM Centers;"
# se espera: 0
```

Si devuelve el total de centros, RLS no está haciendo nada. **Cero filas fuera de
contexto es la señal de que el aislamiento no depende de que el backend recuerde
filtrar.**

### Paso 4 — Con tenant, solo lo propio

Recuerda que `SET LOCAL` vive dentro de la transacción, así que ambas sentencias deben ir
en la misma:

```bash
docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAq \
  -c "BEGIN" \
  -c "SELECT set_config('app.current_tenant','1',true)" \
  -c "SELECT COUNT(*) FROM Centers" \
  -c "COMMIT"
# se espera: solo los centros de la comuna 1
```

Cambia el `1` por otra comuna y comprueba que el número cambia. Si da lo mismo en las
dos, algo está mal.

### Paso 5 — Que las escrituras cruzadas exploten

```sql
BEGIN;
SELECT set_config('app.current_tenant','1',true);
-- Intento crear un centro a nombre de la comuna 2:
INSERT INTO Centers (name, municipality_id, address, capacity)
VALUES ('Trampa', 2, 'x', 10);
-- se espera: ERROR ... violates row-level security policy
ROLLBACK;
```

El `ROLLBACK` es lo que hace segura la comprobación: aunque la política fallara y la fila
entrara, no queda nada escrito.

### Paso 6 — Por la API, que es lo que ve el usuario

Haz login como administrador de la comuna A y pide un recurso de la comuna B por su
identificador. Lo esperado es **403, 404 o cero filas — nunca datos**. Repítelo con:

- un centro de otra comuna,
- una emergencia de otra comuna,
- el tablero de un SuperEvento en el que tu comuna está solo `invitada` (debe dar 403
  `NO_PARTICIPA`),
- el mapa público sin sesión (debe seguir funcionando y no mostrar inventario ni
  personas).

### El script que hace todo esto solo

```bash
docker compose down -v && docker compose up -d
bash scripts/validar_multitenant.sh
```

Cubre roles y RLS en la base, aislamiento por API, permisos por rol, gobernanza de
administración, colaboración intercomunal, canal público e higiene de sesión. Ninguna
comprobación deja datos detrás: las que ejercitan escrituras corren dentro de
`BEGIN … ROLLBACK`, y la única que escribe de verdad (crear una municipalidad, que solo
se puede acreditar creándola) borra lo que creó al terminar.

Exige la base **recién recreada**, porque varias comprobaciones son conteos absolutos
sobre los datos sembrados. Lo visual —mapa, badges, modales— va aparte, en
`docs/03_guion_de_validacion.md`.

---

## 12. Chuleta

### Glosario

| Término | Qué es |
| --- | --- |
| **Tenant** | Cada organización que usa el sistema. Aquí, una municipalidad |
| **Discriminador** | La columna que dice de quién es cada fila: `municipality_id` |
| **RLS** | Row-Level Security: PostgreSQL filtra filas según una regla, automáticamente |
| **Política** | La regla concreta (`CREATE POLICY`). Varias se suman con OR |
| **`USING`** | Qué filas existentes puedes ver o tocar. Si falla: fila invisible |
| **`WITH CHECK`** | Cómo puede quedar una fila que escribes. Si falla: error |
| **`ENABLE`** | Enciende RLS para todos menos el dueño de la tabla |
| **`FORCE`** | Lo enciende también para el dueño. Sin esto, las políticas son decorativas |
| **`SECURITY DEFINER`** | Función que corre con permisos de quien la creó: no pasa por RLS |
| **`SET LOCAL`** | Variable de sesión que vive solo hasta el fin de la transacción |
| **Middleware** | Función de Express que corre antes del manejador de la ruta |
| **`AsyncLocalStorage`** | Contexto de Node disponible en toda una cadena asíncrona, por petición |

### Errores de PostgreSQL que verás

| Código | Significa | En AppCopio se traduce a |
| --- | --- | --- |
| `42501` | Una política bloqueó la operación | 403 |
| `23505` | Clave duplicada | 409, o "ya estaba invitada" |
| `23503` | El padre no existe o no es visible | 404 |
| 0 filas | Casi siempre RLS, no el `WHERE` | 404 |

### El recorrido completo de una petición

```
Navegador (Bearer token)
   ↓
requireAuth ......... verifica la firma del JWT → req.user
   ↓
withTenant .......... BEGIN + set_config('app.current_tenant', …)
   ↓
Guardia de rol ...... requireTenant / soloAdminOApoyo
   ↓
Servicio ............ SQL escrito SIN filtro de comuna
   ↓
pool interceptado ... redirige al cliente con el tenant fijado
   ↓
PostgreSQL .......... aplica RLS y devuelve solo lo permitido
   ↓
finishTx ............ COMMIT si status < 400, ROLLBACK si no
```

### Las diez reglas de oro

1. **La comuna sale del JWT, nunca del body.** Siempre `req.user.municipality_id`.
2. **`FORCE` en toda tabla con `municipality_id`.** Sin él, el dueño se salta las
   políticas.
3. **El backend nunca se conecta como superusuario.** Si `rolsuper` o `rolbypassrls` dan
   `t`, el aislamiento es ficticio.
4. **Sin transacción no hay tenant.** `SET LOCAL` muere en el `COMMIT`; un `pool.query()`
   fuera de la transacción del middleware pierde el contexto.
5. **Los contextos son excluyentes.** Tenant o público, jamás los dos: las políticas
   permisivas se suman con OR.
6. **`SECURITY DEFINER` solo para ventanillas estrechas.** Pocos parámetros, sin texto
   libre, con verificación dentro y columnas fijadas en la firma.
7. **Ante 0 filas, sospecha de la política antes que del `WHERE`.**
8. **Los agregados cuentan solo lo visible.** Un `COUNT` bajo RLS no es el total real.
9. **Cada cambio de esquema es un `.sql` nuevo**, nunca un `ALTER` a mano contra una base
   viva. El entorno se recrea con `docker compose down -v`.
10. **Los datos sensibles de personas jamás cruzan de comuna**, ni en colaboración. Entre
    comunas solo viajan ubicación, capacidad, llenado, estado operacional y prioridades.

### Dónde seguir leyendo

| Documento | Para qué |
| --- | --- |
| `docs/01_modelo_de_negocio.md` | Las decisiones de dominio: qué se comparte y por qué |
| `docs/02_implementacion_tecnica.md` | El detalle técnico y los 39 problemas numerados |
| `docs/03_guion_de_validacion.md` | El guión de validación visual, pantalla por pantalla |
| `docs/04_entidades_y_flujo_multitenant.md` | Entidades y flujos de emergencias y SuperEventos |
| `AppCopio_MultiTenant_Plan.md` | El plan de migración paso a paso |
| `CLAUDE.md` | Las reglas duras del proyecto, en corto |
