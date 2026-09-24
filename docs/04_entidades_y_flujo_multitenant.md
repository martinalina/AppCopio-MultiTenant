# AppCopio Multi-tenant — Entidades, flujo e implementación

> Documento consolidado. Fusiona [01_modelo_de_negocio.md](01_modelo_de_negocio.md),
> [02_implementacion_tecnica.md](02_implementacion_tecnica.md) y
> [03_guion_de_validacion.md](03_guion_de_validacion.md) en un solo documento con el orden
> **diseño → implementación → validación**, y agrega una sección nueva (Parte III) que
> reconcilia todo esto contra los dos planes de trabajo previos (`Multi-tenant 1 - Plan.md` y
> `Multi-tenant 2 - Implementación.md`), señalando dónde el plan y lo construido difieren.
>
> Metodología de esta consolidación: no se dio por buena la redacción de los tres documentos
> de origen. Se volvió a contar contra el código y la base de datos actuales — funciones
> `SECURITY DEFINER`, endpoints por router, tablas con RLS, índice único de administrador,
> configuración del pool — y los tres documentos de origen coincidieron exactamente en cada
> cifra reverificada (16 funciones, 36 tablas con RLS, 15 + 4 endpoints nuevos). Donde se
> encontró un matiz no documentado (el cierre de una emergencia, Parte III.3), se agregó.

> ## ⚠️ Nota de actualización — modelo de SuperEventos (`db/002d_supereventos.sql`)
>
> Después de escrito este documento, la colaboración intermunicipal **dejó de vivir dentro de
> la emergencia** y pasó a una entidad nueva, `SuperEvents`. En resumen:
>
> - `Emergencies` es ahora siempre **local de una comuna** (nivel *emergencia menor*).
> - `SuperEvents` agrupa emergencias de varias comunas y lleva el nivel del evento
>   (`mayor` / `desastre` / `catastrofe`).
> - `EmergencyParticipants` **fue eliminada**; la reemplaza `SuperEventParticipants`.
> - Se agregó `EmergencyActivationInvitations` para registrar qué centro respondió qué.
> - **Cerrar un SuperEvento ahora sí corta el acceso**, lo que resuelve el hueco que este
>   mismo documento reportaba en la Parte III.3.
>
> **Secciones ya actualizadas:** Parte I §3, §5 y §6.5–6.7.
>
> **Secciones que todavía describen el modelo anterior** y deben leerse con esa advertencia:
> Parte I §4.5 y §7; Parte II §3.4 y §5; Parte III §2 y §3; y el guion de la Parte IV
> (pasos 6, 7, 12 y 13). Los documentos 01, 02 y 03 tampoco recogen el cambio.

---

# Parte I — Diseño de la solución

## 1. Punto de partida: AppCopio single-tenant

La versión inicial de AppCopio es un sistema de gestión de albergues y centros de acopio
construido **para una sola municipalidad**: Valparaíso. Esa suposición no estaba declarada
en ninguna parte del código, pero estaba incrustada en todo el diseño:

| Evidencia de la suposición single-tenant | Dónde |
|---|---|
| Los identificadores de centro eran globales y correlativos (`C001`, `C002`, …) | `Centers.center_id` con `DEFAULT` sobre una secuencia única `centers_seq` |
| El catálogo de productos y categorías era global y con nombre único | `Categories.name UNIQUE`, `Products.name UNIQUE` |
| La portada decía "Valparaíso" fijo | `HomePage.tsx` |
| Los datos semilla eran todos de Valparaíso, sin marcarlos como tales | `003_datos.sql` |
| No existía ninguna noción de "a qué organización pertenece este dato" | Las 33 tablas del esquema |

El sistema tenía **tres roles**: Administrador (1), Trabajador Municipal (2) y Contacto
Ciudadano (3). Cualquier usuario autenticado veía y operaba sobre la totalidad de los datos.
No había frontera de datos porque no había nada de qué separarlos.

## 2. El cambio de alcance

El objetivo fue convertir AppCopio en una plataforma que varias municipalidades puedan usar
simultáneamente, **sin que los datos de una sean visibles para otra**, pero permitiendo un
modo de colaboración acotado cuando una emergencia supera los límites de una comuna.

Esto obligó a responder tres preguntas de dominio que antes no existían:

1. **¿Cuál es la unidad de aislamiento?** → La **municipalidad** (comuna).
2. **¿Qué datos son privados y cuáles pueden cruzar?** → Todo es privado salvo una
   excepción explícita y acotada (§5).
3. **¿Quién administra la plataforma por encima de las comunas?** → Un rol nuevo,
   el **Super Administrador**.

## 3. Entidades nuevas

Se agregaron **6 entidades** al modelo, que pasó de 33 a 39 tablas: `Municipalities`,
`Emergencies`, `CrossMunicipalSupportOffers` (las tres de `002a`), más `SuperEvents`,
`SuperEventParticipants` y `EmergencyActivationInvitations` (de `002d`).
`EmergencyParticipants`, que existió entre `002a` y `002c`, fue eliminada: la participación
se trasladó al SuperEvento.

### 3.1 `Municipalities` — la unidad de tenencia

Es la entidad raíz del aislamiento. Todo dato operativo del sistema pertenece a una y solo
una municipalidad.

| Atributo | Rol en el dominio |
|---|---|
| `name` | Nombre de la comuna |
| `shortname` (2–5 letras, único) | **Prefijo de los identificadores de centro.** `VALPO` → `VALPO-C001` |
| `is_active` | Permite dar de baja una comuna sin borrar su historial |
| `center_seq_counter` | Correlativo **propio** de centros: cada comuna parte en `C001` |

La decisión de darle a cada comuna su propio contador (en vez de una secuencia global)
responde a un requisito de negocio: los identificadores deben ser legibles y significativos
para el personal municipal. Un funcionario de Quilpué no debe recibir el centro `C047`
porque otras comunas ya crearon 46; recibe `QUILP-C001`.

### 3.2 `Emergencies` — el evento LOCAL de una comuna

Una emergencia es un **evento acotado a una sola comuna**: agrupa las activaciones de sus
centros y es la unidad de organización interna. Corresponde al nivel *emergencia menor* de
la escala de niveles: afectación acotada a una zona o comuna, atendida con capacidades
comunales.

`created_by_municipality_id` es **NOT NULL**: toda emergencia tiene dueño. El Super
Administrador no crea emergencias, porque no tiene comuna.

`super_event_id` (nullable) indica si esa emergencia fue aportada a un SuperEvento. Nulo es
el caso normal y más frecuente: la comuna se organiza sola.

> **Cambio respecto del diseño original.** Hasta `002c`, `Emergencies` era a la vez el evento
> local *y* el contenedor de la colaboración, y admitía un alcance "regional" con
> `created_by_municipality_id = NULL`. Eso obligaba a que el contenedor existiera **antes**
> que las emergencias locales: si cada comuna ya había abierto la suya —el caso normal cuando
> un evento crece— quedaban dos emergencias activas que eran el mismo evento, y había que
> abandonar una o mover información a mano. Los dos conceptos se separaron en `002d`.

### 3.3 `SuperEvents` — el contenedor de la colaboración

Un SuperEvento **agrupa emergencias de varias comunas** y es el único lugar donde vive la
colaboración: participantes, tablero intercomunal y ofertas de apoyo.

A diferencia de las emergencias, sí modela una escala de gravedad, en `level`:

| Nivel | Definición y alcance | Capacidad de respuesta requerida |
|---|---|---|
| *(emergencia menor)* | Evento local acotado a una zona o comuna. **No es un SuperEvento**: es una `Emergencies` suelta. | Capacidades y recursos exclusivamente comunales. |
| `mayor` | Sobrepasa la capacidad de respuesta de la comuna afectada. | Apoyo o intervención del nivel provincial o regional. |
| `desastre` | Afectación severa que sobrepasa la capacidad de respuesta regional. | Movilización y reasignación de recursos a nivel nacional. |
| `catastrofe` | Excede la capacidad de respuesta del país. | Coordinación del Gobierno Central y asistencia internacional. |

Tres caminos llegan a un SuperEvento, y los tres terminan en la misma entidad:

1. **El Super Administrador lo crea** vacío e invita comunas (se anticipa al evento).
2. **El Super Administrador agrupa** emergencias que ya existen y no tienen SuperEvento
   (llega después, cuando cada comuna ya venía manejando la suya).
