# AppCopio multi-tenant — Implementación técnica

> Documento 2 de 2. Describe **cómo** se construyó, qué problemas aparecieron y cómo se
> resolvieron. Las decisiones de dominio están en [01_modelo_de_negocio.md](01_modelo_de_negocio.md).

---

## 1. Estrategia de multi-tenancy

### 1.1 La alternativa elegida

Existen tres estrategias habituales para multi-tenancy en bases de datos relacionales:

| Estrategia | Aislamiento | Costo operativo | Descartada porque |
|---|---|---|---|
| Base de datos por tenant | Máximo | Alto: N bases que migrar y respaldar | Inviable para un equipo pequeño; la colaboración intercomunal exigiría consultas federadas |
| Esquema por tenant | Alto | Medio: N esquemas que mantener sincronizados | Mismo problema de migraciones multiplicadas; la colaboración sigue siendo incómoda |
| **Esquema compartido + discriminador** | **Depende del mecanismo** | **Bajo: una migración, un respaldo** | **Elegida** |

El esquema compartido tiene una debilidad conocida: **el aislamiento depende de que cada
consulta recuerde filtrar por el discriminador**. Un solo `SELECT` sin `WHERE municipality_id = ...`
filtra datos entre organizaciones, y el sistema tiene decenas de consultas SQL escritas a mano.

La respuesta a esa debilidad fue **no confiar en la disciplina del código de aplicación**, sino
mover el aislamiento a la base de datos con **Row-Level Security (RLS)** de PostgreSQL. Con RLS,
un `SELECT * FROM Centers` sin filtro alguno devuelve únicamente las filas del tenant activo,
porque el motor añade la condición. La consulta que olvida filtrar deja de ser una fuga.

### 1.2 Arquitectura de aislamiento en tres capas

```
┌──────────────────────────────────────────────────────────┐
│ 1. AUTENTICACIÓN                                         │
│    El JWT lleva municipality_id, firmado por el servidor │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 2. CONTEXTO DE TENANT (middleware withTenant)            │
│    BEGIN + set_config('app.current_tenant', ...) por      │
│    request. AsyncLocalStorage propaga el cliente.        │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 3. ROW-LEVEL SECURITY (PostgreSQL)                       │
│    Políticas de RLS sobre 36 tablas. El motor filtra.    │
│    Rol appcopio_app SIN superusuario ni BYPASSRLS.       │
└──────────────────────────────────────────────────────────┘
```

Las tres capas son necesarias: la capa 3 es la que garantiza el aislamiento, pero solo
funciona si la capa 2 le dice cuál es el tenant, y la capa 2 solo puede confiar en un valor
que la capa 1 haya verificado criptográficamente.

### 1.3 El prerrequisito que casi invalida todo

`docker-compose.yml` creaba únicamente el usuario `postgres`, y el backend se conectaba con
él. **Los superusuarios de PostgreSQL ignoran RLS siempre**, incluso con `FORCE ROW LEVEL
SECURITY`. Sin corregirlo, todas las políticas de RLS habrían sido decorativas.

Se creó un rol de aplicación `appcopio_app` sin `SUPERUSER` ni `BYPASSRLS`, y el backend
pasó a usarlo. Los scripts de inicialización siguen corriendo como `postgres` para poder
sembrar datos sin pelear con las políticas.

Se usó `FORCE ROW LEVEL SECURITY` (no solo `ENABLE`) porque sin `FORCE` el **dueño** de la
tabla se salta sus propias políticas.

---

## 2. Metodología: análisis previo antes de escribir código

El proyecto partió de un plan de migración escrito previamente. Antes de ejecutarlo se hizo
una **fase de análisis de viabilidad**: contrastar cada supuesto del plan contra el código
real, sin modificar nada.

El resultado justificó el esfuerzo: **5 bloqueadores** que habrían dejado el sistema sin
arrancar o sin login, y **10 huecos de cobertura**. Varios de ellos (el login roto por RLS,
el trigger que no podía escribir, el `setval` que rompía el seed) solo se manifiestan en
tiempo de ejecución y habrían aparecido de a uno, después de horas de trabajo ya invertido.

**Hallazgo metodológico:** un plan de migración escrito sin verificar contra el código real
contiene supuestos que envejecen. Nombres de carpetas (`db_init/` vs `db/`), conteos
(«6 archivos con `BEGIN`/`COMMIT`» cuando eran 13), y afirmaciones directamente falsas
(«el handler de refresh no necesita cambios» cuando sí los necesitaba).

---

## 3. Fase 1 — Base de datos

### 3.1 Estructura de scripts

El entorno se recrea desde cero (`docker compose down -v && docker compose up`); no hay
migración de datos reales. Los cambios de esquema son archivos nuevos que PostgreSQL ejecuta
en orden alfabético:

```
000_drop.sql
001_tablas.sql                        ← esquema original (33 tablas)
002_triggers.sql
002a_multitenant_schema.sql           ← NUEVO: tenencia + RLS
002b_emergencias_y_notificaciones.sql ← NUEVO: notificaciones municipales + admin único
002c_rls_tablas_restantes.sql         ← NUEVO: cierre del aislamiento + políticas de ofertas
002d_supereventos.sql                 ← NUEVO: SuperEventos y colaboración
003_datos.sql                         ← reescrito
004_add_family_to_inventory_log.sql
005_datos_validacion.sql              ← NUEVO: datos para el guion de validación
```

