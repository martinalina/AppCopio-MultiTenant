# AppCopio multi-tenant: los conceptos, uno por uno (a prueba de tontos)

> Esta guía asume que **no sabes nada** de RLS, roles de Postgres, transacciones ni
> middlewares. Cada concepto sigue el mismo orden: **qué es → por qué hace falta → dónde
> está en AppCopio**. Cuando ya lo tengas claro y quieras más detalle y los 40 problemas
> numerados, sigue con `00_guia_rls_desde_cero.md` y `02_implementacion_tecnica.md`.

---

## 0. El mapa completo en 60 segundos

Antes de entrar al detalle, esta es la película completa. Cada pieza se explica después.

```
 Usuario (admin de la comuna 1)
    │  GET /api/centers/X     con un "pase" (JWT) que dice "soy de la comuna 1"
    ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ BACKEND (Node + Express)                                                │
 │                                                                         │
 │  1. requireAuth   → revisa que el pase sea auténtico (firma del JWT)    │
 │  2. withTenant    → abre una transacción y le dice a Postgres:          │
 │                     "esta conexión trabaja para la comuna 1"            │
 │  3. el servicio   → escribe SQL SIN filtrar por comuna (SELECT * ...)   │
 │  4. pool interceptado → manda ese SQL por la conexión de la comuna 1    │
 └───────────────────────────────┬─────────────────────────────────────────┘
                                 ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ POSTGRESQL (conectado como appcopio_app, NO superusuario)               │
 │                                                                         │
 │  5. RLS: antes de devolver cada fila pregunta a la política             │
 │          "¿municipality_id = la comuna de esta sesión?"                 │
 │          → solo pasan las filas de la comuna 1                          │
 └─────────────────────────────────────────────────────────────────────────┘
    │
    ▼  6. Al terminar la respuesta: COMMIT (si salió bien) o ROLLBACK (si hubo error)
```

**La idea en una frase:** el backend no se encarga de filtrar por comuna; le *avisa* a
Postgres de qué comuna es la petición, y **Postgres** filtra solo, siempre, en cada
consulta.

---

## PARTE A — Los cimientos (lo que hay que saber antes de RLS)

### A1. Multi-tenant y `municipality_id`

**Qué es.** *Tenant* = "inquilino". Cada municipalidad es un tenant. *Multi-tenant* =
un solo sistema, una sola base de datos, varios inquilinos que no deben verse entre sí.
Como un edificio de departamentos: una estructura, muchas puertas con llave.

**Cómo se distingue de quién es cada fila.** Con una columna: `municipality_id`. Cada
centro, usuario, familia, etc. lleva escrito a qué comuna pertenece. Esa columna se
llama **discriminador**.

**Por qué esta estrategia y no otra.** Había tres caminos:

| Opción | Cómo sería | Por qué no |
|---|---|---|
| Una base de datos por comuna | 10 comunas = 10 bases | 10 migraciones, 10 respaldos; y la colaboración entre comunas obligaría a consultar entre bases |
| Un esquema por comuna | 1 base, 10 esquemas | Mismas migraciones multiplicadas |
| **Una base, un esquema, columna `municipality_id`** | Todo mezclado, cada fila etiquetada | **Elegida:** una sola migración, un solo respaldo, y entre comunas se puede compartir lo justo |

**El problema de la opción elegida.** Todo está mezclado en las mismas tablas. Si
`SELECT * FROM Centers` olvida el `WHERE municipality_id = 3`, devuelve centros de
**todas** las comunas. Y AppCopio guarda nombres, RUT y composición familiar de
damnificados: eso no es un bug visual, es una filtración de datos personales.

> La pregunta que justifica toda la migración: **¿cómo hacemos que una consulta que
> olvida filtrar sea inofensiva en vez de peligrosa?** Todo lo que sigue es la
> respuesta.

---

### A2. Roles de Postgres (¡no son los roles de la app!)

**Ojo con la palabra "rol".** En AppCopio hay dos cosas distintas con el mismo nombre:

| | Rol **de Postgres** | Rol **de la aplicación** |
|---|---|---|
| Ejemplo | `postgres`, `appcopio_app` | Administrador, Trabajador Municipal, Super Administrador (`role_id` 4) |
| Quién lo tiene | La *conexión* a la base de datos | Cada *persona* que inicia sesión |
| Qué decide | Qué puede hacer el programa contra la base | Qué botones/acciones tiene permitida esa persona |

En esta guía, "rol" a secas = rol de Postgres, salvo que diga "rol de la app".

**Qué es un rol de Postgres.** Una identidad con la que te conectas a la base. Cada rol
tiene permisos (`GRANT SELECT ON tabla TO rol`) y atributos especiales. Dos atributos
importan muchísimo aquí:

- **`SUPERUSER`**: puede hacer absolutamente todo y **se salta RLS siempre**.
- **`BYPASSRLS`**: no es superusuario, pero también se salta RLS.

**El dueño de una tabla (owner)** es el rol que la creó. Por defecto, el dueño también
se salta RLS (a menos que uses `FORCE`, ver parte B).

**Por qué importa en AppCopio.** El proyecto original se conectaba como `postgres` (el
superusuario que Docker crea por defecto). Si hubiéramos dejado eso, habríamos escrito
todas las políticas de seguridad… y ninguna habría hecho nada, porque el superusuario
las ignora. Peor: parecería que todo está protegido.

