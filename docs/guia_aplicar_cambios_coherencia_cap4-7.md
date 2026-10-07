# Guía v2 para aplicar los cambios de coherencia (caps. 4–7 + anexos)

Reemplaza a la versión anterior. Incorpora la **opción B** (el Super Administrador deja de poder leer datos
operativos también en el motor) y corrige lo que esa decisión cambia en el texto, el script y las imágenes.

---

## Pendientes — revisión del 03-10-2026

Revisé tus cinco archivos contra la guía, ítem por ítem. De **64** cambios de texto de la guía: **49 están aplicados** (☑), **3 se omitieron a propósito** (⊘: B4-5 y B5-5, que dejaste comentado o sin aplicar, y B4-10, que ya no corresponde porque eliminaste la mención de la entrevista), y quedan **6 de texto por aplicar**, 2 opcionales, 2 pies de figura condicionados y los que dependen de volver a capturar imágenes.

**Lo que verifiqué y está bien:** las cifras (87 y "ochenta y siete") coinciden en cap. 6 (dos lugares), cap. 7 y pie del anexo; la etiqueta `<anexo:validacion-solucion>` ya está en `layout/thesis_template.typ`; las tablas del anexo quedaron con las filas correctas; la lista de las seis tablas del Super Administrador es idéntica en cap. 4, 5 y 6; y no hay referencias cruzadas rotas.

> **Aviso sobre mi guía anterior.** Dos de los pendientes (P5 y P6) nacen de que mis instrucciones tenían comillas invertidas anidadas dentro de código en línea, lo que hacía fácil copiar mal el texto y terminó en dos frases dañadas en tu tesis. Aquí van en bloques de código: **copia todo el contenido del bloque**.

Método: el mismo de la sección 1 (Ctrl+F del texto de *Buscar*, 1 solo resultado, reemplazar, guardar, marcar). Verifiqué que cada texto de *Buscar* de esta sección existe **exactamente una vez** en tus archivos actuales.

### A. Pendientes de texto (6)

☐ **P1 · cap. 4 — salvedad de `EmergencyActivationInvitations`** (era B4-4).
Buscar:
```
nacen con su columna de comuna desde el diseño.
```
Reemplazar por:
```
nacen con su columna de comuna desde el diseño (con la salvedad de `EmergencyActivationInvitations`, cuya columna completa el mismo disparador de herencia del segundo patrón, como se verá en la implementación).
```

☐ **P2 · cap. 4 — errata** (era B4-9). Sigue escrito "adminitir".
Buscar:
```
exige adminitir que varias comunas
```
Reemplazar por:
```
exige admitir que varias comunas
```

☐ **P3 · cap. 5 — qué servicio escribe cómo su comuna** (era B5-3).
Buscar:
```
El mismo patrón aparece en los servicios de categorías, productos, inventario, movimientos, plantillas y usuarios.
```
Reemplazar por:
```
El mismo patrón aparece en los servicios de categorías, productos --incluidos los que se crean desde inventario y movimientos--, personas, plantillas y usuarios. El inventario de cada centro, en cambio, toma la comuna de su centro con una subconsulta en el propio `INSERT`, y el historial de movimientos la hereda del centro por disparador.
```

☐ **P4 · cap. 5 — antecedente de los secretos** (era B5-8). Sin esto, la última viñeta de trabajo futuro del cap. 7 ("gestión de secretos") aparece sin antecedente.
Buscar (está al final de la sección *Entorno de desarrollo*):
```
no se requirió un procedimiento de migración de datos (RNF6, @sec:consideraciones-migracion).
```
No lo reemplaces: **deja una línea en blanco debajo** y pega este párrafo nuevo:
```
Los secretos del despliegue (por ejemplo, la contraseña de la base en `docker-compose.yml`) permanecen como valores literales provisionales: su gestión no se abordó en esta extensión y se declara como trabajo futuro (@cap:conclusiones).
```

☐ **P5 · cap. 6 — frase dañada en la descripción del sembrado** (era B6-2). Hoy dice "…(Concón, en el segundo), en los tres estados que registra la tabla…": perdió el sujeto ("invitaciones de centro") y no se entiende.
Buscar:
```
en los tres estados que registra la tabla (más un centro todavía sin invitar), cinco ofertas
```
Reemplazar por:
```
invitaciones de centro en los tres estados que registra la tabla (más un centro todavía sin invitar), cinco ofertas
```
*(Alternativa si prefieres conservar el "cuatro":)*
```
invitaciones de centro en los cuatro estados que muestra la pantalla de gestión (los tres que registra la tabla y el de un centro todavía sin invitar), cinco ofertas
```

☐ **P6 · cap. 7 — viñeta de trabajo futuro con la "y" perdida** (era B7-6). Hoy dice "…flujo completo de colaboración,  ampliar la cobertura…" (dos espacios y sin "y").
Buscar (ojo: hay **dos espacios** después de la coma):
```
colaboración,  ampliar la cobertura de pruebas automatizadas:
```
Reemplazar por:
```
colaboración, y ampliar la cobertura de pruebas automatizadas:
```

### B. Opcionales (2)

☐ **P7 · cap. 7 — pulido de la frase de consentimiento** (era B7-3). Quedaron dos "y" seguidas en una enumeración larga.
Buscar:
```
y compartirlo con otras comunas es decisión de una administración
```
Reemplazar por:
```
compartirlo con otras comunas es decisión de una administración
```

☐ **P8 · anexos — nota del catálogo de funciones** (segunda mitad de C-A4). La primera mitad (`super_event_participants_of`) ya está.
Buscar:
```
no es una vía alterna para invitar, solo para avisar.]
```
Reemplazar por:
```
no es una vía alterna para invitar, solo para avisar. El Super Administrador queda exento de participar.]
```

### C. Pies de figura que dependen de si redibujas las figuras (2)

Hazlos **solo si no vas a redibujar** esas figuras para que incluyan lo que dicen; si las redibujas, omítelos.

☐ **P9 · cap. 4 — pie de `invitacion-municipalidades`.**
Buscar:
```
caption: [Modelo de invitación de municipalidades a SuperEventos. Fuente: Elaboración propia.],
```
Reemplazar por:
```
caption: [Modelo de invitación de municipalidades a SuperEventos (fase de ingreso: no se dibujan el retiro ni la reinvitación). Fuente: Elaboración propia.],
```

☐ **P10 · cap. 4 — pie de `ofertas-apoyo`.**
Buscar:
```
caption: [Ciclo de vida de una oferta de apoyo inter-municipal. Fuente: Elaboración propia.],
```
Reemplazar por:
```
caption: [Ciclo de vida de una oferta de apoyo inter-municipal (no se dibujan la cancelación automática por retiro ni el congelamiento al cerrar el SuperEvento). Fuente: Elaboración propia.],
```