`002a_` < `002b_` < `002c_` < `002d_` < `003_` funciona porque `_` (0x5F) ordena antes que
`a` (0x61).

**Cada objeto se crea una sola vez y en su forma final.** Un script posterior puede corregir
a uno anterior (agregar una columna, agregar una tabla, ajustar una restricción), pero no se
crea nada cuyo único destino sea ser eliminado en el mismo arranque: entre `002a` y `002d` no
se ejecuta ni un solo `DROP TABLE`, `DROP POLICY` ni `DROP FUNCTION`. Los pocos `DROP` que
quedan adaptan el esquema single-tenant de `001_tablas.sql` —restricciones de unicidad
globales, la secuencia de centros, el `NOT NULL` de `center_id`— y no deshacen trabajo
propio.

### 3.2 Funciones de contexto

```sql
current_tenant()     -- NULLIF(current_setting('app.current_tenant', true), '')::INT
is_superadmin()      -- current_setting('app.is_superadmin', true) = 'true'
is_public_context()  -- current_setting('app.public_access', true) = 'true'
```

El segundo parámetro `true` de `current_setting` (*missing_ok*) es esencial: sin él, una
consulta fuera de contexto de tenant lanza excepción en vez de devolver `NULL`.

### 3.3 El correlativo por comuna

Un `trigger BEFORE INSERT` sobre `Centers` incrementa `Municipalities.center_seq_counter` y
compone `SHORTNAME-C00X`. Se prefirió un contador por fila antes que una `SEQUENCE` de
PostgreSQL por comuna, para no tener que crear y destruir secuencias dinámicamente al dar de
alta o de baja municipalidades.

### 3.4 Funciones `SECURITY DEFINER`: la válvula de escape controlada

RLS resuelve el 95% de los casos, pero hay operaciones legítimas que **necesitan ver más allá
del tenant**. Para ellas se usaron funciones `SECURITY DEFINER` (se ejecutan con los
privilegios de su creador, `postgres`, y por tanto omiten RLS), cada una con un alcance
mínimo y verificable:

Hay **17 funciones `SECURITY DEFINER`** en el esquema final:

| Función | Por qué necesita omitir RLS |
|---|---|
| `auth_lookup_user(username)` | El login ocurre **antes** de conocer el tenant |
| `auth_lookup_user_by_id(id)` | Ídem para `GET /auth/me` |
| `generate_center_id()` | El trigger escribe en `Municipalities`, que solo permite escritura al superadmin |
| `public_center_occupancy(center_id)` | Cuenta personas para el aforo público **sin devolver ni una fila** de personas |
| `super_event_shared_center_ids()` | Resuelve el conjunto de centros compartidos, que por definición son de otras comunas |
| `super_event_shared_centers(id)` | Igual, pero devuelve los doce campos del tablero intercomunal |
| `super_event_participants_of(id)` | Devuelve las comunas participantes y la emergencia que aporta cada una, verificando primero que quien pregunta participe |
| `notify_support_offer(id)` | Escribe un aviso dirigido a **otra** comuna (§6.5, P35) |
| `notify_super_event_invitation(id, comuna)` | Escribe la invitación en la comuna invitada; mismo muro que la anterior |
| `support_offers_visible()` | Resuelve el nombre del centro destino, que es de otra comuna (§6.5, P36) |
| `refresh_token_*` (7 funciones) | Única vía de acceso al almacén de sesiones (§3.6) |

Nueve de las diecisiete existen por dos motivos muy acotados —autenticar antes de conocer la
comuna y sellar el almacén de sesiones—; cuatro habilitan lecturas que cruzan de comuna y dos,
escrituras de aviso hacia la comuna de enfrente.

`emergency_activations_status(id)` **no** es `SECURITY DEFINER` aunque alimente una pantalla
nueva: todo lo que consulta es de la propia comuna, así que RLS la acota sola.

Cada una lleva `SET search_path = public` (evita secuestro por `search_path`) y sus permisos
se revocan de `PUBLIC` y se otorgan solo a `appcopio_app`.

---

### 3.5 Cerrar el aislamiento: estrategia mixta

Dieciséis tablas quedaron sin política en la primera pasada porque no tenían
`municipality_id` propio. No filtraban a través de consultas con `JOIN` a sus tablas padre
—que sí estaban protegidas— pero **una consulta aislada sobre ellas no estaba restringida**,
y al menos una lo estaba explotando sin querer: el listado de cajas de recursos no filtraba
nada.

Había dos caminos, con una tensión real entre ellos:

| Camino | A favor | En contra |
|---|---|---|
| Columna `municipality_id` propia | Lecturas rápidas, política de igualdad simple e indexable | Hay que llenar la columna en cada `INSERT`: es exactamente el defecto P15, repetido |
| Política por subconsulta al padre | Cero cambios de esquema y de código | Cada lectura paga la subconsulta; en tablas de volumen se nota |

Se tomó un camino mixto, y el conflicto de la primera opción se resolvió con **triggers de
herencia**: la columna existe, pero la llena un `BEFORE INSERT` que la lee del padre. Ningún
`INSERT` de la aplicación cambió, y las 148 filas de datos semilla quedaron marcadas solas.

