# Guion de validación manual — Multi-tenant AppCopio

> Documento 3. Complementa a [scripts/validar_multitenant.sh](../scripts/validar_multitenant.sh):
> ese script cubre lo que se puede afirmar por API y base de datos; este guion cubre lo visual
> —mapas, badges, modales, redirecciones— que solo se comprueba mirando la pantalla.

## Antes de empezar

```bash
docker compose down -v && docker compose up -d
bash scripts/validar_multitenant.sh   # debe terminar en TODO OK
```

Todos los usuarios de prueba usan la contraseña **`12345`**. Los datos de este guion —los tres
SuperEventos, las seis emergencias locales, las activaciones fuera de Valparaíso, las cuatro
ofertas y las notificaciones— viven en
[db/005_datos_validacion.sql](../db/005_datos_validacion.sql), que corre al final del sembrado.

**Mapa de lo sembrado**, porque el guion lo da por sabido:

| SuperEvento | Nivel | Estado | Comunas | Emergencias que agrupa |
|---|---|---|---|---|
| SE1 · Incendio forestal región de Valparaíso 2024 | mayor | vigente | VALPO y VINA participando, QUILP invitada | E1 (VALPO), E2 (VINA) |
| SE2 · Aluvión Marga Marga | desastre | vigente | VINA participando (lo originó), VALPO invitada, CONCO rechazada | E4 (VINA) |
| SE3 · Temporal agosto 2024 | mayor | **cerrado** | CONCO y VINA participando | E5 (CONCO), E6 (VINA) |

`E3 · Sistema frontal Quilpué` queda **suelta**, sin SuperEvento: es el caso más común —una
comuna organizándose sola— y es la emergencia que Quilpué puede aportar al aceptar el SE1.

| Comuna | Administrador | Trabajador con apoyo | Trabajador sin apoyo |
|---|---|---|---|
| Valparaíso (1) | `admin` | `martinalina` | `tito` |
| Viña del Mar (2) | `admin.vina` | `apoyo.vina` | `tm.vina` |
| Quilpué (3) | `admin.quilpue` | — | `tm.quilpue` |
| Concón (4) | `admin.concon` | — | `tm.concon` |
| — | `superadmin` (Super Administrador) | — | — |

Marca la casilla `[ ]` → `[x]` a medida que confirmes cada resultado.

---

## 1. Mapa público sin sesión

1. Abre `/map` **sin iniciar sesión**.
2. Confirma que aparecen centros de **las cuatro comunas** (Valparaíso, Viña, Quilpué, Concón),
   coloreados por estado operacional, no por urgencia.
3. Abre la ficha de cualquier centro: solo debe mostrar ubicación, capacidad, % de llenado y
   estado — nada de personas, familias ni cantidades de inventario.

- [ ] Se ven centros de las cuatro comunas
- [ ] Ningún dato sensible aparece en la ficha

---

## 2. Login por comuna y badge de comuna

1. Entra como `admin.vina` / `12345`.
2. En el navbar debe aparecer el badge **«Viña del Mar»**.
3. En **Mis Centros**, solo deben listarse los 3 centros de Viña.
4. Cierra sesión y entra como `admin` (Valparaíso): el badge cambia a **«Valparaíso»** y la
   lista pasa a mostrar los 12 centros de Valparaíso.

- [ ] El badge de comuna es el correcto en ambos casos
- [ ] Ningún centro de la otra comuna aparece en la lista

---

## 3. Trabajador vs. administrador

1. Entra como `tm.vina` (Trabajador Municipal, sin apoyo admin).
2. Confirma que **no** aparece la barra de administración ni el menú de Usuarios.
3. Confirma que el menú de **Emergencias** tampoco aparece (ni en el navbar ni entrando a
   `/emergencias` a mano, que debe redirigir a `/`).
4. Entra como `admin.vina`: ambos deben estar presentes.

- [ ] `tm.vina` no ve administración ni emergencias
- [ ] `admin.vina` ve ambas

---

## 4. Super Administrador

1. Entra como `superadmin` / `12345`.
2. Confirma que el menú **no** ofrece ningún acceso a centros.
3. Entra a `/superadmin/municipalidades`: deben listarse las cuatro comunas sembradas.
4. Crea una municipalidad nueva (por ejemplo «Casablanca») y asígnale un administrador.
5. Cierra sesión y entra con ese administrador nuevo: debe ver una comuna vacía, sin centros
   heredados de ninguna otra.

- [ ] El Super Admin no tiene acceso a centros en ninguna pantalla
- [ ] La comuna nueva parte vacía

---

## 5. Cambio de administrador (regresión de un defecto ya corregido)

