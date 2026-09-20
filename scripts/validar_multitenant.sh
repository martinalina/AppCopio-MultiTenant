#!/usr/bin/env bash
#
# validar_multitenant.sh — comprobaciones automáticas del aislamiento multi-tenant.
#
# Cubre lo que se puede afirmar sin mirar la pantalla: roles y RLS en la base,
# aislamiento por API, permisos por rol, gobernanza de administración, colaboración
# intercomunal, continuidad funcional, canal público e higiene de sesión. Lo visual
# (mapa, badges, modales) va en docs/03_guion_de_validacion.md.
#
# Ninguna comprobación deja escrituras: las dos que ejercitan una escritura prohibida
# corren dentro de BEGIN … ROLLBACK, y el relevo de administrador se rechaza en el
# servicio antes de tocar la base.
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

afirmar "un Trabajador sin apoyo no accede al tablero" "$(codigo "$T_TRAB" /cross-support/board/1)" "403"
afirmar "un Trabajador CON apoyo sí accede al tablero" "$(codigo "$T_APOYO" /cross-support/board/1)" "200"
echo

# ----------------------------------------------------------
echo "Gobernanza de administración"
# ----------------------------------------------------------
# Concón (comuna 4) tiene a admin.concon como administrador vigente y a tm.concon como
# Trabajador Municipal. Nombrar a tm.concon sin liberar antes el puesto debe fallar.
ID_TM_CONCON=$(psql_val "SELECT user_id FROM Users WHERE username = 'tm.concon';")

# replaceMunicipalityAdmin lanza ADMIN_ACTUAL_REQUIERE_ACCION antes de ejecutar ningún
# UPDATE, así que esta llamada no modifica la base.
afirmar "no se puede nombrar un segundo Administrador sin liberar el puesto" \
  "$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/municipalities/4/admin" \
      -H "Authorization: Bearer $T_SUPER" -H "Content-Type: application/json" \
      -d "{\"promover_user_id\":$ID_TM_CONCON}")" \
  "409"

# El relevo con degradación/desactivación es un flujo del panel de plataforma: un
# administrador municipal no puede ejecutarlo ni siquiera sobre su propia comuna.
afirmar "el relevo de administrador es exclusivo del Super Administrador" \
  "$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/municipalities/4/admin" \
      -H "Authorization: Bearer $T_CONCO" -H "Content-Type: application/json" \
      -d "{\"promover_user_id\":$ID_TM_CONCON}")" \
  "403"

# Y la regla se sostiene aunque se salte la aplicación por completo.
afirmar "el índice único impide un segundo Administrador aunque se salte la aplicación" \
  "$(psql_tenant_espera_error 4 \
      "UPDATE Users SET role_id = 1 WHERE username = 'tm.concon'" \
      'users_one_active_admin_per_municipality_uq')" \
  "bloqueado"
echo

# ----------------------------------------------------------
echo "Emergencias y colaboración"
# ----------------------------------------------------------
afirmar "el tablero de la E1 funciona en ambos sentidos" \
  "$(echo "$(get "$T_VALPO" /cross-support/board/1 | contar)/$(get "$T_VINA" /cross-support/board/1 | contar)")" \
  "2/2"

afirmar "una comuna que no participa recibe 403" "$(codigo "$T_CONCO" /cross-support/board/1)" "403"

afirmar "el tablero no expone datos sensibles" \
  "$(get "$T_VINA" /cross-support/board/1 | "$PY_BIN" -c "
import sys,json
prohibidos = {'persons','families','family_groups','inventory','quantity','rut','personas'}
d = json.load(sys.stdin)
filtrados = sorted({k for c in d for k in c} & prohibidos)
print(','.join(filtrados) if filtrados else 'limpio')")" \
  "limpio"

afirmar "Quilpué está invitada a la E1, no participando" \
  "$(psql_val "SELECT status FROM EmergencyParticipants WHERE emergency_id = 1 AND municipality_id = 3;")" \
  "invitada"

afirmar "sus prioridades NO se comparten mientras no acepte" \
  "$(get "$T_VALPO" /cross-support/board/1 | "$PY_BIN" -c "
import sys,json
print(sum(1 for c in json.load(sys.stdin) if c['municipality_shortname'] == 'QUILP'))")" \
  "0"

# La E3 la declaró Viña y Quilpué no figura entre sus participantes, así que el INSERT
# choca con emergency_participants_write (solo inscribe el superadmin o la comuna que
# declaró la emergencia) y no con la clave primaria.
afirmar "una comuna no invitada no puede autoinscribirse en una emergencia ajena" \
  "$(psql_tenant_espera_error 3 \
      "INSERT INTO EmergencyParticipants (emergency_id, municipality_id, status) VALUES (3, 3, 'participando')" \
      'row-level security')" \
  "bloqueado"

afirmar "Quilpué tiene activaciones sueltas para vincular en la E2" \
  "$(get "$T_QUILP" /emergencies/activations/open | contar)" "2"

afirmar "las cuatro ofertas están en los cuatro estados" \
  "$(psql_val "SELECT COUNT(DISTINCT status) FROM CrossMunicipalSupportOffers;")" "4"

afirmar "Valparaíso ve 2 ofertas recibidas" \
  "$(get "$T_VALPO" "/cross-support/offers?box=recibidas" | contar)" "2"

afirmar "Valparaíso ve 2 ofertas enviadas" \
  "$(get "$T_VALPO" "/cross-support/offers?box=enviadas" | contar)" "2"

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
  "emergency_invitation,support_offer"

afirmar "el apoyo admin recibe lo mismo que el admin" \
  "$(get "$T_APOYO" /notifications/me | "$PY_BIN" -c "
import sys,json
print(','.join(sorted({n['kind'] for n in json.load(sys.stdin)})))")" \
  "emergency_invitation,support_offer"

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

afirmar "el mapa público no expone datos sensibles" \
  "$(get_publico /centers | "$PY_BIN" -c "
import sys,json
prohibidos = {'persons','families','family_groups','inventory','quantity','rut','personas'}
d = json.load(sys.stdin)
filtrados = sorted({k for c in d for k in c} & prohibidos)
print(','.join(filtrados) if filtrados else 'limpio')")" \
  "limpio"
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