**Y el trigger hace un segundo trabajo.** Corre **como invocador**, no como `SECURITY
DEFINER`: su consulta al padre pasa por RLS, así que si el centro no es de tu comuna la
subconsulta devuelve `NULL` y la fila se rechaza. El aislamiento de escritura se aplica solo,
sin una sola línea de validación en la aplicación.

- **Columna + trigger (7 tablas):** `InventoryLog`, `UpdateRequests`, `CenterAssignments`,
  `CenterShifts`, `ActivationAssignments`, `DatasetRecords`, `ResourceBoxes`.
- **Política por subconsulta (9 tablas):** las satélite cuyo padre ya está protegido
  (`DatasetFields`, `DatasetFieldOptions`, `DatasetRecord*`, `TemplateFields`,
  `CenterShiftHistory`, `ResourceBoxItems`, `AuditLog`). Basta exigir que el padre sea
  visible: **la RLS del padre se aplica dentro de la subconsulta** y hace el trabajo de
  tenant. Es el mismo mecanismo que en P10 y P12 jugaba en contra, usado esta vez a favor.

`AuditLog` requirió además una corrección de datos: su `activation_id` era nullable y **sin
clave foránea**, así que una fila sin activación no pertenecería a nadie. Como la tabla nunca
se escribe todavía —solo hay consultas de lectura, ni un `INSERT` en el código— está vacía y
se pudo exigir el vínculo desde ahora.

### 3.6 `RefreshTokens`: sellar en vez de aislar

El almacén de tokens de sesión se consulta **siempre fuera de contexto de tenant**: login,
refresh, logout y un trabajo periódico de limpieza. Una política de comuna habría roto el
login, exactamente como en P1.

Dejarla sin protección era la alternativa cómoda. En su lugar se optó por **sellarla**: sus
ocho accesos se movieron a siete funciones `SECURITY DEFINER`, y la tabla quedó con RLS
activo **y ninguna política permisiva**. En PostgreSQL eso niega todo.

El resultado es más fuerte que el aislamiento por comuna: ninguna consulta SQL de la
aplicación puede tocar la tabla, ni por error ni por inyección. Verificado —
`SELECT * FROM RefreshTokens` como rol de aplicación devuelve 0 filas **incluso con tenant
activo**— mientras el ciclo login → refresh → logout sigue funcionando.

---

## 4. Fase 2 — Backend

### 4.1 El problema del contexto de tenant

`SET LOCAL` solo vive dentro de una transacción explícita. Y el código existente tenía, al
momento del análisis, **8 servicios y 26 routers importando el pool directamente**, con
**31 llamadas a `pool.connect()`** y **13 archivos con `BEGIN`/`COMMIT`/`ROLLBACK` propios**.
(Las cifras actuales son algo mayores porque esta migración agregó routers nuevos; las que
importan para justificar la decisión son las del estado previo.)

Convertir cada transacción interna en un `SAVEPOINT` habría significado editar 13 archivos y
unos 40 sitios, con alto riesgo de omitir alguno.

### 4.2 La solución: interceptar el pool con `AsyncLocalStorage`

Se mutaron los métodos del objeto singleton `pool` **en un solo archivo**
(`config/db.ts`), de modo que:

- Dentro de un request con contexto de tenant activo, cualquier `pool.query()` se enruta al
  cliente que tiene el tenant seteado.
- Cualquier `pool.connect()` devuelve un `Proxy` sobre **ese mismo cliente**, no una conexión
  nueva (que perdería el `SET LOCAL`). Su `.release()` es no-op.
- Los `BEGIN`/`COMMIT`/`ROLLBACK` internos se vuelven no-op: la transacción real la controla
  el middleware.

Como todos los archivos importan el mismo singleton, los 36 archivos quedaron cubiertos sin
tocarlos. **Una transacción por request**, tenant garantizado, cero refactor masivo.

El `ROLLBACK` interno no se descarta en silencio: marca un flag `rollbackRequested` que el
middleware consulta al cerrar, para no commitear lo que un servicio quiso descartar.

### 4.3 Modos de contexto

| Middleware | Uso | Efecto |
|---|---|---|
| `withTenant` | Rutas autenticadas | `set_config('app.current_tenant', …)` o `app.is_superadmin` |
| `withPublicContext` | Rutas anónimas | `set_config('app.public_access', 'true')` |
| `withTenantOrPublic` | Rutas de doble uso | Resuelve según haya sesión o no, **nunca ambos** |

---

## 5. Fase 3 — Frontend, e iteraciones 4 y 5

**Fase 3** propagó el tenant al cliente: tipo `User` con los campos de comuna, rol 4 en los
guards, badge de comuna en el navbar, y plantillas CSV actualizadas al nuevo formato de id.

**Iteración 4** construyó las pantallas de Super Administrador (municipalidades, detalle con
cambio de administrador, emergencias), el flujo de invitación con notificación en pantalla, y
la vinculación de activaciones. Se agregaron 15 endpoints repartidos en dos routers nuevos
(`municipalityRoutes` y `emergencyRoutes`).

