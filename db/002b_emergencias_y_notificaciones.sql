-- ==========================================================
-- 002b: INVITACIONES A EMERGENCIAS + NOTIFICACIONES MUNICIPALES
--       + regla de un solo administrador activo por comuna
--
-- Corre después de 002a_multitenant_schema.sql y antes de 003_datos.sql
-- (orden alfabético: 002a_ < 002b_ < 003_). Las tablas siguen vacías acá.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. Estado de participación en una emergencia
--
--    Una comuna ya NO se auto-inscribe: se la invita (status 'invitada') y ella
--    acepta o rechaza. Tener fila en la tabla alcanza para LEER la emergencia
--    (así la comuna invitada puede ver a qué la invitan), pero la colaboración
--    real exige 'participando' (ver punto 5).
-- ----------------------------------------------------------

ALTER TABLE EmergencyParticipants
    ADD COLUMN status TEXT NOT NULL DEFAULT 'participando'
        CHECK (status IN ('invitada', 'participando', 'rechazada')),
    ADD COLUMN invited_by   INT REFERENCES Users(user_id) ON DELETE SET NULL,
    ADD COLUMN responded_at TIMESTAMPTZ;

COMMENT ON COLUMN EmergencyParticipants.status IS
  'invitada = pendiente de respuesta; participando = colabora y comparte prioridades; rechazada = declinó.';

-- ----------------------------------------------------------
-- 2. Un solo administrador ACTIVO por comuna
--
--    Para nombrar uno nuevo hay que degradar al actual a Trabajador Municipal
--    o desactivarlo. Los es_apoyo_admin no cuentan para el límite.
--
--    El índice se evalúa por sentencia (no es DEFERRABLE), así que el servicio
--    debe degradar/desactivar al actual ANTES de dar de alta al nuevo. Ambas
--    sentencias viven en la misma transacción del request (withTenant).
-- ----------------------------------------------------------

CREATE UNIQUE INDEX users_one_active_admin_per_municipality_uq
    ON Users (municipality_id)
    WHERE role_id = 1 AND is_active = TRUE AND municipality_id IS NOT NULL;

-- ----------------------------------------------------------
-- 3. Notificaciones dirigidas a una comuna (no a un centro)
--
--    CenterNotifications.center_id era NOT NULL, así que no podía alojar un
--    aviso dirigido a una municipalidad. Se relaja y se agrega destino
--    municipal en la MISMA tabla, para no duplicar el badge ni el polling
--    del frontend.
-- ----------------------------------------------------------

ALTER TABLE CenterNotifications
    ALTER COLUMN center_id DROP NOT NULL;

ALTER TABLE CenterNotifications
    ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id),
    -- Si viene, la UI renderiza los botones Aceptar / Rechazar de la invitación.
    ADD COLUMN emergency_id    INT REFERENCES Emergencies(emergency_id) ON DELETE CASCADE,
    -- Qué clase de aviso es. Sin esta columna la UI tenía que adivinarlo a partir de
    -- qué campos venían llenos, y tres avisos distintos comparten forma:
    --   invitación a la comuna  -> emergencia, sin centro
    --   invitación a un centro  -> emergencia + centro + activación
    --   ofrecimiento de apoyo   -> emergencia + centro, sin activación
    -- Adivinar mandaba el ofrecimiento al detalle del centro y hacía que el modal de
    -- invitación lo confundiera con una invitación de comuna.
    ADD COLUMN kind             TEXT,
    ADD CONSTRAINT centernotif_destino_chk
        CHECK (center_id IS NOT NULL OR municipality_id IS NOT NULL),
    ADD CONSTRAINT centernotif_kind_chk
        CHECK (kind IS NULL OR kind IN (
          'emergency_invitation',   -- invitación a la comuna
          'activation_invitation',  -- invitación a que un centro se sume
          'support_offer',          -- ofrecimiento de apoyo de otra comuna
          'volunteer_contact'       -- contacto de voluntariado (aviso de centro)
        ));

CREATE INDEX idx_centernotif_municipality ON CenterNotifications (municipality_id, event_at DESC);
CREATE INDEX idx_centernotif_emergency    ON CenterNotifications (emergency_id);

-- ----------------------------------------------------------
-- 4. RLS en CenterNotifications
--
--    Hasta ahora no tenía política (estaba en la lista de "Fase 2 pendiente").
--    Ahora transporta invitaciones intercomunales, así que se cierra: una
--    comuna solo ve lo dirigido a ella o a sus propios centros.
-- ----------------------------------------------------------

ALTER TABLE CenterNotifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE CenterNotifications FORCE ROW LEVEL SECURITY;

CREATE POLICY centernotif_tenant ON CenterNotifications
  USING (
    is_superadmin()
    OR municipality_id = current_tenant()
    OR center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant())
  )
  WITH CHECK (
    is_superadmin()
    OR municipality_id = current_tenant()
    OR center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant())
  );

-- ----------------------------------------------------------
-- 5. Políticas que cambian por el estado de participación
-- ----------------------------------------------------------