**Dónde está.** `db/002a_multitenant_schema.sql`, sección 12:

```sql
CREATE ROLE appcopio_app LOGIN PASSWORD '...';          -- sin SUPERUSER ni BYPASSRLS
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appcopio_app;
```

Y en `backend/.env`: `DB_USER=appcopio_app`.

**Quién usa cuál:**

| Rol | Lo usa | ¿Pasa por RLS? | Para qué |
|---|---|---|---|
| `postgres` (superusuario) | Solo los scripts de `db/` al crear el contenedor | No | Crear tablas, roles y políticas; sembrar datos |
| `appcopio_app` | **El backend, siempre** | **Sí** | Toda la operación normal |

**Por qué son dos y no uno:** crear un rol requiere ser superusuario. El superusuario
arma el escenario y se va; el backend usa el rol limitado.

**Cómo verificar (5 segundos):**

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'appcopio_app';
-- esperado:  appcopio_app | f | f      (si ves 't' en alguna, el aislamiento es falso)
```

---

### A3. Transacciones (`BEGIN` / `COMMIT` / `ROLLBACK`)

**Qué es.** Una transacción agrupa varias sentencias SQL como una sola operación
"todo o nada":

```sql
BEGIN;                                  -- empieza el paquete
INSERT INTO ...;                        -- paso 1
UPDATE ...;                             -- paso 2
COMMIT;                                 -- confirma: ambos pasos quedan guardados
-- o bien:
ROLLBACK;                               -- deshace: es como si nunca hubieran pasado
```

**Por qué importa aquí.** Dos razones, una buena y una obligatoria:

1. *(Buena)* Atomicidad: si crear un SuperEvento e invitar comunas falla a medias, no
   queda un SuperEvento huérfano.
2. *(Obligatoria)* Las variables de contexto del tenant (ver A5) **solo existen dentro
   de una transacción**. Sin transacción, el tenant se pierde.

**Dónde está.** `backend/src/auth/tenantContext.ts`: el middleware `withTenant` hace
`BEGIN` al inicio del request y `COMMIT`/`ROLLBACK` al final (función `finishTx`).

---

### A4. Pool de conexiones

**Qué es.** Abrir una conexión a Postgres es lento, así que el backend abre un
puñado (aquí hasta 30) y las **reutiliza**: una petición pide una prestada, la usa y la
devuelve; la siguiente petición recibe la misma (o cualquier otra) del montón.

```
 pool = [ conexión1, conexión2, conexión3, ... ]
   petición de Viña    → toma conexión2 → la devuelve
   petición de Valpo   → toma conexión2 (¡la misma!) → ...
```

**Por qué importa.** Si pusiéramos "esta conexión es de Viña" de forma permanente, la
siguiente petición (de Valparaíso) heredaría esa marca y vería datos de Viña. Por eso el
tenant se fija con alcance **de transacción** (A5): se borra solo al terminar.

**Dónde está.** `backend/src/config/db.ts`, el `new Pool({...})`. Notarás
`max: 30`, `statement_timeout` e `idle_in_transaction_session_timeout`: como ahora cada
request retiene una conexión durante toda su duración (por la transacción), el límite
por defecto de 10 se agotaría rápido (por ejemplo, subiendo un CSV con cientos de
filas). Los timeouts evitan que una transacción olvidada bloquee una conexión para siempre.

---

### A5. Variables de sesión y `set_config` (el "post-it" en la conexión)

**El problema.** El backend siempre se conecta con el *mismo* usuario de Postgres
(`appcopio_app`), sea quien sea la persona que hizo la petición. Entonces Postgres no
puede deducir "¿de qué comuna es esta petición?" a partir del usuario de la base. Hay
que **decírselo**, en cada petición.

**La herramienta.** Postgres permite guardar variables propias (post-its) en la sesión:

```sql
SELECT set_config('app.current_tenant', '3', true);   -- dejo el post-it: "comuna 3"
SELECT current_setting('app.current_tenant', true);   -- lo leo → '3'
```

- El prefijo `app.` es solo convención para variables de la aplicación.
- El tercer parámetro `true` significa **LOCAL**: el post-it se borra solo en el
  `COMMIT`/`ROLLBACK`. Es una decisión de seguridad (ver A4) y es la razón por la que
  necesitamos transacciones (A3).
- En `current_setting`, el `true` significa "si no existe, devuelve NULL en vez de
  reventar".

**Por qué `set_config(...)` y no `SET LOCAL app.current_tenant = $1`.** El comando `SET`
no acepta parámetros (`$1`), y pegar el valor a mano en el texto abriría la puerta a
inyección SQL justo en el mecanismo que nos protege. `set_config` sí acepta parámetros.
Está comentado en `tenantContext.ts`, función `setLocal`.

**Las tres variables que usa AppCopio:**

| Variable | Significa | La fija |
|---|---|---|
| `app.current_tenant` | "soy de la comuna N" | `withTenant` |
| `app.is_superadmin` | "soy el Super Administrador (administro la plataforma: no veo datos operativos de ninguna comuna)" | `withTenant` |
| `app.public_access` | "soy una visita anónima del mapa público" | `withPublicContext` |

---

### A6. Funciones SQL, `STABLE` y triggers

**Función SQL.** Un trozo de código guardado en la base, con nombre, que puedes llamar
desde cualquier consulta. Para no repetir `current_setting(...)` en cada política, se
envolvió en tres funciones pequeñas (`db/002a`, sección 6):

```sql
CREATE FUNCTION current_tenant() RETURNS INT AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::INT;
$$ LANGUAGE sql STABLE;
-- is_superadmin()      → ¿app.is_superadmin = 'true'?
-- is_public_context()  → ¿app.public_access = 'true'?
```

- `NULLIF(x, '')` convierte "vacío" en NULL, porque `''::INT` daría error.
- `STABLE` le promete al planificador "dentro de una consulta esto devuelve siempre lo
  mismo", así que la evalúa una vez en vez de una por fila (si no, una tabla de 100.000
  filas haría 100.000 llamadas).

**Trigger.** Una función que Postgres ejecuta **automáticamente** cuando ocurre algo
(por ejemplo, "antes de insertar una fila"). AppCopio usa triggers para:

- Generar IDs de centro tipo `VALPO-C001` (con contador por comuna).
- **Rellenar `municipality_id` automáticamente** en tablas hijas (ver parte E, patrón D).

---

## PARTE B — Row-Level Security (RLS)

### B1. Qué es RLS

Hasta RLS, los permisos eran **por tabla**: `GRANT SELECT ON Centers` = puedes leer la
tabla entera o nada. **RLS baja un nivel: decide qué *filas* ves de esa tabla.**

Metáfora: `GRANT` te da (o no) la llave de la sala de archivadores. RLS decide qué
carpetas de adentro puedes sacar.

El efecto práctico:

```sql
-- Lo que escribe el backend (sin filtro):
SELECT * FROM Centers;