La notificación en pantalla reutiliza el sondeo de 30 segundos que ya existía para el badge
del buzón (`useUnreadNotifications`), extendido para devolver también la lista y no solo el
conteo. Se usa `createNotification` y **no** `sendNotification`, porque esta última dispara
correo y el requisito era aviso solo dentro de la aplicación.

**Iteración 5** cerró los dos huecos que quedaban declarados: el aislamiento de las dieciséis
tablas sin política (§3.5), el sellado del almacén de sesiones (§3.6), y la interfaz de
colaboración intercomunal — un tablero con los centros activos de las otras comunas
participantes y sus necesidades, y una bandeja de ofertas de apoyo con las acciones separadas
por lado. Cuatro endpoints más en `crossSupportRoutes`.

**Iteración 6 — SuperEventos.** La colaboración se sacó de la emergencia y se llevó a una
entidad propia. El detonante fue un caso borde que el modelo anterior no resolvía: si dos
comunas ya habían abierto cada una su emergencia para el mismo evento, no había forma de
unirlas sin abandonar una o mover información a mano. `Emergencies` pasó a ser siempre local
de una comuna, `SuperEvents` quedó como contenedor con nivel del evento, y
`EmergencyParticipants` desapareció en favor de `SuperEventParticipants`. Se agregaron
`superEventRoutes` (9 endpoints), `superEventService` y `emergencyService`, y en el cliente
las pantallas de SuperEventos —de comuna y de plataforma—, el diálogo de aceptación que
obliga a aportar una emergencia y el de gestión continua de centros. El total de endpoints
nuevos de la extensión pasó de 19 a **28**.

---

## 6. Catálogo de problemas encontrados

Esta sección es el registro de los **39 defectos** hallados, su causa raíz y su solución. Se
agrupan por naturaleza porque la causa raíz se repite dentro de cada grupo: los identificadores
P1–P39 son estables y sirven para citar cada uno.

> Los nombres de tablas y funciones son los que estaban vigentes cuando se encontró cada
> defecto. Varios cambiaron en la iteración 6: `EmergencyParticipants` pasó a
> `SuperEventParticipants`, y las funciones `emergency_*` de colaboración a `super_event_*`.
> La causa raíz y la lección no cambian con el nombre.

### 6.1 Problemas de aislamiento y seguridad

#### P1 — RLS sobre `Users` rompía el login de todos los usuarios

*Síntoma:* «Credenciales inválidas» para cualquier usuario.
*Causa:* `/api/auth` no puede pasar por `withTenant` porque la comuna se conoce **después** de
leer al usuario. Con RLS sobre `Users`, `municipality_id = current_tenant()` con
`current_tenant()` en `NULL` evalúa a `NULL`, nunca a verdadero → 0 filas.
*Solución:* función `auth_lookup_user` con `SECURITY DEFINER`, acotada a un `username` exacto.
*Por qué así:* la alternativa (una política de lectura amplia sobre `Users`) dejaba una vía de
acceso general si alguien montaba mal otra ruta. La función tiene una superficie de una línea.

#### P2 — Fuga de tenant por `withPublicContext` a nivel de prefijo

*Síntoma:* un administrador de Valparaíso veía los centros activos de Viña del Mar.
*Causa:* montar `app.use("/api/centers", withPublicContext, …)` hacía que **toda** petición
bajo ese prefijo activara `app.public_access`, incluidas las autenticadas. Las políticas
permisivas de PostgreSQL se combinan con **OR**, así que la política pública se sumaba a la de
tenant.
*Solución:* mover `withPublicContext` a nivel de ruta, solo en los endpoints realmente
públicos, y crear `withTenantOrPublic` para los de doble uso.

#### P3 — `GET /api/centers` es de doble uso

*Síntoma:* tras corregir P2, un admin autenticado veía la lista pública (3 centros activos) en
vez de sus 12; y un admin de Viña veía los de Valparaíso.
*Causa:* la misma URL alimenta el mapa público y el panel municipal. Marcarla como pública la
dejaba pública para todos.
*Solución:* `optionalAuth` + `withTenantOrPublic`: con sesión resuelve por tenant, sin sesión
cae al contexto público, **nunca los dos a la vez**.

#### P4 — Auto-inscripción en emergencias adivinando el identificador

*Síntoma:* una comuna podía insertarse en `EmergencyParticipants` de cualquier emergencia.
*Causa:* la política de `INSERT` permitía `municipality_id = current_tenant()`, y **las
verificaciones de clave foránea de PostgreSQL omiten RLS por diseño**, así que ni siquiera
necesitaba poder leer la emergencia.
*Solución:* el `INSERT` quedó restringido a superadmin o comuna creadora; aceptar una
invitación pasó a ser un `UPDATE` del estado de la propia fila.

#### P5 — La comuna invitada veía las prioridades antes de aceptar

*Causa:* la política de lectura ampliada solo verificaba la existencia de la fila en
`EmergencyParticipants`, sin mirar el `status`.
*Solución:* exigir `status = 'participando'` **en ambos lados** (la comuna dueña del centro y
la que lee).

#### P6 — `/api/migrate/migrate-zones` estaba completamente abierto