### D. Dependen de volver a capturar imágenes (no se pueden hacer antes)

Siguen pendientes **B-A3** (pie de la bandeja de ofertas: hoy dice `admin.vina`, pero el sembrado tiene el borrador en Valparaíso), **B-A4** (si el mapa público muestra necesidades: hoy el cap. 6 y el pie de `validacion-07` dicen cosas distintas), **B-A5** (quién cierra el SuperEvento en `validacion-11`: hoy dice "después de cerrarlo"), **B-A6** y **B-A7** (abastecimiento/ocupación). Están más abajo en la guía. La recaptura se hace **una sola vez**, siguiendo la sección 5.

### E. Decisiones que quedaron sin aplicar (confírmalas)

- **B4-5 y B5-5** (aclarar que las operaciones del Super Administrador llevan la comuna en la URL): en el cap. 4 lo dejaste dentro de `/* … */`. Es coherente omitir también el del cap. 5; la afirmación es literalmente cierta (la comuna va en la URL, no en el cuerpo). Si quieres que ambos capítulos digan lo mismo, no hagas nada.
- **Figuras** (`ruta-doble-uso`, `ofertas-apoyo`, `modelo-nuevo`): no puedo verificar si las redibujaste; el estado de cada una está en la sección 6.

---

## 0. Qué cambió en el proyecto (ya está hecho y probado)

**Resultado:** `bash scripts/validar_multitenant.sh` → **TODO OK — 87 comprobaciones** (antes 85: se agregaron 6 por la opción B y se retiraron 4 prescindibles), sobre una base recién recreada.

| Dónde | Qué se hizo |
|---|---|
| `db/002a`, `002b`, `002c`, `002d` | Se quitó `OR is_superadmin()` de **todas** las políticas, salvo las de las 6 tablas que el rol administra. Sobre `Centers`, `Persons`, `FamilyGroups`, `CentersDescription`, inventario, notificaciones, ofertas, prioridades, etc., el Super Administrador **no ve ninguna fila** (su contexto no fija comuna). |
| Excepciones que quedan | `Users` (ver, alta y actualizar; **sin borrar**), `Emergencies` (ver y agrupar; **sin crear ni borrar**), `SuperEvents`, `SuperEventParticipants`, `Municipalities`, `municipal_zones`. Y 2 funciones: `super_event_participants_of` y `notify_super_event_invitation`. |
| Funciones | Se quitó la excepción del Super Administrador de `super_event_shared_centers` (el tablero) y de `support_offers_visible` (ofertas). El **número de funciones con privilegios elevados sigue siendo 17**: no hubo que agregar ninguna. |
| Backend | `municipalityService.ts`: la ficha de comuna ya no cuenta filas de `Centers`. `superEventService.ts`: las emergencias sueltas ya no traen el conteo de activaciones. `centerRoutes.ts`: solo se actualizó el comentario (la guarda `[]` queda como segunda barrera). |
| Frontend | `MunicipalityDetailPage` muestra "N **centros creados**" (usa `center_seq_counter`). `SuperEventsPage` ya no muestra la columna "Centros vinculados". |
| Script | 6 comprobaciones nuevas (ver Fase 1, C6-D), 4 retiradas (ver Fase 1b) y "camino 3" → "vía 2: originado por una comuna". |
| Docs del repo | `docs/02`, `06`, `07` actualizados donde decían que el Super Administrador "ve todo". |

**Pruebas hechas por API real como `superadmin`:** ficha de comuna, usuarios, lista de SuperEventos, emergencias sueltas, participantes,
agrupar emergencias, crear SuperEvento, relevar administrador y reinvitar → todo `200/201`. `/centers` → vacío, tablero → `403`, declarar emergencia → `403`.

> La base quedó recién sembrada. Los cambios **no están commiteados**.

### Qué le pasa a la guía anterior

| Ítem de la guía anterior | Ahora |
|---|---|
| **B4-1** (párrafo de la excepción) | **Reemplazar** por el texto de C4-A (ya lo tienes pegado con la versión vieja). |
| **B4-2** (regla general "o bien que… sea el Super Administrador") | **Revertir** (C4-B). Ya no es cierto y era justo lo que te inquietaba. |
| **B5-9** y fila `secuencia-peticion` de la Fase E | **Ya no hacen falta.** La figura muestra la política sin `OR is_superadmin()`, y ahora eso es exacto. |
| **B6-7** (referencia del RNF8 en el cap. 6) | **Obsoleto**: ese párrafo se reescribe entero en C6-E. |
| **B6-6** | Cambia el texto de reemplazo (C6-G). |
| **#1 del plan original** (cifra 85) | La cifra pasa a **87** (C6-A) y hay que volver a tomar la imagen. |

---

## 1. Método a prueba de tontos (úsalo en cada cambio)

Todos los cambios del cap. 4–7 y anexos son del mismo tipo: **buscar un texto y reemplazarlo**.

**Cómo aplicar un cambio de texto** (VS Code, archivo `.typ` abierto)
1. Abre el archivo indicado (están en `tesis-appcopio-multitenant/content/`).
2. Pulsa **Ctrl+F** y pega el texto de **Buscar** (o sus primeras 5–6 palabras si es muy largo).
3. Debe aparecer **exactamente 1 resultado**. Haz clic en el texto encontrado.
   - **0 resultados:** ya lo aplicaste o el texto cambió. Busca solo las primeras 4 palabras y compara a ojo.
   - **Más de 1:** usa más palabras hasta que quede 1.
4. **Si el cambio es una frase corta:** selecciónala con el mouse y escribe/pega el texto nuevo encima.
5. **Si es un párrafo entero** (marcado "párrafo completo"): haz **triple clic** sobre él (selecciona la línea completa aunque se vea partida), y pega el texto nuevo encima.
6. Guarda con **Ctrl+S**.
7. Marca la casilla ☐ de esta guía.

**Reglas que evitan problemas**
- Aplica los cambios **de uno en uno** y guarda. No hace falta ir de abajo hacia arriba porque siempre buscas por texto, no por número de línea.
- Los números de línea de la guía son **orientativos**; ya se desfasaron con lo que aplicaste.
- Copia y pega el texto nuevo: no lo reescribas. Los guiones dobles `--` son raya larga en Typst; no los cambies.
- No toques lo que está entre `/* ... */` (son comentarios).
- Después de cada archivo, compila (abajo) y mira que no haya errores rojos.

**Cómo compilar** (en la carpeta de la tesis, terminal)
```bash
make
```
(o `make watch` para que recompile al guardar). Si algo sale mal, `git diff content/` te muestra exactamente qué cambiaste.