1. Como `admin.concon`, ve a **Usuarios** y promueve a `tm.concon` a administrador,
   degradando al actual.
2. Cierra sesión. Entra como `admin.concon` (el antiguo administrador, ahora degradado).
3. Confirma **los tres puntos** que fallaban antes de la corrección:
   - El perfil dice «Trabajador Municipal», no «Administrador».
   - El badge del navbar no dice «Administrador».
   - La barra de administración no aparece.

- [ ] Los tres puntos se cumplen

---

## 6. Invitación a un SuperEvento: a quién le llega, y qué exige aceptar

Esto ejercita el fan-out de notificaciones (el aviso va solo a quien puede responderlo) y la
regla central del modelo: **aceptar obliga a aportar una emergencia**.

1. Entra como `tm.quilpue` (trabajador **sin** apoyo admin de Quilpué). Confirma que **no**
   tiene ningún aviso pendiente en el buzón.
2. Entra como `admin.quilpue`. Debe aparecer la notificación **«Invitación a un SuperEvento»**
   (Incendio forestal región de Valparaíso 2024) en el buzón, sin leer.
3. Haz clic en el enlace de la notificación: debe llevar a **`/supereventos`**, no al detalle
   de ningún centro.
4. Pulsa **Aceptar…**. Debe abrirse un segundo diálogo que **no** deja confirmar sin elegir
   una emergencia: o una existente sin SuperEvento (aquí, «Sistema frontal Quilpué»), o una
   nueva creada en ese mismo paso.
5. Elige la existente. Antes de confirmar, el diálogo debe mostrar **la lista exacta de
   centros que quedarán compartidos**. Como las activaciones de Quilpué están sueltas, la
   lista sale vacía y con una advertencia: es el comportamiento correcto, no un error.
6. Confirma. El estado de Quilpué pasa a «participando» y el tablero
   (`/supereventos/tablero`) se habilita.

- [ ] `tm.quilpue` no ve la invitación
- [ ] `admin.quilpue` sí la ve
- [ ] El enlace lleva a `/supereventos`, no a un centro
- [ ] No se puede aceptar sin aportar una emergencia
- [ ] La vista previa muestra qué centros se compartirán
- [ ] Al aceptar, el tablero se habilita

---

## 7. Gestión continua de los centros de una emergencia

Reemplaza a la antigua «vinculación masiva»: la pantalla ya no lista solo las activaciones
sueltas, sino **todas** las abiertas de la comuna con su estado frente a esa emergencia.

1. Entra como `admin.quilpue`. En **Emergencias**, abre **«Gestionar centros»** de «Sistema
   frontal Quilpué».
2. Deben verse los dos centros activos con estados distintos: `QUILP-C001` como **Rechazó** y
   `QUILP-C002` como **Pendiente**. Ese es justamente el dato que antes no existía.
3. Usa el filtro **«Rechazados»**: debe quedar solo `QUILP-C001`.
4. Selecciónalo y pulsa **«Invitar seleccionados»**. Su estado vuelve a **Pendiente** y sale
   un aviso nuevo para su encargado.
5. Selecciona `QUILP-C002` y pulsa **«Vincular seleccionados»**: entra de inmediato, sin
   preguntarle al encargado, y queda como **Participando**.

- [ ] Se ven los cuatro estados posibles, no solo "suelta o no"
- [ ] El filtro de rechazados funciona
- [ ] Reinvitar a un centro que rechazó lo devuelve a pendiente
- [ ] Vincular directo lo suma sin consultar

---

## 7b. Traslado de un centro entre emergencias

1. Como `admin` (Valparaíso), crea una emergencia nueva. El aviso de éxito debe decir a
   cuántos centros **sin emergencia** se convocó: los que ya están en la E1 no se tocan.
2. Abre **«Gestionar centros»** de esa emergencia nueva. `VALPO-C001` debe aparecer con la
   columna «Emergencia actual» apuntando a «Incendio forestal Valparaíso 2024».
3. Selecciónalo e invítalo. Debe salir una confirmación que **nombra la emergencia de
   origen** antes de enviar.
4. Revisa el aviso que le llega a su encargado: el mensaje debe advertir que aceptar
   **trasladará** el centro, no solo sumarlo.
5. Rechaza la invitación desde el encargado y confirma que `VALPO-C001` **sigue** en la E1:
   rechazar registra el rechazo, no desvincula.

- [ ] Crear una emergencia solo convoca a los centros sin emergencia
- [ ] La UI advierte el traslado antes de enviar
- [ ] El aviso al encargado nombra la emergencia de origen
- [ ] Rechazar no saca al centro de donde ya estaba

---

## 8. Tablero intercomunal, vista listado