3. **Una comuna lo autocrea** desde su propia emergencia al querer colaborar. Su emergencia
   no se mueve ni se rehace: se envuelve.

`created_by_municipality_id` registra quién lo originó (NULL = el Super Administrador), pero
**no confiere el privilegio de invitar**: eso lo tiene cualquier comuna participante. Sí
limita quién puede cerrarlo, porque cerrar le corta la colaboración a todos.

Una comuna aporta **a lo sumo una emergencia por SuperEvento**
(`emergencies_one_per_municipality_per_superevent_uq`). Sin esa restricción, "mi emergencia
en este SuperEvento" sería ambiguo.

### 3.4 `SuperEventParticipants` — la participación como máquina de estados

Relaciona municipalidades con SuperEventos, pero **no es una simple tabla puente**: lleva un
`status` que modela el consentimiento.

```
invitada ──aceptar──> participando
    │
    └────rechazar───> rechazada
```

Este estado es una decisión de dominio central: **una comuna no es inscrita, es invitada**.
Compartir información con otra organización requiere consentimiento explícito de quien tiene
la autoridad para darlo (el administrador de la comuna). Solo `participando` habilita la
lectura ampliada.

**Aceptar obliga a aportar una emergencia**, existente o nueva. No es un botón de "sí": una
comuna participando siempre tiene la suya, así el tablero nunca muestra participantes vacíos
y siempre se sabe qué centros expone cada quien.

Columnas de seguimiento: `invited_by`, `invited_by_municipality_id` (necesaria porque ahora
invita cualquier participante, no solo quien originó el SuperEvento) y `responded_at`.

### 3.5 `EmergencyActivationInvitations` — qué centro respondió qué

Registra a qué activaciones se les ofreció sumarse a cada emergencia y qué contestaron
(`invitada` / `aceptada` / `rechazada`). Es **intra-comuna**: no cruza nada entre
municipalidades.

Existe porque el rechazo de un centro antes no se registraba en ninguna parte —rechazar solo
ponía `emergency_id = NULL`— y sin ese dato era imposible distinguir *"nunca se invitó"* de
*"se invitó y dijo que no"*. El administrador no podía volver a invitar a conciencia ni saber
qué centros faltaban por responder.

Su clave primaria compuesta `(emergency_id, activation_id)` es lo que permite **reinvitar**:
una sola fila por par, siempre con el último estado, sin historial duplicado.

### 3.6 `CrossMunicipalSupportOffers` — ofertas de apoyo entre comunas

Modela que una comuna ofrezca recursos a un centro de otra comuna dentro de un **SuperEvento**
compartido (antes colgaba de la emergencia). Tiene un ciclo de vida propio:

```
pending ──acepta el destino──> accepted
   │
   ├────rechaza el destino───> rejected
   └────cancela el origen────> cancelled
```

La asimetría es deliberada y es una regla de negocio, no un detalle técnico: **solo la comuna
que ofrece puede cancelar, y solo la que recibe puede aceptar o rechazar.** Nadie decide por
la contraparte.

Su visibilidad también es acotada: una oferta la ven **la comuna que ofrece y la que recibe**,
no todas las comunas participantes. Un ofrecimiento de recursos es una conversación entre dos
organizaciones, no un anuncio público del grupo.

## 4. Entidades modificadas

### 4.1 Propagación del discriminador de tenencia

Veinte tablas llevan hoy una columna `municipality_id`. La distinción entre obligatorio y
opcional **no es técnica, es de negocio**:

**Obligatorio (`NOT NULL`) — dato operativo que siempre pertenece a una comuna:**

`Centers`, `CentersActivations`, `FamilyGroups`, `Persons`, `CenterInventoryItems`, `Datasets`,
y en una segunda oleada `InventoryLog`, `UpdateRequests`, `CenterAssignments`, `CenterShifts`,
`ActivationAssignments`, `DatasetRecords`.

**Opcional (`NULL` = recurso compartido de la plataforma):**

`Categories`, `Products`, `Templates`, `municipal_zones`, `ResourceBoxes`

El `NULL` en los catálogos codifica una regla de negocio concreta: **existe un catálogo base
común a todas las comunas, y cada comuna puede además crear el suyo propio.** Una comuna ve
lo global más lo suyo, nunca lo de otra.

**Caso especial — `Users`:** la columna es nullable, pero con una restricción que la vuelve
obligatoria salvo para un rol:

```sql
CHECK ((role_id = 4 AND municipality_id IS NULL) OR
       (role_id <> 4 AND municipality_id IS NOT NULL))
```

Es la traducción a esquema de la regla "el Super Administrador no pertenece a ninguna comuna,
y todo el resto sí".

### 4.2 `Persons` — una decisión revisada

`Persons` no recibió `municipality_id` en el diseño original: se pensaba resolver su
pertenencia navegando `Persons → FamilyGroupMembers → FamilyGroups → municipality_id`.

Se cambió a columna propia por dos razones, una de negocio y una técnica:

- **De negocio:** los datos de personas son la información más sensible del sistema y su
  pertenencia debe ser un hecho explícito del modelo, no una inferencia por navegación.
- **Técnica:** la verificación de pertenencia se convertía en una subconsulta de tres tablas
  evaluada en cada lectura de cada fila.

### 4.3 `Centers.center_id` — de correlativo global a identificador con prefijo

El formato pasó de `C00X` a `SHORTNAME-C00X`. El campo se amplió de `VARCHAR(10)` a
`VARCHAR(16)` (con `QUILP-C001` ya se ocupaban exactamente 10 caracteres, y el centro
número 1.000 de una comuna habría desbordado la columna).

El identificador ahora **codifica la pertenencia**, lo que lo vuelve autoexplicativo en
reportes, exportaciones CSV y conversaciones operativas entre comunas.

### 4.4 `Roles` — el cuarto rol

Se agregó **Super Administrador (`role_id = 4`)**, con un alcance deliberadamente estrecho
(§6.3).

### 4.5 `CenterNotifications` — de avisos por centro a avisos por comuna

El modelo original solo permitía notificar sobre un centro (`center_id NOT NULL`). La
colaboración intercomunal exigió notificar a **una comuna** (invitación a una emergencia) o a
**una oferta de apoyo** (que no tiene centro propio, tiene un centro *destino* de otra
comuna), así que `center_id` pasó a ser nullable y se agregaron `municipality_id` y
`emergency_id`, con una restricción que exige al menos un destino:

```sql
CHECK (center_id IS NOT NULL OR municipality_id IS NOT NULL)
```

`emergency_id` es lo que le permite al frontend renderizar los botones Aceptar/Rechazar
directamente sobre la notificación. Antes de esta migración, `CenterNotifications` **no tenía
RLS** — no hacía falta, todo era de una sola comuna. Al pasar a transportar avisos
intercomunales, se activó `ENABLE` + `FORCE ROW LEVEL SECURITY` con una política que exige
que la comuna destino sea la propia (directamente, o vía el centro al que se refiere el aviso).

### 4.6 `ResourceBoxes` — de recurso sin dueño a catálogo dual

Las cajas de recursos (plantillas de ítems para armar entregas) no tenían **ningún** vínculo
con una organización: ni centro, ni comuna. Eran, de hecho, una fuga: el listado no filtraba
nada y un administrador de Viña veía las cajas que había armado Valparaíso.

Se resolvieron como **catálogo dual**, el mismo patrón que productos y categorías: `NULL`
significa caja base de la plataforma, y un valor significa caja propia de esa comuna.

## 5. La regla de oro: qué cruza y qué no

Esta es la decisión de dominio más importante del proyecto, porque define el límite de
confianza entre organizaciones.

**Nunca cruzan de comuna, bajo ninguna circunstancia:**

- `Persons` — datos de personas identificables
- `FamilyGroups` y `FamilyGroupMembers` — composición familiar
- `CentersDescription` — catastro detallado del inmueble
- `CenterInventoryItems` — cantidades de inventario

**Puede cruzar, solo bajo un SuperEvento vigente con consentimiento mutuo:**

- `CenterItemPriority` — **las prioridades de necesidades** de un centro
- Del centro en sí, solo lo que el tablero intercomunal expone: identificador, nombre,
  ubicación, capacidad, porcentaje de abastecimiento y estado operacional