**Cómo volver atrás un archivo** si te equivocas feo: `git checkout -- content/archivo.typ`.
⚠ Esto borra **todos** tus cambios sin commitear de ese archivo; úsalo solo si no hay otra salida.

---

## 2. Fase A — Tres decisiones tuyas (antes de editar)

**A-1. Entrevista de contraste** — ✅ *Resuelta: opción 2 (se borró la mención en el cap. 6).* (cap. 6, párrafo "Conviene, con todo, acotar esa objeción…"). Ni el cap. 4 la presenta. Los caps. 1–3 no los pude revisar.
- **Opción 1 (si la entrevista ocurrió):** aplicar B4-10 con tus datos reales.
- **Opción 2:** aplicar B6-9 variante b (borrar la mención).

**A-2. "Diseño anterior, donde el cierre era puramente informativo"** — ✅ *Resuelta: opción 1.* (cap. 6).
- **Opción 1 (recomendada):** B6-8 variante a (reformular sin historia).
- **Opción 2:** documentar esa historia en el cap. 4 o 5.

**A-3. Pantalla de centro ajeno con error de JavaScript** — ✅ *Resuelta: opción b (pie precisado).* (`validacion-02`).
- **Opción a:** arreglar el frontend y volver a capturar.
- **Opción b (más barata):** B-A8 (precisar el pie).

---

## 3. Fase 1 — Cambios por la opción B

### Cap. 4 · `content/4_diseno_multitenant.typ`

☑ **C4-A. Reemplazar el párrafo de la excepción (era B4-1).** *Párrafo completo.*
Buscar: `Su alcance global tiene una contracara`
Reemplazar el párrafo entero por:
```typst
Su alcance es global sobre la plataforma, pero no sobre los datos de las comunas, y esa diferencia se declara desde el diseño. Las políticas de aislamiento no incluyen ninguna cláusula para el Super Administrador: sobre los centros, las activaciones, las personas y grupos familiares, el inventario y el resto de los datos operativos, su contexto --que no fija comuna alguna-- no ve fila alguna, ni siquiera de lectura. Solo seis tablas lo admiten, cada una por una razón de su rol: `Users` (ver, dar de alta y actualizar, nunca borrar, para nombrar y relevar a los administradores), `Emergencies` (ver y agrupar bajo un SuperEvento, nunca crear ni borrar), `SuperEvents` y `SuperEventParticipants` (crearlos, invitar y cerrarlos), `Municipalities` (darlas de alta) y `municipal_zones` (el catálogo geográfico que siembra el endpoint de migración de zonas). De `Users` ve la identidad del personal de cada comuna, porque nombrar un administrador exige poder elegirlo; es el único dato de personas que su rol alcanza, y no cruza hacia ninguna comuna. Es, junto con las funciones con privilegios elevados, el otro mecanismo de excepción que RNF8 obliga a mantener acotado, y por eso su lista es explícita y verificable.
```

☑ **C4-B. Revertir la regla general (era B4-2).** *Frase corta.*
Buscar: `, o bien que quien consulta sea el Super Administrador (@sec:rol-superadmin).`
Reemplazar por: `.`
(Resultado: "...la comuna activa de la sesión." como estaba originalmente.)

### Cap. 5 · `content/5_implementacion_pmv.typ`

☑ **C5-A. Snippet de la política general.** *Dos líneas.*
Buscar: `  USING (municipality_id = current_tenant() OR is_superadmin())`
Reemplazar por: `  USING (municipality_id = current_tenant())`

Buscar: `  WITH CHECK (municipality_id = current_tenant() OR is_superadmin());`
Reemplazar por: `  WITH CHECK (municipality_id = current_tenant());`

☑ **C5-B. Tercer elemento del párrafo de la política.** *Frase larga dentro de un párrafo.*
Buscar: `Y la disyunción con `is_superadmin()` es la materialización de la excepción administrativa que el diseño declara (@sec:rol-superadmin): el contexto de plataforma no fija comuna alguna, de modo que sin esa cláusula no podría resolver ni siquiera las consultas agregadas para las que existe.`
Reemplazar por:
```typst
Y lo que la forma general no incluye: ninguna cláusula para el Super Administrador. Su contexto no fija comuna alguna, de modo que `current_tenant()` es nulo y la igualdad nunca se cumple: sobre esta tabla no ve nada. Las excepciones que el diseño declara (@sec:rol-superadmin) se escriben como políticas propias, solo en las seis tablas que su rol administra, y no como una disyunción en la regla general.
```

☑ **C5-C (opcional). Ejemplo de excepción acotada.** Justo **después** del párrafo anterior (línea en blanco, luego el bloque):
````typst
```sql
-- db/002a_multitenant_schema.sql: una excepción declarada, acotada a Users y sin DELETE
CREATE POLICY users_superadmin_update ON Users
  FOR UPDATE USING (is_superadmin()) WITH CHECK (is_superadmin());
```
````

### Cap. 6 · `content/6_validacion_implementacion.typ`

☑ **C6-A. Cifra de comprobaciones.** *Frase corta, 2 lugares en este archivo.*
- Buscar: `85 comprobaciones` (o `91 comprobaciones` si ya lo habías cambiado) → Reemplazar por: `87 comprobaciones`
- Buscar: `ochenta y cinco` (o `noventa y una`) → Reemplazar por: `ochenta y siete`
  (queda "Que las ochenta y siete comprobaciones arrojen `PASS`...")

☑ **C6-B. Conteo de escrituras** (la 6.ª comprobación nueva incluye un `UPDATE` que debe alcanzar 0 filas). *Frases cortas, 3 reemplazos.*
- Buscar: `Diecisiete comprobaciones ejercitan` → `Dieciocho comprobaciones ejercitan`
- Buscar: `ocho por API y nueve directamente contra la base` → `ocho por API y diez directamente contra la base`
- Buscar: `Las dieciocho que van directamente contra la base` → `Las diecinueve que van directamente contra la base`

*(Verificado en el script: 8 rechazos de escritura por API; 4 + 5 + 1 = 10 contra la base; 7 permitidas; 2 de medición → 19 contra la base.)*

☑ **C6-C. Procedimiento del Escenario 3.** Buscar la línea que empieza `2. Dar de alta una municipalidad nueva`.
Cambiar ese `2.` por `4.` y, **encima** de esa línea (después del punto 1), insertar:
```typst
2. Consultar la base directamente como el rol de aplicación con el contexto de Super Administrador fijado: contar las filas de las tablas operativas y de personas, e intentar modificar centros y personas (RF2).
3. Comprobar, con una lista blanca, qué políticas y funciones de la base admiten al Super Administrador, y que coinciden exactamente con lo que su rol administra.
```