*Causa:* `if (secret !== process.env.MIGRATION_SECRET)` con `MIGRATION_SECRET` **no definido**
en el `.env` evalúa `undefined !== undefined` → falso → **pasa**. Cualquiera podía reescribir
las zonas municipales.
*Solución:* exigir que el secreto esté configurado **y** que quien llame sea Super
Administrador.
*Nota:* defecto preexistente a la migración.

#### P7 — El Super Administrador veía los centros de todas las comunas

*Causa:* las políticas incluyen `OR is_superadmin()`, y las rutas municipales del frontend
admitían el rol 4.
*Solución:* sacar el rol 4 del bloque de rutas municipales, crear un bloque compartido para el
perfil, y redirigir al superadmin a su propia pantalla tras el login.

#### P8 — `categoryRoutes` sin ninguna autenticación

Crear y borrar categorías estaba abierto a cualquiera. Defecto preexistente, corregido al
montar el router con `requireAuth, withTenant`.

### 6.2 Problemas de correctitud de datos

#### P9 — El trigger de identificadores no podía escribir

*Síntoma:* «Municipality X no existe» al crear cualquier centro.
*Causa:* el trigger hace `UPDATE Municipalities SET center_seq_counter…`, pero la única
política de `UPDATE` sobre esa tabla exigía `is_superadmin()`. Bajo `FORCE RLS` el trigger
corre con los privilegios del invocador → 0 filas → el `RETURNING … INTO` deja `NULL`.
*Solución:* `SECURITY DEFINER` en la función del trigger.
*Lección general:* **un trigger no hereda privilegios especiales**; corre bajo las mismas
políticas que la sentencia que lo disparó.

#### P10 — La colaboración intercomunal nunca funcionó

*Síntoma:* una comuna participante veía 0 prioridades de la comuna vecina.
*Causa:* la política resolvía los centros compartidos con una subconsulta sobre `Centers` y
`CentersActivations`. **Esas tablas también tienen RLS**, así que la subconsulta solo veía
centros de la propia comuna. La política se filtraba a sí misma.
*Solución:* `emergency_shared_center_ids()` con `SECURITY DEFINER`.
*Por qué no se detectó antes:* los datos semilla no incluían ninguna prioridad, así que la
consulta devolvía vacío tanto si funcionaba como si no. **Se corrigió el seed** para que
incluya prioridades y el caso quede cubierto.

#### P11 — Una comuna no podía leer sus propias prioridades

*Causa:* `CenterItemPriority` tenía **una sola** política de `SELECT`, la intercomunal. Un
centro sin emergencia asociada era invisible para su propio dueño.
*Solución:* agregar la política de lectura de tenant que faltaba.

#### P12 — El conteo de participantes siempre daba 1

*Causa:* el `COUNT` sobre `EmergencyParticipants` corre bajo RLS, que solo deja ver la fila
propia.
*Intento fallido:* ampliar la política para permitir ver las filas de emergencias donde uno
participa. PostgreSQL responde `infinite recursion detected in policy for relation`, porque la
política consultaba su propia tabla.
*Solución:* `emergency_participants_of()` con `SECURITY DEFINER`, que primero verifica que
quien pregunta participe.

#### P13 — El `setval` de `Roles` rompía el seed completo

*Causa:* el plan insertaba el rol 4 y hacía `setval` **antes** de que el seed insertara los
roles 1–3 sin id explícito. Estos quedaban como 5, 6 y 7, y todos los `INSERT INTO Users` con
`role_id` 1/2/3 violaban la clave foránea.
*Solución:* ids explícitos en el seed y `setval` al final del archivo.

#### P14 — 158 identificadores de centro huérfanos en el seed

*Causa:* el cambio a `VALPO-C001` invalidaba 158 literales `'C001'`–`'C005'` repartidos en
seis bloques del seed.
*Solución:* sembrar los centros de Valparaíso con `center_id` explícito (el trigger respeta un
id que venga en el `INSERT`) y sincronizar el contador de la comuna. Los centros de las comunas
nuevas **sí** los genera el trigger, de modo que el propio seed valida su funcionamiento.

#### P15 — Cinco tablas con `NOT NULL` sin nadie que las poblara

`Users`, `CentersActivations`, `FamilyGroups`, `CenterInventoryItems` y `Datasets` recibían
`municipality_id NOT NULL`, pero sus `INSERT` no lo enviaban.
*Solución:* derivar el valor **en el propio SQL** (`current_tenant()` o subconsulta a la
entidad padre) en vez de propagar un parámetro por diez firmas de función.
*Por qué:* no se puede falsear desde el cliente, y queda garantizado que coincide con el
`WITH CHECK` de la política. Si el centro no es de tu comuna, la subconsulta devuelve `NULL` y
el `NOT NULL` rechaza la operación — el aislamiento se aplica solo.

#### P16 — Catálogos que quedaban globales por accidente

Cinco servicios crean productos, categorías o plantillas al vuelo sin `municipality_id`, lo que
los insertaba como `NULL` = **globales, visibles para todas las comunas**.
*Solución:* `current_tenant()` en los cinco `INSERT`.

#### P17 — El refresh del token perdía la comuna

*Causa:* el handler de `/auth/refresh` **reconstruía el payload a mano** con los seis campos
antiguos. El plan afirmaba que no necesitaba cambios; era falso.
*Impacto:* a los 15 minutos del login el usuario quedaba sin comuna y sin acceso a sus datos.
*Solución:* propagar los campos, y eliminar el fallback silencioso a un tenant `-1` en favor de
un 401 explícito que fuerza un login nuevo.

