#!/usr/bin/env bash
#
# validar_multitenant.sh — comprobaciones automáticas del aislamiento multi-tenant.
#
# Cubre lo que se puede afirmar sin mirar la pantalla: roles y RLS en la base,
# aislamiento por API, permisos por rol, colaboración intercomunal, continuidad
# funcional, canal público e higiene de sesión. Lo visual (mapa, badges, modales) va
# en docs/03_guion_de_validacion.md.
#
# Ninguna comprobación deja datos detrás. Las que ejercitan una escritura —permitida o
# prohibida— corren dentro de BEGIN … ROLLBACK, o se rechazan en el servicio antes de
# tocar la base; y la única que escribe de verdad (el alta de una municipalidad, que
# solo se puede acreditar creándola) borra lo que creó al terminar.
#
# Uso:
#   docker compose down -v && docker compose up -d
#   bash scripts/validar_multitenant.sh
#
# Requiere la pila levantada y la base RECIÉN RECREADA: varias comprobaciones son
# conteos absolutos sobre los datos sembrados.

set -uo pipefail

API="${API:-http://localhost:4000/api}"
PASS_CLAVE="${PASS_CLAVE:-12345}"

ok=0
fallos=0

# Intérprete de Python: el bash de Windows (WSL) suele traer solo `python3`, mientras
# que Git Bash / Windows suelen exponer `python`. Se usa el primero que exista.
PY_BIN=""
for _cand in python3 python py; do
  if command -v "$_cand" >/dev/null 2>&1 && "$_cand" -c 'import sys,json' >/dev/null 2>&1; then
    PY_BIN="$_cand"
    break
  fi
done
if [[ -z "$PY_BIN" ]]; then
  echo "  ABORTA  No se encontró un intérprete de Python (python3/python/py) para leer las respuestas JSON."
  exit 2
fi


verde()  { printf '\033[32m%s\033[0m' "$1"; }
rojo()   { printf '\033[31m%s\033[0m' "$1"; }

# afirmar <descripción> <valor obtenido> <valor esperado>
afirmar() {
  local desc="$1" obtenido="$2" esperado="$3"
  if [[ "$obtenido" == "$esperado" ]]; then
    echo "  $(verde PASS)  $desc | esperado: $esperado | obtenido: $obtenido"
    ok=$((ok + 1))
  else
    echo "  $(rojo FAIL)  $desc | esperado: $esperado | obtenido: $obtenido"
    fallos=$((fallos + 1))
  fi
}

psql_val() {
  docker compose exec -T db psql -U postgres -d appcopio_mt_db -tAc "$1" 2>/dev/null | tr -d '\r' | tr -d ' '
}

# Consulta como appcopio_app —el rol del backend, sujeto a RLS— con un tenant fijado.
# Cada -c es una sentencia dentro de la misma transacción, que es la única forma de
# que SET LOCAL siga vigente en la consulta siguiente.
# Uso: psql_tenant <municipality_id> <consulta>
psql_tenant() {
  docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAq \
    -c 'BEGIN' \
    -c "SELECT set_config('app.current_tenant', '$1', true)" \
    -c "$2" \
    -c 'COMMIT' 2>/dev/null | tr -d '\r ' | grep -v '^$' | tail -1
}

# Consulta como appcopio_app SIN fijar tenant. Fuera de un contexto de tenant, RLS no
# debe devolver ninguna fila de las tablas operativas: es la comprobación más directa
# de que el aislamiento no depende de que el backend recuerde filtrar.
psql_app_sin_tenant() {
  docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAc "$1" 2>/dev/null | tr -d '\r' | tr -d ' '
}

# Ejecuta una ESCRITURA que la base debe rechazar, como appcopio_app y con tenant fijado.
# Va dentro de BEGIN … ROLLBACK: aunque la política la dejara pasar, nada queda escrito
# —el ROLLBACK es justamente lo que hace segura la comprobación.
# Uso: psql_tenant_espera_error <municipality_id> <sentencia> <patrón esperado en el error>
psql_tenant_espera_error() {
  local salida
  salida=$(docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAq \
    -v ON_ERROR_STOP=0 \
    -c 'BEGIN' \
    -c "SELECT set_config('app.current_tenant', '$1', true)" \
    -c "$2" \
    -c 'ROLLBACK' 2>&1)
  if grep -qi "$3" <<<"$salida"; then echo "bloqueado"; else echo "FUGA"; fi
}

# Ejecuta varias sentencias como appcopio_app dentro de BEGIN … ROLLBACK y devuelve el
# resultado de la ÚLTIMA. Sirve para medir el efecto de una escritura (cuántas filas
# tocó, en qué estado quedó) sin dejarla escrita. El contexto se fija con set_config
# dentro del propio argumento: tenant con app.current_tenant, Super Administrador con
# app.is_superadmin = 'true'.
# Uso: psql_tx_val <sentencias>
psql_tx_val() {
  docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAq \
    -v ON_ERROR_STOP=0 \
    -c 'BEGIN' \
    -c "$1" \
    -c 'ROLLBACK' 2>&1 | tr -d '\r ' | grep -v '^$' | tail -1
}

