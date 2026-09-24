# Guion de demo — AppCopio Multi-tenant (≈10 min)

## Contexto
Mañana hay demo en vivo para el profesor: mostrar que el multi-tenant está implementado y funcionando
(aislamiento por comuna, emergencias locales, invitación de centros, escalamiento a SuperEvento,
colaboración intercomunal y rol del Super Administrador). Este guion se armó a partir de lo que
realmente siembran `db/003_datos.sql` y `db/005_datos_validacion.sql` y de los botones reales de
la UI. Es una **historia continua**: cada paso deja el estado listo para el siguiente.

Entregable: este guion (opcionalmente guardarlo como `docs/05_guion_demo.md`).

---

## Preparación (antes de la clase, ~5 min, NO se muestra)

```bash
docker compose down -v && docker compose up -d
bash scripts/validar_multitenant.sh     # debe terminar en TODO OK
```

- Contraseña de **todas** las cuentas: `12345`.
- Abre **dos ventanas separadas** (sesiones distintas → cero logouts de más):
  - **Ventana A** (navegador normal): lado **Valparaíso** + superadmin.
  - **Ventana B** (incógnito u otro navegador): lado **Viña / Quilpué**.
- Usa un navegador normal, no un panel embebido (los mapas de Google a veces no cargan ahí).
- Ensaya el guion una vez completo y **vuelve a resetear** con `docker compose down -v && up`
  antes de la clase (la demo crea datos: emergencia nueva, SuperEvento nuevo, ofertas).

| Cuenta | Comuna | Rol en la demo |
|---|---|---|
| `admin` | Valparaíso | Admin que crea la emergencia y escala a SuperEvento |
| `tito` | Valparaíso | Encargado de `VALPO-C003` (acepta la invitación del centro) |
| `admin.vina` | Viña del Mar | Comuna colaboradora (tablero + ofertas) |
| `admin.quilpue` | Quilpué | Comuna invitada a un SuperEvento |
| `superadmin` | — | Super Administrador |

---

## 0:00 – 0:45 · Intro + mapa público
**Decir:** "AppCopio pasó de una sola municipalidad a varias en la misma BD. Cada tabla con datos
de comuna tiene `municipality_id` y PostgreSQL aplica Row-Level Security: la aislación la hace la
base de datos, no solo el frontend."

- Ventana A, sin login → `/map`: se ven centros de **4 comunas** (Valparaíso, Viña, Quilpué,
  Concón). Abrir una ficha: solo ubicación, capacidad, % llenado y estado — nada de personas.

## 0:45 – 1:45 · Aislamiento por comuna
- **A:** login `admin` → badge **«Valparaíso»** en navbar → *Mis Centros*: 12 centros `VALPO-…`.
- **B:** login `admin.vina` → badge **«Viña del Mar»** → *Mis Centros*: solo 3 `VINA-…`.
- En B, pegar a mano la URL de un centro de Valparaíso (`/center/VALPO-C001/details`) →
  vacío/error, nunca datos. **Decir:** "Aunque el frontend fallara, RLS no devuelve filas ajenas."

## 1:45 – 3:15 · Crear emergencia local e invitar centros
- **A (`admin`)** → *Emergencias* → **Nueva emergencia** (ej. «Temporal Valparaíso demo», tipo temporal).
- Mostrar el aviso: "Se convocó a 1 centro sin emergencia" (`VALPO-C003`). **Decir:** "Crear la
  emergencia invita automáticamente a los centros activos que no están en otra; los que ya están
  en la emergencia del incendio no se tocan."
- **Gestionar centros** de la emergencia nueva: tabla con estado de invitación por centro
  (Pendiente / Participando / Rechazó / Sin invitar) y columna «Emergencia actual».
  Mencionar los dos caminos: **Invitar** (pregunta al encargado) vs **Vincular** (lo suma directo).
- **A:** cerrar sesión → login `tito` (encargado de `VALPO-C003`) → aparece el **aviso en
  pantalla** de invitación → **Aceptar**. (Si no aparece al instante, recargar: sondea cada 30 s.)
- **A:** volver a `admin` → *Emergencias*: la emergencia ahora tiene **1 centro**.

## 3:15 – 4:30 · La emergencia escala → crear un SuperEvento
**Decir:** "Cuando la emergencia sobrepasa a la comuna, se envuelve en un SuperEvento para
colaborar con otras. No se mueve ni rehace nada."
- **A (`admin`)** → *Emergencias* → en la emergencia nueva, **Colaborar con otra comuna** →
  nombre prerrellenado, elegir **Nivel** → confirmar. La columna SuperEvento ya lo muestra.
- *SuperEventos* (`/supereventos`): aparece el nuevo con Valparaíso participando.
  **Invitar** → marcar **Concón** → enviar (solo para mostrar la invitación; no se acepta).