#### P18 — `es_apoyo_admin` sobrevivía a la degradación

*Síntoma:* un administrador degradado a Trabajador Municipal seguía viendo el menú de
administración y el badge de «Administrador».
*Causa:* la degradación cambiaba `role_id` pero no la marca de apoyo, y la verificación de
permisos es `rol 1 OR es_apoyo_admin`.
*Solución:* apagar la marca junto con el rol.

### 6.3 Problemas de infraestructura y runtime

#### P19 — Fuga de conexiones que agotaba el pool y caía el proceso

*Síntoma:* transacciones ociosas creciendo indefinidamente; luego el proceso Node se caía.
*Causa raíz:* la deduplicación de cierre usaba un `WeakSet` indexado por el objeto
`PoolClient`. **Las conexiones se reciclan**: al liberarlas vuelven al pool y otra petición
recibe el mismo objeto, ya marcado como cerrado. `finishTx` salía antes de tiempo y dejaba la
transacción abierta para siempre.
*Efecto secundario:* PostgreSQL mataba la conexión por `idle_in_transaction_session_timeout`,
el cliente emitía `'error'` sin listener, y Node lo trataba como excepción no capturada.
*Solución:* deduplicar **por petición** (un flag en el objeto de contexto, que es único por
request) y agregar un manejador de `'error'` que descarte la conexión.
*Cómo se encontró:* aislando cuál petición dejaba la transacción abierta y consultando
`pg_stat_activity`. La primera petición funcionaba y la segunda fugaba — el patrón delató el
reciclaje.

#### P20 — `SET LOCAL app.current_tenant = $1` no compila

*Causa:* el comando `SET` de PostgreSQL solo acepta literales o identificadores, **no
parámetros de bind**.
*Impacto:* cada petición autenticada habría dado error de sintaxis.
*Solución:* `set_config(name, value, true)`, el equivalente parametrizable.

#### P21 — Reutilizar un parámetro rompe la inferencia de tipos

*Síntoma:* `inconsistent types deduced for parameter $1: text versus character varying`.
*Causa:* usar `$1` en la lista `VALUES` y también en una subconsulta hacía que PostgreSQL
dedujera dos tipos distintos. Añadir un cast (`$1::varchar`) no lo resolvió: el cast hace que
el parámetro se infiera como `text`.
*Solución:* pasar el valor dos veces como parámetros distintos, en los 8 sitios afectados.

#### P22 — `format('%I', 'Users')` genera una tabla inexistente

*Causa:* las tablas se crearon sin comillas, así que en PostgreSQL se llaman `users` en
minúscula. `quote_ident('Users')` devuelve `"Users"`, que no existe.
*Solución:* nombres en minúscula en los bloques `DO`.

#### P23 — Conteo de transacciones internas subestimado

El plan hablaba de 6 archivos con `BEGIN`/`COMMIT`; el repositorio tenía **13**, más 31
`pool.connect()`. No invalidó el enfoque —de hecho lo confirmó: la alternativa de convertir
cada uno en `SAVEPOINT` a mano habría sido inviable.

#### P24 — Retención de conexiones por petición

Una transacción por petición implica retener una conexión durante toda su duración. El pool
estaba con el valor por defecto (10). Se subió a 30 y se agregaron `statement_timeout` e
`idle_in_transaction_session_timeout`.

### 6.4 Problemas de experiencia de uso

| # | Problema | Causa | Solución |
|---|---|---|---|
| P25 | `/notifications/me` y `/mark-all-read` daban 404 | El frontend los llamaba pero **nunca existieron** en el backend | Implementados |
| P26 | La invitación llegaba a todos los usuarios de la comuna | El `INSERT` dejaba `destinatary` en `NULL` | Dirigida al administrador vigente |
| P27 | «Ver detalles» llevaba a `/center/null/details` | Las notificaciones de comuna no tienen centro | Enlace según el destino del aviso |
| P28 | «Sin emergencia» se veía en blanco | MUI trata `value=""` como *sin selección* | Valor centinela propio |
| P29 | El aviso de activación era un `alert()` del navegador | — | `Snackbar` de MUI, consistente con el resto |
| P30 | Los datos del centro se mostraban en una fila apretada | `.center-info` está definida también en `NotificationsPage.css` como flex-row y, **al no estar scopeados los CSS, esa regla se filtraba** | Selector con el padre (`.center-item > .center-info`) |
| P31 | Hueco vertical enorme bajo los datos del centro | En un contenedor en columna, `flex-basis` controla el **alto**, no el ancho | Reset del `flex` dentro del *media query* |
| P32 | Cuatro estilos de botón distintos en la misma fila | Dos clases sin CSS definido | Sistema unificado por intención |
| P33 | El mapa público perdió las «necesidades» | `CenterItemPriority` quedó sin política pública | Política de lectura pública acotada a centros activos |
| P34 | RUT sin formatear al crear administradores | El formateador existía pero estaba encerrado en otro componente | Extraído a `utils/rut.ts` y compartido |

---

### 6.5 Problemas del cierre de aislamiento y las ofertas de apoyo