- `CrossMunicipalSupportOffers` — las ofertas de apoyo, y solo entre las dos comunas
  involucradas
- Además, el **nombre de la emergencia** que aporta cada centro, para que el tablero pueda
  agruparlos por evento en vez de mezclarlos

Es decir: una comuna puede saber que el albergue vecino *necesita agua con prioridad alta* y
ofrecerle las suyas, pero nunca cuántas personas alberga, quiénes son, ni cuánta agua tiene.

**Y una asimetría deliberada:** la ampliación es de **solo lectura**. Todas las políticas de
escritura exigen que el dato pertenezca a la comuna que escribe. Ninguna comuna puede
modificar datos de otra, ni siquiera dentro de un SuperEvento compartido.

**La ampliación también es temporal:** cerrar el SuperEvento la revoca. Las funciones
`super_event_*` exigen `SuperEvents.ended_at IS NULL`, así que el tablero queda vacío y no se
pueden crear ofertas nuevas. Esto **cambió** respecto del diseño anterior, donde el cierre era
puramente informativo (ver §6.5).

**Aparte, y sin relación con las emergencias, existe un canal público** (mapa sin sesión)
limitado a: ubicación, capacidad, porcentaje de llenado, estado operacional y prioridades
agregadas, y **solo de centros activos**.

## 6. Reglas de negocio nuevas o modificadas

### 6.1 La pertenencia nunca la declara el cliente

Ningún endpoint acepta `municipality_id` en el cuerpo de una petición. Se deriva siempre del
token de sesión verificado o de la entidad padre:

| Dato creado | De dónde hereda la comuna |
|---|---|
| Centro, Usuario, Producto, Categoría, Plantilla, Persona | Del **JWT** de quien lo crea |
| Activación, Inventario, Dataset | Del **centro** al que pertenece |
| Grupo familiar | De la **activación** en la que se registra |

Sin esta regla, un usuario podría crear datos a nombre de otra comuna simplemente alterando
el JSON que envía.

### 6.2 Un solo administrador activo por comuna

Regla nueva: cada municipalidad tiene **exactamente un** usuario con `role_id = 1` activo,
garantizada con un índice único parcial en Postgres, `users_one_active_admin_per_municipality_uq`
(confirmado en `db/002b_emergencias_y_notificaciones.sql:38`), además de la validación en el
servicio. Para nombrar uno nuevo hay que, en la misma operación, **degradar al actual a
Trabajador Municipal o desactivar su cuenta**.

Decisiones asociadas:

- El límite cuenta **solo `role_id = 1`**; los `es_apoyo_admin` no ocupan el cupo.
- Solo se puede promover a un **Trabajador Municipal**. Un Contacto Ciudadano es enlace con
  la comunidad, no personal municipal, y por tanto no es candidato a administrar la comuna.
- Al degradar, se apaga también `es_apoyo_admin`: de lo contrario el usuario conservaba los
  privilegios de administrador que la degradación pretendía quitarle.

### 6.3 El Super Administrador administra la plataforma, no las comunas

Su alcance es deliberadamente estrecho:

**Puede:** crear municipalidades, nombrar y cambiar su administrador, declarar emergencias
regionales e invitar comunas.

**No puede:** crear centros, activar centros, ni operar datos de ninguna comuna. Como no
tiene `municipality_id`, cualquier intento de crear un dato operativo es rechazado por diseño.

### 6.4 Crear y administrar centros

Antes: cualquier usuario autenticado podía crear centros — el endpoint no tenía ninguna
verificación de rol y el frontend admitía los tres roles.

Ahora: **Administrador, apoyo administrativo o Trabajador Municipal**. Queda fuera el
Contacto Ciudadano.

### 6.5 Las activaciones y las emergencias

- **Una activación no requiere emergencia.** Un derrumbe en un sector puntual abre una
  activación local. `emergency_id` es nullable a propósito. Esto es lo que en la práctica
  cubre el caso de una "emergencia puntual" (uno o dos centros): no hace falta declarar una
  `Emergencies` completa para un incidente que no va a cruzar de comuna.
- **Una activación se vincula en dos momentos:** al activar el centro (selector opcional) o
  después, mediante vinculación masiva, para los centros que ya estaban abiertos cuando la
  emergencia se declaró.
- **Cerrar una emergencia es un asunto interno de la comuna.** Registra `ended_at`; los
  centros siguen activos si su activación lo está. No afecta a las demás comunas.
- **Lo que corta la colaboración es cerrar el SUPEREVENTO.** Ahí sí: `super_event_shared_centers()`
  y `super_event_shared_center_ids()` exigen `SuperEvents.ended_at IS NULL`, y
  `POST /cross-support/offers` responde `SUPEREVENTO_CERRADO` (409).
  **Esto corrige un hueco real del diseño anterior**, donde `emergency_shared_centers()` solo
  miraba `CentersActivations.ended_at` y el acceso sobrevivía al cierre de la emergencia hasta
  que alguien cerrara las activaciones una por una.

### 6.6 Consentimiento en dos niveles

La comuna **no compromete a todos sus centros de golpe**. Pero el momento en que se le
pregunta al encargado **cambió**: ya no es al aceptar una invitación intercomunal, sino al
**crear la emergencia local**, que es cuando la pregunta tiene sentido.

```
Administrador de la comuna
   │  crea la emergencia local
   ▼
Encargado de cada activación SIN emergencia  ← decide si SU centro se suma
   │  acepta
   ▼
La activación queda vinculada a la emergencia
   │
   │  (más tarde, si el evento crece)
   ▼
Administrador de la comuna  ← acepta un SuperEvento aportando esa emergencia
   ▼
Los centros ya vinculados pasan a compartirse
```

La razón de fondo no cambia: quien está a cargo de un albergue concreto tiene información
que el administrador comunal no necesariamente tiene sobre la conveniencia de exponer las
necesidades de ese centro. Lo que cambia es *cuándo* se le consulta.

Tres consecuencias de ese traslado, y cómo se cubren:

1. **Solo se convoca a las activaciones sin emergencia.** Convocar a las que ya están en otra
   las movería de lugar sin que nadie lo pidiera. El traslado deliberado existe, pero es
   explícito (punto 3).
2. **Al aceptar un SuperEvento con una emergencia existente NO se vuelve a preguntar**, porque
   ya se preguntó al crearla. Como nadie vuelve a consultar, el diálogo de aceptar muestra la
   **lista exacta de centros que quedarán compartidos** antes de confirmar: es la única
   oportunidad de ver qué se está exponiendo. Si en cambio la emergencia se crea en ese mismo
   paso, sí se avisa a los encargados.
3. **La primera tanda no es la última.** `POST /emergencies/:id/invite-activations` invita o
   **reinvita** a cualquier activación abierta sin importar su estado previo: las que
   rechazaron, las que están en otra emergencia y deben trasladarse, y las que quedaron fuera
   porque entonces pertenecían a una emergencia ya terminada. Cuando el centro está en otra
   emergencia, el aviso se lo dice explícitamente al encargado: aceptar lo traslada, y debe
   saberlo antes de decidir.

**Rechazar ya no desvincula.** Antes `respondActivation(accept=false)` hacía
`SET emergency_id = NULL`, lo que sacaba al centro incluso de la emergencia donde ya estaba
legítimamente. Ahora el rechazo solo se registra en `EmergencyActivationInvitations`.

### 6.7 Ofrecer apoyo a otra comuna

- **Solo se puede ofrecer a centros que el SuperEvento expone.** Si el centro destino no está
  activo y vinculado a una emergencia de ese SuperEvento, el ofrecimiento se rechaza
  (`CENTRO_NO_DISPONIBLE`): no se puede usar el canal de apoyo para alcanzar un centro que la
  colaboración no habilitó.
- **No se ofrece a centros propios** (`CENTRO_PROPIO`). El apoyo intercomunal es entre
  organizaciones distintas.
- **Cada decisión corresponde a un lado:** cancelar es del que ofrece; aceptar y rechazar son
  del que recibe.
- **Una oferta ya resuelta no se vuelve a decidir** (`OFERTA_YA_RESUELTA`, 409). Aceptada,
  rechazada o cancelada, queda como registro histórico.
- **Un SuperEvento cerrado no admite ofertas nuevas** (`SUPEREVENTO_CERRADO`, 409). Antes no
  existía esta guardia y se podía ofrecer apoyo sobre una emergencia ya terminada.