# Ejecuta una escritura que la base debe PERMITIR, como appcopio_app y dentro de
# BEGIN … ROLLBACK. Es la hermana de psql_tenant_espera_error: sirve para acreditar que
# algo SÍ se puede hacer, sin dejar la fila escrita.
#
# Acepta varias sentencias en un solo argumento, lo que permite cambiar de tenant a
# mitad de la transacción: es la única forma de comprobar que dos comunas distintas
# pueden escribir el mismo valor sin colisionar entre sí.
# Uso: psql_espera_ok <sentencias>
psql_espera_ok() {
  local salida
  salida=$(docker compose exec -T db psql -U appcopio_app -d appcopio_mt_db -tAq \
    -v ON_ERROR_STOP=0 \
    -c 'BEGIN' \
    -c "$1" \
    -c 'ROLLBACK' 2>&1)
  if grep -qiE 'ERROR|no se pudo|violat' <<<"$salida"; then echo "rechazado"; else echo "permitido"; fi
}

token() {
  curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
    -d "{\"username\":\"$1\",\"password\":\"$PASS_CLAVE\"}" |
    "$PY_BIN" -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null
}

get() { curl -s "$API$2" -H "Authorization: Bearer $1"; }
codigo() { curl -s -o /dev/null -w "%{http_code}" "$API$2" -H "Authorization: Bearer $1"; }

# Petición SIN cabecera de autorización: así ve el sistema quien abre el mapa público.
get_publico() { curl -s "$API$1"; }

# Cuenta elementos de una respuesta JSON; devuelve 'no-lista' si no es un arreglo.
contar() { "$PY_BIN" -c "import sys,json
try:
    d=json.load(sys.stdin)
    print(len(d) if isinstance(d,list) else 'no-lista')
except Exception:
    print('no-json')"; }

echo
echo "=== Validación multi-tenant de AppCopio ==="
echo

# ----------------------------------------------------------
echo "Preparación"
# ----------------------------------------------------------
if ! docker compose ps --status running 2>/dev/null | grep -q db; then
  echo "  $(rojo ABORTA)  La base no está corriendo. Levanta la pila con: docker compose up -d"
  exit 2
fi

for _ in $(seq 1 45); do
  estado=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
    -H "Content-Type: application/json" -d '{"username":"x","password":"y"}')
  [[ "$estado" == "401" || "$estado" == "400" ]] && break
  sleep 4
done
afirmar "el backend responde" "$estado" "401"

# Conteos absolutos: si no calzan, la base trae datos de una sesión anterior.
centros_valpo=$(psql_val "SELECT COUNT(*) FROM Centers WHERE municipality_id = 1;")
if [[ "$centros_valpo" != "12" ]]; then
  echo "  $(rojo ABORTA)  La base no está recién sembrada (Valparaíso tiene $centros_valpo centros, se esperaban 12)."
  echo "                  Ejecuta: docker compose down -v && docker compose up -d"
  exit 2
fi
echo "  $(verde OK)    base recién sembrada"

T_VALPO=$(token admin)
T_VINA=$(token admin.vina)
T_QUILP=$(token admin.quilpue)
T_CONCO=$(token admin.concon)
T_SUPER=$(token superadmin)
T_TRAB=$(token tito)          # Trabajador Municipal de Valparaíso, sin apoyo admin
T_APOYO=$(token martinalina)  # Trabajador de Valparaíso CON es_apoyo_admin
T_CC=$(token carla.rojas)     # Contacto Ciudadano de Valparaíso (rol 3)

for par in "VALPO:$T_VALPO" "VINA:$T_VINA" "SUPER:$T_SUPER" "TRAB:$T_TRAB"; do
  if [[ -z "${par#*:}" ]]; then
    echo "  $(rojo ABORTA)  No se pudo iniciar sesión como ${par%%:*}"
    echo "                  Respuesta del backend al login:"
    curl -s -X POST "$API/auth/login" -H "Content-Type: application/json"       -d "{\"username\":\"admin\",\"password\":\"$PASS_CLAVE\"}" | head -c 300
    echo
    exit 2
  fi
done
echo "  $(verde OK)    sesiones iniciadas"
echo

# ----------------------------------------------------------
echo "Base de datos"
# ----------------------------------------------------------
afirmar "appcopio_app existe y no puede saltarse RLS" \
  "$(psql_val "SELECT rolsuper::text || ',' || rolbypassrls::text FROM pg_roles WHERE rolname = 'appcopio_app';")" \
  "false,false"

afirmar "el backend NO se conecta como superusuario" \
  "$(psql_val "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = 'appcopio_mt_db' AND usename = 'postgres' AND application_name NOT LIKE 'psql%';")" \
  "0"

afirmar "toda tabla con municipality_id tiene RLS habilitado y forzado" \
  "$(psql_val "
    SELECT COUNT(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                   WHERE col.table_name = c.relname AND col.column_name = 'municipality_id')
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity);")" \
  "0"

afirmar "sin contexto de tenant, Centers no devuelve ninguna fila" \
  "$(psql_app_sin_tenant 'SELECT COUNT(*) FROM Centers;')" "0"

afirmar "sin contexto de tenant, Persons no devuelve ninguna fila" \
  "$(psql_app_sin_tenant 'SELECT COUNT(*) FROM Persons;')" "0"

afirmar "RefreshTokens sigue sellada incluso con tenant fijado" \
  "$(psql_tenant 1 'SELECT COUNT(*) FROM RefreshTokens')" "0"