-- Lo que ejecuta Postgres en realidad, porque hay una política activa:
SELECT * FROM Centers WHERE municipality_id = <la comuna de esta sesión>;
```

El programador no puede olvidar un filtro que no escribe.

### B2. Los tres pasos, siempre en este orden

```sql
-- 1. ENCENDER RLS en la tabla.
ALTER TABLE Centers ENABLE ROW LEVEL SECURITY;

-- 2. FORZARLO también para el dueño.
ALTER TABLE Centers FORCE ROW LEVEL SECURITY;

-- 3. ABRIR la puerta justa con una política.
CREATE POLICY centers_tenant_isolation ON Centers
  USING      (municipality_id = current_tenant())
  WITH CHECK (municipality_id = current_tenant());
```

(El Super Administrador no aparece: su contexto no fija comuna, así que sobre `Centers`
no ve ninguna fila. Solo las tablas que su rol administra —`Users`, `Emergencies`,
`SuperEvents`, sus participantes, `Municipalities` y `municipal_zones`— lo admiten.)

Esas líneas, repetidas sobre las tablas con datos de comuna, **son** la migración
multi-tenant. Los archivos `db/002a` a `db/002d` son, en gran parte, eso.

### B3. `ENABLE`: qué hace y qué pasa si no hay políticas

`ENABLE ROW LEVEL SECURITY` activa el filtrado. Lo crucial: **RLS es "denegar por
defecto"**. Con RLS activo y *ninguna* política, nadie ve nada (la tabla parece vacía y
no se puede escribir).

Eso es una herramienta, no un bug: para cerrar una tabla por completo, se activa RLS y
**no se escribe ninguna política**. AppCopio lo hace con `RefreshTokens` (los tokens de
sesión): ningún `SELECT` de la aplicación puede tocarla, y el único acceso son funciones
controladas (ver parte D).

### B4. `FORCE`: qué hace y por qué existe

Por defecto, `ENABLE` **no** aplica las políticas al **dueño** de la tabla (se asume que
quien la creó debe poder verla entera). `FORCE ROW LEVEL SECURITY` quita esa excepción: el
dueño también queda sujeto.

**Para qué lo usamos, con honestidad.** Hoy el backend se conecta como `appcopio_app`,
que *no* es el dueño de las tablas (las creó `postgres`). Así que, hoy, `ENABLE` solo ya
bastaría para el backend. `FORCE` es **cinturón y tirantes**: si algún día alguien conecta
con el rol dueño, o cambia quién es el dueño, las políticas siguen aplicándose. Por eso
es una regla dura del proyecto (CLAUDE.md, regla 3) y no hay ninguna tabla con `ENABLE`
sin `FORCE`.

> **Resumen de quién se salta RLS:**
>
> | Rol | ¿Se salta RLS? |
> |---|---|
> | Superusuario (`postgres`) | **Siempre**, incluso con `FORCE` |
> | Rol con `BYPASSRLS` | **Siempre** |
> | Dueño de la tabla | Sí con `ENABLE`; **no** con `ENABLE` + `FORCE` |
> | Cualquier otro rol (`appcopio_app`) | Nunca |

### B5. Políticas: `USING` vs `WITH CHECK` (leer vs escribir)

Una política es una regla: "una fila es visible/modificable si se cumple esta condición".
Tiene dos cláusulas, y esta es la distinción que más confunde:

| Cláusula | Se aplica a | Mira | Si no se cumple |
|---|---|---|---|
| `USING` | `SELECT`, `UPDATE`, `DELETE` | La fila **que ya existe** | La fila **simplemente no aparece** (sin error) |
| `WITH CHECK` | `INSERT`, `UPDATE` | La fila **como quedaría** | **Error** (`42501`), la escritura se rechaza |

Ejemplo de la asimetría:

```sql
-- Leo un centro de otra comuna:
SELECT * FROM Centers WHERE center_id = 'OTRA-C001';
--> 0 filas. Sin error: para ti ese centro no existe.