## 7. Comparación resumida

| Dimensión | AppCopio single-tenant | AppCopio multi-tenant |
|---|---|---|
| Organizaciones | 1 (Valparaíso, implícita) | N municipalidades, explícitas |
| Entidades | 33 tablas | 37 tablas |
| Roles | 3 | 4 (+ Super Administrador) |
| Identificador de centro | `C001` global | `VALPO-C001`, correlativo por comuna |
| Catálogo de productos | Global, nombre único | Base compartida + catálogo propio por comuna |
| Frontera de datos | Ninguna | Aislamiento en la base de datos: **36 tablas con RLS** |
| Tablas con marca de pertenencia | 0 | 20 |
| Colaboración entre organizaciones | No aplica | Emergencias con consentimiento en dos niveles, tablero intercomunal y ofertas de apoyo |
| Almacén de sesiones | Tabla accesible desde el SQL de la aplicación | Sellada: solo alcanzable por funciones acotadas |
| Acceso público | Todos los centros | Solo centros activos, campos limitados |
| Administración de la plataforma | No existía | Super Administrador con alcance acotado |

## 8. Alcance deliberadamente excluido

Para dejar constancia de lo que **no** se abordó y por qué:

- **No hay niveles jerárquicos de emergencia** (comunal/provincial/regional/nacional como los
  define la Ley 21.364). El sistema modela participación de comunas, no la escala legal del
  evento — ver §3.2.
- **Una activación pertenece a una sola emergencia.** Si un centro debiera participar en
  varias simultáneamente, se requiere una tabla de relación.
- **La aceptación de una oferta no mueve inventario.** Registra el acuerdo entre las dos
  comunas; el traslado y su descuento de stock siguen siendo un proceso fuera del sistema.
- **`AuditLog` no se escribe todavía.** Su estructura y su política están listas, pero ningún
  flujo genera registros de auditoría.

> **Nota sobre el aislamiento:** este apartado listaba antes dieciséis tablas sin política de
> seguridad a nivel de fila. Ya no queda ninguna: todas las tablas del esquema con datos
> operativos están protegidas, y el almacén de tokens de sesión quedó sellado tras funciones
> acotadas. El detalle está en la Parte II, §3.5 y §3.6.

---

# Parte II — Implementación técnica

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
pasó a usarlo (confirmado: `backend/.env` tiene `DB_USER=appcopio_app`). Los scripts de
inicialización siguen corriendo como `postgres` para poder sembrar datos sin pelear con las
políticas.

Se usó `FORCE ROW LEVEL SECURITY` (no solo `ENABLE`) porque sin `FORCE` el **dueño** de la
tabla se salta sus propias políticas.

## 2. Metodología: análisis previo antes de escribir código

El proyecto partió de un plan de migración escrito previamente (`AppCopio_MultiTenant_Plan.md`,
y luego el plan corregido de la Parte III de este documento). Antes de ejecutarlo se hizo una
**fase de análisis de viabilidad**: contrastar cada supuesto del plan contra el código real,
sin modificar nada.

El resultado justificó el esfuerzo: **5 bloqueadores** que habrían dejado el sistema sin
arrancar o sin login, y **10 huecos de cobertura**. Varios de ellos (el login roto por RLS,
el trigger que no podía escribir, el `setval` que rompía el seed) solo se manifiestan en
tiempo de ejecución y habrían aparecido de a uno, después de horas de trabajo ya invertido.
El detalle punto por punto está en la Parte III.