Los tres aparecieron al ejercitar por primera vez código que las políticas de la Fase 1 nunca
habían tenido enfrente.

#### P35 — El aviso a la comuna destino lo bloqueaba su propia política

*Síntoma:* crear una oferta de apoyo devolvía `42501` (privilegio insuficiente) y la
transacción se revertía entera.
*Causa:* la oferta se insertaba bien; lo que fallaba era la **notificación**. La política
`centernotif_tenant` solo deja escribir avisos cuya comuna sea la propia — y avisarle a otra
comuna es justamente el punto de una oferta de apoyo.
*Solución:* `notify_support_offer(offer_id)`, una función `SECURITY DEFINER` deliberadamente
estrecha: **no recibe texto libre ni destinatario**, solo el identificador de la oferta, y
verifica que quien llama sea su comuna de origen. El mensaje se compone dentro de la función.
*Por qué así:* ampliar la política habría abierto la escritura de notificaciones hacia
cualquier comuna. La función expone exactamente un caso de uso y nada más.

#### P36 — La comuna que ofrece no podía ver a quién le ofreció

*Síntoma:* en la bandeja de ofertas enviadas, la columna «Destino» salía vacía.
*Causa:* el listado resolvía el nombre del centro con un `JOIN` a `Centers`, que pasa por RLS.
El centro destino es de **otra** comuna, así que para quien ofrece era invisible.
*Solución:* `support_offers_visible()`, que replica exactamente la visibilidad de la política
`cmso_read` y resuelve los nombres del lado de la base de datos.
*Nota:* es la tercera vez que aparece la misma causa raíz (P10, P12, P36). Una consulta que
legítimamente debe mirar más allá del tenant no puede resolverse con un `JOIN` normal.

#### P37 — Las políticas de ofertas de apoyo estaban mal desde la Fase 1

Se escribieron junto al resto del esquema, pero **ningún código las ejercitó** hasta esta
iteración. Tenían dos defectos:

- **La lectura era demasiado amplia:** cualquier comuna participante de la emergencia veía
  *todas* las ofertas, incluidas las dirigidas a otras comunas.
- **La escritura solo permitía a la comuna de origen**, así que la comuna que *recibe* la
  oferta no podía aceptarla ni rechazarla: el flujo estaba incompleto en la base de datos.

*Lección:* una política de seguridad que nunca se ejecuta es una hipótesis, no una garantía.

### 6.6 Problemas del modelo de SuperEventos

#### P38 — Una comuna no podía avisarle a la comuna que estaba invitando

*Síntoma:* al pasar la invitación de manos del Super Administrador a cualquier comuna
participante, invitar empezó a fallar con `42501` pese a que la política de participación lo
permitía.

*Causa:* el fallo no estaba en insertar la participación sino en el aviso. La política
`centernotif_tenant` solo deja escribir notificaciones para la **propia** comuna, y una
invitación tiene que aterrizar en la comuna de enfrente. El caso existía desde antes, pero no
se notaba porque en la práctica solo invitaba el Super Administrador, que pasa por
`is_superadmin()`.

*Solución:* `notify_super_event_invitation(id, comuna)`, una función `SECURITY DEFINER`
deliberadamente estrecha —no recibe destinatario ni texto, y exige que la fila de invitación
ya exista— siguiendo el mismo patrón que `notify_support_offer` (P35).

*Nota:* es la segunda vez que aparece la misma causa raíz (P35, P38). Avisarle a otra comuna
es siempre una escritura que cruza el límite, y siempre necesita el mismo tipo de excepción.

#### P39 — `ON CONFLICT` hace que la política de SELECT bloquee un INSERT válido

*Síntoma:* el `INSERT ... ON CONFLICT DO NOTHING` que hace idempotente una invitación fallaba
con `new row violates row-level security policy`, aunque la comuna sí tenía permiso para
invitar. El mismo `INSERT` **sin** `ON CONFLICT` pasaba sin problema.

*Causa:* con `ON CONFLICT`, PostgreSQL exige además que la fila nueva sea **visible bajo la
política de SELECT** de esa tabla. La fila de una invitación lleva el `municipality_id` de la
comuna **invitada**, que `sep_read` justamente le oculta a quien invita. Se descartaron dos
hipótesis antes de dar con esta: la política de INSERT (falla incluso con `WITH CHECK (true)`)
y la de UPDATE (falla igual con la política eliminada). La confirmación fue doble: una tabla
de prueba con política de SELECT `USING (true)` tolera `ON CONFLICT` sin problema, y la tabla
real deja de fallar si se relaja `sep_read`.

*Solución:* insertar a secas y tratar el error `23505` como "ya estaba invitada", dentro de un
`SAVEPOINT` para que un duplicado no aborte la transacción del request. Las comprobaciones de
unicidad de Postgres sí ignoran RLS, así que el `23505` es la única señal fiable disponible.

*Lección:* `ON CONFLICT` no es azúcar sintáctica sobre un `INSERT` cuando hay RLS de por
medio: amplía el conjunto de políticas que deben cumplirse. En una tabla donde se escriben
filas que el autor no puede leer —y una invitación es exactamente eso— la cláusula deja de ser
utilizable.

---

## 7. Verificación