-- 5a. Prioridades compartidas entre comunas.
--
--     BUG DE 002a QUE SE CORRIGE ACÁ: la política original resolvía los centros
--     compartidos con una subconsulta directa sobre Centers y CentersActivations.
--     Esas tablas tienen RLS, así que la subconsulta solo veía centros de la PROPIA
--     comuna y la lectura intercomunal nunca devolvía nada. Se mueve a una función
--     SECURITY DEFINER, que es la única forma de resolver el conjunto compartido sin
--     quedar atrapada por el propio tenant.
--
--     Exige 'participando' en AMBOS lados: la comuna dueña del centro y la que lee.
--     Sin el filtro de status, una comuna recién invitada vería las prioridades
--     ajenas antes de responder la invitación.
CREATE OR REPLACE FUNCTION emergency_shared_center_ids()
RETURNS TABLE (center_id VARCHAR)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT DISTINCT c.center_id
  FROM Centers c
  JOIN CentersActivations ca
    ON ca.center_id = c.center_id AND ca.ended_at IS NULL
  JOIN EmergencyParticipants duena
    ON duena.emergency_id = ca.emergency_id
   AND duena.municipality_id = c.municipality_id
   AND duena.status = 'participando'
  JOIN EmergencyParticipants yo
    ON yo.emergency_id = ca.emergency_id
   AND yo.municipality_id = current_tenant()
   AND yo.status = 'participando'
  WHERE c.is_active = TRUE;
$$;

REVOKE ALL ON FUNCTION emergency_shared_center_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION emergency_shared_center_ids() TO appcopio_app;

DROP POLICY cip_intermunicipal_read ON CenterItemPriority;
CREATE POLICY cip_intermunicipal_read ON CenterItemPriority
  FOR SELECT
  USING (
    is_superadmin()
    OR center_id IN (SELECT s.center_id FROM emergency_shared_center_ids() s)
  );

-- 5a-bis. OTRO BUG DE 002a: CenterItemPriority solo tenía UNA política de SELECT,
--         la intercomunal. Es decir que una comuna no podía leer las prioridades de
--         sus PROPIOS centros salvo que estuvieran dentro de una emergencia activa.
--         Se agrega la lectura de tenant que faltaba.
CREATE POLICY cip_own_read ON CenterItemPriority
  FOR SELECT
  USING (center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()));

-- 5a-ter. El mapa público anuncia "centros activos y necesidades" y MapComponent.tsx
--         consume las prioridades sin sesión. La regla 6 del proyecto permite exponer
--         públicamente prioridades/avisos agregados, así que se restituye esa lectura,
--         acotada a centros activos. El inventario (cantidades) NO se expone.
CREATE POLICY cip_public_read ON CenterItemPriority
  FOR SELECT
  USING (
    is_public_context()
    AND center_id IN (SELECT c.center_id FROM Centers c WHERE c.is_active = TRUE)
  );

-- 5b. Ofertas de apoyo: mismo criterio.
DROP POLICY cmso_participant_read ON CrossMunicipalSupportOffers;
CREATE POLICY cmso_participant_read ON CrossMunicipalSupportOffers
  FOR SELECT
  USING (
    is_superadmin()
    OR emergency_id IN (
        SELECT ep.emergency_id FROM EmergencyParticipants ep
        WHERE ep.municipality_id = current_tenant()
          AND ep.status = 'participando'
    )
  );

-- 5c. Alta de participantes: solo invita el superadmin o la comuna que declaró
--     la emergencia.
--
--     La política anterior permitía `municipality_id = current_tenant()`, es decir
--     que una comuna se insertara sola en CUALQUIER emergencia adivinando su id:
--     las verificaciones de clave foránea de Postgres ignoran RLS, así que ni
--     siquiera necesitaba poder leerla. Aceptar una invitación ahora es un UPDATE
--     de status (5d), no un INSERT.
DROP POLICY emergency_participants_write ON EmergencyParticipants;
CREATE POLICY emergency_participants_write ON EmergencyParticipants
  FOR INSERT
  WITH CHECK (
    is_superadmin()
    OR emergency_id IN (
        SELECT e.emergency_id FROM Emergencies e
        WHERE e.created_by_municipality_id = current_tenant()
    )
  );

-- 5c-bis. Quiénes participan en una emergencia.
--
--         La política de lectura de EmergencyParticipants solo deja ver la fila propia,
--         así que una comuna no puede saber con quién está colaborando ni cuántas
--         comunas hay: un COUNT devuelve siempre 1. No se puede arreglar ampliando la
--         política, porque consultar la misma tabla dentro de su propia política provoca
--         "infinite recursion detected in policy". Va por SECURITY DEFINER, y solo
--         responde si quien pregunta participa de esa emergencia (o es superadmin).
CREATE OR REPLACE FUNCTION emergency_participants_of(p_emergency_id INT)
RETURNS TABLE (municipality_id INT, name TEXT, shortname TEXT, status TEXT,
               joined_at TIMESTAMPTZ, responded_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT ep.municipality_id, m.name::TEXT, m.shortname::TEXT, ep.status,
         ep.joined_at, ep.responded_at
  FROM EmergencyParticipants ep
  JOIN Municipalities m ON m.municipality_id = ep.municipality_id
  WHERE ep.emergency_id = p_emergency_id
    AND (
      is_superadmin()
      OR EXISTS (
        SELECT 1 FROM EmergencyParticipants yo
        WHERE yo.emergency_id = p_emergency_id
          AND yo.municipality_id = current_tenant()
      )
    )
  ORDER BY m.name;
$$;

REVOKE ALL ON FUNCTION emergency_participants_of(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION emergency_participants_of(INT) TO appcopio_app;

-- 5d. Responder la invitación: cada comuna cambia el estado de su propia fila.
CREATE POLICY emergency_participants_update ON EmergencyParticipants
  FOR UPDATE
  USING (is_superadmin() OR municipality_id = current_tenant())
  WITH CHECK (is_superadmin() OR municipality_id = current_tenant());

-- ----------------------------------------------------------
-- 6. Permisos para el rol de aplicación sobre lo nuevo
--    (los GRANT de 002a corrieron antes de que existieran estas columnas;
--     las columnas heredan el grant de la tabla, pero se re-aplica por si acaso)
-- ----------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appcopio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appcopio_app;
