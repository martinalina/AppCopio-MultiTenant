# AppCopio: del modelo single-tenant al multi-tenant — Decisiones de dominio

> Documento 1 de 2. Describe **qué** cambió en el modelo de negocio y **por qué**.
> El detalle de implementación está en [02_implementacion_tecnica.md](02_implementacion_tecnica.md).

---

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

---

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

---

## 3. Entidades nuevas

Se agregaron **6 entidades** al modelo, que pasó de 33 a 39 tablas: `Municipalities`,
`Emergencies`, `CrossMunicipalSupportOffers`, `SuperEvents`, `SuperEventParticipants` y
`EmergencyActivationInvitations`.

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
centros y es su unidad de organización interna. Corresponde al nivel *emergencia menor* de
la escala de niveles de eventos: afectación acotada a una zona o comuna, atendida con
capacidades comunales.

`created_by_municipality_id` es **NOT NULL**: toda emergencia tiene dueño. El Super
Administrador no crea emergencias, porque no tiene comuna.

`super_event_id` (nullable) indica si esa emergencia fue aportada a un SuperEvento. Nulo es
el caso normal y más frecuente: la comuna se organiza sola.

> **Corrección respecto del diseño original.** `Emergencies` era a la vez el evento local
> *y* el contenedor de la colaboración, y admitía un alcance "regional" con
> `created_by_municipality_id = NULL`. Eso obligaba a que el contenedor existiera **antes**
> que las emergencias locales: si cada comuna ya había abierto la suya —el caso normal
> cuando un evento crece— quedaban dos emergencias activas que eran el mismo evento, y
> había que abandonar una o mover información a mano. Los dos conceptos se separaron.

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
   (llega después, cuando cada comuna ya venía manejando la suya por separado).
3. **Una comuna lo autocrea** desde su propia emergencia al querer colaborar. Su emergencia
   no se mueve ni se rehace: se envuelve.

`created_by_municipality_id` registra quién lo originó (NULL = el Super Administrador), pero
**no confiere el privilegio de invitar**: eso lo tiene cualquier comuna participante. Sí
limita quién puede cerrarlo, porque cerrar le corta la colaboración a todos.

Una comuna aporta **a lo sumo una emergencia por SuperEvento**. Sin esa restricción, "mi
emergencia en este SuperEvento" sería ambiguo y el tablero tendría que desempatar.

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
compartido. Tiene un ciclo de vida propio:

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

---

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
colaboración intercomunal exigió notificar a **una comuna** (invitación a una emergencia),
así que `center_id` pasó a ser nullable y se agregaron `municipality_id` y `emergency_id`,
con una restricción que exige al menos un destino:

```sql
CHECK (center_id IS NOT NULL OR municipality_id IS NOT NULL)
```

---

### 4.6 `ResourceBoxes` — de recurso sin dueño a catálogo dual

Las cajas de recursos (plantillas de ítems para armar entregas) no tenían **ningún** vínculo
con una organización: ni centro, ni comuna. Eran, de hecho, una fuga: el listado no filtraba
nada y un administrador de Viña veía las cajas que había armado Valparaíso.

Se resolvieron como **catálogo dual**, el mismo patrón que productos y categorías: `NULL`
significa caja base de la plataforma, y un valor significa caja propia de esa comuna.

---

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
- El **nombre de la emergencia** que aporta cada centro, para que el tablero pueda agrupar
  los centros por evento en vez de mezclarlos

Es decir: una comuna puede saber que el albergue vecino *necesita agua con prioridad alta* y
ofrecerle las suyas, pero nunca cuántas personas alberga, quiénes son, ni cuánta agua tiene.

**Y una asimetría deliberada:** la ampliación es de **solo lectura**. Todas las políticas de
escritura exigen que el dato pertenezca a la comuna que escribe. Ninguna comuna puede
modificar datos de otra, ni siquiera dentro de un SuperEvento compartido.

**La ampliación también es temporal:** cerrar el SuperEvento la revoca. Las funciones
`super_event_*` exigen `SuperEvents.ended_at IS NULL`, así que el tablero queda vacío y no
se pueden crear ofertas nuevas.

**Aparte, y sin relación con los SuperEventos, existe un canal público** (mapa sin sesión)
limitado a: ubicación, capacidad, porcentaje de llenado, estado operacional y prioridades
agregadas, y **solo de centros activos**.

---

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

Regla nueva: cada municipalidad tiene **exactamente un** usuario con `role_id = 1` activo.
Para nombrar uno nuevo hay que, en la misma operación, **degradar al actual a Trabajador
Municipal o desactivar su cuenta**.

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
  activación local. `emergency_id` es nullable a propósito.
- **Una activación se vincula en tres momentos:** al activar el centro (selector opcional),
  al responder la invitación que sale cuando se crea la emergencia, o después, desde la
  pantalla de gestión de centros.
- **Cerrar una emergencia es un asunto interno de la comuna.** Registra `ended_at`; los
  centros siguen activos si su activación lo está. No afecta a las demás comunas.