☑ **C6-D. Seis filas nuevas en la tabla del Escenario 3.** Buscar la fila:
`[`superadmin` solicita \ el listado de municipalidades], [Al menos las cuatro sembradas], [`varias`], [`PASS`],`
y pegar **justo debajo** (misma sangría, 4 espacios):
```typst
    [Tablas operativas y de personas, \ consultadas en la base como \ Super Administrador], [0 filas], [0], [`PASS`],
    [Esas mismas tablas, contadas \ sin restricción de RLS], [Con datos sembrados], [`si`], [`PASS`],
    [Modificar centros y personas \ como Super Administrador \ (filas alcanzadas)], [0], [0], [`PASS`],
    [Usuarios de las comunas, \ vistos como Super Administrador], [Con datos sembrados], [`si`], [`PASS`],
    [Tablas cuyas políticas admiten \ al Super Administrador], [Solo las seis declaradas], [`coincide`], [`PASS`],
    [Funciones que lo contemplan], [Solo las dos declaradas], [`coincide`], [`PASS`],
```

☑ **C6-E. Resultado del Escenario 3.** *Párrafo completo.*
Buscar: `*Resultado.* La afirmación que la evidencia sostiene sobre el alcance del Super Administrador`
Reemplazar el párrafo entero por:
```typst
*Resultado.* El Super Administrador administra la plataforma sin acceso a datos operativos de comuna alguna, y el límite lo pone el motor de base de datos, no la aplicación. Sin pasar por la API, con su contexto fijado, las tablas operativas y de personas no le devuelven ninguna fila --y esas mismas tablas sí tienen datos sembrados, lo que descarta que el cero sea trivial--, y tampoco puede modificar centros ni personas. Lo que sí ve son los usuarios de las comunas, porque RF2 le exige nombrar y relevar a sus administradores. La lista blanca completa el argumento: las únicas tablas cuyas políticas lo admiten son las seis que su rol administra (`Users`, `Emergencies`, `SuperEvents`, `SuperEventParticipants`, `Municipalities` y `municipal_zones`), y las únicas funciones que lo contemplan son dos, la que lista a los participantes de un SuperEvento y la que avisa de una invitación; si alguien agregara una cláusula para el Super Administrador a otra política, esa comprobación fallaría. La restricción de la aplicación --el listado de centros le responde vacío-- queda como una segunda barrera y no como la única. Conviene precisar qué sí alcanza: de `Users`, la identidad del personal de cada comuna, y de `Emergencies`, sus nombres, para poder agruparlas. Son datos de administración y no los datos de personas alojadas ni de centros que protege RF12, pero no son agregados, y reducirlos a lo estrictamente necesario queda como trabajo futuro.
```

☑ **C6-F. Síntesis de resultados.** *Frase corta.*
Buscar: `el Super Administrador administra la plataforma sin ninguna ruta de acceso a los datos operativos de las comunas`
Reemplazar por: `el Super Administrador administra la plataforma sin acceso a los datos operativos de las comunas, ni en la aplicación ni en el motor de base de datos`

☑ **C6-G. Objetivo del Escenario 3 (reemplaza a B6-6).** *Frase corta.*
Buscar: `no dispone de ninguna ruta de acceso a los datos operativos de comuna alguna (RF2)`
Reemplazar por: `no dispone de ninguna ruta de acceso a los datos operativos de comuna alguna, ni en la aplicación ni en el motor de base de datos (RF2, @sec:rol-superadmin)`

### Cap. 7 · `content/7_conclusiones.typ`

☑ **C7-A. Cifra.** Buscar `ochenta y cinco comprobaciones` (o `noventa y un comprobaciones`, que es como quedó escrito) → `ochenta y siete comprobaciones`.

☑ **C7-B (opcional). Trabajo futuro.** En la lista de `== Trabajo futuro`, agregar una viñeta:
```typst
- Reducir aún más lo que el Super Administrador alcanza de `Users` --hoy ve la identidad del personal de cada comuna-- a lo estrictamente necesario para nombrar y relevar administradores.
```

### Anexos · `content/anexos.typ`

☑ **C-A1. Pie de la salida del script.** Buscar `85 de 85 comprobaciones` (o `91 de 91 comprobaciones` si ya lo habías cambiado) → `87 de 87 comprobaciones`.

☑ **C-A2. Matriz de trazabilidad, fila RF2.**
Buscar: `[RF2], [Rol de Super Administrador por sobre las municipalidades.], [Escenario 3.],`
Reemplazar por:
```typst
[RF2], [Rol de Super Administrador por sobre las municipalidades.], [Escenario 3: incluida la comprobación, directo en la base, de que no ve ni modifica datos operativos, y la lista blanca de las tablas y funciones que lo admiten.],
```

☑ **C-A3. Matriz de trazabilidad, fila RNF8.**
Buscar: `y sus `REVOKE ... FROM PUBLIC` (@sec:catalogo-definer).]`
Reemplazar por: `y sus `REVOKE ... FROM PUBLIC` (@sec:catalogo-definer), y por la lista blanca de políticas y funciones que admiten al Super Administrador (Escenario 3).]`

☐ **C-A4 (opcional). Catálogo de funciones.** En la fila de `super_event_participants_of`, al final de la descripción agregar: ` También la consulta el Super Administrador, que administra los SuperEventos.` En la de `notify_super_event_invitation`, al final: ` El Super Administrador queda exento de participar.`

---

## 3b. Fase 1b — Retiro de 4 comprobaciones (87 en lugar de 91)

**Qué se quitó del script** (`scripts/validar_multitenant.sh`, verificado: **TODO OK — 87 comprobaciones** sobre base recién recreada):

| Comprobación retirada | Motivo |
|---|---|
| "ninguna emergencia quedó sin comuna dueña" | No podía fallar: `created_by_municipality_id` es `NOT NULL`. |
| "toda oferta registra su comuna de origen y su fecha" | No podía fallar: `from_municipality_id` y `created_at` son `NOT NULL`. |
| "las ofertas cubren los cinco estados del ciclo de vida" | Solo describía el sembrado; no probaba comportamiento. |
| "el centro ajeno responde 404, no 200 con datos" | **Fundida**, no perdida: ahora "Viña no puede leer un centro de Valparaíso" es una sola comprobación que exige `404/sin-datos`. Por eso la fila del cap. 6 y del anexo ("404 / `sin-datos`") **sigue siendo exacta y no se toca**. |

**Cap. 7 y cap. 6 (cifras):** ya quedan cubiertos por C6-A, C7-A y C-A1 de arriba (todos apuntan a **87**).
Si ya cambiaste esas cifras a 91, los textos de "Buscar" de esos tres ítems incluyen la variante con 91.