**Hallazgo metodológico:** un plan de migración escrito sin verificar contra el código real
contiene supuestos que envejecen. Nombres de carpetas (`db_init/` vs `db/`), conteos
(«6 archivos con `BEGIN`/`COMMIT`» cuando eran 13), y afirmaciones directamente falsas
(«el handler de refresh no necesita cambios» cuando sí los necesitaba).

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
002b_emergencias_y_notificaciones.sql ← NUEVO: invitaciones + correcciones
002c_rls_tablas_restantes.sql         ← NUEVO: cierre del aislamiento + ofertas
003_datos.sql                         ← reescrito
004_add_family_to_inventory_log.sql
005_datos_validacion.sql              ← NUEVO: datos para el guion de QA (Parte IV)
```

`002a_` < `002b_` < `002c_` < `003_` funciona porque `_` (0x5F) ordena antes que `a` (0x61).

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
mínimo y verificable.

Hay **16 funciones `SECURITY DEFINER`** en el esquema final — recontadas una por una en esta
consolidación sobre `db/002a_*.sql`, `db/002b_*.sql` y `db/002c_*.sql`, coincide exacto con lo
documentado:

| Función | Por qué necesita omitir RLS |
|---|---|
| `auth_lookup_user(username)` | El login ocurre **antes** de conocer el tenant |
| `auth_lookup_user_by_id(id)` | Ídem para `GET /auth/me` |
| `generate_center_id()` | El trigger escribe en `Municipalities`, que solo permite escritura al superadmin |
| `public_center_occupancy(center_id)` | Cuenta personas para el aforo público **sin devolver ni una fila** de personas |
| `emergency_shared_center_ids()` | Resuelve el conjunto de centros compartidos, que por definición son de otras comunas |
| `emergency_shared_centers(id)` | Igual, pero devuelve los campos del tablero intercomunal |
| `emergency_participants_of(id)` | Devuelve las comunas participantes, verificando primero que quien pregunta participe |
| `notify_support_offer(id)` | Escribe un aviso dirigido a **otra** comuna (§6.5, P35) |
| `support_offers_visible()` | Resuelve el nombre del centro destino, que es de otra comuna (§6.5, P36) |
| `refresh_token_*` (7 funciones: `create`, `find`, `revoke_by_hash`, `revoke_by_id`, `revoke_all`, `purge`, `stats`) | Única vía de acceso al almacén de sesiones (§3.6) |

Cada una lleva `SET search_path = public` (evita secuestro por `search_path`) y sus permisos
se revocan de `PUBLIC` y se otorgan solo a `appcopio_app`.

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

- **Columna + trigger (7 tablas, recontadas sobre `db/002c_*.sql`):** `InventoryLog`,
  `UpdateRequests`, `CenterAssignments`, `CenterShifts`, `ActivationAssignments`,
  `DatasetRecords`, `ResourceBoxes`.
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

Como todos los archivos importan el mismo singleton, quedaron cubiertos sin tocarlos: tanto
los servicios que reciben `db: Db` inyectado como los que importan `pool` directamente. **Una
transacción por request**, tenant garantizado, cero refactor masivo.

El `ROLLBACK` interno no se descarta en silencio: marca un flag `rollbackRequested` que el
middleware consulta al cerrar (`finishTx`, con
`shouldRollback = statusCode >= 400 || store.rollbackRequested`), para no commitear lo que un
servicio quiso descartar.

### 4.3 Modos de contexto

| Middleware | Uso | Efecto |
|---|---|---|
| `withTenant` | Rutas autenticadas | `set_config('app.current_tenant', …)` o `app.is_superadmin` |
| `withPublicContext` | Rutas anónimas | `set_config('app.public_access', 'true')` |
| `withTenantOrPublic` | Rutas de doble uso | Resuelve según haya sesión o no, **nunca ambos** |

Confirmado en `backend/src/config/db.ts`: el `Pool` además sube `max` a 30 y define
`statement_timeout` e `idle_in_transaction_session_timeout`, ambos configurables por variable
de entorno (`DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS`), consecuencia directa de que
retener una conexión por toda la duración del request exige un pool más grande y límites de
tiempo (P19, P24 más abajo).

### 4.4 Autenticación y tenant en el JWT

`JwtUser` incorpora `municipality_id` y `municipality_shortname`. El login no puede pasar por
`withTenant` porque la comuna se conoce recién *después* de leer al usuario — de ahí
`auth_lookup_user`/`auth_lookup_user_by_id` (§3.4). `requireSuperAdmin` y `requireTenant(req)`
son los guards que usan las rutas nuevas: el segundo devuelve el `municipality_id` del JWT o
lanza 403, y es el mecanismo con el que se implementa la regla 6.1 (nunca confiar en el
`municipality_id` del body).

## 5. Fase 3 — Frontend, e iteraciones 4 y 5

**Fase 3** propagó el tenant al cliente: tipo `User` con los campos de comuna, rol 4 en los
guards, badge de comuna en el navbar, y plantillas CSV actualizadas al nuevo formato de id.

**Iteración 4** construyó las pantallas de Super Administrador (municipalidades, detalle con
cambio de administrador, emergencias), el flujo de invitación con notificación en pantalla, y
la vinculación de activaciones. Se agregaron **15 endpoints** repartidos en dos routers
nuevos: **recontados en esta consolidación** —
`municipalityRoutes.ts` (`GET /`, `POST /`, `GET /:id`, `GET /:id/users`, `POST /:id/admin` = 5) y
`emergencyRoutes.ts` (`GET /`, `POST /`, `GET /activations/open`, `PATCH /activations/:id`,
`GET /:id/participants`, `POST /:id/invite`, `POST /:id/respond`,
`POST /:id/link-activations`, `POST /:id/activations/:activationId/respond`,
`PATCH /:id/close` = 10) — 5 + 10 = **15**, coincide exacto.

La notificación en pantalla reutiliza el sondeo de 30 segundos que ya existía para el badge
del buzón (`useUnreadNotifications`), extendido para devolver también la lista y no solo el
conteo. Se usa `createNotification` y **no** `sendNotification`, porque esta última dispara
correo y el requisito era aviso solo dentro de la aplicación.

**Iteración 5** cerró los dos huecos que quedaban declarados: el aislamiento de las dieciséis
tablas sin política (§3.5), el sellado del almacén de sesiones (§3.6), y **la interfaz de
colaboración intercomunal** — un tablero con los centros activos de las otras comunas
participantes y sus necesidades, y una bandeja de ofertas de apoyo con las acciones separadas
por lado. **Cuatro endpoints** en `crossSupportRoutes.ts`, recontados y confirmados:
`GET /board/:emergencyId`, `GET /offers`, `POST /offers`, `PATCH /offers/:offerId`.

Esta funcionalidad — tablero intercomunal, ofertas de apoyo, las páginas
`IntermunicipalBoardPage.tsx` y `SupportOffersPage.tsx`, el componente `OfferSupportDialog` —
**no está descrita en ninguno de los dos planes de trabajo previos** (ver Parte III.2): se
construyó como parte de esta iteración 5, sobre una tabla (`CrossMunicipalSupportOffers`) que
sí estaba en el plan base, pero cuyas rutas, servicio y pantallas no tenían spec escrita.

## 6. Catálogo de problemas encontrados

Esta sección es el registro de los **37 defectos** hallados, su causa raíz y su solución. Se
agrupan por naturaleza porque la causa raíz se repite dentro de cada grupo: los identificadores
P1–P37 son estables y sirven para citar cada uno.

### 6.1 Problemas de aislamiento y seguridad

**P1 — RLS sobre `Users` rompía el login de todos los usuarios.**
*Síntoma:* «Credenciales inválidas» para cualquier usuario. *Causa:* `/api/auth` no puede
pasar por `withTenant` porque la comuna se conoce **después** de leer al usuario; con RLS
sobre `Users`, `municipality_id = current_tenant()` con `current_tenant()` en `NULL` evalúa a
`NULL`, nunca a verdadero → 0 filas. *Solución:* función `auth_lookup_user` con
`SECURITY DEFINER`, acotada a un `username` exacto. *Por qué así:* la alternativa (una
política de lectura amplia sobre `Users`) dejaba una vía de acceso general si alguien montaba
mal otra ruta; la función tiene una superficie de una línea.

**P2 — Fuga de tenant por `withPublicContext` a nivel de prefijo.**
*Síntoma:* un administrador de Valparaíso veía los centros activos de Viña del Mar. *Causa:*
montar `app.use("/api/centers", withPublicContext, …)` hacía que **toda** petición bajo ese
prefijo activara `app.public_access`, incluidas las autenticadas; las políticas permisivas de
PostgreSQL se combinan con **OR**, así que la política pública se sumaba a la de tenant.
*Solución:* mover `withPublicContext` a nivel de ruta, solo en los endpoints realmente
públicos, y crear `withTenantOrPublic` para los de doble uso.

**P3 — `GET /api/centers` es de doble uso.**
*Síntoma:* tras corregir P2, un admin autenticado veía la lista pública (3 centros activos) en
vez de sus 12; y un admin de Viña veía los de Valparaíso. *Causa:* la misma URL alimenta el
mapa público y el panel municipal. *Solución:* `optionalAuth` + `withTenantOrPublic`: con
sesión resuelve por tenant, sin sesión cae al contexto público, **nunca los dos a la vez**.

**P4 — Auto-inscripción en emergencias adivinando el identificador.**
*Síntoma:* una comuna podía insertarse en `EmergencyParticipants` de cualquier emergencia.
*Causa:* la política de `INSERT` permitía `municipality_id = current_tenant()`, y **las
verificaciones de clave foránea de PostgreSQL omiten RLS por diseño**, así que ni siquiera
necesitaba poder leer la emergencia. *Solución:* el `INSERT` quedó restringido a superadmin o
comuna creadora; aceptar una invitación pasó a ser un `UPDATE` del estado de la propia fila.
**Nota de reconciliación:** este es el punto exacto donde el plan base (`POST
/emergencies/:id/join`, auto-inscripción) quedó reemplazado por el flujo de invitación —
ver Parte III.1.

**P5 — La comuna invitada veía las prioridades antes de aceptar.**
*Causa:* la política de lectura ampliada solo verificaba la existencia de la fila en
`EmergencyParticipants`, sin mirar el `status`. *Solución:* exigir `status = 'participando'`
**en ambos lados** (la comuna dueña del centro y la que lee).

**P6 — `/api/migrate/migrate-zones` estaba completamente abierto.**
*Causa:* `if (secret !== process.env.MIGRATION_SECRET)` con `MIGRATION_SECRET` **no definido**
en el `.env` evalúa `undefined !== undefined` → falso → **pasa**. Cualquiera podía reescribir
las zonas municipales. *Solución:* exigir que el secreto esté configurado **y** que quien
llame sea Super Administrador. *Nota:* defecto preexistente a la migración.

**P7 — El Super Administrador veía los centros de todas las comunas.**
*Causa:* las políticas incluyen `OR is_superadmin()`, y las rutas municipales del frontend
admitían el rol 4. *Solución:* sacar el rol 4 del bloque de rutas municipales, crear un
bloque compartido para el perfil, y redirigir al superadmin a su propia pantalla tras el login.

**P8 — `categoryRoutes` sin ninguna autenticación.**
Crear y borrar categorías estaba abierto a cualquiera. Defecto preexistente, corregido al
montar el router con `requireAuth, withTenant`.

### 6.2 Problemas de correctitud de datos

**P9 — El trigger de identificadores no podía escribir.**
*Síntoma:* «Municipality X no existe» al crear cualquier centro. *Causa:* el trigger hace
`UPDATE Municipalities SET center_seq_counter…`, pero la única política de `UPDATE` sobre esa
tabla exigía `is_superadmin()`; bajo `FORCE RLS` el trigger corre con los privilegios del
invocador → 0 filas → el `RETURNING … INTO` deja `NULL`. *Solución:* `SECURITY DEFINER` en la
función del trigger. *Lección general:* **un trigger no hereda privilegios especiales**; corre
bajo las mismas políticas que la sentencia que lo disparó.

**P10 — La colaboración intercomunal nunca funcionó.**
*Síntoma:* una comuna participante veía 0 prioridades de la comuna vecina. *Causa:* la
política resolvía los centros compartidos con una subconsulta sobre `Centers` y
`CentersActivations`, que **también tienen RLS**, así que la subconsulta solo veía centros de
la propia comuna: la política se filtraba a sí misma. *Solución:* `emergency_shared_center_ids()`
con `SECURITY DEFINER`. *Por qué no se detectó antes:* los datos semilla no incluían ninguna
prioridad, así que la consulta devolvía vacío tanto si funcionaba como si no; **se corrigió el
seed** para incluir prioridades.

**P11 — Una comuna no podía leer sus propias prioridades.**
*Causa:* `CenterItemPriority` tenía **una sola** política de `SELECT`, la intercomunal; un
centro sin emergencia asociada era invisible para su propio dueño. *Solución:* agregar la
política de lectura de tenant que faltaba.

**P12 — El conteo de participantes siempre daba 1.**
*Causa:* el `COUNT` sobre `EmergencyParticipants` corre bajo RLS, que solo deja ver la fila
propia. *Intento fallido:* ampliar la política para permitir ver las filas de emergencias
donde uno participa → PostgreSQL responde `infinite recursion detected in policy for relation`,
porque la política consultaba su propia tabla. *Solución:* `emergency_participants_of()` con
`SECURITY DEFINER`, que primero verifica que quien pregunta participe.

**P13 — El `setval` de `Roles` rompía el seed completo.**
*Causa:* el plan insertaba el rol 4 y hacía `setval` **antes** de que el seed insertara los
roles 1–3 sin id explícito; estos quedaban como 5, 6 y 7, y todos los `INSERT INTO Users` con
`role_id` 1/2/3 violaban la clave foránea. *Solución:* ids explícitos en el seed y `setval` al
final del archivo.

**P14 — 158 identificadores de centro huérfanos en el seed.**
*Causa:* el cambio a `VALPO-C001` invalidaba 158 literales `'C001'`–`'C005'` repartidos en
seis bloques del seed. *Solución:* sembrar los centros de Valparaíso con `center_id` explícito
(el trigger respeta un id que venga en el `INSERT`) y sincronizar el contador de la comuna.
Los centros de las comunas nuevas **sí** los genera el trigger.

**P15 — Cinco tablas con `NOT NULL` sin nadie que las poblara.**
`Users`, `CentersActivations`, `FamilyGroups`, `CenterInventoryItems` y `Datasets` recibían
`municipality_id NOT NULL`, pero sus `INSERT` no lo enviaban. *Solución:* derivar el valor
**en el propio SQL** (`current_tenant()` o subconsulta a la entidad padre) en vez de propagar
un parámetro por diez firmas de función. *Por qué:* no se puede falsear desde el cliente, y
queda garantizado que coincide con el `WITH CHECK` de la política.

**P16 — Catálogos que quedaban globales por accidente.**
Cinco servicios crean productos, categorías o plantillas al vuelo sin `municipality_id`, lo
que los insertaba como `NULL` = **globales, visibles para todas las comunas**. *Solución:*
`current_tenant()` en los cinco `INSERT`.

**P17 — El refresh del token perdía la comuna.**
*Causa:* el handler de `/auth/refresh` **reconstruía el payload a mano** con los seis campos
antiguos — el plan afirmaba que no necesitaba cambios; era falso. *Impacto:* a los 15 minutos
del login el usuario quedaba sin comuna y sin acceso a sus datos. *Solución:* propagar los
campos, y eliminar el fallback silencioso a un tenant `-1` en favor de un 401 explícito
(`TENANT_MISSING`) que fuerza un login nuevo.

**P18 — `es_apoyo_admin` sobrevivía a la degradación.**
*Síntoma:* un administrador degradado a Trabajador Municipal seguía viendo el menú de
administración y el badge de «Administrador». *Causa:* la degradación cambiaba `role_id` pero
no la marca de apoyo. *Solución:* apagar la marca junto con el rol.

### 6.3 Problemas de infraestructura y runtime

**P19 — Fuga de conexiones que agotaba el pool y caía el proceso.**
*Síntoma:* transacciones ociosas creciendo indefinidamente; luego el proceso Node se caía.
*Causa raíz:* la deduplicación de cierre usaba un `WeakSet` indexado por el objeto
`PoolClient`; **las conexiones se reciclan**: al liberarlas vuelven al pool y otra petición
recibe el mismo objeto, ya marcado como cerrado, así que `finishTx` salía antes de tiempo y
dejaba la transacción abierta para siempre. *Efecto secundario:* PostgreSQL mataba la conexión
por `idle_in_transaction_session_timeout`, el cliente emitía `'error'` sin listener, y Node lo
trataba como excepción no capturada. *Solución:* deduplicar **por petición** (un flag en el
objeto de contexto, único por request) y agregar un manejador de `'error'` que descarte la
conexión.

**P20 — `SET LOCAL app.current_tenant = $1` no compila.**
*Causa:* el comando `SET` de PostgreSQL solo acepta literales o identificadores, **no
parámetros de bind**. *Solución:* `set_config(name, value, true)`, el equivalente
parametrizable.

**P21 — Reutilizar un parámetro rompe la inferencia de tipos.**
*Síntoma:* `inconsistent types deduced for parameter $1: text versus character varying`.
*Causa:* usar `$1` en la lista `VALUES` y también en una subconsulta hacía que PostgreSQL
dedujera dos tipos distintos; un cast (`$1::varchar`) no lo resolvió. *Solución:* pasar el
valor dos veces como parámetros distintos, en los 8 sitios afectados.

**P22 — `format('%I', 'Users')` genera una tabla inexistente.**
*Causa:* las tablas se crearon sin comillas, así que en PostgreSQL se llaman `users` en
minúscula; `quote_ident('Users')` devuelve `"Users"`, que no existe. *Solución:* nombres en
minúscula en los bloques `DO`.

**P23 — Conteo de transacciones internas subestimado.**
El plan hablaba de 6 archivos con `BEGIN`/`COMMIT`; el repositorio tenía **13**, más 31
`pool.connect()`. No invalidó el enfoque —de hecho lo confirmó: la alternativa de convertir
cada uno en `SAVEPOINT` a mano habría sido inviable.

**P24 — Retención de conexiones por petición.**
Una transacción por petición implica retener una conexión durante toda su duración. El pool
estaba con el valor por defecto (10). Se subió a 30 y se agregaron `statement_timeout` e
`idle_in_transaction_session_timeout` (confirmado en `backend/src/config/db.ts:21-23`).

### 6.4 Problemas de experiencia de uso

| # | Problema | Causa | Solución |
|---|---|---|---|
| P25 | `/notifications/me` y `/mark-all-read` daban 404 | El frontend los llamaba pero **nunca existieron** en el backend | Implementados |
| P26 | La invitación llegaba a todos los usuarios de la comuna | El `INSERT` dejaba `destinatary` en `NULL` | Dirigida al administrador vigente |
| P27 | «Ver detalles» llevaba a `/center/null/details` | Las notificaciones de comuna no tienen centro | Enlace según el destino del aviso |
| P28 | «Sin emergencia» se veía en blanco | MUI trata `value=""` como *sin selección* | Valor centinela propio |
| P29 | El aviso de activación era un `alert()` del navegador | — | `Snackbar` de MUI, consistente con el resto |
| P30 | Los datos del centro se mostraban en una fila apretada | `.center-info` estaba también en `NotificationsPage.css` como flex-row, sin CSS scopeado | Selector con el padre (`.center-item > .center-info`) |
| P31 | Hueco vertical enorme bajo los datos del centro | En un contenedor en columna, `flex-basis` controla el **alto**, no el ancho | Reset del `flex` dentro del *media query* |
| P32 | Cuatro estilos de botón distintos en la misma fila | Dos clases sin CSS definido | Sistema unificado por intención |
| P33 | El mapa público perdió las «necesidades» | `CenterItemPriority` quedó sin política pública | Política de lectura pública acotada a centros activos |
| P34 | RUT sin formatear al crear administradores | El formateador existía pero estaba encerrado en otro componente | Extraído a `utils/rut.ts` y compartido |

### 6.5 Problemas del cierre de aislamiento y las ofertas de apoyo

Los tres aparecieron al ejercitar por primera vez código que las políticas de la Fase 1 nunca
habían tenido enfrente.

**P35 — El aviso a la comuna destino lo bloqueaba su propia política.**
*Síntoma:* crear una oferta de apoyo devolvía `42501` (privilegio insuficiente) y la
transacción se revertía entera. *Causa:* la oferta se insertaba bien; lo que fallaba era la
**notificación** — la política `centernotif_tenant` solo deja escribir avisos cuya comuna sea
la propia, y avisarle a otra comuna es justamente el punto de una oferta de apoyo. *Solución:*
`notify_support_offer(offer_id)`, `SECURITY DEFINER` deliberadamente estrecha: **no recibe
texto libre ni destinatario**, solo el identificador de la oferta, y verifica que quien llama
sea su comuna de origen.

**P36 — La comuna que ofrece no podía ver a quién le ofreció.**
*Síntoma:* en la bandeja de ofertas enviadas, la columna «Destino» salía vacía. *Causa:* el
listado resolvía el nombre del centro con un `JOIN` a `Centers`, que pasa por RLS, y el
centro destino es de **otra** comuna. *Solución:* `support_offers_visible()`, que replica
exactamente la visibilidad de la política `cmso_read` y resuelve los nombres del lado de la
base de datos. *Nota:* es la tercera vez que aparece la misma causa raíz (P10, P12, P36).

**P37 — Las políticas de ofertas de apoyo estaban mal desde la Fase 1.**
Se escribieron junto al resto del esquema, pero **ningún código las ejercitó** hasta esta
iteración. Tenían dos defectos: la lectura era demasiado amplia (cualquier comuna participante
veía *todas* las ofertas, incluidas las dirigidas a otras comunas), y la escritura solo
permitía a la comuna de origen (la comuna que *recibe* la oferta no podía aceptarla ni
rechazarla). *Lección:* una política de seguridad que nunca se ejecuta es una hipótesis, no
una garantía.

## 7. Verificación

No se usaron pruebas automatizadas; la verificación fue **ejecución real del sistema completo**
(PostgreSQL + backend + frontend en Docker) recreando la base desde cero en cada iteración, más
un script (`scripts/validar_multitenant.sh`) y el guion manual de la Parte IV.

### 7.1 Pruebas de aislamiento

| Prueba | Resultado esperado |
|---|---|
| `SELECT * FROM Centers` sin tenant, como `appcopio_app` | 0 filas |
| Tenant VALPO vs tenant VINA | 12 centros / 3 centros, sin cruce |
| Comuna A pide un centro de comuna B | 404 |
| Admin de Valparaíso lista centros | Solo VALPO (detecta la fuga P2/P3) |
| Comuna invitada, antes de aceptar | Ve la emergencia, **0 prioridades** ajenas |
| Comuna tras aceptar | Ve las prioridades compartidas |
| Comuna sin invitación intenta inscribirse | `new row violates row-level security policy` |
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

### 7.3 Salud del runtime

Tras cada tanda: **0 transacciones ociosas** en `pg_stat_activity`, **0 caídas** del proceso, y
**0 intentos de envío de correo** (el requisito era aviso solo en aplicación). El ciclo
completo login → refresh → logout se verificó contra el almacén de sesiones sellado.

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
   prioridad.
7. **Interceptar un singleton puede evitar un refactor masivo**, pero exige entender el ciclo
   de vida de lo que se intercepta. La misma técnica que ahorró editar decenas de archivos
   introdujo P19 al asumir que los objetos de conexión eran únicos por petición.
8. **Un trigger puede ser un mecanismo de seguridad, no solo de conveniencia.** Los triggers
   de herencia de comuna se escribieron para no tocar cien `INSERT`, pero al correr como
   invocador terminaron validando la pertenencia del padre gratis.
9. **Cuando el aislamiento por tenant no aplica, sellar puede ser más fuerte que aislar.** El
   almacén de sesiones no admitía una política de comuna porque se usa antes de conocerla; en
   vez de dejarlo desprotegido, quedó inalcanzable para todo el SQL de la aplicación.
10. **Una política que nunca se ejecuta es una hipótesis.** Las de ofertas de apoyo se
    escribieron con el resto del esquema y estuvieron mal durante toda la migración: nadie lo
    notó porque no había una sola línea de código que las tocara.

---

# Parte III — Reconciliación con los planes originales

Los dos documentos de trabajo previos —**Plan A**, `Multi-tenant 2 - Implementación.md`
("Plan corregido — Migración multi-tenant AppCopio", cubre BD+Backend+Frontend base) y
**Plan B**, `Multi-tenant 1 - Plan.md` ("Gestión de municipalidades, emergencias e
invitaciones", cubre las pantallas de Super Administrador y el flujo de invitación) — no son
incorrectos en su diagnóstico general: ambos identifican bien la arquitectura (RLS + rol
`appcopio_app` + `AsyncLocalStorage`) y el orden de trabajo (BD → Backend → Frontend). Donde
se equivocan es en supuestos puntuales sobre el estado exacto del código, algunos de los
cuales habrían dejado el sistema sin arrancar de haberse ejecutado tal cual.

## 1. Dónde el Plan A resultó incorrecto o incompleto

| # doc | Afirmación del Plan A | Qué pasó en realidad |
|---|---|---|
| P13 | "Ids explícitos (1,2,3) en `003_datos.sql`, `setval` **después**" — el plan lo proponía pero en un orden que rompía el seed | El `setval` debía ir **al final del archivo**, después de insertar los usuarios; se corrigió el orden, no el enfoque |
| P17 | "`/auth/refresh` no necesita cambios" (decisión C5 del plan, sección 2.4) | **Falso**: el handler reconstruía el payload a mano con los 6 campos antiguos; sin el fix, la comuna se perdía 15 minutos después del login |
| P23 | "Cubre los 13 archivos con `BEGIN/COMMIT` y las 31 llamadas a `pool.connect()`" (§2.1) daba a entender un conteo ya cerrado | El propio plan corrigió sobre la marcha un plan *anterior* que hablaba de 6 archivos; el número real terminó siendo 13, confirmado en el código |
| B5/2.9 | Base de emergencias: "`POST /api/emergencies/:id/join` — una comuna se une a sí misma" | Este endpoint **no sobrevivió**: el Plan B lo reemplazó por invitación (`POST /:id/invite` + `POST /:id/respond`), y la política de `INSERT` en `EmergencyParticipants` se cerró a superadmin o comuna creadora (P4). Ver Parte I §3.3 |
| 2.9 | "Fuera de alcance: UI de invitación, notificación en pantalla y pantalla de vinculación masiva" (declarado explícitamente como pendiente) | Correcto y consistente: es exactamente lo que ejecuta el Plan B a continuación |

El resto de las decisiones del Plan A (B1–B4, C1–C10) se verificaron contra el código actual
y **coinciden** con lo implementado: `SECURITY DEFINER` para login y trigger de centro, roles
con ids explícitos, `Persons` con `municipality_id` propio, `centers_public_read` limitada a
activos, pool con `max`/timeouts subidos, `rollbackRequested` en el store de tenant.

## 2. Dónde el Plan B resultó incorrecto, incompleto, o quedó corto

El Plan B es más preciso que el Plan A — probablemente porque se escribió después de que el
Plan A ya hubiera expuesto la brecha entre "plan" y "código real". Verificado contra el
código actual, **todas** sus piezas centrales se construyeron tal como las describe:

- La tabla de reglas de emergencias (qué habilita, quién declara, cómo entra una comuna,
  cuándo se vincula una activación, quién cierra, qué hace el cierre) coincide con el
  comportamiento real, **incluida** la advertencia explícita que el propio plan hace sobre el
  cierre informativo (Fase I, §6.5 de este documento).
- Los 5 endpoints de `municipalityRoutes.ts` y los 10 de `emergencyRoutes.ts` (B2/B3) están,
  con las firmas descritas.
- `createNotification` sin correo (B4), `/notifications/me` y `/mark-all-read` (B5, el mismo
  defecto que P25), y el selector opcional de emergencia al activar un centro (B6) — todos
  presentes.
- La regla de un solo administrador activo por comuna, con el índice único parcial exacto
  (`users_one_active_admin_per_municipality_uq`), está en `db/002b_*.sql:38`.

**Lo que el Plan B no contempla y sin embargo se construyó** (esto es lo que le faltaba a
"la completitud" que se pidió revisar en esta consolidación):

1. **Todo el módulo de Apoyo Intercomunal**: `crossSupportRoutes.ts`, `crossSupportService.ts`,
   `IntermunicipalBoardPage.tsx`, `SupportOffersPage.tsx`, `OfferSupportDialog`, y las 3
   funciones `SECURITY DEFINER` que lo sostienen (`emergency_shared_centers`,
   `notify_support_offer`, `support_offers_visible`). La tabla `CrossMunicipalSupportOffers`
   ya existía en el esquema base (Plan A, Fase 1), pero ni el Plan A ni el Plan B describen
   sus rutas, su servicio ni sus pantallas — es la "Iteración 5" mencionada en la Parte II §5,
   posterior a ambos documentos.
2. **Los defectos P35–P37**, que solo se manifestaron al construir ese módulo (la política de
   ofertas de apoyo estaba mal desde la Fase 1 y nadie lo notó porque nada la ejercitaba).
3. **El guion de validación manual completo** (Parte IV) y el script `validar_multitenant.sh`
   no están previstos en ninguno de los dos planes; se construyeron para poder verificar de
   punta a punta lo que ninguno de los dos había podido probar en Postman.

## 3. Corrección agregada en esta consolidación: el cierre de una emergencia no es uniforme entre capas

Ni el Plan A, ni el Plan B, ni los documentos 01/02/03 de origen dejan esto explícito, y se
verificó directamente contra el código para este documento:

- **A nivel de API/base de datos**, cerrar una emergencia (`PATCH /:id/close`) es
  estrictamente informativo: `emergency_shared_centers()` (el tablero) y `POST
  /crossSupport/offers` (crear una oferta) **no consultan `Emergencies.ended_at` en ningún
  punto** — verificado en `db/002c_rls_tablas_restantes.sql:361-388` y
  `backend/src/routes/crossSupportRoutes.ts`. Si una comuna sigue `'participando'` y tiene
  activaciones abiertas vinculadas, el tablero y la creación de nuevas ofertas **siguen
  funcionando después del cierre**, siempre que se llame a la API directamente con el
  `emergency_id`.
- **A nivel de interfaz**, sí hay un corte: el selector de emergencia del tablero
  (`IntermunicipalBoardPage.tsx:79`) y el selector de emergencia al activar un centro
  (`ActiveCenterDialog.tsx:73`) filtran `!e.ended_at` — una emergencia cerrada **desaparece de
  las listas desplegables**, así que en el uso normal de la aplicación nadie llega a un
  tablero cerrado ni puede iniciar una oferta nueva sobre él.

Es decir: el comportamiento que describe el guion de validación (Parte IV, §13 — "el tablero
deja de ofrecer esa emergencia como opción" y "no se pueden crear ofertas nuevas") es
**cierto solo como consecuencia de que la interfaz oculta la opción**, no porque el backend lo
impida. Quedan dos caminos, y vale la pena que el equipo decida cuál quiere antes de
considerar esto cerrado:

- Si el comportamiento deseado es el que describe el diseño (Parte I §6.5: "el cierre es
  informativo, el corte real es al cerrar/desvincular activaciones"), el estado actual ya lo
  cumple y no hace falta nada más — el guion de QA (Parte IV) solo debería aclarar que prueba
  la interfaz, no una garantía de la API.
- Si el comportamiento deseado es que **cerrar la emergencia también bloquee** el tablero y
  las ofertas nuevas a nivel de API (no solo de interfaz), falta agregar
  `AND e.ended_at IS NULL` a `emergency_shared_centers()` y una verificación equivalente en
  `POST /crossSupport/offers`, porque hoy cualquiera con el `emergency_id` puede saltarse el
  filtro de la interfaz llamando a la API directamente.

---

# Parte IV — Guion de validación manual

> Complementa a `scripts/validar_multitenant.sh`: ese script cubre lo que se puede afirmar por
> API y base de datos; este guion cubre lo visual — mapas, badges, modales, redirecciones —
> que solo se comprueba mirando la pantalla. Los datos de prueba (tres emergencias,
> activaciones fuera de Valparaíso, cuatro ofertas y sus notificaciones) viven en
> `db/005_datos_validacion.sql`, que corre al final del sembrado.

```bash
docker compose down -v && docker compose up -d
bash scripts/validar_multitenant.sh   # debe terminar en TODO OK
```

Todos los usuarios de prueba usan la contraseña **`12345`**.

| Comuna | Administrador | Trabajador con apoyo | Trabajador sin apoyo |
|---|---|---|---|
| Valparaíso (1) | `admin` | `martinalina` | `tito` |
| Viña del Mar (2) | `admin.vina` | `apoyo.vina` | `tm.vina` |
| Quilpué (3) | `admin.quilpue` | — | `tm.quilpue` |
| Concón (4) | `admin.concon` | — | `tm.concon` |
| — | `superadmin` (Super Administrador) | — | — |

## 1. Mapa público sin sesión
Abrir `/map` sin iniciar sesión: deben verse centros de las cuatro comunas, coloreados por
estado operacional (no urgencia). La ficha de cualquier centro solo debe mostrar ubicación,
capacidad, % de llenado y estado — nada de personas, familias ni inventario.

## 2. Login por comuna y badge de comuna
`admin.vina` → badge "Viña del Mar", "Mis Centros" lista solo los 3 de Viña. `admin`
(Valparaíso) → badge "Valparaíso", 12 centros.

## 3. Trabajador vs. administrador
`tm.vina` (sin apoyo admin): sin barra de administración, sin menú de Usuarios, sin menú de
Emergencias (y `/emergencias` a mano redirige a `/`). `admin.vina`: ambos presentes.

## 4. Super Administrador
`superadmin`: sin acceso a centros en ninguna pantalla. `/superadmin/municipalidades` lista
las cuatro comunas sembradas. Crear una comuna nueva y asignarle administrador: esa comuna
parte vacía, sin centros heredados.

## 5. Cambio de administrador (regresión de P18)
Como `admin.concon`, promover a `tm.concon` degradando al actual. Al volver a entrar con el
antiguo administrador: perfil dice "Trabajador Municipal", badge no dice "Administrador",
barra de administración no aparece.

## 6. Invitación a emergencia: a quién le llega y a dónde lleva
`tm.quilpue` (sin apoyo admin): sin avisos pendientes. `admin.quilpue`: notificación
"Invitación a emergencia" sin leer, cuyo enlace lleva a `/emergencias` (no al detalle de un
centro). Al aceptar, el estado pasa a "participando" y `/emergencias/tablero` muestra los
centros de Valparaíso y Viña con sus prioridades.

## 7. Vinculación masiva de activaciones
`admin.quilpue`, en Emergencias → "Vincular activaciones": deben listarse `QUILP-C001` y
`QUILP-C002` sueltas; al seleccionar ambas y confirmar, quedan asociadas.

## 8. Tablero intercomunal, vista listado
`admin.vina` en el tablero de "Incendio forestal Valparaíso 2024": deben aparecer los 2
centros activos de Valparaíso con sus prioridades. Filtrar por prioridad mínima alta reduce
el conteo; filtrar por comuna propia da lista vacía (Viña no comparte consigo misma).

## 9. Tablero intercomunal, vista mapa
Alternar a Mapa cambia la URL a `?vista=mapa` y persiste tras recargar. Pines coloreados por
urgencia. Con permiso de ubicación, aparecen distancias y orden por cercanía; sin permiso, el
resto sigue funcionando.

## 10. Ofrecer apoyo desde ambas vistas, y a dónde lleva el aviso
`admin.vina` ofrece apoyo a `VALPO-C001`. `tito` (sin apoyo admin) no recibe aviso;
`martinalina` (con apoyo admin) sí, y el enlace lleva a `/emergencias/ofertas` (no al centro).
Repetir desde la vista de mapa da el mismo resultado.

## 11. Aceptar y rechazar ofertas
`admin` (Valparaíso) ve en "recibidas" las ofertas pendientes de Viña; al aceptar una, su
estado se sincroniza también en la bandeja "enviadas" de `admin.vina`. Una oferta ajena
(`admin.quilpue` intentando actuar sobre una oferta Valparaíso↔Viña) no aparece en ninguna
bandeja ni se puede resolver vía API.

## 12. Emergencia declarada por una comuna
`admin.vina` declara "Aluvión quebrada Viña del Mar": aparece como creada por Viña (no por el
Super Admin), con Viña ya participando y Concón rechazada. `admin` (Valparaíso) tiene la
invitación pendiente y puede responderla.

## 13. Cierre de emergencia
Al cerrar una emergencia, el tablero deja de ofrecerla como opción y no se pueden crear
ofertas nuevas sobre ella **desde la interfaz** — ver el matiz de la Parte III.3 sobre por qué
esto es un filtro de frontend y no (todavía) una restricción de la API.

## 14. Aislamiento a la vista, dos sesiones en paralelo
Dos sesiones simultáneas (una por comuna) solo operan sobre sus propios centros; forzar la URL
del centro ajeno da vacío o error, nunca datos de la otra comuna.

## Cierre
Si las 14 secciones quedan validadas y `scripts/validar_multitenant.sh` termina en `TODO OK`,
el multi-tenant queda validado de punta a punta: aislamiento de datos, roles, colaboración
intercomunal en ambos sentidos, y notificaciones dirigidas a quien corresponde.