-- Creo un centro a nombre de otra comuna:
INSERT INTO Centers (name, municipality_id) VALUES ('Trampa', 99);
--> ERROR: new row violates row-level security policy
```

Un `UPDATE` pasa por las dos: `USING` valida que la fila original sea tuya, `WITH CHECK`
valida que no la dejes perteneciendo a otra comuna. Eso bloquea el truco de "regalar" una
fila a otra comuna con `UPDATE ... SET municipality_id = 7`.

Por eso el backend traduce: error `42501` → HTTP 403; 0 filas → 404.

### B6. Políticas "por comando" (`FOR SELECT`, `FOR INSERT`...)

Si no dices `FOR ...`, la política vale para todos los comandos. Pero puedes acotarla:

```sql
CREATE POLICY centers_public_read ON Centers
  FOR SELECT                                       -- SOLO lectura
  USING (is_public_context() AND is_active = TRUE);
```

Esto es lo que implementa la **regla 7 del proyecto**: las políticas que *amplían* la
lectura (mapa público, colaboración entre comunas) son siempre `FOR SELECT`. Escribir
nunca se amplía: `INSERT/UPDATE/DELETE` siguen exigiendo `municipality_id =
current_tenant()`.

### B7. Varias políticas se suman con OR (y por qué eso dio un bug real)

Las políticas son **permisivas**: si hay varias para el mismo comando, basta que **una**
se cumpla. Se suman con OR.

`CenterItemPriority` tiene tres políticas de lectura: la propia, la pública y la
intercomunal. Eso permite que cada contexto vea lo suyo.

**El peligro, y por qué existe `withTenantOrPublic`.** Si por error el contexto *público*
(`app.public_access = true`) estuviera activo **dentro de una petición autenticada**, la
política pública se sumaría (OR) a la del tenant y un admin vería los centros activos
de **todas** las comunas. Eso pasó de verdad (problema P2): se había montado el middleware
público sobre el prefijo entero `/api/centers`.

Por eso: **los contextos son mutuamente excluyentes** (tenant *o* público, jamás ambos), y
los routers que mezclan endpoints públicos y privados aplican el middleware **ruta por
ruta** (mira `backend/src/routes/centerRoutes.ts`, líneas ~793-815) y no por prefijo.

---

## PARTE C — El backend: middlewares y cómo le cuentan a Postgres quién eres

### C1. Qué es un middleware

Una función de Express que corre **antes** del manejador de la ruta y puede enriquecer la
petición, cortarla (respondiendo un error) o dejarla pasar con `next()`. Se encadenan en
orden, como una línea de control en un aeropuerto: documento → detector de metales →
embarque.

```ts
// backend/src/index.ts
app.use('/api/emergencies', requireAuth, withTenant, emergencyRoutes);
//                          ①            ②           ③ las rutas
```

El **orden importa**: `withTenant` necesita que `requireAuth` ya haya llenado `req.user`.

### C2. JWT y `requireAuth` — ¿quién eres?

**JWT** = un "pase" firmado que el servidor entrega al hacer login. Contiene datos del
usuario (`user_id`, `role_id`, `municipality_id`...) y una **firma** hecha con un secreto
que solo el servidor conoce. Si alguien cambia un solo dato del pase (por ejemplo, su
comuna), la firma deja de calzar y el pase se rechaza.

**`requireAuth`** (`backend/src/auth/middleware.ts`): lee `Authorization: Bearer <token>`,
verifica la firma y deja el contenido en `req.user`. Sin token o vencido → 401 y la
petición muere ahí.

**Por qué importa para multi-tenant:** el JWT es la **única fuente confiable** de la
comuna. De ahí la **regla 5**: *nunca* se usa un `municipality_id` que venga del body de
la petición (el cliente lo podría inventar). Siempre `req.user.municipality_id`.

El tipo del pase está en `backend/src/auth/tokens.ts` (`JwtUser`). Nota que
`municipality_id` es `null` solo para el Super Administrador.

**`optionalAuth`**: igual, pero si no hay token no corta; sigue como anónimo. Para
rutas de doble uso, como el listado de centros (mapa público *y* panel municipal).

### C3. `withTenant` — contárselo a Postgres (el middleware central)

`backend/src/auth/tenantContext.ts`. Hace, en orden:

1. **Valida:** si el usuario no es superadmin y no tiene comuna → 401 `TENANT_MISSING`.
   (Antes caía a un tenant falso `-1` y el usuario veía todo vacío sin entender por qué.)
2. **Toma una conexión del pool** y hace `BEGIN`.
3. **Deja el post-it:** `set_config('app.current_tenant', '<su comuna>', true)`, o
   `app.is_superadmin = true` si es superadmin.
4. **Ejecuta el resto del request** con esa conexión (ver C5).
5. **Al terminar la respuesta**, `finishTx` hace `COMMIT` o `ROLLBACK` y devuelve la
   conexión al pool.

**La regla de cierre:** `ROLLBACK` si el status HTTP es `>= 400` (o si un servicio pidió
rollback); `COMMIT` en el resto. Beneficio: una petición que falla no deja datos a
medias.

### C4. Los tres modos de contexto

| Middleware | Cuándo se usa | Qué fija | Qué ve el request |
|---|---|---|---|
| `withTenant` | Rutas autenticadas (la gran mayoría) | `app.current_tenant` o `app.is_superadmin` | Lo de su comuna (el superadmin, solo lo que administra: usuarios, SuperEventos, emergencias para agrupar) |
| `withPublicContext` | Rutas públicas sin sesión | `app.public_access` | Solo lo que las políticas públicas permiten |
| `withTenantOrPublic` | Rutas de doble uso | **Uno u otro**, nunca ambos | Según haya sesión o no |

Las rutas de **login** (`/api/auth`) no usan ninguno: aún no se sabe quién eres, así que
tampoco la comuna. Cómo se resuelve eso: ver D1.

### C5. El truco del pool interceptado (`AsyncLocalStorage`)

**El problema práctico.** `withTenant` fija el tenant en **una conexión concreta**. Pero
el código de los servicios (31 archivos) está lleno de:

```ts
import pool from '../config/db';
const { rows } = await pool.query('SELECT * FROM Centers');
```

`pool.query()` normalmente toma **cualquier** conexión del pool, una que *no* tiene el
post-it. Resultado: cero filas o comportamiento errático. Había que reescribir 31
servicios (8 de ellos importan `pool` directo, 23 reciben `db` por parámetro, y 13
archivos tienen sus propios `BEGIN/COMMIT`).

**La solución, sin tocar ningún servicio.** Dos piezas en `backend/src/config/db.ts`:

1. **`AsyncLocalStorage`**: una utilidad de Node que funciona como una "variable global
   *por petición*": `withTenant` guarda ahí la conexión con el tenant fijado, y queda
   disponible en toda la cadena de llamadas de ese request sin pasarla por parámetro.
2. **Interceptar `pool.query` y `pool.connect`** (una sola vez, en ese archivo): si hay una
   conexión de request guardada, **redirigen todo a ella**.

```ts
(pool as any).query = (text, params, cb) => {
  const store = tenantStorage.getStore();
  if (store) {
    // Dentro de un request con tenant:
    //  - BEGIN/COMMIT/ROLLBACK de servicios viejos → se ignoran (la transacción es del middleware)
    //  - cualquier otra consulta → a la conexión con el tenant puesto
    ...
    return store.client.query(text, params, cb);
  }
  return originalQuery(text, params, cb);   // fuera de un request: normal
};
```

Y `pool.connect()` devuelve un *Proxy* sobre la misma conexión, con `.release()`
convertido en "no hacer nada" (lo libera el middleware al final; si el servicio la
liberara a mitad, se perdería el tenant).

**Detalle sutil:** si un servicio hace su propio `ROLLBACK`, ese comando se ignora, pero
se marca `rollbackRequested = true`. Sin eso, el middleware haría `COMMIT` al final y se
guardaría justo lo que el servicio quiso descartar.

### C6. Guardias de rol: otra capa, otra pregunta

No confundir:

| | Pregunta | Quién lo resuelve |
|---|---|---|
| `withTenant` + RLS | "¿De qué **comuna** son los datos que puedes tocar?" | **Postgres** |
| `requireRole`, `requireTenant`, `crearGuardaAdmin`, `requireSuperAdmin` | "¿Tienes el **cargo** para esta acción?" | **El backend** |

Un detalle que lo ilustra: dentro de **tu** comuna, RLS deja pasar a un Contacto
Ciudadano igual que a un Administrador (ambos son de la misma comuna). Lo que impide que
el Contacto Ciudadano cree centros es `requireCenterManagement`, no RLS. Está dicho en el
comentario de `crearGuardaAdmin`: *"RLS aísla la comuna, no el rol dentro de ella."*

**`requireTenant(req)`** (`backend/src/auth/requireUser.ts`) devuelve el
`municipality_id` del JWT y es **la única fuente válida** para escrituras (regla 5). Lo
usa, por ejemplo, `createCenter`.

**Truco de orden:** en `centerRoutes.ts` verás
`requireAuth, requireCenterManagement, withTenant, createCenter`. Los guardias de rol van
*antes* de `withTenant`, así una petición rechazada ni siquiera abre una transacción ni
consume una conexión.

---

## PARTE D — `SECURITY DEFINER`: la ventanilla controlada

### D1. El problema: RLS aísla *demasiado bien*

A veces hay que leer algo legítimamente **fuera de tu tenant**, y desde RLS es imposible,
porque hasta las subconsultas pasan por RLS. Ejemplos reales en AppCopio:

- **El login.** Para saber de qué comuna eres hay que leer `Users`. Pero `Users` tiene
  RLS por comuna. Pero aún no sabemos la comuna. Huevo y gallina: con RLS activo, el login
  fallaba para todo el mundo (problema P1).
- **La colaboración entre comunas:** mostrar en un tablero centros de *otras* comunas.

### D2. Qué es

Toda función corre en uno de dos modos:

| Modo | Corre con los permisos de... | ¿Pasa por RLS? |
|---|---|---|
| `SECURITY INVOKER` (el normal) | **quien la llama** | Sí |
| `SECURITY DEFINER` | **quien la creó** (aquí, `postgres`, superusuario) | **No** |

Metáfora: es una **ventanilla**. Tú no entras al archivo; le pides algo concreto a la
persona que sí puede entrar, y ella decide qué entrega. **La función es la ventanilla, y
su cuerpo es la política.**

### D3. Por qué es peligrosa, y cómo se hace segura

Dentro de una función `SECURITY DEFINER` **no hay aislamiento**. Lo que la hace segura es
que sea **estrecha**:

- Pocos parámetros y de tipo fijo (nada de texto SQL libre).
- Verificación explícita adentro (por ejemplo, `WHERE u.username = p_username`, exacto).
- Devuelve solo las columnas necesarias (el límite está en la *firma* de la función,
  no en el código TypeScript, así que nadie lo amplía por descuido).
- `SET search_path = public`, para que nadie anteponga un esquema falso y secuestre la
  función.
- `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO appcopio_app;`, porque por defecto
  *cualquiera* puede ejecutar una función nueva.

### D4. Dónde se usa en AppCopio

| Función | Archivo | Para qué |
|---|---|---|
| `auth_lookup_user(username)` / `auth_lookup_user_by_id` | `002a` | Login y `/auth/me`: leer `Users` sin tenant, acotado a un usuario exacto |
| `generate_center_id()` (trigger) | `002a` | Mover el contador `center_seq_counter` de `Municipalities`, tabla que solo el superadmin puede modificar |
| `public_center_occupancy` | `002a` | Ocupación pública de un centro, sin exponer personas |
| `refresh_token_*` (7 funciones) | `002c` | Único acceso a `RefreshTokens` (tabla cerrada sin políticas) |
| `super_event_shared_centers` y similares | `002d` | Colaboración entre comunas: devuelve solo ubicación, capacidad, % de llenado y estado |
| `notify_super_event_invitation`, `notify_support_offer` | `002d` | Escribir un aviso en **otra** comuna, verificando antes que quien llama tenga derecho |

Ejemplo de ventanilla segura (`002d`): `super_event_shared_centers` verifica que el evento
siga abierto, que la comuna dueña del centro participe, **y que quien lee también
participe**. Y su firma solo devuelve columnas permitidas por la regla 6: **nunca**
`Persons`, `FamilyGroups`, `CentersDescription` ni cantidades de inventario.

> Un detalle que conviene tener presente: como el creador de estas funciones es
> `postgres` (superusuario), `FORCE ROW LEVEL SECURITY` **no las frena**. No hay nada
> que las limite salvo su propio código. Por eso se escriben tan estrechas.

---

## PARTE E — Cómo se cubrieron las tablas: cuatro patrones

No todas las tablas son iguales, así que se usó el patrón más barato en cada caso.

| Patrón | Para qué tablas | Cómo funciona | Ejemplo |
|---|---|---|---|
| **A. Columna directa** | Tablas "raíz" con su propio `municipality_id` | Política `municipality_id = current_tenant()` (solo `Users` suma políticas aparte para el superadmin) | `Users`, `Centers`, `Persons`, `FamilyGroups`, `Datasets` |
| **B. Catálogo dual** | Productos, categorías, plantillas, zonas | `municipality_id IS NULL` = "global, de todos"; si no, solo de esa comuna | `Products`, `Categories` |
| **C. Subconsulta al padre** | Tablas satélite pequeñas | La política pregunta al padre: `dataset_id IN (SELECT dataset_id FROM Datasets)`. Esa subconsulta **también pasa por RLS**, así que hereda el aislamiento solo | `DatasetFields`, `TemplateFields`, `ResourceBoxItems` |
| **D. Columna + trigger de herencia** | Tablas "hoja" de mucho volumen | Llevan su propio `municipality_id`, rellenado automáticamente por un trigger que lo copia del centro padre | `InventoryLog`, `UpdateRequests`, `CenterAssignments` |

**Por qué cuatro y no uno solo:**

- El patrón A es el más rápido y simple, pero exige una columna.
- El C evita agregar columnas, pero cada lectura hace una subconsulta: aceptable en
  tablas chicas, caro en las grandes.
- El D evita esa subconsulta en tablas grandes, a cambio de una columna extra.
- El B existe porque hay datos que legítimamente son compartidos (el catálogo de
  productos base) y a la vez permiten productos propios por comuna.

**Una sutileza del patrón D** (comentada en `002c`): el trigger corre como *invocador*
(no `SECURITY DEFINER`) **a propósito**. Si intentas registrar inventario sobre un centro
ajeno, la subconsulta al padre pasa por RLS, no lo ve, devuelve NULL, y la restricción
`NOT NULL` rechaza la fila. El aislamiento de escritura se aplica "gratis".

**`Persons` es un caso especial:** podría deducir su comuna por subconsulta, pero es dato
sensible que **nunca cruza de comuna**, así que tiene columna propia y un `WITH CHECK`
real.

---

## PARTE F — Colaboración intermunicipal (SuperEventos), en corto

El aislamiento total no alcanza: un incendio puede cruzar límites comunales. La
respuesta no es "romper RLS" sino **abrirlo con precisión**:

1. **Solo lectura se amplía; escritura nunca** (regla 7). Las políticas ampliadas son
   `FOR SELECT`. Para escribir en otra comuna (invitar, avisar) hay funciones
   `SECURITY DEFINER` que verifican antes.
2. **Solo se comparte lo mínimo** (regla 6): ubicación, capacidad, % de llenado, estado
   operacional, prioridades agregadas. Las personas **jamás**.
3. **Ambos lados deben participar**, y el SuperEvento debe estar abierto (los "cuatro
   candados" de `super_event_shared_centers`).
4. **El límite vive en la base, no en TypeScript.** Si alguien edita el backend, no
   puede exponer más columnas por accidente.

Consecuencia de RLS que sorprende: **los agregados cuentan solo lo visible**. Un
`COUNT(*)` de participantes de un SuperEvento devolvía 1 (solo veías tu propia fila). Se
resolvió con una ventanilla `super_event_participants_of(...)`.

---

## PARTE G — Una petición de principio a fin, con ejemplo

**Escenario:** Ana, administradora de la comuna 1, abre su listado de centros.
`GET /api/centers/status/active`, con `Authorization: Bearer eyJ...`.

| Paso | Qué pasa | Dónde |
|---|---|---|
| 1 | Express recibe la petición y corre `requireAuth`: verifica la firma. El JWT dice `municipality_id: 1`, `role_id: 1`. Lo deja en `req.user`. | `auth/middleware.ts` |
| 2 | Corre `withTenant`: toma una conexión del pool, `BEGIN`, y `set_config('app.current_tenant','1',true)`. Guarda la conexión en `AsyncLocalStorage`. | `auth/tenantContext.ts` |
| 3 | Corre el handler/servicio, que ejecuta `SELECT * FROM Centers WHERE is_active = true`. **Sin filtro de comuna.** | `routes/`, `services/` |
| 4 | `pool.query` está interceptado: ve que hay conexión de request y manda la consulta a *esa* conexión. | `config/db.ts` |
| 5 | Postgres aplica la política `centers_tenant_isolation`: `municipality_id = current_tenant()` (= 1). Solo salen los centros de la comuna 1. | `db/002a` sección 7 |
| 6 | El handler responde 200. `finishTx` hace `COMMIT` y devuelve la conexión al pool (con el post-it ya borrado). | `auth/tenantContext.ts` |

**¿Y si Ana (o un atacante con su token) intenta ver un centro de la comuna 2?**
`SELECT * FROM Centers WHERE center_id = 'COMUNA2-C001'` → **0 filas**; el servicio
responde 404. Nunca se devuelven datos. Y si intenta **crear** algo a nombre de la
comuna 2 en el body, el backend lo ignora (usa `requireTenant`), y aunque no lo
ignorara, el `WITH CHECK` lo rechazaría con error 42501 → 403.

**¿Y si el programador olvidó el `WHERE`?** Da igual: el filtro lo pone Postgres.

---

## PARTE H — Qué protege RLS y qué NO (límites honestos)

Para no quedarte con una falsa sensación de seguridad:

| ✅ RLS sí protege | ❌ RLS no protege |
|---|---|
| Un `WHERE` olvidado en una consulta | Un backend comprometido o con una inyección SQL que ejecute `set_config('app.current_tenant', ...)` con otro valor: Postgres confía en lo que el backend le dice |
| Que un admin lea o escriba datos de otra comuna por un bug | **Permisos de rol dentro de la misma comuna** (eso son los guardias del backend) |
| Escrituras a nombre de otra comuna | Funciones `SECURITY DEFINER` mal escritas: dentro de ellas no hay aislamiento |
| Que un cliente falsifique su comuna en el body (el JWT firmado manda) | Conectar como superusuario o con `BYPASSRLS`: ahí todo es decorativo |

Moraleja: por eso hay **tres capas** (JWT firmado → `withTenant` → RLS) más los guardias
de rol, y por eso las reglas del proyecto insisten tanto en no usar superusuario y en
mantener estrechas las funciones `SECURITY DEFINER`.

---

## PARTE I — Trampas típicas al desarrollar (lo que más sorprende)

1. **"Mi consulta devuelve 0 filas."** Antes de culpar al `WHERE`, sospecha de la
   política: ¿estás dentro de `withTenant`? ¿la política permite leer eso? Con RLS, lo
   que no está permitido expresamente **no existe** (problema P11).
2. **Un `pool.query()` suelto fuera de un request** (scripts, arranque) no tiene tenant
   → cero filas. Es esperable, no un bug.
3. **`INSERT ... ON CONFLICT` y `RETURNING`** pueden fallar bajo RLS cuando la fila
   nueva no sería visible para ti (problemas P38/P39 en invitaciones de SuperEventos).
4. **Un `COUNT/SUM` bajo RLS cuenta solo lo visible.** Si necesitas el total real, hace
   falta una ventanilla.
5. **No guardes estado por petición en un objeto que el pool reutilice** (como el
   `PoolClient`). Se hizo una vez y causó fuga de conexiones (P19); el estado vive ahora
   en el store de `AsyncLocalStorage`.
6. **No agregues `console.log` permanentes** para depurar RLS (regla 9 del proyecto).
7. **Cada cambio de esquema es un `.sql` nuevo en `db/`**; se recrea todo con
   `docker compose down -v && docker compose up`. Sin `-v`, los scripts de `db/` **no
   vuelven a correr** (Docker solo los ejecuta con el volumen vacío) y estarías probando
   el esquema viejo.

---

## PARTE J — Cómo comprobar que de verdad aísla

Lo peligroso de RLS es que una implementación rota **se ve igual que una correcta**
mientras pruebes con un solo usuario. Pruebas rápidas, de la más importante a la más
detallada:

```bash
# 1. El rol no se salta RLS (esperado: f | f)
docker compose exec -T db psql -U postgres -d appcopio_mt_db -tAc \
  "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='appcopio_app'"