### Cap. 6 · `content/6_validacion_implementacion.typ`

☑ **C6-H. Frase sobre las comprobaciones que no se tabulan.** Con el retiro y el análisis previo, esa frase ya no era del todo exacta: las de integridad del sembrado sí aparecen en las tablas del anexo, y solo el backend y la higiene de sesión quedan fuera. *Frase larga dentro de un párrafo.*
Buscar:
```
las restantes verifican la integridad del conjunto de datos sembrado y la disponibilidad del backend, y no se tabulan por no corresponder a ningún requisito del @cap:diseno-multitenant
```
Reemplazar por:
```typst
las restantes --la disponibilidad del backend y la higiene de la sesión, esta última descrita en la síntesis de resultados-- no corresponden a ningún requisito del @cap:diseno-multitenant y no se tabulan en los escenarios
```
*(El punto final de la oración ya está después del texto buscado: no lo borres.)*

**Lo que NO hay que tocar en el cap. 6:** la frase de la sección de datos sembrados "cinco ofertas de apoyo que cubren los cinco estados del ciclo de vida" sigue siendo cierta: describe el sembrado, y lo único que se retiró es la comprobación que lo verificaba. Tampoco cambian los conteos de escrituras (ninguna de las 4 retiradas era una escritura).

### Cap. 7 · `content/7_conclusiones.typ`

Solo la cifra (C7-A). Ojo: hoy dice `noventa y un comprobaciones` (concordancia errada: debía ser "una"); al reemplazarlo por `ochenta y siete comprobaciones` el problema desaparece.

### Anexos · `content/anexos.typ`

☑ **C-A5. Anexo, tabla del Escenario 1: borrar una fila.** Buscar `Emergencias sembradas sin comuna dueña`. Haz clic en esa línea, selecciónala entera (**triple clic**), pulsa **Supr** y borra también la línea en blanco que quede. La línea es:
```
    [Emergencias sembradas sin comuna dueña], [0], [0], [`PASS`],
```
La tabla debe quedar con **14 filas** de datos (antes 15).

☑ **C-A6. Anexo, tabla del Escenario 2: borrar dos filas.** Mismo método para estas dos líneas:
```
    [Ofertas sin comuna de origen o sin fecha de creación], [0], [0], [`PASS`],
    [Estados distintos representados entre las ofertas sembradas], [5], [5], [`PASS`],
```
La tabla debe quedar con **27 filas** de datos (antes 29).

☑ **C-A7. Anexo, matriz de trazabilidad, fila RF11.** *Frase larga.*
Buscar: `Escenario 2: las cinco ofertas sembradas cubren los cinco estados del ciclo de vida, una comuna ajena a la oferta no puede resolverla y un trabajador sin apoyo administrativo tampoco.`
Reemplazar por:
```typst
Escenario 2: una comuna ajena a la oferta no puede resolverla, un trabajador sin apoyo administrativo tampoco, y el borrador solo existe para la comuna que lo emitió.
```

☑ **C-A8. Anexo, matriz de trazabilidad, fila RNF7.** *Frase larga.*
Buscar: `ninguna participación resuelta queda sin fecha de respuesta y ninguna oferta sin comuna de origen ni fecha; las cancelaciones automáticas dejan registrado su motivo; sostenido por esquema con`
Reemplazar por:
```typst
ninguna participación resuelta queda sin fecha de respuesta, y la comuna de origen y la fecha de cada oferta quedan garantizadas por el esquema (`NOT NULL`); las cancelaciones automáticas dejan registrado su motivo; sostenido por esquema con
```
*(Es más honesto: dice que eso lo garantiza el esquema, no una ejecución.)*

**Lo que NO hay que tocar en los anexos:** la fila "Lectura de un centro de otra comuna por identificador | 404 | 404 / `sin-datos`" (sigue exacta), y la tabla del Escenario 3, 4 y 5 del cap. 6.

### Comprobación de esta fase
```bash
cd /c/Github/tesis-appcopio-multitenant/content
grep -nE "sin comuna dueña|Estados distintos representados|sin comuna de origen|ninguna oferta sin comuna" anexos.typ
```
No debe devolver nada. Y en el anexo, las dos tablas deben tener 14 y 27 filas.

### Imagen
La captura `resultados-script-validacion.png` debe mostrar **87** y, en "Aislamiento entre comunas", la línea
`Viña no puede leer un centro de Valparaíso (responde 404 y sin datos)`.
(Se toma en la Fase 3, paso 3.)

---

## 4. Fase 2 — El resto de los cambios (de la guía anterior, sin las partes que la opción B anuló)

### Cap. 4

