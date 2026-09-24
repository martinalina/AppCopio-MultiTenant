-- ==========================================================
-- 002b: NOTIFICACIONES MUNICIPALES + regla de un solo administrador activo
--       + las lecturas propia y pública de CenterItemPriority
--
-- Corre después de 002a_multitenant_schema.sql y antes de 003_datos.sql
-- (orden alfabético: 002a_ < 002b_ < 003_). Las tablas siguen vacías acá.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. Un solo administrador ACTIVO por comuna
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
-- 2. Notificaciones dirigidas a una comuna (no a un centro)
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
    -- Emergencia LOCAL a la que se refiere el aviso: la usa 'activation_invitation'
    -- para que el encargado sepa a qué se le está invitando. La columna equivalente
    -- para los SuperEventos (super_event_id) la agrega 002d.
    ADD COLUMN emergency_id    INT REFERENCES Emergencies(emergency_id) ON DELETE CASCADE,
    -- Qué clase de aviso es. Sin esta columna la UI tenía que adivinarlo a partir de
    -- qué campos venían llenos, y tres avisos distintos comparten forma:
    --   invitación a la comuna  -> superevento, sin centro
    --   invitación a un centro  -> emergencia + centro + activación
    --   ofrecimiento de apoyo   -> superevento + centro, sin activación
    -- Adivinar mandaba el ofrecimiento al detalle del centro y hacía que el modal de
    -- invitación lo confundiera con una invitación de comuna.
    ADD COLUMN kind             TEXT,
    ADD CONSTRAINT centernotif_destino_chk
        CHECK (center_id IS NOT NULL OR municipality_id IS NOT NULL),
    ADD CONSTRAINT centernotif_kind_chk
        CHECK (kind IS NULL OR kind IN (
          'super_event_invitation', -- invitación de una comuna a un SuperEvento
          'activation_invitation',  -- invitación a que un centro se sume a una emergencia
          'support_offer',          -- ofrecimiento de apoyo de otra comuna
          'volunteer_contact'       -- contacto de voluntariado (aviso de centro)
        ));

CREATE INDEX idx_centernotif_municipality ON CenterNotifications (municipality_id, event_at DESC);
CREATE INDEX idx_centernotif_emergency    ON CenterNotifications (emergency_id);

-- ----------------------------------------------------------
-- 3. RLS en CenterNotifications
--
--    001_tablas.sql la crea sin política. Como transporta invitaciones
--    intercomunales, se cierra: una comuna solo ve lo dirigido a ella o a sus
--    propios centros.
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
-- 4. Lecturas de CenterItemPriority
--
--    La lectura INTERCOMUNAL de esta tabla no está acá: vive en 002d, porque
--    necesita resolver el conjunto de centros compartidos con una función
--    SECURITY DEFINER sobre SuperEvents, que todavía no existe en este script.
-- ----------------------------------------------------------

-- 4a. La lectura de la propia comuna. Parece obvia, pero faltaba: en el primer
--     diseño la única política de SELECT era la intercomunal, así que una comuna
--     no podía leer las prioridades de sus PROPIOS centros salvo que estuvieran
--     dentro de una emergencia activa.
CREATE POLICY cip_own_read ON CenterItemPriority
  FOR SELECT
  USING (center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()));

-- 4b. El mapa público anuncia "centros activos y necesidades" y MapComponent.tsx
--     consume las prioridades sin sesión. La regla 6 del proyecto permite exponer
--     públicamente prioridades/avisos agregados, así que se habilita esa lectura,
--     acotada a centros activos. El inventario (cantidades) NO se expone.
CREATE POLICY cip_public_read ON CenterItemPriority
  FOR SELECT
  USING (
    is_public_context()
    AND center_id IN (SELECT c.center_id FROM Centers c WHERE c.is_active = TRUE)
  );

-- ----------------------------------------------------------
-- 5. Permisos para el rol de aplicación sobre lo nuevo
--    (los GRANT de 002a corrieron antes de que existieran estas columnas;
--     las columnas heredan el grant de la tabla, pero se re-aplica por si acaso)
-- ----------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appcopio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appcopio_app;