afirmar "ninguna notificación quedó sin destinatario" \
  "$(psql_val "SELECT COUNT(*) FROM CenterNotifications WHERE destinatary IS NULL;")" "0"

afirmar "ninguna notificación quedó sin kind" \
  "$(psql_val "SELECT COUNT(*) FROM CenterNotifications WHERE kind IS NULL;")" "0"

# Invariante del modelo de SuperEventos: toda emergencia es LOCAL de una comuna. Si
# alguna quedara sin dueña, el aislamiento de Emergencies dejaría de tener sentido.
afirmar "ninguna emergencia quedó sin comuna dueña" \
  "$(psql_val "SELECT COUNT(*) FROM Emergencies WHERE created_by_municipality_id IS NULL;")" "0"

# RNF5: las cuatro comunas conviven en UNA base y UN esquema. Es la comprobación
# observable de que incorporar una comuna no aprovisiona infraestructura.
afirmar "todas las comunas comparten un solo esquema" \
  "$(psql_val "SELECT COUNT(*) FROM information_schema.schemata
                WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast');")" \
  "1"

afirmar "y una sola base de datos" \
  "$(psql_val "SELECT COUNT(*) FROM pg_database WHERE datname LIKE 'appcopio%';")" "1"
echo

# ----------------------------------------------------------
echo "Aislamiento entre comunas"
# ----------------------------------------------------------
afirmar "Valparaíso ve sus 12 centros" "$(get "$T_VALPO" /centers | contar)" "12"
afirmar "Viña ve sus 3 centros"        "$(get "$T_VINA"  /centers | contar)" "3"

afirmar "ningún centro se cruza entre comunas" \
  "$("$PY_BIN" - <<PY
import json, subprocess
def ids(tok):
    out = subprocess.run(["curl","-s","$API/centers","-H",f"Authorization: Bearer {tok}"],
                         capture_output=True, text=True).stdout
    return {c["center_id"] for c in json.loads(out)}
print(len(ids("$T_VALPO") & ids("$T_VINA")))
PY
)" "0"

afirmar "Viña no puede leer un centro de Valparaíso" \
  "$(get "$T_VINA" /centers/VALPO-C001 | "$PY_BIN" -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print('FUGA' if isinstance(d,dict) and d.get('center_id') else 'sin-datos')
except Exception:
    print('sin-datos')")" \
  "sin-datos"

# El cuerpo vacío no basta: se comprueba además que la API responda 404 y no un 200
# con datos recortados en el frontend.
afirmar "el centro ajeno responde 404, no 200 con datos" \
  "$(codigo "$T_VINA" /centers/VALPO-C001)" "404"

afirmar "Viña no puede editar un centro de Valparaíso" \
  "$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/centers/VALPO-C001" \
      -H "Authorization: Bearer $T_VINA" -H "Content-Type: application/json" \
      -d '{"name":"intento de cambio"}' | grep -qE '200|204' && echo FUGA || echo bloqueado)" \
  "bloqueado"

afirmar "las personas de otra comuna no se filtran" \
  "$(psql_tenant 2 'SELECT COUNT(*) FROM Persons WHERE municipality_id = 1')" "0"

# RF3 es un requisito distinto de RF12: el de arriba cubre a los RESIDENTES de un
# centro, este cubre a los TRABAJADORES de la municipalidad. Cada comuna administra su
# propio padrón de cuentas, y ninguna cuenta aparece en dos comunas.
# Las dos respuestas se envuelven en un solo JSON para compararlas en un mismo proceso;
# evita archivos temporales, que no son portables entre el bash de Windows y el de Linux.
afirmar "ninguna cuenta de usuario se cruza entre comunas" \
  "$("$PY_BIN" -c "
import sys,json
d = json.load(sys.stdin)
a = {u['username'] for u in d['valpo']['users']}
b = {u['username'] for u in d['vina']['users']}
print(','.join(sorted(a & b)) if (a & b) else 'ninguno')" \
    <<<"{\"valpo\":$(get "$T_VALPO" /users),\"vina\":$(get "$T_VINA" /users)}")" \
  "ninguno"

afirmar "y cada comuna administra su propio padrón" \
  "$("$PY_BIN" -c "
import sys,json
d = json.load(sys.stdin)
print('si' if len(d['valpo']['users']) > 0 and len(d['vina']['users']) > 0 else 'no')" \
    <<<"{\"valpo\":$(get "$T_VALPO" /users),\"vina\":$(get "$T_VINA" /users)}")" \
  "si"
echo

# ----------------------------------------------------------
echo "Roles"
# ----------------------------------------------------------
afirmar "el Super Admin NO ve centros" "$(get "$T_SUPER" /centers | contar)" "0"

afirmar "el Super Admin sí ve las municipalidades" \
  "$(get "$T_SUPER" /municipalities | "$PY_BIN" -c "
import sys,json
d=json.load(sys.stdin)
print('varias' if isinstance(d,list) and len(d) >= 4 else 'insuficiente')")" \
  "varias"

afirmar "un Trabajador Municipal accede al tablero intercomunal" "$(codigo "$T_TRAB" /cross-support/board/1)" "200"
afirmar "un Trabajador CON apoyo admin también accede al tablero" "$(codigo "$T_APOYO" /cross-support/board/1)" "200"