- **Lo que corta la colaboración es cerrar el SUPEREVENTO.** Ahí sí: las funciones
  `super_event_shared_centers()` y `super_event_shared_center_ids()` exigen
  `SuperEvents.ended_at IS NULL`, y crear una oferta responde `SUPEREVENTO_CERRADO` (409).
  **Esto corrige un hueco del diseño anterior**, donde el acceso sobrevivía al cierre hasta
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
   las movería de lugar sin que nadie lo pidiera.
2. **Al aceptar un SuperEvento con una emergencia existente NO se vuelve a preguntar**,
   porque ya se preguntó al crearla. Como nadie vuelve a consultar, el diálogo de aceptar
   muestra la **lista exacta de centros que quedarán compartidos** antes de confirmar. Si en
   cambio la emergencia se crea en ese mismo paso, sí se avisa a los encargados.
3. **La primera tanda no es la última.** El administrador puede invitar o **reinvitar** a
   cualquier activación abierta sin importar su estado previo: las que rechazaron, las que
   están en otra emergencia y deben trasladarse, y las que quedaron fuera porque entonces
   pertenecían a una emergencia ya terminada. Cuando el centro está en otra emergencia, el
   aviso se lo dice explícitamente al encargado: aceptar lo traslada, y debe saberlo antes
   de decidir.

**Rechazar ya no desvincula.** Antes, rechazar ponía `emergency_id = NULL`, lo que sacaba al
centro incluso de la emergencia donde ya estaba legítimamente. Ahora el rechazo solo se
registra en `EmergencyActivationInvitations`.

---

### 6.7 Ofrecer apoyo a otra comuna

- **Solo se puede ofrecer a centros que el SuperEvento expone.** Si el centro destino no
  está activo y vinculado a una emergencia de ese SuperEvento, el ofrecimiento se rechaza: no
  se puede usar el canal de apoyo para alcanzar un centro que la colaboración no habilitó.
- **Un SuperEvento cerrado no admite ofertas nuevas** (`SUPEREVENTO_CERRADO`, 409).
- **No se ofrece a centros propios.** El apoyo intercomunal es entre organizaciones distintas.
- **Cada decisión corresponde a un lado:** cancelar es del que ofrece; aceptar y rechazar son
  del que recibe.
- **Una oferta ya resuelta no se vuelve a decidir.** Aceptada, rechazada o cancelada, queda
  como registro histórico.

---

## 7. Comparación resumida

| Dimensión | AppCopio single-tenant | AppCopio multi-tenant |
|---|---|---|
| Organizaciones | 1 (Valparaíso, implícita) | N municipalidades, explícitas |
| Entidades | 33 tablas | 39 tablas |
| Roles | 3 | 4 (+ Super Administrador) |
| Identificador de centro | `C001` global | `VALPO-C001`, correlativo por comuna |
| Catálogo de productos | Global, nombre único | Base compartida + catálogo propio por comuna |
| Frontera de datos | Ninguna | Aislamiento en la base de datos: **38 tablas con RLS** |
| Tablas con marca de pertenencia | 0 | 21 (sin contar `Municipalities`, que *es* la marca) |
| Eventos | Activación de centro | Emergencia local (comuna) + SuperEvento (varias comunas, con nivel) |
| Colaboración entre organizaciones | No aplica | SuperEventos con consentimiento en dos niveles, tablero intercomunal y ofertas de apoyo |
| Almacén de sesiones | Tabla accesible desde el SQL de la aplicación | Sellada: solo alcanzable por funciones acotadas |
| Acceso público | Todos los centros | Solo centros activos, campos limitados |
| Administración de la plataforma | No existía | Super Administrador con alcance acotado |

---

## 8. Alcance deliberadamente excluido

Para dejar constancia de lo que **no** se abordó y por qué:

- **Una activación pertenece a una sola emergencia**, y una comuna aporta una sola
  emergencia por SuperEvento. Si un centro debiera participar en varias simultáneamente, se
  requiere una tabla de relación.
- **Los niveles no se derivan solos.** `SuperEvents.level` lo fija quien crea el SuperEvento;
  el sistema no arbitra si un evento escaló de `mayor` a `desastre` ni aplica las
  implicancias normativas de cada nivel.
- **La aceptación de una oferta no mueve inventario.** Registra el acuerdo entre las dos
  comunas; el traslado y su descuento de stock siguen siendo un proceso fuera del sistema.
- **`AuditLog` no se escribe todavía.** Su estructura y su política están listas, pero ningún
  flujo genera registros de auditoría.

> **Nota sobre el aislamiento:** este apartado listaba antes dieciséis tablas sin política de
> seguridad a nivel de fila. Ya no queda ninguna: todas las tablas del esquema con datos
> operativos están protegidas, y el almacén de tokens de sesión quedó sellado tras funciones
> acotadas. El detalle está en el documento técnico, §3.5 y §3.6.