No se usaron pruebas automatizadas; la verificación fue **ejecución real del sistema completo**
(PostgreSQL + backend + frontend en Docker) recreando la base desde cero en cada iteración.

### 7.1 Pruebas de aislamiento (las que realmente importan)

| Prueba | Resultado esperado |
|---|---|
| `SELECT * FROM Centers` sin tenant, como `appcopio_app` | 0 filas |
| Tenant VALPO vs tenant VINA | 12 centros / 3 centros, sin cruce |
| Comuna A pide un centro de comuna B | 404 |
| Admin de Valparaíso lista centros | Solo VALPO (detecta la fuga P2/P3) |
| Comuna invitada, antes de aceptar | Ve el SuperEvento, **0 prioridades** ajenas |
| Comuna tras aceptar | Ve las prioridades compartidas |
| Comuna sin invitación intenta inscribirse | `new row violates row-level security policy` |
| Tablero de un SuperEvento **cerrado**, por una comuna que participa | 0 centros, y `SUPEREVENTO_CERRADO` al ofrecer apoyo |
| Comuna participante **no originaria** invita a una tercera | Permitido (política `sep_write`) |
| Una comuna intenta aportar una segunda emergencia al mismo SuperEvento | Rechazado por el índice único parcial |
| `rolsuper` / `rolbypassrls` de `appcopio_app` | `f` / `f` |
| Las 16 tablas antes desprotegidas, con tenant VALPO y luego VIÑA | 110 / 0 registros de inventario, sin cruce |
| Registrar inventario contra un centro de otra comuna | Rechazado por la política (el trigger deja la comuna en `NULL`) |
| `SELECT * FROM RefreshTokens` como rol de aplicación **con** tenant activo | 0 filas |
| Listado de cajas de recursos como otra comuna | 0 filas (antes devolvía las ajenas) |
| Una tercera comuna participante mira una oferta ajena | 0 filas |

### 7.2 Pruebas de reglas de negocio

Segundo administrador sin liberar el puesto → 409 con mensaje explicativo. Promover a un
Contacto Ciudadano → rechazado. Índice único parcial en la base impide dos administradores
activos **aunque se salte la aplicación**. Al fallar la promoción, la transacción por petición
**revierte la degradación** ya aplicada — la comuna no queda sin administrador.

Desde la iteración 6, estas comprobaciones están automatizadas en
`scripts/validar_multitenant.sh`: 45 comprobaciones contra el sistema real, todas en `PASS`.

### 7.3 Salud del runtime

Tras cada tanda: **0 transacciones ociosas** en `pg_stat_activity`, **0 caídas** del proceso,
y **0 intentos de envío de correo** (el requisito era aviso solo en aplicación). El ciclo
completo login → refresh → logout se verificó contra el almacén de sesiones sellado.

---

## 8. Lecciones transferibles

1. **RLS convierte el aislamiento en una propiedad del motor, no de la disciplina del
   equipo.** Es la diferencia entre «ninguna consulta debe olvidar el filtro» y «el motor lo
   pone». En un sistema con decenas de consultas escritas a mano, es la única garantía viable.

2. **RLS se aplica también dentro de las políticas.** P10 y P12 son la misma causa: una
   política que consulta tablas protegidas queda atrapada por el propio aislamiento. Las
   consultas que legítimamente deben ver a través del tenant necesitan `SECURITY DEFINER`.

3. **Las verificaciones de integridad referencial omiten RLS.** Documentado por PostgreSQL, y
   la raíz de P4: se puede insertar una fila que apunta a un registro que no se puede leer.

4. **Un plan escrito sin verificar contra el código contiene supuestos que envejecen.** El
   análisis previo encontró 5 bloqueadores antes de escribir una línea.

5. **Los defectos de estado compartido no aparecen en la primera petición.** P19 funcionaba la
   primera vez y fallaba la segunda, porque dependía del reciclaje de conexiones del pool.

6. **Los datos semilla deben cubrir los caminos que se quieren verificar.** La colaboración
   intercomunal estuvo rota desde el principio y no se notó porque el seed no traía ninguna
   prioridad: la consulta devolvía vacío tanto si funcionaba como si no.

7. **Interceptar un singleton puede evitar un refactor masivo**, pero exige entender el ciclo
   de vida de lo que se intercepta. La misma técnica que ahorró editar 36 archivos introdujo
   P19 al asumir que los objetos de conexión eran únicos por petición.

8. **Un trigger puede ser un mecanismo de seguridad, no solo de conveniencia.** Los triggers
   de herencia de comuna se escribieron para no tocar cien `INSERT`, pero al correr como
   invocador terminaron validando la pertenencia del padre gratis: escribir contra un centro
   ajeno se rechaza sin una línea de validación en la aplicación.

9. **Cuando el aislamiento por tenant no aplica, sellar puede ser más fuerte que aislar.** El
   almacén de sesiones no admitía una política de comuna porque se usa antes de conocerla; en
   vez de dejarlo desprotegido, quedó inalcanzable para todo el SQL de la aplicación.

10. **Una política que nunca se ejecuta es una hipótesis.** Las de ofertas de apoyo se
    escribieron con el resto del esquema y estuvieron mal durante toda la migración: nadie lo
    notó porque no había una sola línea de código que las tocara.