☑ **B4-3 [#6] El recorte de campos no lo hace RLS.**
Buscar: `Sus políticas propias acotan la lectura anónima a los centros activos --de todas las comunas-- y a los mismos campos que el mapa ya exponía en la versión single-tenant.`
Reemplazar por:
```typst
Sus políticas propias acotan la lectura anónima a los centros activos --de todas las comunas--, y la respuesta pública se limita a los mismos campos que el mapa ya exponía en la versión single-tenant.
```
*(Hay un duplicado dentro de `/* … */` más abajo; ignóralo.)*

☐ **B4-4 [#16] `EmergencyActivationInvitations` es la excepción.**
Buscar: `nacen con su columna de comuna desde el diseño.`
Reemplazar por:
```typst
nacen con su columna de comuna desde el diseño (con la salvedad de `EmergencyActivationInvitations`, cuya columna completa el mismo disparador de herencia del segundo patrón, como se verá en la implementación).
```

⊘ **B4-5 [#18, opcional] Operaciones del Super Administrador.**
Buscar: `El cuerpo de la petición nunca es fuente: ninguna entidad hereda su comuna de ahí.`
Reemplazar por:
```typst
El cuerpo de la petición nunca es fuente: ninguna entidad hereda su comuna de ahí. (En las operaciones del Super Administrador sobre municipalidades, la comuna es el objeto de la operación y viaja en la URL.)
```

☑ **B4-6 [#20] Efecto del cierre.**
Buscar: `al cerrarlo el tablero queda vacío y no se pueden emitir ofertas nuevas`
Reemplazar por: `al cerrarlo el tablero deja de ser consultable y no se pueden emitir ofertas nuevas`

☑ **B4-7 [#27] Quién envía directo una oferta** *(verificado en `crossSupportRoutes.ts`: administrador y apoyo administrativo crean `pending`).*
Buscar: `Un administrador que redacta una oferta la envía de inmediato, sin pasar por el borrador.`
Reemplazar por: `Un administrador --o un trabajador con apoyo administrativo-- que redacta una oferta la envía de inmediato, sin pasar por el borrador.`

☑ **B4-8 [residuo del #2] "Solo lectura".**
Buscar: `La visibilidad ampliada es, además, de solo lectura: ninguna comuna puede modificar datos de otra, ni siquiera dentro de una emergencia compartida.`
Reemplazar por:
```typst
La visibilidad ampliada es, además, de solo lectura sobre los datos operativos: ninguna comuna puede modificar los datos operativos de otra, ni siquiera dentro de una emergencia compartida. Las únicas escrituras que cruzan son las descritas en la @sec:diseno-politicas --invitar, ofrecer apoyo y responder una oferta--, y todas tocan solo la respuesta de la contraparte.
```

☐ **B4-9 [#33] Errata.** Buscar `adminitir` → `admitir`.

⊘ **B4-10 [#9, solo si A-1 = opción 1] Presentar la entrevista.** En `== Objetivos y restricciones de diseño`, al final del primer párrafo, agregar un párrafo con tus datos reales:
```typst
Las reglas de operación que este diseño modela se contrastaron además con [CONTRAPARTE, CARGO] de [INSTITUCIÓN] en una entrevista realizada en [FECHA], que respaldó decisiones como [DECISIÓN 1, p. ej. el consentimiento explícito de la comuna para entrar en una colaboración] y [DECISIÓN 2, p. ej. la aprobación administrativa de toda oferta dirigida a otra municipalidad].
```

### Cap. 5

☑ **B5-1 [#6].** Buscar: `de modo que lo único que decide qué devuelve el endpoint es qué política quedó activa al resolver el contexto.`
Reemplazar por:
```typst
de modo que lo único que decide qué *filas* devuelve el endpoint es qué política quedó activa al resolver el contexto; los campos de cada fila los fija la lista de columnas de la consulta, idéntica en ambas ramas.
```

☑ **B5-2 [#19].** Buscar: `El primero es directo --una columna `NOT NULL` con clave foránea a `Municipalities`-- y no merece más comentario.`
Reemplazar por:
```typst
El primero es directo --una columna `NOT NULL` con clave foránea a `Municipalities`, salvo en `Users`, donde la obligatoriedad la impone la restricción `CHECK` de la @sec:rol-superadmin-- y no merece más comentario.
```

☐ **B5-3 [#17] Qué tabla escribe cómo su comuna** *(verificado: `Products`/`Categories`/`Persons`/plantillas/usuarios con `current_tenant()`; `CenterInventoryItems` con subconsulta a `Centers`; `InventoryLog` por disparador).*
Buscar: `El mismo patrón aparece en los servicios de categorías, productos, inventario, movimientos, plantillas y usuarios.`
Reemplazar por:
```typst
El mismo patrón aparece en los servicios de categorías, productos --incluidos los que se crean desde inventario y movimientos--, personas, plantillas y usuarios. El inventario de cada centro, en cambio, toma la comuna de su centro con una subconsulta en el propio `INSERT`, y el historial de movimientos la hereda del centro por disparador.
```

☑ **B5-4 [#20].** Buscar: `--el tablero queda vacío y no se pueden emitir ofertas nuevas--`
Reemplazar por: `--el tablero deja de ser consultable y no se pueden emitir ofertas nuevas--`

⊘ **B5-5 [#18, opcional].** Buscar: `que son el objeto de la operación y no la identidad de quien la pide.`
Reemplazar por: `que son el objeto de la operación y no la identidad de quien la pide (las operaciones del Super Administrador sobre municipalidades llevan la comuna objeto en la URL).`

☑ **B5-6 [#26] Aprobar y enviar.**
- Buscar: `aprobar o cancelar los borradores propios` → `aprobar y enviar, o cancelar, los borradores propios`
- Buscar: `ofrece enviarla o cancelarla` → `ofrece aprobarla y enviarla, o cancelarla`

☑ **B5-7 [#33] Errata.** Buscar `comportamiento transaccional previo."` (con la comilla `"` al final) → `comportamiento transaccional previo.`

☐ **B5-8 [#13] Antecedente de los secretos** *(verificado: `POSTGRES_PASSWORD: postgres` literal en `docker-compose.yml`).*
Después del párrafo que termina en `(RNF6, @sec:consideraciones-migracion).` (sección Entorno de desarrollo), agregar un párrafo:
```typst
Los secretos del despliegue (por ejemplo, la contraseña de la base en `docker-compose.yml`) permanecen como valores literales provisionales: su gestión no se abordó en esta extensión y se declara como trabajo futuro (@cap:conclusiones).
```

### Cap. 6

☑ **B6-1 [#nuevo] Errata.** Buscar `de ma duración del producto` → `de madurez del producto`.

☐ **B6-2 [#15].** → ver **P5** en la sección *Pendientes* (arriba): ahí está con bloques de código copiables.

☑ **B6-3 [#34].** Buscar: `El aislamiento se sostiene en las tres capas del diseño.`
Reemplazar por: `El aislamiento se sostiene en el motor, en la API y en la interfaz.`

☑ **B6-4 [#23].** Buscar: `etiquetados con la emergencia que los aporta` → `filtrables por la emergencia que los aporta`

☑ **B6-5 [#22] Fila faltante del Escenario 2.** En la tabla del Escenario 2, pega esta fila como **primera fila de datos** (justo debajo del encabezado `table.header[...]`):
```typst
    [Comuna no participante solicita \ el tablero por API], [403], [403], [`PASS`],
```

☑ **B6-8 [#13, según A-2] "Diseño anterior".**
Buscar: `Es la corrección de un hueco real del diseño anterior, donde el cierre era puramente informativo y el acceso sobrevivía hasta que se cerrara, una por una, cada activación involucrada.`
- **Variante a (recomendada):** reemplazar por `Es lo que distingue cerrar el evento de desvincular, una por una, las activaciones de cada comuna.`
- **Variante b:** dejarlo y documentar el antecedente en otra parte.

☑ **B6-9 [#9, según A-1] Entrevista.**
Buscar: `y la entrevista de contraste realizada para esta extensión (@cap:diseno-multitenant) son la fuente de decisiones`
- **Variante a** (si aplicaste B4-10): no cambies nada.
- **Variante b:** reemplazar por `es la fuente de decisiones`. La `y` que unía las dos fuentes ya va dentro del texto buscado, así que desaparece sola: la frase queda "...del que nació AppCopio, es la fuente de decisiones como...".

☑ **B6-10 [#5].** Buscar: `el borrador que envió` → `el borrador que emitió`

☑ **B6-11 [#25] RNF6.**
Buscar: `Caso aparte es RNF6, que no requiere verificación alguna: al no existir un despliegue productivo ni datos heredados que migrar (@sec:consideraciones-migracion), construir un escenario de migración habría significado fabricar un conjunto artificial sin valor de acreditación.`
Reemplazar por:
```typst
En el caso de RNF6, la acreditación por diseño es la más literal: el requisito declara que no hay nada que migrar, porque no existe un despliegue productivo ni datos heredados (@sec:consideraciones-migracion), y construir un escenario de migración habría significado fabricar un conjunto artificial sin valor de acreditación.
```

☑ **B6-12 [residuo del #2] "Solo lectura".**
Buscar: `dentro de los límites de solo lectura y consentimiento explícito definidos en el diseño`
Reemplazar por: `dentro de los límites de confianza y de consentimiento explícito definidos en el diseño`

### Cap. 7

☑ **B7-1 [residuo del #2].** Buscar `la colaboración de solo lectura dentro de los límites de confianza definidos`
→ `la colaboración dentro de los límites de confianza definidos, sin escritura sobre datos operativos ajenos`

☑ **B7-2 [#13].** Buscar `se preserva su capacidad de operar con conectividad degradada` → `no se intervino su capacidad de operar con conectividad degradada`

☑ **B7-3 [#4].** Buscar `ningún centro se expone sin que su encargado lo consienta`
Reemplazar por:
```typst
ningún centro se expone sin que su encargado haya sido consultado --o, cuando el administrador lo vincula directamente, sin que lo vea indicado de forma permanente en la ficha de su centro--, y compartirlo con otras comunas es decisión de una administración que debe revisar la lista exacta antes de aceptar
```

☑ **B7-4 [#11] Orden de los desafíos.** *Oración larga.* Buscar `Una política de lectura ampliada quedó atrapada por el propio aislamiento` y reemplaza desde ahí **hasta `…que costó caro.`** (incluida la oración final del pool) por todo esto, que va hasta el final del párrafo:
```typst
Una política de lectura ampliada quedó atrapada por el propio aislamiento, tanto al resolver su subconsulta sobre tablas igualmente protegidas como al devolver la fila recién escrita; la reutilización de objetos de conexión por parte del _pool_ dejaba transacciones abiertas indefinidamente, un supuesto incorrecto que costó caro; activar dos contextos a la vez amplió la vista en lugar de acotarla, porque las políticas permisivas de PostgreSQL se combinan por disyunción; una comuna pudo inscribirse en un evento ajeno apoyándose en que las claves foráneas omiten RLS, de modo que ocultar una fila no impedía referenciarla; y la cláusula `ON CONFLICT` resultó inutilizable sobre una tabla donde se escriben filas que su propio autor no puede leer.
```
⚠ Este párrafo es largo: hazlo con triple clic y pega **todo** el texto de arriba, no solo una parte.

☑ **B7-5 [#12].** Buscar: `--el arbitraje normativo de la escalada, las relaciones de pertenencia únicas y los traslados físicos de recursos y personas (@sec:alcance-exclusiones)--`
Reemplazar por: `--el arbitraje normativo de la escalada, las relaciones de pertenencia únicas, los traslados físicos de recursos y personas, la configuración por municipalidad y el traspaso de la titularidad de un SuperEvento (@sec:alcance-exclusiones)--`

☐ **B7-6 [#12] Trabajo futuro.** → la viñeta nueva ya está aplicada; falta corregir la 2.ª viñeta: ver **P6** en *Pendientes*.

☑ **B7-7 [#14].** Buscar `porque esta extensión no los abordó.`
Reemplazar por:
```typst
porque esta extensión no los abordó. En el caso de las guardias de ruta, su efecto queda acotado: como se argumentó en la @sec:frontend, la frontera de acceso a los datos está en las políticas del motor y no en el cliente.
```

### Anexos y plantilla

☑ **B-A1 [#32] Etiqueta de anexo (arregla un bug de render).** Archivo `layout/thesis_template.typ`. En la lista `anexo-labels`, agrega una línea nueva:
```typst
  <anexo:validacion-solucion>,
```
entre `<anexo:resultado-script-validacion>,` y `<anexo:matriz-trazabilidad-completa>`. Sin esto, las referencias al anexo de verificaciones se imprimen como "Sección…" en vez de "Anexo…".

☑ **B-A2 [#30]** `content/anexos.typ`: buscar `(camino 3)` → `(vía 2: originado por una comuna)`. *(El script ya fue cambiado: el texto del anexo debe coincidir con el script.)*

☐ **B-A3 [#5] Pie de la bandeja de ofertas — solo después de recapturar (Fase 3).** Si tomas la captura con `admin` (Valparaíso), pestaña Enviadas:
```typst
Bandeja de ofertas de apoyo. Sesión de `admin` (Valparaíso), pestaña de enviadas: cada oferta con su estado --incluido un borrador pendiente de aprobación interna-- y las acciones disponibles según el lado y el estado desde el que se la observa. Fuente: Elaboración propia.
```

☐ **B-A4 [#7] Pie del mapa público — según lo que veas.** Abre el mapa sin sesión → "Ver más". Si **muestra** necesidades, agrégalas al pie ("…nivel de abastecimiento y necesidades priorizadas"). Si **no**, en el cap. 6 borra `y necesidades priorizadas`. *(El código sugiere que sí las pide: `MapComponent` consume `getInventoryWithPriorities` y existe `cip_public_read`.)*

☐ **B-A5 [#21] Pie de `validacion-11`.** Cuando recapturas, anota **quién** cierra el SuperEvento. Si es el Super Administrador, reemplaza `después de cerrarlo, deja de figurar` por `después de que el Super Administrador lo cierra, deja de figurar`.

☐ **B-A6 [#24]** *(solo si NO recapturas la galería).* Buscar `sobre el entorno de datos sembrados` → `a partir del entorno sembrado, tras ejercitar algunos flujos`.

☐ **B-A7 [#31]** No unifiques "abastecimiento" y "ocupación" todavía. `fullness_percentage` se muestra como "Abastecimiento", mientras que `public_center_occupancy` cuenta personas alojadas. Mira qué métrica muestra el diálogo de aceptación: si es otra, corrige la etiqueta o el pie; si es la misma, unifica a "abastecimiento".

☑ **B-A8 [#8, según A-3b] Pie de `validacion-02`.**
```typst
Intento de alcanzar por URL un centro de Valparaíso desde la sesión de Viña del Mar: la API responde `404` y la interfaz, que no maneja ese caso de forma amigable (deuda heredada del frontend), no muestra ningún dato del centro ajeno. Fuente: Elaboración propia.
```

---

## 5. Fase 3 — Recaptura de imágenes (hazla **una sola vez**, al final)

Orden, para que ningún flujo contamine los datos de otro:

1. Terminar el texto (Fases 1 y 2).
2. En la carpeta del proyecto (`AppCopio-MultiTenant`), terminal:
   ```bash
   docker compose down -v && docker compose up -d
   ```
   Espera ~1 minuto a que el backend responda.
3. Correr el script y **capturar la terminal completa**:
   ```bash
   bash scripts/validar_multitenant.sh
   ```
   Debe terminar en `TODO OK — 87 comprobaciones`. Guárdala como `figures/resultados-script-validacion.png`.
4. **Reponer la base** (repite el paso 2): el script crea y borra una comuna.
5. Capturas **que no cambian datos**, en este orden:
   - `pantalla-emergencias-comuna` (hoy muestra una 7.ª emergencia "Derrumbe Playa Ancha"; con base limpia deben ser 6).
   - `pantalla-gestion-centros-emergencia`, `pantalla-supereventos-comuna`, `pantalla-tablero-listado`, `pantalla-tablero-mapa` (el Gimnasio de Valparaíso debe verse igual en todas).
   - **`pantalla-superadmin-supereventos`** (**nueva razón para recapturarla**: desaparece la columna "Centros vinculados").
   - `pantalla-bandeja-ofertas` (con `admin` de Valparaíso, pestaña Enviadas: hoy es la de Viña y muestra un borrador que no existe en el sembrado).
   - `validacion-01`, `validacion-07` (mapa público: abre "Ver más" para resolver B-A4), `validacion-08`, `validacion-02`.
6. Capturas **que cambian datos**, cada una al final y reponiendo la base si hace falta:
   - `pantalla-aceptacion-invitacion` (acepta la invitación de Quilpué).
   - `validacion-04` (aceptar la oferta pendiente).
   - `validacion-11` (cerrar el SuperEvento; anota quién lo cierra, B-A5).

Credenciales de prueba: contraseña común `12345`; `superadmin` no tiene comuna (usuarios en el cap. 6, tabla de usuarios de prueba).

---

## 6. Fase 4 — Figuras (revisar abriendo cada una; no pude verlas)

| Figura | Qué ajustar | Plan |
|---|---|---|
| `secuencia-peticion` | **Nada.** Muestra la política sin `OR is_superadmin()` y ahora es exacto. | ~~#3~~ |
| `ruta-doble-uso` | Las dos ramas devuelven **los mismos campos** y difieren en las **filas**. Cambiar "Solo los campos del mapa público" / "Ficha completa de cada centro" por algo como "Solo centros activos, de todas las comunas" / "Solo los centros de la comuna". | #6 |
| `ofertas-apoyo` | Incluir al trabajador **con** apoyo administrativo emitiendo directo como pendiente. Mencionar en el pie que no se dibuja la cancelación automática por retiro ni el congelamiento al cerrar. Usar "aprobar y enviar". | #26, #27 |
| `invitacion-municipalidades` | Agregar "(fase de ingreso)" al pie. | #28 |
| `modelo-nuevo` | Conectar `Users`–`Municipalities`; dibujar `SuperEvents.created_by_municipality_id`; agregar la entidad de notificaciones; mostrar `joined_at`/`responded_at` y `created_at`/motivo de cancelación. **Antes de corregir "Rols" y "comunity_charge_id" verifica que no sean los nombres reales:** `comunity_charge_id` existe tal cual en `db/001_tablas.sql:64`. | #29 |

---

## 7. Fase 5 — Verificación final

**1. Búsquedas que NO deben devolver nada** (terminal, carpeta de la tesis):
```bash
cd content
grep -nE "85 comprobaciones|91 comprobaciones|ochenta y cinco|noventa y un|85 de 85|91 de 91|camino 3|cuatro estados posibles|ma duración|adminitir|ninguna comuna puede modificar datos de otra|que envió|lo consienta|Diecisiete comprobaciones|nueve directamente|Las dieciocho|o bien que quien consulta sea el Super Administrador|OR is_superadmin|sin ninguna ruta de acceso a los datos operativos de las comunas" *.typ
grep -n 'previo\."' 5_implementacion_pmv.typ
grep -n "tres capas del diseño" 6_validacion_implementacion.typ
```
`OR is_superadmin` solo puede aparecer en el cap. 5 si dejaste el ejemplo opcional C5-C **sin** el `OR` (ahí no debe aparecer).

**2. Búsquedas que SÍ deben devolver algo:**
```bash
grep -c "87 comprobaciones" 6_validacion_implementacion.typ     # 1
grep -c "ochenta y siete" 6_validacion_implementacion.typ 7_conclusiones.typ   # 1 y 1
grep -c "87 de 87" anexos.typ                                   # 1
grep -c "Solo seis tablas lo admiten" 4_diseno_multitenant.typ  # 1
```

**3. A mano:**
- `make` compila sin errores y `@anexo:validacion-solucion` se imprime como "Anexo…".
- Cifra **87** coherente en cap. 6 (dos lugares), cap. 7, pie del anexo e imagen.
- Cada pie de figura coincide con su imagen recapturada (usuario, estado, conteos).
- La lista de las seis tablas es idéntica en cap. 4 (C4-A), cap. 5 (C5-B) y cap. 6 (C6-E): `Users`, `Emergencies`, `SuperEvents`, `SuperEventParticipants`, `Municipalities`, `municipal_zones`.

**4. Del lado del proyecto** (si quieres reconfirmar antes de entregar):
```bash
docker compose down -v && docker compose up -d
bash scripts/validar_multitenant.sh
```
Debe cerrar en `TODO OK — 87 comprobaciones`.

---

## 8. Orden de trabajo resumido

1. **Fase A** (3 decisiones).
2. **Fase 1** completa (opción B) → compilar.
3. **Fase 2** completa → compilar.
4. **Fase 3** (recaptura única) y luego **B-A3 … B-A8** con las imágenes nuevas a la vista.
5. **Fase 4** (figuras).
6. **Fase 5** (verificación).

## 9. Límites de lo verificado

- No pude revisar los caps. 1–3 (necesario para A-1 y para confirmar que "secretos" no aparece antes).
- No abrí las figuras `modelo-nuevo`, `ofertas-apoyo`, `invitacion-municipalidades` y `ruta-doble-uso`.
- No verifiqué en pantalla si el mapa público muestra necesidades (B-A4) ni qué métrica rotula el diálogo de aceptación (B-A7).
- La excepción de `municipal_zones` existe por el endpoint de migración de zonas (`/api/migrate/migrate-zones`); si algún día se elimina ese endpoint, esa tabla puede quedar sin excepción y la lista pasar a cinco (hay que cambiar el script, la guía y los textos juntos).