1. Entra como `admin.vina`, ve a `/supereventos/tablero` y elige el SuperEvento «Incendio
   forestal región de Valparaíso 2024». Junto al selector debe verse el chip de nivel
   **Emergencia mayor**.
2. Deben aparecer los 2 centros activos de Valparaíso (`VALPO-C001` con 3 prioridades,
   `VALPO-C002` sin ninguna), cada uno etiquetado con la **emergencia** que lo aporta.
3. Filtra por **prioridad mínima: alta**. El contador debe pasar de «2 de 2» a «1 de 1».
4. Cambia el filtro de **comuna**: al elegir Valparaíso deben quedar los mismos 2; al elegir
   cualquier otra comuna, la lista queda vacía (Viña no comparte consigo misma).
5. Usa el filtro de **emergencia**: es nuevo, y permite mirar solo los centros que aporta una
   de las emergencias agrupadas.

- [ ] Los 2 centros de Valparaíso aparecen con sus prioridades correctas
- [ ] Cada centro muestra de qué emergencia proviene
- [ ] Los filtros de prioridad y de emergencia reducen el conteo correctamente

---

## 9. Tablero intercomunal, vista mapa

1. En la misma pantalla, alterna a **Mapa**. La URL debe pasar a `?vista=mapa` y mantenerse
   tras recargar la página.
2. Los pines deben aparecer coloreados por urgencia: `VALPO-C001` en rojo (tiene una prioridad
   alta), `VALPO-C002` en gris (sin prioridades).
3. Concede el permiso de ubicación del navegador: deben aparecer las distancias y habilitarse
   el orden por cercanía en el selector de filtros.
4. Al ordenar por cercanía, el primer centro debe coincidir en ambas vistas (mapa y listado).
5. Cierra el permiso de ubicación (o pruébalo en una pestaña nueva y recházalo): el tablero
   debe seguir funcionando, solo sin distancias.

> Nota de entorno: si usas un panel de navegador embebido, este puede dejar de instanciar
> mapas de Google tras varias cargas seguidas (le pasa también al mapa público). Si el mapa se
> queda en blanco sin errores en consola, prueba en una pestaña nueva o en un navegador normal.

- [ ] La alternancia y la URL funcionan
- [ ] Los colores de los pines son correctos
- [ ] Distancia y orden por cercanía aparecen al conceder ubicación
- [ ] Sin ubicación, el resto sigue funcionando

---

## 10. Ofrecer apoyo desde ambas vistas, y a dónde lleva el aviso

Esto ejercita la segunda corrección del fan-out (antes, `notify_support_offer` no fijaba
destinatario) y la del enlace (antes, llevaba al detalle del centro en vez de a la bandeja).

1. Como `admin.vina`, desde el **listado**, ofrece apoyo a `VALPO-C001` con un mensaje.
2. Confirma el aviso de éxito en pantalla.
3. Cierra sesión. Entra como `tito` (trabajador de Valparaíso, **sin** apoyo admin): confirma
   que **no** le llega ningún aviso de la oferta.
4. Entra como `martinalina` (trabajador de Valparaíso **con** apoyo admin): la notificación
   **«Ofrecimiento de apoyo de otra comuna»** debe estar en su buzón.
5. Haz clic en el enlace: debe llevar a **`/supereventos/ofertas`**, no al detalle de
   `VALPO-C001`.
6. Repite el ofrecimiento, esta vez desde la **vista de mapa**: clic en el pin de `VALPO-C002`,
   botón «Ofrecer apoyo» de la ficha emergente. Confirma que también llega el aviso.

- [ ] `tito` no recibe el aviso
- [ ] `martinalina` sí lo recibe
- [ ] El enlace lleva a la bandeja de ofertas, no al centro
- [ ] Ofrecer desde el mapa funciona igual que desde el listado

---

## 11. Aceptar y rechazar ofertas

1. Entra como `admin` (Valparaíso). En `/supereventos/ofertas`, bandeja **recibidas**, deben
   aparecer 2 ofertas de Viña: una `pending` (la sembrada, agua para `VALPO-C001`) y la que
   creaste en el paso anterior.
2. Acepta la oferta pendiente sembrada. Su estado debe pasar a `accepted`.
3. Entra como `admin.vina`, bandeja **enviadas**: la oferta debe verse como `accepted` también
   ahí (mismo estado en ambos lados).
4. Intenta cambiar el estado de una oferta que **no** te corresponde a ti (por ejemplo, entra
   como `admin.quilpue` y trata de aceptar una oferta entre Valparaíso y Viña vía la API): debe
   fallar. Esto ya lo cubre `scripts/validar_multitenant.sh`; aquí solo confirma que la UI ni
   siquiera te la muestra en ninguna bandeja.

