# Emergencias, SuperEventos y colaboración inter-municipal en AppCopio

**Informe de funcionamiento y verificación de cifras — v2**
Rama `appcopio-multitenant`, commit `81994a5` **+ 20 archivos sin commitear**. Todo lo afirmado aquí fue verificado contra el código en su estado actual (*working tree*), no contra el último commit.

> ⚠️ **Lo primero que hay que decidir:** los cambios sin commitear son sustantivos y van por delante de los capítulos 5 y 6. Afectan cifras, tablas de evidencia y al menos dos afirmaciones de diseño. La Parte 2 los lista uno por uno.

---

# PARTE 1 — Cómo funciona, desde cero

## 1. El vocabulario mínimo

Cinco conceptos, y conviene no confundirlos porque los capítulos los mezclan cuando hablan rápido:

| Concepto | Qué es | De quién es |
|---|---|---|
| **Municipalidad** (comuna, *tenant*) | La unidad de aislamiento. Todo dato operativo pertenece a exactamente una. | — |
| **Centro** | Un albergue o punto de acopio. Su id codifica la comuna: `VALPO-C001`. | De una comuna |
| **Activación** (`CentersActivations`) | El período en que un centro está abierto y operando. Varias en el tiempo, una abierta a la vez. | De una comuna |
| **Emergencia local** (`Emergencies`) | El evento que una comuna declara para agrupar sus propias activaciones. `created_by_municipality_id` es NOT NULL. **Nunca cruza comunas.** | De **una** comuna |
| **SuperEvento** (`SuperEvents`) | El contenedor donde vive *toda* la colaboración inter-municipal. Agrupa emergencias locales de varias comunas. | De nadie / de la comuna que lo originó |

La regla estructural: **una emergencia es siempre de una sola comuna; un SuperEvento agrupa emergencias de varias.** Toda visibilidad cruzada se resuelve a través del SuperEvento, nunca a través de la emergencia.

## 2. Los cuatro roles y el flag de apoyo

| Rol | `role_id` | Comuna | Para qué sirve |
|---|---|---|---|
| Administrador municipal | 1 | Sí | Manda en su comuna. Declara emergencias, decide colaborar, resuelve ofertas. |
| Trabajador Municipal | 2 | Sí | Personal en terreno. Opera centros, inventario, residentes. |
| Contacto Ciudadano | 3 | Sí | Enlace con la comunidad (dirigente vecinal). **No es personal municipal.** |
| Super Administrador | 4 | **No** (`municipality_id = NULL`) | Administra la plataforma: crea comunas, nombra administradores, crea y agrupa SuperEventos. |

Sobre esto se monta un flag ortogonal: **`es_apoyo_admin`**, un booleano en `Users` que eleva a un Trabajador Municipal a los permisos de administrador para la colaboración, sin nombrarlo Administrador. En el código aparece siempre como `role_id === 1 || es_apoyo_admin === true`.

Dos detalles no obvios:

- Todos los administradores sembrados llevan `es_apoyo_admin = TRUE` también. Redundante pero inofensivo (la condición es un OR).
- Al **degradar** un administrador en un relevo, el servicio apaga `es_apoyo_admin` explícitamente ([municipalityService.ts:148](backend/src/services/municipalityService.ts#L148)). Si no, el degradado seguiría viendo el menú de administración y el badge de "Administrador" — que es justo lo que la degradación busca quitarle.

Los helpers del frontend ([authz.ts](frontend/src/utils/authz.ts)) parten el espacio así, y no son intercambiables:

| Helper | Incluye |
|---|---|
| `isAdminOrSupport` | rol 1 **o** `es_apoyo_admin` |
| `isFieldUser` | rol 2 o 3, **y** sin `es_apoyo_admin` |
| `isMunicipalWorker` | rol 2 exacto |
| `canManageCenters` | rol 1, rol 2, o apoyo |
| `isSuperAdmin` | rol 4 |

## 3. Los tres contextos de base de datos

Cada petición corre dentro de **exactamente uno** de tres contextos, fijado como variable de sesión local a una transacción ([tenantContext.ts](backend/src/auth/tenantContext.ts)):

| Contexto | Variable | Cuándo | Qué ve |
|---|---|---|---|
| Comuna | `app.current_tenant = <id>` | Usuario municipal autenticado | Solo su comuna (+ lo que un SuperEvento vigente autorice) |
| Plataforma | `app.is_superadmin = true` | Super Administrador | Todo a nivel de motor, nada operativo a nivel de aplicación |
| Público | `app.public_access = true` | Sin sesión (mapa público) | Solo centros activos, campos reducidos |

**Nunca dos a la vez.** En PostgreSQL varias políticas permisivas sobre la misma tabla se combinan con OR, así que activar el contexto público dentro de una sesión autenticada no acota la vista: la amplía (un admin pasaría a ver centros activos de todas las comunas). `withTenantOrPublic` resuelve por exclusión: si hay sesión, comuna; si no, público.

Caso de borde deliberado: un usuario municipal **sin comuna** recibe `401 TENANT_MISSING` en vez de caer a un tenant inválido, para que el frontend fuerce un login nuevo.

## 4. El aislamiento: cómo se sostiene

Tres capas, en orden de fuerza:

1. **Motor (RLS).** Cada tabla con datos operativos tiene `ENABLE` + `FORCE ROW LEVEL SECURITY` y una política de la forma `municipality_id = current_tenant() OR is_superadmin()`. El backend se conecta como `appcopio_app`, sin `SUPERUSER` ni `BYPASSRLS`, así que las políticas también se le aplican a él.
2. **API.** Los servicios nunca reciben `municipality_id` como parámetro ni lo leen del body: lo escriben invocando `current_tenant()` dentro del propio `INSERT`, o lo toman de `req.user.municipality_id` (del JWT verificado).
3. **Frontend.** Guardas de ruta (`ProtectedRoute allowedRoleIds={[...]} checkSupportAdmin`). Son **ayuda de navegación, no control de acceso**.

El almacén de tokens (`RefreshTokens`) es la excepción: no se aísla, se **sella**. RLS activo sin ninguna política permisiva = denegación total. Todo acceso pasa por siete funciones `SECURITY DEFINER`.

## 5. Las dos capas de consentimiento

El corazón del diseño, y lo que hace que nada se comparta por accidente. Para que un centro de Valparaíso aparezca en el tablero que ve Viña deben cumplirse **cuatro** condiciones simultáneas:

1. El centro está **activo** (tiene activación abierta).
2. La activación está **vinculada a una emergencia local** de Valparaíso, y esa vinculación la aceptó el encargado del centro → *consentimiento de nivel 1, por centro*.
3. Esa emergencia está **dentro de un SuperEvento**, y Valparaíso está `participando` → *consentimiento de nivel 2, por comuna*.
4. Viña también está `participando` en ese mismo SuperEvento, **y el SuperEvento sigue vigente** (`ended_at IS NULL`).

Las condiciones 3 y 4 se verifican **dentro de la función de base de datos**, no en la API: `super_event_shared_centers()` exige `status = 'participando'` en *ambos* lados (`duena` y `yo`) más `se.ended_at IS NULL` ([002d:359](db/002d_supereventos.sql#L359)).

---

## 6. Flujos, paso a paso

### 6.1 Declarar una emergencia local

```
POST /api/emergencies   { name, type }
```

**Quién:** cualquier usuario con comuna (ver 🔶 más abajo). Nunca el Super Administrador: `requireTenant(req)` lo rechaza con **403 `TENANT_REQUIRED`** porque no tiene comuna, y toda emergencia es local. Él crea SuperEventos.

La comuna **no viene del body**: sale del JWT. Al crearse, el sistema **invita automáticamente** a los encargados de las activaciones abiertas **sueltas** (sin emergencia) de esa comuna. Es una invitación, no una vinculación: cada encargado decide.

✅ **`/api/emergencies` ya tiene guarda de rol** (corregido). El hallazgo era real: el router estaba montado solo con `requireAuth, withTenant` ([index.ts:144](backend/src/index.ts#L144)) y ninguno de sus 10 handlers verificaba `role_id` — solo `requireUser` (¿hay sesión?) y `requireTenant` (¿tiene comuna?), que no miran el rol. El frontend sí restringía la pantalla a rol 1 + apoyo ([App.tsx:104](frontend/src/App.tsx#L104)), de modo que un Trabajador Municipal o un Contacto Ciudadano podía **crear y cerrar emergencias, e invitar o vincular centros** llamando directo a la API. Nunca fue fuga entre comunas — RLS seguía firme — sino una discrepancia entre cliente y servidor en el control de rol *dentro* de la propia comuna.

Ahora **7 de las 10 rutas** llevan `soloAdminOApoyo` (admin de la comuna o `es_apoyo_admin`), que devuelve **403 `SOLO_ADMIN`**. Las tres abiertas al resto del personal municipal son deliberadas:

| Ruta | Guarda | Por qué |
|---|---|---|
| `GET /` | — | la consume "Mis Centros" desde sesión de Trabajador Municipal (§6.10), y también `ActiveCenterDialog` y `SuperEventInviteDialog` |
| `GET /activations/open` | — | idem "Mis Centros" |
| `POST /:id/activations/:aid/respond` | — | la responde el **encargado del centro**, no el administrador: es el consentimiento por centro, y el diálogo que la llama vive en `MainLayout`, visible para cualquier usuario con sesión |
| las otras 7 | `soloAdminOApoyo` | gestión: crear, cerrar, invitar, vincular, y los dos GET de estado de invitaciones |

La guarda se extrajo a `crearGuardaAdmin` en [requireUser.ts](backend/src/auth/requireUser.ts), que ahora comparten los tres routers (`emergencyRoutes`, `superEventRoutes` — con `incluirSuperAdmin` — y `crossSupportRoutes`), en lugar de las dos copias literales que existían.

🔶 **Sigue abierto, de otro alcance:** `respondActivation` verifica que la emergencia sea de la comuna, pero **no** que el usuario sea el encargado de *ese* centro. Hoy cualquier usuario de la comuna puede responder la invitación de cualquier centro de su comuna. Requiere cruzar la asignación del encargado, no una guarda de rol.


### 6.2 Gestión continua de los centros de una emergencia

La pantalla de "Gestión de centros" (diálogo). Cuatro endpoints:

| Endpoint | Qué hace |
|---|---|
| `GET /emergencies/:id/activations` | Todas las activaciones abiertas de la comuna con su estado frente a esta emergencia: `sin_invitar` / `invitada` / `aceptada` / `rechazada`, y en qué emergencia están hoy. |
| `POST /emergencies/:id/invite-activations` | Invita o **reinvita**, sin importar el estado previo. Sirve para las que rechazaron y para trasladar una desde otra emergencia. **409** si la emergencia está cerrada. |
| `POST /emergencies/:id/link-activations` | Vinculación **en lote, sin preguntar** al encargado (`activation_ids` o `all_open: true`). |
| `POST /emergencies/:id/activations/:actId/respond` | El **encargado del centro** acepta o rechaza. |

La tabla es `EmergencyActivationInvitations`, con PK compuesta `(emergency_id, activation_id)` y tres estados. La PK compuesta permite reinvitar con `ON CONFLICT DO UPDATE` sin acumular historial. Es una tabla **intra-comuna**: nada cruza.

Rechazar **no desvincula**: solo registra el rechazo. Antes ponía `emergency_id = NULL`, lo que sacaba al centro incluso de la emergencia en la que ya estaba.

**A quién llega el aviso:** a los usuarios asignados a esa activación (`ActivationAssignments` con `end_date IS NULL`); si no hay ninguno, al `municipal_manager_id` del centro. Una fila de notificación por persona.

### 6.3 Los tres caminos hacia un SuperEvento

**Camino 1 — El Super Administrador lo crea vacío.**
```
POST /api/super-events                      (requireSuperAdmin)
POST /api/super-events/:id/invite  { municipality_ids: [...] }
```
Las comunas quedan `invitada` y deben aceptar aportando una emergencia.

**Camino 2 — El Super Administrador agrupa emergencias que ya existen.**
```
POST /api/super-events/:id/group-emergencies  { emergency_ids: [...] }   (requireSuperAdmin)
```
Solo agrupa emergencias **abiertas y huérfanas** (sin SuperEvento). Vincula la emergencia al SuperEvento y deja a cada comuna dueña como **`invitada`** — no `participando`.

> ⚠️ **Esto cambió.** Antes agrupar inscribía directo a `participando` con un `responded_at` fingido. Ahora exige consentimiento, lo que **refuerza RF9**. Pero introduce un estado intermedio: *la emergencia queda vinculada mientras la comuna sigue `invitada`*. No filtra nada, porque `super_event_shared_centers()` exige `participando` en la comuna dueña. El frontend tuvo que aprender a manejarlo: `SuperEventInviteDialog` ahora busca por separado la emergencia ya vinculada, porque el filtro normal (`super_event_id == null`) la descartaba y dejaba al administrador sin nada que seleccionar, y `AcceptSuperEventDialog` la preselecciona con un aviso ("El Super Administrador agrupó «X» bajo este SuperEvento… Tus centros no se comparten con nadie hasta que aceptes").

**Camino 3 — Una comuna escala su propia emergencia.** (El que motivó el rediseño.)
```
POST /api/super-events/from-emergency/:emergencyId   { name, level, ..., municipality_ids }
```
En una sola transacción: crea el SuperEvento, mete su emergencia dentro, se inscribe como `participando` e invita a las demás.

Este camino exigió dos parches de política:
- `super_events_read` incluye ahora `created_by_municipality_id = current_tenant()`. Sin eso, el `INSERT ... RETURNING` muere con 42501: el `RETURNING` obliga a evaluar la política de `SELECT`, y en ese instante la fila de participante todavía no existe.
- `sep_write` tiene una cláusula de *bootstrap*: una comuna puede insertar su propia primera fila de participación **solo en el SuperEvento que ella misma originó**. Exigir estar ya `participando` era un círculo imposible. El acotamiento a `created_by_municipality_id` es deliberado: un `municipality_id = current_tenant()` suelto permitiría autoinscribirse en cualquier SuperEvento ajeno y rompería el consentimiento.

### 6.4 Aceptar o rechazar una invitación a un SuperEvento

```
POST /api/super-events/:id/respond   { accept, emergency_id | new_emergency }
```

**Quién:** Administrador o apoyo admin de la comuna invitada. Doble verificación: el guard de ruta `soloAdminOApoyo` y además un chequeo explícito de `role_id === 1 || es_apoyo_admin` dentro del handler (el guard de ruta admite al superadmin; este chequeo no, y por eso el superadmin recibe 403 al intentar responder).

**Aceptar obliga a aportar exactamente una emergencia** — existente (`emergency_id`) o nueva (`new_emergency`). Ni ninguna ni las dos: `400 FALTA_EMERGENCIA`. La razón: una comuna `participando` siempre tiene emergencia propia, así el tablero nunca muestra participantes vacíos.

Tres reglas, cada una aplicada en el nivel que le corresponde:

| Intento | Qué lo rechaza | Código |
|---|---|---|
| Aceptar sin aportar emergencia | Validación de servicio | `400` |
| Aportar la emergencia de otra comuna | RLS: la emergencia ajena simplemente **no existe** para quien pregunta | `404`, no 403 |
| Aportar una **segunda** emergencia propia al mismo SuperEvento | Índice único parcial `emergencies_one_per_municipality_per_superevent_uq` | Error de BD |

Diferencia fina en las notificaciones: con una emergencia **existente** *no* se avisa a los encargados de centro (esa emergencia ya los convocó al crearse). Con una **nueva** sí. Por eso la UI muestra, antes de confirmar con una existente, la vista previa de qué centros quedarán compartidos (`GET /emergencies/:id/linked-activations`).

**Rechazar** hace además algo no obvio: pone `super_event_id = NULL` en la emergencia de esa comuna. Si llegó por agrupación, su emergencia ya estaba vinculada; sin esto quedaría atrapada en un evento rechazado — sin compartirse, pero también sin volver a ser huérfana para agruparse en otro lado.

### 6.5 Quién puede invitar

**Cualquier comuna que ya esté `participando`, más el Super Administrador.** No es privilegio de quien originó el SuperEvento. Es el cambio que permite que un evento que crece sume comunas sin pasar por su comuna de origen. Se sostiene en `sep_write` (la frontera real) y en el chequeo `comunaParticipa()` de la ruta (que solo da el mensaje claro).

Este cambio destapó un problema latente: **invitar implica escribir en territorio ajeno.** La política `centernotif_tenant` solo deja escribir avisos dirigidos a la propia comuna, y una invitación tiene que aterrizar en la comuna de enfrente. Mientras solo invitaba el Super Administrador nadie lo notaba, porque él está exento del aislamiento. La solución es `notify_super_event_invitation(super_event_id, municipality_id)`, `SECURITY DEFINER`, que no recibe texto ni destinatario individual, verifica que quien la invoca participe, y **exige que la fila de invitación ya exista**: no es una vía alterna para invitar, solo para avisar.

Y un segundo problema: el `INSERT ... ON CONFLICT DO NOTHING` que hacía idempotente la invitación **no es usable**. Con `ON CONFLICT`, PostgreSQL exige además que la fila nueva sea visible bajo la política de `SELECT`. La fila de invitación lleva el `municipality_id` de la comuna **invitada**, que es justo lo que `sep_read` le oculta a quien invita: una comuna puede crear esa fila pero no verla. Se insertan a secas y se trata el `23505` como "ya estaba invitada", dentro de un `SAVEPOINT` para que un duplicado no aborte la transacción del request completo.

> Nota fina: en `groupEmergencies` **sí** se usa `ON CONFLICT`, y es correcto — agrupar exige superadmin, y `sep_read` lo exime, así que la fila recién creada le es visible.

### 6.6 El tablero intercomunal

```
GET /api/cross-support/board/:superEventId
```

**Quién puede acceder** (esto cambió):

| | Antes (commiteado) | Ahora (working tree) |
|---|---|---|
| Administrador (rol 1) | ✅ 200 | ✅ 200 |
| Trabajador con `es_apoyo_admin` | ✅ 200 | ✅ 200 |
| Trabajador Municipal (rol 2, sin apoyo) | ❌ 403 | ✅ **200** |
| Contacto Ciudadano (rol 3) | ❌ 403 | ❌ 403 |
| Super Administrador (rol 4) | 403 (`NO_PARTICIPA`) | 403 |

El guard nuevo se llama `soloPersonalMunicipal`. El razonamiento: "el encargado de una activación es quien sabe qué puede ofrecer su centro". El Contacto Ciudadano queda fuera porque el tablero expone centros de *otras* comunas. El frontend se ajustó a `allowedRoleIds={[1, 2]}`.

Dos condiciones previas más (`comunaParticipa`):
- La comuna debe estar `participando`, no solo invitada → **403 `NO_PARTICIPA`**
- El SuperEvento debe estar vigente → **409 `SUPEREVENTO_CERRADO`**

**Qué expone, exactamente.** `super_event_shared_centers()` devuelve **doce columnas** y ninguna más:

`center_id, name, latitude, longitude, capacity, fullness_percentage, operational_status, municipality_id, municipality_shortname, activation_id, emergency_id, emergency_name`

Más `prioridades[]` que el servicio ensambla, con solo `item_id, item_name, priority`.

Lo que **no** aparece en la firma y por lo tanto no puede filtrarse por un error de la capa de aplicación: `CentersDescription` (catastro de infraestructura), `FamilyGroups`, `Persons`, y cantidades de inventario. No hay ninguna consulta que los pida.

**El tablero nunca muestra tus propios centros.** `getBoard()` los descarta ([crossSupportService.ts:42](backend/src/services/crossSupportService.ts#L42)):

```ts
const ajenos = centros.filter((c: any) => c.municipality_id !== ownMunicipalityId);
if (ajenos.length === 0) return [];
```

Detalle que importa para entender la arquitectura: la función SQL **sí** devuelve los centros propios — tiene que hacerlo, porque resuelve el conjunto compartido del SuperEvento completo, y el handler de creación de ofertas la usa para validar destinos. Es el servicio el que los filtra para la vista.

> **Por qué estas funciones son `SECURITY DEFINER`:** una política de RLS que intente resolver el conjunto compartido con una subconsulta a `Centers`/`CentersActivations` queda **atrapada por su propio aislamiento** — esas tablas también tienen RLS, la subconsulta corre bajo el tenant activo y solo ve los centros propios. La política que debía habilitar la visibilidad cruzada terminaba filtrándose a sí misma.

Las prioridades de necesidades se resuelven con una tercera política de lectura sobre `CenterItemPriority` (`cip_intermunicipal_read`), que delega en `super_event_shared_center_ids()`.

La pantalla ofrece dos vistas del mismo conjunto (listado y mapa), ambas presentacionales: consumen el conjunto ya filtrado y ordenado, así que cambiar de vista no cambia el recorte. Filtros por prioridad mínima, comuna, ítem solicitado y emergencia; orden por urgencia o cercanía.

### 6.7 Ofertas de apoyo — ciclo de vida

El cambio más grande de los no commiteados: **el ciclo pasó de cuatro a cinco estados.**

```
                    (trabajador sin apoyo)
                            │
                         draft ──────── cancelled
                            │ (su propio admin aprueba)
(admin/apoyo) ─────────► pending ───┬── accepted   (solo la comuna DESTINO)
                            │        └── rejected   (solo la comuna DESTINO)
                            └──────── cancelled     (solo la comuna ORIGEN)
```

`CHECK (status IN ('draft','pending','accepted','rejected','cancelled'))` — [002a:69](db/002a_multitenant_schema.sql#L69)

**Precisión de vocabulario que conviene fijar antes de escribirlo en la tesis:** hay dos "pendientes" distintos, con destinatarios distintos.

- **`draft` = "Borrador"** → pendiente de aprobación **por su propio administrador**. Invisible para la comuna destino, sin notificación.
- **`pending` = "Pendiente"** → ya enviada, pendiente de respuesta **de la comuna destino**. Visible y notificada.

**Crear una oferta** — `POST /cross-support/offers`, guard `soloPersonalMunicipal`. El orden de validaciones importa ([crossSupportRoutes.ts:157-203](backend/src/routes/crossSupportRoutes.ts#L157)):

```
L168  comunaParticipa()                              → 403 NO_PARTICIPA / 409 SUPEREVENTO_CERRADO
L172  ¿está entre los compartidos del SuperEvento?    → 400 CENTRO_NO_DISPONIBLE
L183  ¿es un centro de MI comuna?                    → 400 CENTRO_PROPIO
L192  const isAdmin = role_id === 1 || es_apoyo_admin;
L193  const status  = isAdmin ? 'pending' : 'draft';
```

El estado depende **solo del rol**, sin ninguna rama sobre el destino. Y la oferta de un Trabajador Municipal es **siempre** `draft`. La pregunta "¿y si ofrece a un centro de su propia comuna?" no llega a plantearse: ese caso se rechaza en L183, antes de calcular el estado. Todo lo que alcanza el `INSERT` es, por construcción, inter-municipal. Verifiqué además que no hay otra vía de creación: el único `INSERT` en código es `createOffer()`, invocado solo desde ese handler, y el cliente **no envía `status`** en el payload ([crossSupport.service.ts:99](frontend/src/services/crossSupport.service.ts#L99)).

**Cambiar estado** — `PATCH /cross-support/offers/:id`, guard `soloAdminOApoyo` (aquí sí solo admin/apoyo: comprometer a la comuna frente a otra es el acto institucional):

| Transición | Quién | Desde |
|---|---|---|
| → `pending` (aprobar borrador) | Solo la comuna **origen**. Re-verifica participación + vigencia, para que un borrador redactado antes del cierre no se pueda enviar después. | `draft` |
| → `cancelled` | Solo la comuna **origen** | `draft` o `pending` |
| → `accepted` / `rejected` | Solo la comuna **destino** | `pending` |

La asimetría se aplica en tres niveles: validación de servicio, la política `cmso_update` (origen **o** destino), y `cmso_own_write` para el INSERT (solo origen).

**La invisibilidad del borrador vive en RLS**, no en la aplicación: `cmso_read` exige `status <> 'draft'` en la rama que autoriza a la comuna destino ([002c:329](db/002c_rls_tablas_restantes.sql#L329)). Un borrador solo lo ve su propia comuna. *Esto es un buen ejemplo extra para el capítulo 5: una regla de negocio nueva se implementó en el motor y no en el servicio.*

En la interfaz, la bandeja traduce esto literalmente: enviadas con `draft` → **Enviar** / **Cancelar**; enviadas con `pending` → solo **Cancelar**; recibidas con `pending` → **Aceptar** / **Rechazar**. Quien no es admin/apoyo ve "Pendiente de aprobación" en lugar de botones. *La comuna nunca ve un botón para una acción que el servidor le va a negar.*

### 6.8 No hay ofertas entre centros de la misma comuna

Vale la pena decirlo explícitamente porque es una pregunta natural que el capítulo hoy no responde. Si C1 y C2 son de MUNI y ambos participan del SuperEvento S junto a QUI, **los encargados de C1 y C2 solo pueden ofrecer apoyo a centros de QUI, nunca entre sí.** Bloqueado en dos capas: el tablero no muestra los centros propios (§6.6), y si alguien saltea la UI el backend responde `400 CENTRO_PROPIO`.

Detalle relevante para el capítulo: esa regla es **validación de servicio, no RLS**. A nivel de motor, `cmso_own_write` solo exige `from_municipality_id = current_tenant()`, así que una oferta MUNI→MUNI pasaría la política. Es la única regla del módulo de colaboración que vive *solo* en la aplicación — y es coherente, porque no es una regla de aislamiento (no hay nada que aislar entre dos centros de la misma comuna) sino una regla de negocio sobre el propósito de la entidad.

**Qué cubre el caso intra-comunal hoy:**

| Mecanismo | Qué mueve | ¿Centro a centro? |
|---|---|---|
| `movementRoutes` — entradas / salidas / cajas de recursos | Inventario | **No.** `ENTRY` / `EXIT` / `ADJUSTMENT` de un centro contra el exterior, sin entidad origen-destino. Un traslado se registra como dos movimientos sueltos. |
| `familyRoutes` — `departure_reason = 'traslado'` + `destination_activation_id` | **Personas** | **Sí**, pero mueve residentes, no suministros. Es lo único centro-a-centro del sistema. |
| `CenterItemPriority` + política `cip_own_read` | Visibilidad | El administrador ve las necesidades priorizadas de todos sus centros, pero no hay flujo formal de oferta/aceptación. |
| `UpdateRequests` | Solicitudes de un centro a su municipalidad | No es centro-a-centro. |

O sea: la coordinación intra-comunal existe como **visibilidad** y como **traslado de personas**, pero el ciclo ofrecer→aceptar/rechazar con notificación dirigida solo existe cruzando comunas.

El argumento para la tesis es sólido: *el ciclo de vida de una oferta existe porque cruza una **frontera de autoridad**. Dos municipalidades son organizaciones distintas, sin nadie por encima que pueda decidir por ambas, así que la coordinación necesita un protocolo de consentimiento con estado y trazabilidad. Dentro de una misma comuna esa frontera no existe: el administrador tiene autoridad sobre C1 y C2 a la vez y ya ve las necesidades de ambos, de modo que reasignar recursos es una **instrucción**, no una negociación.*

Dicho eso, hay un hueco operativo real para **trabajo futuro**, distinto del anterior: no existe un traslado de inventario centro-a-centro como operación atómica y auditable. Hoy son dos movimientos independientes que nada vincula, así que el inventario puede quedar descuadrado si uno se registra y el otro no.

### 6.9 Notificaciones dirigidas

Se extendió la entidad existente (`CenterNotifications`) en vez de crear una nueva, para no duplicar el badge ni el polling del frontend. Tres cambios:

- `center_id` pasa a nullable y se agrega `municipality_id`, con `CHECK (center_id IS NOT NULL OR municipality_id IS NOT NULL)`.
- Vínculo con el evento que origina el aviso: `emergency_id` (002b) para lo interno de la comuna, `super_event_id` (002d) para lo que nace de la colaboración.
- Columna `kind`, con **cuatro** valores: `super_event_invitation`, `activation_invitation`, `support_offer`, `volunteer_contact`. Antes la UI tenía que inferirlo de qué campos venían llenos, y tres avisos comparten forma — un ofrecimiento de apoyo abría el detalle del centro en vez de la bandeja de ofertas.

**Las dos escrituras que cruzan el límite** son `notify_support_offer(offer_id)` y `notify_super_event_invitation(super_event_id, municipality_id)`. Comparten la misma forma deliberada:
- No reciben destinatario ni texto: ambos se derivan y se componen dentro, así no hay forma de enviar un mensaje arbitrario a una comuna arbitraria.
- Verifican quién llama (`from_municipality_id IS DISTINCT FROM current_tenant()` → excepción).
- **Insertan una fila por persona** que puede actuar sobre el aviso (administrador + trabajadores con apoyo admin de la comuna destino), no un aviso compartido. `read_at` es por fila: con un aviso único, el primero en abrirlo apagaría el indicador de todos.
- Si la comuna destino no tiene a nadie elegible, el aviso queda dirigido a la comuna para que no se pierda.
- No pasan por `sendNotification`, que dispararía correo.

### 6.10 🆕 Transparencia hacia el encargado del centro ("Mis Centros")

Cambio nuevo, en una pantalla **heredada** y no en una nueva ([MisCentrosPage.tsx](frontend/src/pages/MisCentrosPage/MisCentrosPage.tsx)). Cada tarjeta de centro muestra ahora:

- **A qué emergencia local está unido** el centro, o "No está unido a ninguna".
- Si un SuperEvento **vigente** lo está compartiendo, un aviso explícito: *"Compartido con otras comunas en «X»: su ubicación, capacidad, nivel de abastecimiento y necesidades son visibles para las comunas participantes. **Nunca los datos de las personas alojadas.**"*

Dos decisiones bien tomadas que vale la pena citar en la tesis:

- La condición es `super_event_id != null && super_event_ended_at == null`. Al cerrar el SuperEvento el aviso desaparece, porque *"seguir diciendo compartido sería falso"*. Es la misma semántica de revocación del §6.11, propagada a la interfaz.
- La carga es *best-effort*: si las dos consultas fallan, las tarjetas se muestran igual. Es información añadida, no un bloqueo.

**Por qué importa para el capítulo:** cierra un hueco de transparencia del modelo de consentimiento. El encargado consiente que su centro se sume a la **emergencia local**, pero la decisión de colaborar con otras comunas la toma el administrador *después*. Hasta ahora su único rastro era una notificación en el Buzón — un mensaje, no un estado consultable. Ahora puede verificar en cualquier momento si su centro está siendo compartido y qué se expone de él. Esto es evidencia directa de RF12 desde el lado de quien aporta el dato, y hoy el capítulo 5 no lo menciona.

### 6.11 Cerrar: emergencia vs SuperEvento

La distinción que el diseño original no tenía, y la corrección más importante del capítulo 5.

| | Cerrar una **emergencia local** | Cerrar un **SuperEvento** |
|---|---|---|
| Quién | Administrador o apoyo admin de la comuna dueña (`soloAdminOApoyo` + RLS) | Super Administrador **o la comuna que lo originó** (`super_events_update`) |
| Efecto en la colaboración | **Ninguno** | **Corta el acceso de inmediato y en un solo punto** |
| Efecto en la operación local | Cierra el agrupador; las activaciones siguen abiertas | **Ninguno**: cada comuna sigue con su emergencia |

El cierre del SuperEvento revoca el acceso porque `super_event_shared_center_ids()` y `super_event_shared_centers()` exigen `se.ended_at IS NULL`. El tablero queda vacío, no se pueden emitir ofertas nuevas, y no hace falta recorrer y desvincular las activaciones de cada comuna — que era lo que el cierre exigía antes.

Un participante cualquiera que intente cerrar obtiene 0 filas del `UPDATE` y recibe un **404** con el mensaje "solo pueden cerrarlo el Super Administrador y la comuna que lo originó".

---

## 7. Quién ve qué panel: el menú lateral

Verificado sobre [Navbar.tsx](frontend/src/components/layout/navbar/Navbar.tsx) en su estado actual. **Tres bloques mutuamente excluyentes**, porque `isFieldUser` excluye a los `es_apoyo_admin` y el Super Administrador no entra en ninguno de los dos primeros.

| Bloque | Condición | Enlaces |
|---|---|---|
| Público (siempre) | — | Inicio, Mapa |
| **Personal en terreno** | `isFieldUser` (rol 2 o 3, sin apoyo) | Mis Centros, Buzón, Mis Turnos + 🆕 **Apoyo intercomunal** y **Ofertas de apoyo**, estos dos solo si `isMunicipalWorker` (rol 2 exacto) |
| **Administración** | `isAdminOrSupport` (rol 1 o apoyo) | Mis Centros, Buzón + menú desplegable "Administración": Usuarios, Actualizaciones, Importar datos, Centros, Emergencias, SuperEventos, Apoyo intercomunal, 🆕 **Ofertas de apoyo** |
| **Super Administración** | `isSuperAdmin` (rol 4) | Municipalidades, SuperEventos *(sin ningún enlace a datos operativos)* |

Detalle bien resuelto: los enlaces de colaboración se acotan a `isMunicipalWorker` y no a `isFieldUser`, porque el Contacto Ciudadano está dentro de `isFieldUser` pero el backend lo rechaza con 403 — le habrían mostrado un enlace que lo rebota.

🔸 **Hallazgo menor:** `canSeeIntermunicipal()` se agregó a [authz.ts:56](frontend/src/utils/authz.ts#L56) con el docblock *"Debe coincidir con soloPersonalMunicipal del backend y con los allowedRoleIds de las rutas… en App.tsx"*, pero **nada la usa** — lo verifiqué con `grep` sobre todo `frontend/src`. La regla sigue duplicada en tres lugares (el literal `[1, 2]` de App.tsx, `isMunicipalWorker` en el Navbar, y el guard del backend). Conviene usarla en App.tsx y en el Navbar, que es para lo que se escribió; si no, es código muerto. La regla 9 del proyecto (no dejar residuos de desarrollo) aplica por analogía.

## 8. Matriz de permisos consolidada

Estado del **working tree**.

| Operación | Admin (1) | Trab. + apoyo | Trab. (2) | Contacto (3) | SuperAdmin (4) |
|---|:---:|:---:|:---:|:---:|:---:|
| Crear / cerrar emergencia local | ✅ | ✅ | 🔶 ✅ vía API | 🔶 ✅ vía API | ❌ 403 |
| Invitar / vincular centros a su emergencia | ✅ | ✅ | 🔶 ✅ vía API | 🔶 ✅ vía API | ❌ 403 |
| Listar emergencias / activaciones abiertas | ✅ | ✅ | ✅ *(usado por Mis Centros)* | ✅ | ✅ (0 filas) |
| Responder invitación de centro (encargado) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Crear SuperEvento vacío | ❌ | ❌ | ❌ | ❌ | ✅ |
| Agrupar emergencias existentes | ❌ | ❌ | ❌ | ❌ | ✅ |
| Autocrear SuperEvento desde emergencia propia | ✅ | ✅ | ❌ 403 | ❌ 403 | ❌ (no tiene comuna) |
| Invitar comunas a un SuperEvento | ✅ si participa | ✅ si participa | ❌ 403 | ❌ 403 | ✅ |
| Aceptar / rechazar invitación de comuna | ✅ | ✅ | ❌ 403 | ❌ 403 | ❌ 403 |
| Cerrar SuperEvento | ✅ solo si lo originó | ✅ solo si lo originó | ❌ 403 | ❌ 403 | ✅ |
| Ver tablero intercomunal | ✅ | ✅ | ✅ *(cambió)* | ❌ 403 | ❌ 403 |
| Redactar oferta de apoyo | ✅ → `pending` | ✅ → `pending` | ✅ → **`draft`** | ❌ 403 | ❌ |
| Aprobar borrador → enviar | ✅ | ✅ | ❌ 403 | ❌ | ❌ |
| Aceptar / rechazar oferta recibida | ✅ | ✅ | ❌ 403 | ❌ | ❌ |
| Cancelar oferta propia | ✅ | ✅ | ❌ 403 | ❌ | ❌ |
| Ofrecer apoyo a un centro de su propia comuna | ❌ 400 | ❌ 400 | ❌ 400 | ❌ | ❌ |
| Alta de municipalidad + primer admin | ❌ | ❌ | ❌ | ❌ | ✅ |
| Relevo de administrador de comuna | ❌ 403 | ❌ | ❌ | ❌ | ✅ |
| Ver centros / datos operativos | ✅ propios | ✅ propios | ✅ propios | ✅ propios | **0 resultados** |

🔶 = el frontend lo bloquea, el backend no.

## 9. Gobernanza del cargo de Administrador

Regla: **exactamente un Administrador activo por comuna.** Dos niveles:

- **Base:** índice único parcial `users_one_active_admin_per_municipality_uq ON Users (municipality_id) WHERE role_id = 1 AND is_active = TRUE AND municipality_id IS NOT NULL`. Parcial a propósito: los degradados o desactivados quedan como historial sin bloquear al titular, y los apoyo-admin no cuentan para el límite.
- **Servicio:** el índice se evalúa por sentencia (no es diferible), así que no basta nombrar al sucesor — hay que liberar el puesto primero. El endpoint **exige declarar** `accion_actual: 'degradar' | 'desactivar'` y rechaza con **409** si no se indica. Ambas sentencias viven en la misma transacción del request.

Otras validaciones: `400 ADMIN_ES_EL_MISMO` si se promueve al titular vigente; `400 USUARIO_NO_PROMOVIBLE` si el candidato no es un Trabajador Municipal activo de esa comuna (un Contacto Ciudadano no es personal municipal).

Es operación **exclusiva del Super Administrador**: verifiqué las seis apariciones de `requireSuperAdmin` en los cinco handlers de `municipalityRoutes`. Un administrador municipal recibe 403 incluso sobre su propia comuna.

## 10. Dónde vive cada excepción al aislamiento (17 funciones `SECURITY DEFINER`)

| Motivo | Cuántas | Funciones |
|---|:---:|---|
| Autenticar antes de conocer la comuna | 2 | `auth_lookup_user`, `auth_lookup_user_by_id` |
| Sellar el almacén de sesiones | 7 | `refresh_token_issue` / `_find` / `_revoke_by_hash` / `_revoke_by_id` / `_revoke_all` / `_purge` / `_stats` |
| Operaciones que no cruzan comuna | 2 | `public_center_occupancy` (aforo del canal público), `generate_center_id` (escribe `Municipalities`, reservada a la plataforma) |
| Lecturas acotadas al conjunto compartido | 4 | `super_event_shared_center_ids`, `super_event_shared_centers`, `super_event_participants_of`, `support_offers_visible` |
| Escrituras dirigidas a la comuna de enfrente | 2 | `notify_support_offer`, `notify_super_event_invitation` |

Todas: `SET search_path = public`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO appcopio_app`, ninguna recibe texto libre.

Contraejemplo útil: `emergency_activations_status(INT)`, que alimenta la pantalla de gestión de centros, **no** es `SECURITY DEFINER` — todo lo que consulta es de la propia comuna, así que RLS la acota sola. Prueba de que la superficie se mantuvo acotada a propósito.

---

# PARTE 2 — Verificación de cifras

## ✅ Correctas (re-verificadas contra el working tree)

| Afirmación | Dónde | Verificación |
|---|---|---|
| **28 endpoints nuevos**, repartidos 5 / 10 / 9 / 4 | Cap. 5, `table:endpoints-colaboracion` | Exacto |
| **17 funciones `SECURITY DEFINER`** | Cap. 5 §catálogo + anexo | Exacto. Desglose 2+7+2+4+2 también correcto |
| **7 funciones** de `RefreshTokens` | Cap. 5 | Exacto |
| **11 tablas** afectadas por `center_id VARCHAR(10) → VARCHAR(16)` | Cap. 5 | Exacto: 11 `ALTER COLUMN ... TYPE VARCHAR(16)` (Centers + 10 que la referencian) |
| **4 funciones** de herencia, **8 disparadores** (7 con columna obligatoria + 1 en cajas de recursos) | Cap. 5 | Exacto: 4 funciones, 7 triggers en 002c + 1 en 002d |
| **4 índices únicos parciales** de catálogos | Cap. 5 + Esc. 4 | Exacto (2 en Categories, 2 en Products) |
| **12 columnas** en `super_event_shared_centers` | Cap. 5 + anexo | Exacto |
| Solo las **2** funciones de centros compartidos exigen SuperEvento vigente | Cap. 5 | Correcto (`participants_of` y `support_offers_visible` no lo exigen) |
| **4 valores** de `kind` en notificaciones | Cap. 5 | Exacto |
| **15 archivos** con transacciones propias, **>80** llamadas directas al pool | Cap. 5 §contexto-transacción | Exacto: 15 archivos en routes/services con `BEGIN`; 86 llamadas (36 `connect` + 50 `query`) |
| **4 municipalidades**; **12 / 3** centros Valparaíso / Viña | Cap. 6 | Exacto (Quilpué 3, Concón 3; total 21) |
| **9 centros activos**, **4 comunas** en el mapa público | Cap. 6, Esc. 4 | Exacto: VALPO 001-003, VINA 001-003, QUILP 001-002, CONCO 001 |
| **3 SuperEventos** (uno cerrado), **6 emergencias locales** en 4 comunas | Cap. 6 | Exacto |
| `apoyo.vina` existe | `table:usuarios-prueba` | Sí, se crea en `005_datos_validacion.sql` |
| Índice único parcial de un admin activo por comuna | Cap. 5 | Exacto |
| Al degradar se apaga `es_apoyo_admin` | Cap. 5 | Exacto |
| **7 pantallas nuevas** | Cap. 5, `table:pantallas-frontend` | Correcto como *pantallas nuevas* (ver punto 8 de abajo sobre "Mis Centros") |

## ❌ A corregir

### 1. El ciclo de vida de las ofertas tiene **cinco** estados, no cuatro

Hay un estado `draft` nuevo. Afecta a:

- **Cap. 6 §intro:** "cuatro ofertas de apoyo que cubren los cuatro estados del ciclo de vida" → **cinco ofertas, cinco estados**. (El propio `005_datos_validacion.sql` ya dice "los cinco estados" en su encabezado; la tesis quedó atrás.)
- **Anexo, `table:escenario2-script`:** "Estados distintos representados entre las ofertas sembradas: 4 / 4" → **5 / 5**.
- **Anexo, `table:trazabilidad`, RF11:** "las cuatro ofertas sembradas cubren los cuatro estados" → cinco.
- **Anexo, `table:escenario2-script`:** "Ofertas recibidas / enviadas visibles para Valparaíso: 2 / 2" → **2 / 3** (Valparaíso tiene un borrador propio). Y hay una comprobación **nueva** que agregar: *"el borrador es invisible para la municipalidad destino → 2"*.
- **Cap. 5 §frontend:** "la pestaña de enviadas solo ofrece cancelar" → incompleto. Sobre un borrador ofrece **Enviar** y **Cancelar**; solo sobre `pending` ofrece solo cancelar.
- **Recomendado:** mencionar en el cap. 5 que la invisibilidad del borrador se implementa **en RLS** (`cmso_read` con `status <> 'draft'`), no en el servicio. Es un ejemplo adicional de la tesis central del capítulo.

### 2. El acceso al tablero intercomunal cambió de guarda

- **Anexo, `table:escenario2-script`:**
  - "Trabajador sin apoyo administrativo solicita el tablero → 403" → **200**.
  - "Trabajador con apoyo administrativo solicita el tablero → 200" → esa fila **ya no existe** en el script; en su lugar hay *"un Contacto Ciudadano NO accede al tablero → 403"*.
- **Cap. 5 §frontend, "El cliente no es la frontera de seguridad":** "la posibilidad de admitir además a los trabajadores con apoyo administrativo, que es como el tablero intercomunal queda disponible para ellos" → el tablero está abierto a **todo el personal municipal (roles 1 y 2)**; lo que el apoyo admin habilita ahora es *resolver* ofertas, no *ver* el tablero.
- **Cap. 5 §notificaciones:** "los mismos que las guardas de ruta dejan entrar a la bandeja de ofertas" → ya no coinciden. Los destinatarios del aviso son admin + apoyo; a la bandeja entra además el trabajador sin apoyo, que ve pero no puede resolver.

### 3. El script tiene **69** comprobaciones en **10** secciones, no 70

Los cambios sin commitear **eliminaron la sección completa "Gobernanza de administración"** (3 comprobaciones), quitaron 1 de roles y agregaron 3. Conteo actual verificado:

| Sección | Comprobaciones |
|---|:---:|
| Preparación | 1 |
| Base de datos | 11 |
| Aislamiento entre comunas | 9 |
| Roles | 4 |
| Catálogos compartidos y propios | 3 |
| SuperEventos y colaboración | 25 |
| Notificaciones | 3 |
| Continuidad funcional y canal público | 6 |
| Alta de una municipalidad nueva | 5 |
| Higiene de sesión | 2 |
| **Total** | **69** |

Afecta a:
- Cap. 6: "70 comprobaciones agrupadas en diez secciones" → **69 en diez**.
- Cap. 6 §discusión: "las setenta comprobaciones" → sesenta y nueve.
- Anexo, extracto del script: **"70 comprobaciones agrupadas en once secciones"** → 69 en **diez**. (Ojo: el capítulo decía *diez* y el anexo *once* — eran inconsistentes entre sí incluso antes.)
- Anexo, `fig:salida-final-script`: pie "70 de 70 comprobaciones con `PASS`" → hay que **volver a correr el script y recapturar la imagen**.
- Anexo, extracto: los comentarios "3 de 11", "3 de 9", "2 de 3", "4 de 23", "2 de 5" hay que recalcularlos con la tabla de arriba (SuperEventos pasó de 23 a **25**).

⚠️ **Lo más serio: el Escenario 3 del capítulo 6 se quedó sin evidencia de script.** Sus tres comprobaciones clave — nombrar un segundo administrador → 409, el relevo intentado por un administrador municipal → 403, y la promoción escrita directamente en la base → bloqueada por el índice único — **ya no existen en el script**. Las primeras cinco filas de `table:escenario3-script` no tienen respaldo ejecutable hoy. Lo correcto es **restaurar esa sección** (el comportamiento sigue existiendo: verifiqué `replaceMunicipalityAdmin` y el índice), no degradar las filas a evidencia manual. Restaurarla deja el total en **72**.

### 4. El quinto patrón cubre **9** tablas, no 11

Cap. 5 §propagación: "Las once tablas restantes resuelven su pertenencia contra la tabla padre". Son **nueve** políticas `*_via_padre`: `CenterShiftHistory`, `DatasetFields`, `DatasetFieldOptions`, `DatasetRecordOptionValues`, `DatasetRecordRelations`, `DatasetRecordCoreRelations`, `TemplateFields`, `ResourceBoxItems`, `AuditLog`.

Revisar contra `table:patrones-propagacion` del cap. 4 — si esa tabla dice 11, el error está en los dos lados.

### 5. Agrupar emergencias ya no inscribe automáticamente

Cap. 5 §endpoints, descripción de `superEventRoutes`: "agrupar emergencias existentes" es correcto pero incompleto. Ahora agrupar deja a cada comuna dueña **`invitada`**, no `participando`. Vale la pena decirlo explícitamente porque **refuerza RF9** y porque explica la comprobación nueva del camino 3.

También hay que ajustar el anexo: `notify_super_event_invitation` la invocan **tres** endpoints (`/invite`, `/group-emergencies`, `/from-emergency/:id`), no solo `POST /super-events/:id/invite`.

### 6. La tabla de usuarios de prueba está incompleta

`table:usuarios-prueba` omite la columna de **Contacto Ciudadano**, que existe en las cuatro comunas (`carla.rojas`, `cc.vina`, `cc.quilpue`, `cc.concon`) y que el script **ahora usa** (`T_CC=$(token carla.rojas)`) para la comprobación nueva del tablero. Hay que agregarla.

Además, precisión menor: el texto dice que `003_datos.sql` crea "los usuarios de cada comuna", pero `apoyo.vina` se crea en `005_datos_validacion.sql`.

### 7. 🆕 Falta el bloqueo de ofertas intra-comunales

No es un conteo mal, es una ausencia. El cap. 5 no dice en ninguna parte que una comuna **no puede ofrecer apoyo a sus propios centros**, ni que el tablero descarta los centros propios. Es una pregunta que cualquier lector se hace, y la respuesta refuerza el argumento del capítulo. Ver §6.8 de este informe para el texto sugerido, incluida la observación de que es la **única** regla del módulo que vive solo en la aplicación y no en RLS — lo que la vuelve un contraejemplo interesante y honesto frente al resto.

### 8. 🆕 Falta la transparencia hacia el encargado en "Mis Centros"

Cambio nuevo, descrito en §6.10. No es una pantalla nueva (es una heredada, ampliada), así que las **7 pantallas** de `table:pantallas-frontend` siguen siendo 7. Pero merece mención propia en el cap. 5, porque:

- Cierra un hueco real del modelo de consentimiento: el encargado consiente sumarse a la emergencia *local*, y la decisión de colaborar la toma el administrador después. Hasta ahora su único rastro era una notificación; ahora es un estado consultable.
- Enuncia en la interfaz, en palabras, el límite de confianza inter-municipal ("Nunca los datos de las personas alojadas"). Es evidencia de RF12 desde el lado de quien aporta el dato, no solo desde el lado de quien lee.
- La condición `super_event_ended_at == null` propaga la semántica de revocación del §6.11 hasta la UI.

Sugerencia: un párrafo en §frontend, o una fila extra en la tabla marcada como *pantalla heredada modificada* para no inflar el conteo de nuevas.

### 9. Detalles menores

- **Cap. 5 "El cliente no es la frontera de seguridad":** el argumento valía para el **aislamiento por comuna** pero no para el **control de rol**: `emergencyRoutes` no tenía ninguna guarda de rol. **Resuelto en el código** (§6.1): 7 de sus 10 rutas llevan `soloAdminOApoyo` y devuelven 403 `SOLO_ADMIN`. El capítulo puede mantener la afirmación, con dos precisiones: (a) tres rutas siguen abiertas al personal municipal *por diseño* — las dos lecturas de "Mis Centros" (§6.10) y la respuesta del encargado a la invitación de su centro, que no es un acto del administrador; (b) el nivel de granularidad que **todavía** no se hace cumplir en el servidor es *qué centro* responde: cualquier usuario de la comuna puede responder por cualquier centro de ella. No conviene, entonces, escribir que el servidor replica *toda* la autorización del cliente.
- **Cap. 5 §colaboración:** vale la pena mencionar los dos parches de política que el camino 3 exigió (`created_by_municipality_id` en `super_events_read`, y el bootstrap de `sep_write`). Son dos manifestaciones más del desafío 1 — el aislamiento atrapando a su propia política — en un lugar nuevo: el `RETURNING` de un `INSERT`, que obliga a evaluar la política de `SELECT` sobre una fila cuyo contexto de autorización aún no existe. Sería un sexto desafío perfectamente defendible, o un párrafo dentro del primero.
- **Cap. 5 §resolución de tenant:** omite que un usuario municipal sin comuna recibe `401 TENANT_MISSING`. Caso de borde deliberado, bien documentado en el código.
- **Código, no tesis** — `canSeeIntermunicipal()` en [authz.ts:56](frontend/src/utils/authz.ts#L56) está definida y documentada pero **no se usa en ninguna parte**. Se escribió para ser la fuente única de la regla y la duplicación que venía a eliminar sigue en pie.
- **Código, no tesis** — comentario obsoleto en [config/db.ts:55](backend/src/config/db.ts#L55): dice "13 archivos con BEGIN/COMMIT/ROLLBACK propios y 31 llamadas a pool.connect()"; los números reales son **15** y **36**. La tesis dice bien "quince" y "más de ochenta".
- **Código, no tesis** — comentario obsoleto en [002d:291](db/002d_supereventos.sql#L291): "Todas exigen `se.ended_at IS NULL`", pero `super_event_participants_of` no lo hace (a propósito, para que un evento cerrado siga mostrando quiénes participaron). La tesis lo tiene bien.

## Orden de trabajo recomendado

1. **Decidir si los cambios sin commitear entran en la versión final.** Son sustantivos: borradores de oferta, tablero abierto a trabajadores, consentimiento en agrupación, bootstrap del camino 3, transparencia en Mis Centros. Si entran, hay que actualizar los capítulos 5 y 6 en los nueve puntos de arriba.
2. **Restaurar la sección de Gobernanza al script** — sin ella el Escenario 3 pierde su evidencia primaria. Es el ítem más urgente.
3. **Volver a correr `scripts/validar_multitenant.sh`** y recapturar `resultados-script-validacion.png` con el total real.
4. **Recapturar las capturas afectadas:** la bandeja de ofertas (`fig:pantalla-bandeja-ofertas`) ahora muestra un estado "Borrador" que la imagen actual no tiene; y conviene una captura nueva de "Mis Centros" con el aviso de compartido, si se decide documentar §6.10.
5. Ajustar el conteo del quinto patrón (9, no 11) en los capítulos 4 y 5 **a la vez**.
6. Opcional pero barato: usar `canSeeIntermunicipal()` en App.tsx y en el Navbar, o borrarla.