# El Contacto Ciudadano no es personal municipal y el tablero expone centros de otras
# comunas, así que queda fuera aunque tenga sesión y su comuna participe.
afirmar "un Contacto Ciudadano NO accede al tablero" "$(codigo "$T_CC" /cross-support/board/1)" "403"

# La guarda de rol del servidor (crearGuardaAdmin) es una frontera distinta de RLS: aisla
# el ROL dentro de una misma comuna, no la comuna. Ver el tablero y redactar un borrador
# no habilita las acciones de gestión, y eso tiene que sostenerse sin pasar por la interfaz.
afirmar "un Trabajador sin apoyo no puede declarar una emergencia" \
  "$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/emergencies" \
      -H "Authorization: Bearer $T_TRAB" -H "Content-Type: application/json" \
      -d '{"name":"no deberia"}')" \
  "403"

afirmar "un Trabajador sin apoyo no puede resolver una oferta de su comuna" \
  "$(oferta=$(psql_val "SELECT offer_id FROM CrossMunicipalSupportOffers WHERE status = 'pending' LIMIT 1;")
     curl -s -o /dev/null -w "%{http_code}" -X PATCH "$API/cross-support/offers/$oferta" \
       -H "Authorization: Bearer $T_TRAB" -H "Content-Type: application/json" \
       -d '{"status":"accepted"}')" \
  "403"
echo

# ----------------------------------------------------------
echo "Catálogos compartidos y propios"
# ----------------------------------------------------------
# RF6: los catálogos base son compartidos (municipality_id NULL) y cada comuna puede
# extenderlos con ítems propios. Lo sostienen dos índices únicos PARCIALES por tabla:
# uno entre los registros globales y otro dentro de cada comuna.
afirmar "existen los índices que separan el catálogo global del propio" \
  "$(psql_val "SELECT COUNT(*) FROM pg_indexes
                WHERE tablename IN ('categories','products')
                  AND indexname IN ('categories_name_global_uq','categories_name_tenant_uq',
                                    'products_name_global_uq','products_name_tenant_uq');")" \
  "4"

# Las dos inserciones van en la MISMA transacción, cambiando de tenant entre medio: así
# la segunda se enfrenta de verdad a la primera. Si el índice fuera global, colisionarían.
afirmar "dos comunas pueden crear una categoría con el mismo nombre" \
  "$(psql_espera_ok "
      SELECT set_config('app.current_tenant', '1', true);
      INSERT INTO Categories (name, municipality_id) VALUES ('ZZ Prueba RF6', 1);
      SELECT set_config('app.current_tenant', '2', true);
      INSERT INTO Categories (name, municipality_id) VALUES ('ZZ Prueba RF6', 2);")" \
  "permitido"

# Pero el catálogo base sigue siendo único: nadie puede duplicar un nombre global.
afirmar "pero ninguna puede duplicar una categoría del catálogo base" \
  "$(psql_tenant_espera_error 1 \
      "INSERT INTO Categories (name, municipality_id)
         VALUES ((SELECT name FROM Categories WHERE municipality_id IS NULL ORDER BY name LIMIT 1), NULL)" \
      'categories_name_global_uq')" \
  "bloqueado"
echo

# ----------------------------------------------------------
echo "SuperEventos y colaboración"
# ----------------------------------------------------------
afirmar "el tablero del SE1 funciona en ambos sentidos" \
  "$(echo "$(get "$T_VALPO" /cross-support/board/1 | contar)/$(get "$T_VINA" /cross-support/board/1 | contar)")" \
  "2/2"

afirmar "una comuna que no participa recibe 403" "$(codigo "$T_CONCO" /cross-support/board/1)" "403"

# Lista BLANCA, no negra: se afirma que no hay ninguna clave FUERA de las autorizadas,
# en vez de que no estén siete nombres concretos. Es lo que el límite de confianza
# intermunicipal realmente promete, y no envejece si mañana se agrega un campo nuevo.
afirmar "el tablero expone exactamente los campos autorizados, y ninguno más" \
  "$(get "$T_VINA" /cross-support/board/1 | "$PY_BIN" -c "
import sys,json
permitidos = {'center_id','name','latitude','longitude','capacity','fullness_percentage',
              'operational_status','municipality_id','municipality_shortname',
              'activation_id','emergency_id','emergency_name','prioridades'}
d = json.load(sys.stdin)
extra = sorted({k for c in d for k in c} - permitidos)
print(','.join(extra) if extra else 'exacto')")" \
  "exacto"

afirmar "y cada necesidad declarada, solo ítem y prioridad" \
  "$(get "$T_VINA" /cross-support/board/1 | "$PY_BIN" -c "
import sys,json
permitidos = {'item_id','item_name','priority'}
d = json.load(sys.stdin)
extra = sorted({k for c in d for pr in c['prioridades'] for k in pr} - permitidos)
print(','.join(extra) if extra else 'exacto')")" \
  "exacto"

afirmar "Quilpué está invitada al SE1, no participando" \
  "$(psql_val "SELECT status FROM SuperEventParticipants WHERE super_event_id = 1 AND municipality_id = 3;")" \
  "invitada"

afirmar "sus prioridades NO se comparten mientras no acepte" \
  "$(get "$T_VALPO" /cross-support/board/1 | "$PY_BIN" -c "
import sys,json
print(sum(1 for c in json.load(sys.stdin) if c['municipality_shortname'] == 'QUILP'))")" \
  "0"