# 2. Sin tenant fijado, la app no ve NADA (esperado: 0)
docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAc \
  "SELECT COUNT(*) FROM Centers"

# 3. Con tenant fijado, solo lo de esa comuna (cambia el 1 por otro y el número cambia)
docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAq \
  -c "BEGIN" -c "SELECT set_config('app.current_tenant','1',true)" \
  -c "SELECT COUNT(*) FROM Centers" -c "COMMIT"
```

Y el script completo, que además prueba la API, los permisos, la colaboración y el
canal público (necesita la base recién recreada):

```bash
docker compose down -v && docker compose up -d
bash scripts/validar_multitenant.sh
```

---

## Glosario rápido

| Término | Significa |
|---|---|
| **Tenant** | Cada organización que usa el sistema (aquí, una municipalidad) |
| **Discriminador** | La columna que dice de quién es cada fila: `municipality_id` |
| **RLS** | Row-Level Security: Postgres filtra *filas* según una regla, automáticamente |
| **Política (`POLICY`)** | La regla concreta de RLS. Varias sobre la misma tabla se suman con OR |
| **`ENABLE`** | Enciende RLS (no aplica al dueño de la tabla) |
| **`FORCE`** | Lo aplica también al dueño |
| **`USING`** | Qué filas existentes puedes ver/tocar. Falla → la fila no aparece |
| **`WITH CHECK`** | Cómo puede quedar una fila que escribes. Falla → error |
| **Superusuario / `BYPASSRLS`** | Rol que se salta RLS siempre; el backend jamás debe usarlo |
| **`appcopio_app`** | Rol de Postgres sin privilegios especiales, el que usa el backend |
| **Transacción** | Grupo de sentencias "todo o nada" (`BEGIN`…`COMMIT`/`ROLLBACK`) |
| **Pool** | Conjunto de conexiones reutilizables a la base |
| **`set_config(..., true)`** | Deja una variable de sesión que vive solo hasta el fin de la transacción |
| **JWT** | "Pase" firmado con los datos del usuario, incluida su comuna |
| **Middleware** | Función de Express que corre antes del manejador de la ruta |
| **`AsyncLocalStorage`** | Variable "global por petición" de Node |
| **`SECURITY DEFINER`** | Función que corre con permisos de su creador: no pasa por RLS ("ventanilla") |
| **Trigger** | Función que Postgres ejecuta sola ante un evento (ej. antes de insertar) |

## Mapa de archivos

| Qué buscas | Dónde |
|---|---|
| Tablas originales (single-tenant) | `db/001_tablas.sql` |
| `Municipalities`, rol `appcopio_app`, funciones `current_tenant()`, RLS de las tablas núcleo | `db/002a_multitenant_schema.sql` |
| Notificaciones, lecturas de prioridades | `db/002b_emergencias_y_notificaciones.sql` |
| Tablas restantes, triggers de herencia, `RefreshTokens` | `db/002c_rls_tablas_restantes.sql` |
| SuperEventos y colaboración intermunicipal | `db/002d_supereventos.sql` |
| Pool interceptado + `AsyncLocalStorage` | `backend/src/config/db.ts` |
| `withTenant`, `withPublicContext`, `withTenantOrPublic`, `finishTx` | `backend/src/auth/tenantContext.ts` |
| `requireAuth`, `optionalAuth`, `requireRole` | `backend/src/auth/middleware.ts` |
| `requireTenant`, `crearGuardaAdmin` | `backend/src/auth/requireUser.ts` |
| Forma del JWT | `backend/src/auth/tokens.ts` |
| Qué rutas llevan qué middleware | `backend/src/index.ts` (líneas ~107-146) y `routes/centerRoutes.ts` |
| Las reglas duras del proyecto | `CLAUDE.md` |

## Orden de lectura recomendado

1. Esta guía, de arriba abajo (Partes A → C son lo esencial).
2. `docs/00_guia_rls_desde_cero.md` para más profundidad y ejemplos de SQL.
3. Abre `tenantContext.ts` y `db.ts` junto a la Parte C; son cortos y quedan claros.
4. `docs/02_implementacion_tecnica.md` cuando quieras ver los problemas reales y cómo
   se resolvieron.