- Mostrar de paso los SuperEventos precargados: «Incendio forestal región de Valparaíso 2024»
  (regional, del superadmin), «Aluvión Marga Marga» (creado por Viña) y uno **Cerrado**.

## 4:30 – 6:15 · Unirse a un SuperEvento (asignando una emergencia)
- **B:** cerrar sesión de Viña → login `admin.quilpue`. Aparece el aviso de **Invitación a un
  SuperEvento** (Incendio forestal región 2024) → **Más tarde** por ahora.
- *Emergencias* → **Gestionar centros** de «Sistema frontal Quilpué»: `QUILP-C001` **Rechazó**,
  `QUILP-C002` **Pendiente**. Seleccionar `QUILP-C002` → **Vincular seleccionados** → Participando.
- Ir a *SuperEventos* (o la campana de notificaciones → lleva a `/supereventos`) →
  **Aceptar…** la invitación. **Decir:** "Aceptar obliga a aportar una emergencia de la comuna:
  una existente o una nueva."
  - Elegir **«Sistema frontal Quilpué»** → el diálogo muestra **la lista exacta de centros que se
    compartirán** (`QUILP-C002`) → confirmar. Estado: **participando**.

## 6:15 – 8:15 · Colaboración dentro del SuperEvento
- **B:** cerrar sesión → login `admin.vina` → *SuperEventos* → **Tablero intercomunal** → elegir
  «Incendio forestal región de Valparaíso 2024» (chip de nivel *Emergencia mayor*).
  - Se ven los centros de Valparaíso **y ahora el de Quilpué** que acaba de entrar, cada uno con
    la emergencia que lo aporta, % de ocupación y **necesidades/prioridades**.
  - Filtro de prioridad mínima (alta) y cambio a vista **Mapa** (pines por urgencia).
  - **Decir (regla clave):** "Solo cruza ubicación, capacidad, ocupación, estado y necesidades
    agregadas. Personas, familias e inventario nunca salen de la comuna, ni en colaboración."
  - **Ofrecer apoyo** a `VALPO-C001` con un mensaje (ej. "Tenemos 200 L de agua").
- **A (`admin`)** → campana: «Ofrecimiento de apoyo de otra comuna» → el enlace lleva a
  **Ofertas** (`/supereventos/ofertas`) → bandeja **recibidas** → **Aceptar** la oferta.
- (Opcional, 15 s) **B** → *Ofertas* → **enviadas**: la misma oferta aparece como aceptada.
  **Decir:** "La lectura entre comunas es solo `SELECT`; cada comuna escribe únicamente lo suyo."

## 8:15 – 9:30 · Super Administrador
- **A:** cerrar sesión → login `superadmin`. El menú **no tiene acceso a centros** (no pertenece a
  ninguna comuna).
- **Municipalidades**: las 4 comunas; abrir una → ver/cambiar su administrador. Mencionar que
  desde aquí se da de alta una comuna nueva, que parte vacía.
- **SuperEventos** (vista global): todos los SuperEventos, su origen (regional vs creado por una
  comuna), nivel, estado y nº de comunas. Acciones: **Nuevo SuperEvento**, **Invitar**,
  **Agrupar** (sección «Emergencias sin SuperEvento»: agrupa emergencias sueltas de varias
  comunas de una vez) y **Cerrar**.
- Final: **Cerrar** «Incendio forestal región de Valparaíso 2024» → el diálogo avisa que termina la
  colaboración para todas las comunas pero las emergencias locales siguen abiertas.
- **B (`admin.vina`)** → recargar el Tablero: ese SuperEvento ya **no aparece**; no se comparte nada.

## 9:30 – 10:00 · Cierre
**Decir:** "Resumen: una BD compartida, aislamiento forzado por RLS con un rol de aplicación sin
privilegios; emergencias locales por comuna; SuperEventos para colaborar sin exponer datos
sensibles; y un Super Admin que gobierna comunas y SuperEventos sin tocar los centros. Además hay
un script automatizado (`scripts/validar_multitenant.sh`) con 45 comprobaciones que pasan."

---

## Plan B (si algo falla en vivo)
- Aviso de invitación no aparece → recargar o ir a la campana / `/notifications`.
- Mapa en blanco → usar la vista **Listado** del tablero; seguir.
- Se agotó el tiempo → saltar "Invitar a Concón" (paso 3:15) y la bandeja *enviadas* (paso 6:15).
- Estado sucio por un ensayo → `docker compose down -v && docker compose up -d` (~1 min).

## Verificación
Ensayar el guion completo una vez con cronómetro tras un reset limpio, confirmando cada resultado
esperado indicado arriba (se apoya en las secciones 1, 2, 4, 6, 7, 7b, 8–13 de
`docs/03_guion_de_validacion.md`, ya validadas); luego resetear de nuevo antes de la clase.