# El SE2 lo originó Viña y Quilpué no figura entre sus participantes, así que el INSERT
# choca con sep_write --que solo deja invitar al superadmin o a una comuna que ya esté
# 'participando' en ese SuperEvento-- y no con la clave primaria.
afirmar "una comuna no invitada no puede autoinscribirse en un SuperEvento ajeno" \
  "$(psql_tenant_espera_error 3 \
      "INSERT INTO SuperEventParticipants (super_event_id, municipality_id, status) VALUES (2, 3, 'participando')" \
      'row-level security')" \
  "bloqueado"

# Escalada de una comuna (camino 3): autocrear el SuperEvento e inscribirse en él.
#
# Son las DOS operaciones que fallaban. La primera moría en el RETURNING, que obliga a
# evaluar super_events_read cuando la fila de participante aún no existe; la segunda, en
# el bootstrap de sep_write, que exigía estar ya 'participando' para insertar la propia
# primera fila. Va con ROLLBACK, así que no deja SuperEvento detrás.
#
# Van como DOS sentencias, igual que createFromEmergency: dentro de un mismo CTE las
# sub-sentencias comparten snapshot y no ven los efectos de las otras, así que el
# INSERT de participante no encontraría el SuperEvento recién creado y esto fallaría
# por un motivo que no tiene nada que ver con las políticas.
afirmar "una comuna puede autocrear su SuperEvento e inscribirse (camino 3)" \
  "$(psql_espera_ok "
      SELECT set_config('app.current_tenant', '3', true);
      INSERT INTO SuperEvents (name, level, created_by_municipality_id)
        VALUES ('ZZ Escalada de prueba', 'mayor', 3);
      INSERT INTO SuperEventParticipants (super_event_id, municipality_id, status, responded_at)
        SELECT super_event_id, 3, 'participando', now()
          FROM SuperEvents WHERE name = 'ZZ Escalada de prueba';")" \
  "permitido"

afirmar "Quilpué tiene activaciones sueltas para vincular" \
  "$(get "$T_QUILP" /emergencies/activations/open | contar)" "2"

afirmar "las ofertas cubren los cinco estados del ciclo de vida" \
  "$(psql_val "SELECT COUNT(DISTINCT status) FROM CrossMunicipalSupportOffers;")" "5"

afirmar "Valparaíso ve 2 ofertas recibidas" \
  "$(get "$T_VALPO" "/cross-support/offers?box=recibidas" | contar)" "2"

afirmar "Valparaíso ve 3 ofertas enviadas (incluido su borrador)" \
  "$(get "$T_VALPO" "/cross-support/offers?box=enviadas" | contar)" "3"

afirmar "el borrador es invisible para la municipalidad destino" \
  "$(get "$T_VINA" "/cross-support/offers?box=recibidas" | contar)" "2"

# --- El cierre del SuperEvento revoca el acceso -------------------------------------
# El SE3 está cerrado en el sembrado, pero sus emergencias y sus activaciones siguen
# ABIERTAS: es justamente el caso que antes dejaba la colaboración viva indefinidamente.
afirmar "el SuperEvento cerrado conserva sus emergencias abiertas" \
  "$(psql_val "SELECT COUNT(*) FROM Emergencies WHERE super_event_id = 3 AND ended_at IS NULL;")" \
  "2"

afirmar "y aun así no comparte ningún centro" \
  "$(codigo "$T_VINA" /cross-support/board/3)" "409"

# La comprobación importante: la revocación vive en el MOTOR, no en una guarda de la
# aplicación. Viña participa del SE3 junto a Concón y aun así no ve sus centros.
afirmar "la revocación se aplica en el motor, no solo en la API" \
  "$(psql_tenant 2 "SELECT COUNT(*) FROM super_event_shared_center_ids() WHERE center_id LIKE 'CONCO%'")" \
  "0"

afirmar "un SuperEvento cerrado no admite ofertas nuevas" \
  "$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/cross-support/offers" \
      -H "Authorization: Bearer $T_VINA" -H "Content-Type: application/json" \
      -d '{"super_event_id":3,"target_center_id":"CONCO-C001","message":"tarde"}')" \
  "409"

# --- Reglas del modelo de SuperEventos ----------------------------------------------
# Aceptar no es un botón de "sí": la comuna debe aportar una emergencia, o el tablero
# mostraría participantes que no exponen nada.
afirmar "aceptar un SuperEvento sin aportar emergencia es rechazado" \
  "$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/super-events/1/respond" \
      -H "Authorization: Bearer $T_QUILP" -H "Content-Type: application/json" \
      -d '{"accept":true}')" \
  "400"

# Y la emergencia aportada tiene que ser suya: la 1 es de Valparaíso.
afirmar "ni se puede aportar la emergencia de otra comuna" \
  "$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/super-events/1/respond" \
      -H "Authorization: Bearer $T_QUILP" -H "Content-Type: application/json" \
      -d '{"accept":true,"emergency_id":1}')" \
  "404"

# Una comuna aporta A LO SUMO una emergencia por SuperEvento: Viña ya aporta la 2 al SE1,
# así que mover también la 4 debe chocar con el índice único parcial.
afirmar "una comuna solo aporta una emergencia por SuperEvento" \
  "$(psql_tenant_espera_error 2 \
      "UPDATE Emergencies SET super_event_id = 1 WHERE emergency_id = 4" \
      'emergencies_one_per_municipality_per_superevent_uq')" \
  "bloqueado"