- [ ] El estado se sincroniza para ambas comunas
- [ ] Una oferta ajena no aparece en tus bandejas

---

## 12. SuperEvento autocreado por una comuna

Este es el caso que motivó el modelo: una comuna que ya tenía su emergencia y decide
colaborar, sin rehacer nada.

1. Entra como `admin.vina`. En **SuperEventos**, confirma que «Aluvión Marga Marga» aparece
   con origen **«Creado por una comuna»** (no regional), nivel **Desastre**, y Viña
   participando con su emergencia «Aluvión quebrada Viña del Mar».
2. Confirma que Concón aparece **rechazada** y Valparaíso **invitada** en la lista de
   participantes.
3. Como Viña **participa pero no lo originó** el Super Admin, confirma que el botón
   **Invitar** está disponible: cualquier participante puede sumar comunas. En cambio
   **Cerrar** solo lo ofrece a la comuna que lo originó.
4. Cierra sesión y entra como `admin` (Valparaíso): debe tener la invitación pendiente en el
   buzón, y el aviso debe decir que **la comuna de Viña del Mar** lo invitó, no el Super
   Administrador.
5. Prueba ahora el autocreado completo: como `admin` en **Emergencias**, sobre una emergencia
   sin SuperEvento, pulsa **«Colaborar con otra comuna»**. El nombre debe venir prerrellenado
   con el de la emergencia, y hay que elegir un nivel. Al confirmar, la emergencia queda
   dentro del SuperEvento nuevo **sin haber movido ningún centro**.

- [ ] El SuperEvento se ve como originado por Viña, no por el Super Admin
- [ ] Concón aparece rechazada y Valparaíso invitada
- [ ] Una comuna participante no originaria puede invitar, pero no cerrar
- [ ] El aviso nombra a la comuna que invitó
- [ ] «Colaborar con otra comuna» envuelve la emergencia existente sin alterarla

---

## 13. Cierre: la emergencia y el SuperEvento no cierran lo mismo

Esta sección distingue dos cierres que antes se confundían.

1. **El SuperEvento ya cerrado.** Entra como `admin.vina`: el SE3 «Temporal agosto 2024»
   aparece como **Cerrado** aunque Viña participe y su emergencia E6 siga abierta con
   `VINA-C003` activo. Confirma que el tablero **no** lo ofrece como opción y que, forzando
   la petición, responde `SUPEREVENTO_CERRADO`. Confirma también que Viña **no** ve el centro
   de Concón que cuelga de ese mismo SuperEvento.
2. **Cerrar un SuperEvento vigente.** Como `superadmin`, cierra el SE1. El diálogo debe
   advertir que termina la colaboración para todas las comunas y aclarar que las emergencias
   locales siguen abiertas. Tras cerrarlo, el tablero queda vacío y no se pueden crear
   ofertas nuevas.
3. **Cerrar una emergencia local.** Como `admin`, cierra una emergencia de Valparaíso. El
   diálogo debe dejar claro que es un cambio interno de la comuna; si esa emergencia pertenece
   a un SuperEvento, debe decir que la colaboración termina al cerrar **el SuperEvento**, no
   la emergencia.

- [ ] El SuperEvento cerrado no comparte centros, aunque sus emergencias sigan abiertas
- [ ] Cerrar un SuperEvento vacía el tablero e impide ofertas nuevas
- [ ] Cerrar una emergencia local no corta la colaboración de las demás comunas

---

## 14. Aislamiento a la vista, dos sesiones en paralelo

1. Abre dos navegadores (o uno normal y una ventana privada).
2. En uno, entra como `admin` (Valparaíso); en el otro, como `admin.vina` (Viña).
3. En ambos, navega a la **misma URL de detalle de centro** que exista en tu propia comuna
   (por ejemplo, cada uno a su propio `VALPO-C001` / `VINA-C001`) y luego prueba forzar la URL
   del centro de la otra comuna a mano.
4. Confirma que cada sesión solo opera sobre sus propios centros, y que forzar la URL ajena
   da vacío o error — nunca datos de la otra comuna.

- [ ] Ninguna sesión puede leer ni editar centros de la otra comuna vía URL directa

---

## Cierre

Si las 15 secciones quedan marcadas y `scripts/validar_multitenant.sh` terminó en `TODO OK`
(45 comprobaciones), el multi-tenant queda validado de punta a punta: aislamiento de datos,
roles, colaboración intercomunal en ambos sentidos con SuperEventos, gestión continua de los
centros de cada emergencia, y notificaciones dirigidas a quien corresponde.
