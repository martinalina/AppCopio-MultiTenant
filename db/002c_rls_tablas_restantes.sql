-- ==========================================================
-- 002c: RLS PARA LAS TABLAS RESTANTES + POLÍTICAS DE LAS OFERTAS DE APOYO
--
-- Cierra el hueco declarado en la migración: 16 tablas sin política de
-- seguridad a nivel de fila. No filtraban datos a través de consultas que
-- se unen a sus tablas padre (que sí están protegidas), pero una consulta
-- aislada sobre ellas no estaba restringida — y al menos una lo estaba
-- explotando sin querer (getAllResourceBoxes no filtraba nada).
--
-- Corre después de 002b y antes de 003_datos.sql.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. Triggers de herencia de comuna
--
--    Las tablas hoja de más volumen reciben su propia columna
--    municipality_id en vez de resolverla por subconsulta en cada lectura.
--    Un trigger la rellena desde el padre, de modo que NINGÚN INSERT de la
--    aplicación necesita cambiar.
--
--    Corren como INVOCADOR a propósito (no SECURITY DEFINER): la consulta al
--    padre pasa por RLS, así que si el centro no es de tu comuna la
--    subconsulta devuelve NULL y el NOT NULL rechaza la fila. El aislamiento
--    de escritura se aplica solo.
--
--    Solo asignan si el valor viene NULL, para permitir un valor explícito
--    (mismo criterio que generate_center_id).
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION heredar_comuna_de_centro() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.municipality_id IS NULL THEN
    NEW.municipality_id := (
      SELECT c.municipality_id FROM Centers c WHERE c.center_id = NEW.center_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION heredar_comuna_de_activacion() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.municipality_id IS NULL THEN
    NEW.municipality_id := (
      SELECT ca.municipality_id FROM CentersActivations ca
       WHERE ca.activation_id = NEW.activation_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION heredar_comuna_de_dataset() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.municipality_id IS NULL THEN
    NEW.municipality_id := (
      SELECT d.municipality_id FROM Datasets d WHERE d.dataset_id = NEW.dataset_id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Las cajas de recursos no cuelgan de ningún centro: heredan del contexto de
-- tenant. Al ser un catálogo dual, NULL es válido (caja base de la plataforma),
-- así que el trigger no fuerza nada si no hay tenant (por ejemplo, en el seed).
CREATE OR REPLACE FUNCTION heredar_comuna_del_contexto() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.municipality_id IS NULL THEN
    NEW.municipality_id := current_tenant();
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------
-- 2. Columna propia + trigger (tablas hoja de volumen)
-- ----------------------------------------------------------

ALTER TABLE InventoryLog          ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
ALTER TABLE UpdateRequests        ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
ALTER TABLE CenterAssignments     ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
ALTER TABLE CenterShifts          ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
ALTER TABLE ActivationAssignments ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
ALTER TABLE DatasetRecords        ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
-- Dual: NULL = caja base de la plataforma, compartida por todas las comunas.
ALTER TABLE ResourceBoxes         ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);

CREATE TRIGGER trg_inventorylog_comuna          BEFORE INSERT ON InventoryLog
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_de_centro();
CREATE TRIGGER trg_updaterequests_comuna        BEFORE INSERT ON UpdateRequests
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_de_centro();
CREATE TRIGGER trg_centerassignments_comuna     BEFORE INSERT ON CenterAssignments
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_de_centro();
CREATE TRIGGER trg_centershifts_comuna          BEFORE INSERT ON CenterShifts
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_de_centro();
CREATE TRIGGER trg_activationassignments_comuna BEFORE INSERT ON ActivationAssignments
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_de_activacion();
CREATE TRIGGER trg_datasetrecords_comuna        BEFORE INSERT ON DatasetRecords
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_de_dataset();
CREATE TRIGGER trg_resourceboxes_comuna         BEFORE INSERT ON ResourceBoxes
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_del_contexto();

-- El NOT NULL se aplica DESPUÉS de crear los triggers: así el seed (003_datos.sql)
-- puede insertar sin declarar la columna y el trigger la completa.
ALTER TABLE InventoryLog          ALTER COLUMN municipality_id SET NOT NULL;
ALTER TABLE UpdateRequests        ALTER COLUMN municipality_id SET NOT NULL;
ALTER TABLE CenterAssignments     ALTER COLUMN municipality_id SET NOT NULL;
ALTER TABLE CenterShifts          ALTER COLUMN municipality_id SET NOT NULL;
ALTER TABLE ActivationAssignments ALTER COLUMN municipality_id SET NOT NULL;
ALTER TABLE DatasetRecords        ALTER COLUMN municipality_id SET NOT NULL;
-- ResourceBoxes queda nullable a propósito (catálogo dual).

CREATE INDEX idx_inventorylog_comuna          ON InventoryLog (municipality_id);
CREATE INDEX idx_updaterequests_comuna        ON UpdateRequests (municipality_id);
CREATE INDEX idx_centerassignments_comuna     ON CenterAssignments (municipality_id);
CREATE INDEX idx_centershifts_comuna          ON CenterShifts (municipality_id);
CREATE INDEX idx_activationassignments_comuna ON ActivationAssignments (municipality_id);
CREATE INDEX idx_datasetrecords_comuna        ON DatasetRecords (municipality_id);

-- Políticas de tenant directo.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventorylog','updaterequests','centerassignments',
                           'centershifts','activationassignments','datasetrecords'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I
         USING (municipality_id = current_tenant() OR is_superadmin())
         WITH CHECK (municipality_id = current_tenant() OR is_superadmin())',
      t, t
    );
  END LOOP;
END $$;

-- Cajas de recursos: catálogo dual, mismo patrón que Categories/Products.
ALTER TABLE ResourceBoxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ResourceBoxes FORCE ROW LEVEL SECURITY;
CREATE POLICY resourceboxes_tenant_or_global ON ResourceBoxes
  USING (municipality_id IS NULL OR municipality_id = current_tenant() OR is_superadmin())
  WITH CHECK (municipality_id IS NULL OR municipality_id = current_tenant() OR is_superadmin());

-- ----------------------------------------------------------
-- 3. Política por subconsulta al padre (tablas satélite)
--
--    Su padre YA está protegido, así que basta exigir que el padre sea
--    visible: la RLS del padre se aplica dentro de la subconsulta y hace
--    el trabajo de tenant. No necesitan columna propia.
-- ----------------------------------------------------------

ALTER TABLE CenterShiftHistory ENABLE ROW LEVEL SECURITY;
ALTER TABLE CenterShiftHistory FORCE ROW LEVEL SECURITY;
CREATE POLICY centershifthistory_via_padre ON CenterShiftHistory
  USING (shift_id IN (SELECT s.shift_id FROM CenterShifts s))
  WITH CHECK (shift_id IN (SELECT s.shift_id FROM CenterShifts s));

ALTER TABLE DatasetFields ENABLE ROW LEVEL SECURITY;
ALTER TABLE DatasetFields FORCE ROW LEVEL SECURITY;
CREATE POLICY datasetfields_via_padre ON DatasetFields
  USING (dataset_id IN (SELECT d.dataset_id FROM Datasets d))
  WITH CHECK (dataset_id IN (SELECT d.dataset_id FROM Datasets d));

ALTER TABLE DatasetFieldOptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE DatasetFieldOptions FORCE ROW LEVEL SECURITY;
CREATE POLICY datasetfieldoptions_via_padre ON DatasetFieldOptions
  USING (field_id IN (SELECT f.field_id FROM DatasetFields f))
  WITH CHECK (field_id IN (SELECT f.field_id FROM DatasetFields f));

ALTER TABLE DatasetRecordOptionValues ENABLE ROW LEVEL SECURITY;
ALTER TABLE DatasetRecordOptionValues FORCE ROW LEVEL SECURITY;
CREATE POLICY drov_via_padre ON DatasetRecordOptionValues
  USING (record_id IN (SELECT r.record_id FROM DatasetRecords r))
  WITH CHECK (record_id IN (SELECT r.record_id FROM DatasetRecords r));

ALTER TABLE DatasetRecordRelations ENABLE ROW LEVEL SECURITY;
ALTER TABLE DatasetRecordRelations FORCE ROW LEVEL SECURITY;
CREATE POLICY drr_via_padre ON DatasetRecordRelations
  USING (record_id IN (SELECT r.record_id FROM DatasetRecords r))
  WITH CHECK (record_id IN (SELECT r.record_id FROM DatasetRecords r));

ALTER TABLE DatasetRecordCoreRelations ENABLE ROW LEVEL SECURITY;
ALTER TABLE DatasetRecordCoreRelations FORCE ROW LEVEL SECURITY;
CREATE POLICY drcr_via_padre ON DatasetRecordCoreRelations
  USING (record_id IN (SELECT r.record_id FROM DatasetRecords r))
  WITH CHECK (record_id IN (SELECT r.record_id FROM DatasetRecords r));

-- Templates puede ser global (municipality_id NULL); apoyarse en su RLS cubre
-- ese caso sin necesitar una excepción explícita acá.
ALTER TABLE TemplateFields ENABLE ROW LEVEL SECURITY;
ALTER TABLE TemplateFields FORCE ROW LEVEL SECURITY;
CREATE POLICY templatefields_via_padre ON TemplateFields
  USING (template_id IN (SELECT t.template_id FROM Templates t))
  WITH CHECK (template_id IN (SELECT t.template_id FROM Templates t));

ALTER TABLE ResourceBoxItems ENABLE ROW LEVEL SECURITY;
ALTER TABLE ResourceBoxItems FORCE ROW LEVEL SECURITY;
CREATE POLICY resourceboxitems_via_padre ON ResourceBoxItems
  USING (box_id IN (SELECT b.box_id FROM ResourceBoxes b))
  WITH CHECK (box_id IN (SELECT b.box_id FROM ResourceBoxes b));

-- ----------------------------------------------------------
-- 4. AuditLog
--
--    activation_id era nullable y SIN clave foránea: una fila con NULL no
--    pertenece a nadie y quedaría invisible para todos. La tabla nunca se
--    escribe todavía (solo hay consultas de lectura, ni un INSERT en el
--    código), así que está vacía y se puede exigir el vínculo desde ahora.
-- ----------------------------------------------------------

ALTER TABLE AuditLog
  ALTER COLUMN activation_id SET NOT NULL,
  ADD CONSTRAINT auditlog_activation_fk
    FOREIGN KEY (activation_id) REFERENCES CentersActivations(activation_id) ON DELETE CASCADE;

ALTER TABLE AuditLog ENABLE ROW LEVEL SECURITY;
ALTER TABLE AuditLog FORCE ROW LEVEL SECURITY;
CREATE POLICY auditlog_via_padre ON AuditLog
  USING (activation_id IN (SELECT ca.activation_id FROM CentersActivations ca))
  WITH CHECK (activation_id IN (SELECT ca.activation_id FROM CentersActivations ca));

-- ----------------------------------------------------------
-- 5. RefreshTokens: encapsular y denegar
--
--    Se consulta SIEMPRE fuera de contexto de tenant (login, refresh, logout y
--    el job de limpieza), así que una política de comuna rompería el login —
--    el mismo problema que tuvo el lookup de Users.
--
--    En vez de dejarla sin protección, todos sus accesos se mueven a funciones
--    SECURITY DEFINER y la tabla queda con RLS SIN NINGUNA POLÍTICA PERMISIVA:
--    en PostgreSQL eso niega todo. Ninguna consulta SQL de la aplicación puede
--    tocarla, ni por error ni por inyección; solo se llega por estas funciones.
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION refresh_token_issue(
  p_user_id INT, p_token_hash TEXT, p_user_agent TEXT, p_ip TEXT, p_expires_at TIMESTAMPTZ
) RETURNS BIGINT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO RefreshTokens (user_id, token_hash, user_agent, ip, expires_at)
  VALUES (p_user_id, p_token_hash, p_user_agent, p_ip, p_expires_at)
  RETURNING id;
$$;

CREATE OR REPLACE FUNCTION refresh_token_find(p_user_id INT, p_token_hash TEXT)
RETURNS TABLE (id BIGINT, user_id INT, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at
  FROM RefreshTokens rt
  WHERE rt.user_id = p_user_id AND rt.token_hash = p_token_hash;
$$;

CREATE OR REPLACE FUNCTION refresh_token_revoke_by_hash(p_token_hash TEXT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  UPDATE RefreshTokens SET revoked_at = now()
   WHERE token_hash = p_token_hash AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_token_revoke_by_id(p_id BIGINT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  UPDATE RefreshTokens SET revoked_at = now() WHERE id = p_id AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_token_revoke_all(p_user_id INT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  UPDATE RefreshTokens SET revoked_at = now()
   WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_token_purge() RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  DELETE FROM RefreshTokens
   WHERE (expires_at < now() - INTERVAL '1 day')
      OR (revoked_at IS NOT NULL AND revoked_at < now() - INTERVAL '7 days');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_token_stats()
RETURNS TABLE (total BIGINT, active BIGINT, expired BIGINT, revoked BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE expires_at > now() AND revoked_at IS NULL),
         COUNT(*) FILTER (WHERE expires_at <= now()),
         COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)
  FROM RefreshTokens;
$$;

-- Sin políticas: RLS activo y ninguna permisiva = denegación total.
ALTER TABLE RefreshTokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE RefreshTokens FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------
-- 6. Ofertas de apoyo intercomunal: lectura y cambio de estado
--
--    Van acá y no en 002a porque ambas resuelven la comuna DESTINO a través de
--    Centers, y de ahí salen las dos reglas:
--      a) una oferta la ven SOLO las dos comunas involucradas —la que ofrece y la
--         que recibe—, no todas las participantes del evento;
--      b) la que RECIBE tiene que poder aceptarla o rechazarla, así que el UPDATE
--         no puede estar limitado a la comuna de origen.
--
--    La política de INSERT (cmso_own_write, en 002a) sí es solo de origen: quien
--    ofrece es quien crea la oferta.
-- ----------------------------------------------------------

CREATE POLICY cmso_read ON CrossMunicipalSupportOffers
  FOR SELECT
  USING (
    is_superadmin()
    OR from_municipality_id = current_tenant()
    OR target_center_id IN (
        SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()
    )
  );

CREATE POLICY cmso_update ON CrossMunicipalSupportOffers
  FOR UPDATE
  USING (
    from_municipality_id = current_tenant()
    OR target_center_id IN (
        SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()
    )
  )
  WITH CHECK (
    from_municipality_id = current_tenant()
    OR target_center_id IN (
        SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()
    )
  );

-- ----------------------------------------------------------
-- Nota: el tablero intercomunal, el aviso de oferta a la comuna destino y el
-- listado de ofertas con nombres resueltos NO están acá.
--
-- Las tres funciones (super_event_shared_centers, notify_support_offer y
-- support_offers_visible) necesitan CrossMunicipalSupportOffers.super_event_id,
-- columna que agrega 002d. Postgres valida el cuerpo de una función SQL al
-- crearla, así que definirlas antes falla. Viven en 002d.
-- ----------------------------------------------------------

-- ----------------------------------------------------------
-- 8. Permisos
-- ----------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appcopio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appcopio_app;

REVOKE ALL ON FUNCTION refresh_token_issue(INT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION refresh_token_find(INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION refresh_token_revoke_by_hash(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION refresh_token_revoke_by_id(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION refresh_token_revoke_all(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION refresh_token_purge() FROM PUBLIC;
REVOKE ALL ON FUNCTION refresh_token_stats() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION refresh_token_issue(INT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_find(INT, TEXT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_revoke_by_hash(TEXT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_revoke_by_id(BIGINT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_revoke_all(INT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_purge() TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_stats() TO appcopio_app;