# El Super Administrador no tiene comuna, y toda emergencia es local: no puede crearlas.
afirmar "el Super Administrador no puede crear emergencias" \
  "$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/emergencies" \
      -H "Authorization: Bearer $T_SUPER" -H "Content-Type: application/json" \
      -d '{"name":"no deberia"}')" \
  "403"

# La contracara del check de invitar (el siguiente): quien invita solo puede dejar a la
# otra comuna 'invitada'. Pasar a 'participando' es el consentimiento de ESA comuna y lo
# da ella con un UPDATE de su propia fila (sep_update). Concón no tiene fila en el SE1,
# así que el rechazo es de RLS y no de la clave primaria. Si falla en una base que no se
# recreó con `down -v`, es la política vieja: sep_write vive en la base, no en el .sql.
afirmar "una comuna participante no puede inscribir a otra como 'participando'" \
  "$(psql_tenant_espera_error 2 \
      "INSERT INTO SuperEventParticipants (super_event_id, municipality_id, status, invited_by_municipality_id)
         VALUES (1, 4, 'participando', 2)" \
      'row-level security')" \
  "bloqueado"

# Invitar ya no es privilegio de quien originó el SuperEvento. Viña participa del SE1
# sin haberlo creado (lo creó el Super Administrador) y aun así puede sumar comunas.
# Va contra la base y con ROLLBACK para no dejar invitada a Concón.
afirmar "una comuna participante no originaria puede invitar a otra" \
  "$(psql_espera_ok "
      SELECT set_config('app.current_tenant', '2', true);
      INSERT INTO SuperEventParticipants (super_event_id, municipality_id, status, invited_by_municipality_id)
      VALUES (1, 4, 'invitada', 2);")" \
  "permitido"

# --- Retiro de una comuna: ofertas, reinvitación y cierre ---------------------------
# Todo va contra la base con ROLLBACK, como appcopio_app y con el tenant que corresponde:
# el sembrado tiene que quedar intacto para lo que sigue. Las sentencias son las mismas
# que ejecuta el backend (retirarComuna, inviteMunicipalities).

# A. Al retirarse Valparaíso del SE1 se cancelan solas sus ofertas sin resolver: el
# borrador que ENVIÓ (origen_retirada) y la oferta pendiente que RECIBIÓ de Viña
# (destino_retirada). La aceptada y la rechazada son historial y no se tocan.
afirmar "al retirarse una comuna se cancelan sus ofertas sin resolver, enviadas y recibidas" \
  "$(psql_tx_val "
      SELECT set_config('app.current_tenant', '1', true);
      WITH c AS (
        UPDATE CrossMunicipalSupportOffers
           SET status = 'cancelled',
               cancel_reason = CASE WHEN from_municipality_id = 1
                                    THEN 'origen_retirada' ELSE 'destino_retirada' END
         WHERE super_event_id = 1 AND status IN ('draft', 'pending')
           AND (from_municipality_id = 1
                OR target_center_id IN (SELECT center_id FROM Centers WHERE municipality_id = 1))
        RETURNING cancel_reason)
      SELECT string_agg(cancel_reason, ',' ORDER BY cancel_reason) FROM c;")" \
  "destino_retirada,origen_retirada"

# Y el cierre queda marcado como automático: una cancelación hecha a mano deja
# cancel_reason en NULL, y eso es lo que las distingue.
afirmar "una oferta cancelada por un usuario no lleva motivo de cierre automático" \
  "$(psql_val "SELECT COUNT(*) FROM CrossMunicipalSupportOffers
                WHERE status = 'cancelled' AND cancel_reason IS NOT NULL;")" "0"

# El retiro de Viña deja fuera lo que no es suyo: una oferta ya aceptada no se cancela.
afirmar "el retiro no cancela las ofertas ya resueltas" \
  "$(psql_tx_val "
      SELECT set_config('app.current_tenant', '2', true);
      WITH c AS (
        UPDATE CrossMunicipalSupportOffers SET status = 'cancelled', cancel_reason = 'origen_retirada'
         WHERE super_event_id = 1 AND status IN ('draft', 'pending')
           AND (from_municipality_id = 2
                OR target_center_id IN (SELECT center_id FROM Centers WHERE municipality_id = 2))
        RETURNING offer_id)
      SELECT COUNT(*) FROM c;")" \
  "1"

# B. Reinvitar a una comuna que rechazó (Concón en el SE2) es solo del Super
# Administrador. Una comuna participante —Viña— no puede pisar esa fila: sep_update
# solo deja modificar la propia.
afirmar "una comuna no puede reinvitar a otra que ya rechazó" \
  "$(psql_tx_val "
      SELECT set_config('app.current_tenant', '2', true);
      WITH u AS (
        UPDATE SuperEventParticipants SET status = 'invitada', responded_at = NULL
         WHERE super_event_id = 2 AND municipality_id = 4 RETURNING 1)
      SELECT COUNT(*) FROM u;")" \
  "0"

reinvitar="INSERT INTO SuperEventParticipants
             (super_event_id, municipality_id, status, invited_by, invited_by_municipality_id)
           VALUES (2, %s, 'invitada', NULL, NULL)
           ON CONFLICT (super_event_id, municipality_id) DO UPDATE
             SET status = 'invitada', responded_at = NULL, invited_by_municipality_id = NULL
             WHERE SuperEventParticipants.status IN ('rechazada', 'retirada')
           RETURNING municipality_id"

afirmar "el Super Administrador reinvita a una comuna que rechazó" \
  "$(psql_tx_val "
      SELECT set_config('app.is_superadmin', 'true', true);
      WITH r AS ($(printf "$reinvitar" 4)) SELECT COUNT(*) FROM r;")" \
  "1"

afirmar "y también a una que se retiró" \
  "$(psql_tx_val "
      SELECT set_config('app.is_superadmin', 'true', true);
      UPDATE SuperEventParticipants SET status = 'retirada' WHERE super_event_id = 2 AND municipality_id = 2;
      WITH r AS ($(printf "$reinvitar" 2)) SELECT COUNT(*) FROM r;")" \
  "1"

afirmar "pero no pisa a una comuna que ya está participando" \
  "$(psql_tx_val "
      SELECT set_config('app.is_superadmin', 'true', true);
      WITH r AS ($(printf "$reinvitar" 2)) SELECT COUNT(*) FROM r;")" \
  "0"

afirmar "ni a una que sigue con la invitación pendiente" \
  "$(psql_tx_val "
      SELECT set_config('app.is_superadmin', 'true', true);
      WITH r AS ($(printf "$reinvitar" 1)) SELECT COUNT(*) FROM r;")" \
  "0"

# C. El SE2 lo originó Viña. Mientras participa puede cerrarlo; al retirarse pierde el
# control, aunque siga figurando como quien lo originó. El Super Administrador es la
# salida de emergencia, y una comuna que no lo originó nunca pudo.
cerrar_se2="WITH u AS (UPDATE SuperEvents SET ended_at = now() WHERE super_event_id = 2 RETURNING 1) SELECT COUNT(*) FROM u;"

afirmar "la comuna originaria participando puede cerrar su SuperEvento" \
  "$(psql_tx_val "SELECT set_config('app.current_tenant', '2', true); $cerrar_se2")" "1"

afirmar "la originaria que se retiró ya no puede cerrarlo" \
  "$(psql_tx_val "
      SELECT set_config('app.current_tenant', '2', true);
      UPDATE SuperEventParticipants SET status = 'retirada' WHERE super_event_id = 2 AND municipality_id = 2;
      $cerrar_se2")" "0"

afirmar "una comuna que no lo originó tampoco puede cerrarlo" \
  "$(psql_tx_val "SELECT set_config('app.current_tenant', '1', true); $cerrar_se2")" "0"

afirmar "el Super Administrador siempre puede cerrarlo" \
  "$(psql_tx_val "
      SELECT set_config('app.current_tenant', '2', true);
      UPDATE SuperEventParticipants SET status = 'retirada' WHERE super_event_id = 2 AND municipality_id = 2;
      SELECT set_config('app.is_superadmin', 'true', true);
      $cerrar_se2")" "1"

# --- Trazabilidad de lo compartido (RNF7) -------------------------------------------
afirmar "toda participación resuelta registra cuándo se respondió" \
  "$(psql_val "SELECT COUNT(*) FROM SuperEventParticipants
                WHERE status <> 'invitada' AND responded_at IS NULL;")" "0"

afirmar "toda oferta registra su comuna de origen y su fecha" \
  "$(psql_val "SELECT COUNT(*) FROM CrossMunicipalSupportOffers
                WHERE from_municipality_id IS NULL OR created_at IS NULL;")" "0"

afirmar "una comuna ajena no puede cambiar el estado de una oferta" \
  "$(oferta=$(psql_val "SELECT offer_id FROM CrossMunicipalSupportOffers WHERE status = 'pending' LIMIT 1;")
     curl -s -o /dev/null -w "%{http_code}" -X PATCH "$API/cross-support/offers/$oferta" \
       -H "Authorization: Bearer $T_QUILP" -H "Content-Type: application/json" \
       -d '{"status":"accepted"}' | grep -qE '200|204' && echo FUGA || echo bloqueado)" \
  "bloqueado"
echo

# ----------------------------------------------------------
echo "Notificaciones"
# ----------------------------------------------------------
afirmar "el admin de Valparaíso recibe la oferta y la invitación" \
  "$(get "$T_VALPO" /notifications/me | "$PY_BIN" -c "
import sys,json
print(','.join(sorted({n['kind'] for n in json.load(sys.stdin)})))")" \
  "super_event_invitation,support_offer"

afirmar "el apoyo admin recibe lo mismo que el admin" \
  "$(get "$T_APOYO" /notifications/me | "$PY_BIN" -c "
import sys,json
print(','.join(sorted({n['kind'] for n in json.load(sys.stdin)})))")" \
  "super_event_invitation,support_offer"

afirmar "el trabajador sin apoyo NO recibe avisos intercomunales" \
  "$(get "$T_TRAB" /notifications/me | contar)" "0"
echo

# ----------------------------------------------------------
echo "Continuidad funcional y canal público"
# ----------------------------------------------------------
# Los módulos heredados de la versión single-tenant deben seguir operando, ahora
# acotados al contexto de una comuna.
afirmar "el inventario de un centro sigue operando dentro de la comuna" \
  "$(codigo "$T_VALPO" /centers/VALPO-C001/inventory)" "200"

afirmar "el registro de residentes sigue operando dentro de la comuna" \
  "$(codigo "$T_VALPO" /centers/VALPO-C001/residents)" "200"

afirmar "las prioridades de necesidades siguen operando dentro de la comuna" \
  "$(codigo "$T_VALPO" /centers/VALPO-C001/priorities)" "200"

# El mapa público no lleva sesión: centers_public_read lo acota a centros activos, de
# todas las comunas. Los valores esperados se derivan de la base y no van fijos, así la
# comprobación no se rompe si cambian los datos semilla.
activos=$(psql_val "SELECT COUNT(*) FROM Centers WHERE is_active = TRUE;")
comunas_activas=$(psql_val "SELECT COUNT(DISTINCT municipality_id) FROM Centers WHERE is_active = TRUE;")

afirmar "el mapa público muestra exactamente los centros activos" \
  "$(get_publico /centers | contar)" "$activos"

# getAllCenters no devuelve municipality_id —el listado público no debe exponer más de
# lo necesario—, así que la comuna se deduce del prefijo del identificador.
afirmar "el mapa público cubre todas las comunas con centros activos" \
  "$(get_publico /centers | "$PY_BIN" -c "
import sys,json
print(len({c['center_id'].split('-')[0] for c in json.load(sys.stdin)}))")" \
  "$comunas_activas"

# Misma lista blanca que en el tablero: lo que importa no es que falten siete nombres
# concretos, sino que no aparezca nada fuera de lo que el canal anónimo debe mostrar.
afirmar "el mapa público expone exactamente los campos autorizados, y ninguno más" \
  "$(get_publico /centers | "$PY_BIN" -c "
import sys,json
permitidos = {'center_id','name','address','type','capacity','latitude','longitude',
              'is_active','operational_status','fullness_percentage','fullnessPercentage',
              'public_note'}
d = json.load(sys.stdin)
extra = sorted({k for c in d for k in c} - permitidos)
print(','.join(extra) if extra else 'exacto')")" \
  "exacto"
echo

# ----------------------------------------------------------
echo "Alta de una municipalidad nueva"
# ----------------------------------------------------------
# RF1 solo se puede acreditar creando una comuna: es la única comprobación del script
# que escribe de verdad. Va al final y borra lo que creó, de modo que la base queda
# como estaba para cualquier ejecución posterior.
RESP_MUNI=$(curl -s -X POST "$API/municipalities" \
  -H "Authorization: Bearer $T_SUPER" -H "Content-Type: application/json" \
  -d '{"name":"Comuna de Prueba","shortname":"ZZPRU",
       "admin":{"username":"zz.prueba","password":"'"$PASS_CLAVE"'","email":"zz@prueba.cl",
                "nombre":"Admin de Prueba","rut":"40.000.000-0"}}')

ID_MUNI=$("$PY_BIN" -c "
import sys,json
try:
    print(json.load(sys.stdin).get('municipality',{}).get('municipality_id',''))
except Exception:
    print('')" <<<"$RESP_MUNI")

afirmar "el Super Administrador da de alta una comuna sobre la instancia en marcha" \
  "$([[ -n "$ID_MUNI" ]] && echo creada || echo fallo)" "creada"

if [[ -n "$ID_MUNI" ]]; then
  # No hereda nada de nadie: parte vacía.
  afirmar "la comuna nueva parte sin centros propios" \
    "$(psql_val "SELECT COUNT(*) FROM Centers WHERE municipality_id = $ID_MUNI;")" "0"

  # Y su correlativo parte en 1, no continúa el de las demás.
  afirmar "su correlativo de centros parte de cero" \
    "$(psql_val "SELECT center_seq_counter FROM Municipalities WHERE municipality_id = $ID_MUNI;")" "0"

  # Su administrador queda atado a ella y a ninguna otra.
  afirmar "su administrador queda atado solo a esa comuna" \
    "$(psql_val "SELECT COUNT(*) FROM Users WHERE username = 'zz.prueba' AND municipality_id = $ID_MUNI AND role_id = 1;")" \
    "1"

  # Limpieza: la base queda exactamente como estaba antes de esta sección.
  psql_val "DELETE FROM Users WHERE municipality_id = $ID_MUNI;" >/dev/null
  psql_val "DELETE FROM Municipalities WHERE municipality_id = $ID_MUNI;" >/dev/null
  afirmar "y la comprobación no deja rastro en la base" \
    "$(psql_val "SELECT COUNT(*) FROM Municipalities WHERE municipality_id = $ID_MUNI;")" "0"
fi
echo

# ----------------------------------------------------------
echo "Higiene de sesión"
# ----------------------------------------------------------
afirmar "no quedan transacciones abiertas sin actividad" \
  "$(psql_val "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = 'appcopio_mt_db' AND state = 'idle in transaction';")" \
  "0"

afirmar "no hubo ningún intento de envío de correo" \
  "$(docker compose logs backend 2>/dev/null | grep -ciE 'sendMail|smtp.*enviad|correo enviado' | tr -d ' ')" \
  "0"
echo

# ----------------------------------------------------------
echo "=========================================="
if [[ $fallos -eq 0 ]]; then
  echo "$(verde "TODO OK") — $ok comprobaciones"
  exit 0
else
  echo "$(rojo "$fallos con FALLO") de $((ok + fallos)) comprobaciones"
  exit 1
fi
