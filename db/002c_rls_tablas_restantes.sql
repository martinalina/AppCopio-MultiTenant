-- ==========================================================
-- 002c: RLS PARA LAS TABLAS RESTANTES + OFERTAS DE APOYO
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
-- 6. Ofertas de apoyo intercomunal: corrección de políticas
--
--    Se escribieron en la Fase 1 sin código que las ejercitara y tienen dos
--    defectos:
--      a) la lectura dejaba que CUALQUIER comuna participante viera TODAS las
--         ofertas de la emergencia, incluidas las dirigidas a otras comunas;
--      b) la escritura solo permitía a la comuna de ORIGEN, así que la comuna
--         que RECIBE la oferta no podía aceptarla ni rechazarla.
-- ----------------------------------------------------------

DROP POLICY cmso_participant_read ON CrossMunicipalSupportOffers;
CREATE POLICY cmso_read ON CrossMunicipalSupportOffers
  FOR SELECT
  USING (
    is_superadmin()
    OR from_municipality_id = current_tenant()
    OR target_center_id IN (
        SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()
    )
  );

DROP POLICY cmso_own_update ON CrossMunicipalSupportOffers;
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
-- 7. Tablero intercomunal
--
--    Hermana de emergency_shared_center_ids(): devuelve los centros compartidos
--    con los campos que la regla 6 del proyecto permite exponer entre comunas.
--    NUNCA CentersDescription, FamilyGroups, Persons ni cantidades de inventario.
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION emergency_shared_centers(p_emergency_id INT)
RETURNS TABLE (
  center_id VARCHAR, name TEXT, latitude DECIMAL, longitude DECIMAL,
  capacity INT, fullness_percentage INT, operational_status TEXT,
  municipality_id INT, municipality_shortname TEXT, activation_id INT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.center_id, c.name::TEXT, c.latitude, c.longitude,
         c.capacity, c.fullness_percentage, c.operational_status::TEXT,
         c.municipality_id, m.shortname::TEXT, ca.activation_id
  FROM Centers c
  JOIN Municipalities m ON m.municipality_id = c.municipality_id
  JOIN CentersActivations ca
    ON ca.center_id = c.center_id AND ca.ended_at IS NULL
   AND ca.emergency_id = p_emergency_id
  JOIN EmergencyParticipants duena
    ON duena.emergency_id = p_emergency_id
   AND duena.municipality_id = c.municipality_id
   AND duena.status = 'participando'
  WHERE c.is_active = TRUE
    AND (
      is_superadmin()
      OR EXISTS (
        SELECT 1 FROM EmergencyParticipants yo
        WHERE yo.emergency_id = p_emergency_id
          AND yo.municipality_id = current_tenant()
          AND yo.status = 'participando'
      )
    )
  ORDER BY m.name, c.name;
$$;


-- ----------------------------------------------------------
-- 7b. Aviso de oferta a la comuna DESTINO
--
--    La política centernotif_tenant solo deja escribir avisos para la propia
--    comuna, así que la comuna que ofrece no puede notificar a la que recibe —
--    y avisarle es justamente el punto de una oferta de apoyo.
--
--    Se resuelve con una función SECURITY DEFINER deliberadamente estrecha: no
--    recibe texto libre ni destinatario, solo el id de la oferta, y verifica que
--    quien llama sea la comuna de ORIGEN de esa oferta. El mensaje se compone
--    dentro de la función.
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_support_offer(p_offer_id INT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offer RECORD;
  v_from  TEXT;
  v_id    UUID;
BEGIN
  SELECT o.offer_id, o.emergency_id, o.from_municipality_id, o.target_center_id,
         c.municipality_id AS target_municipality_id, c.name AS center_name
    INTO v_offer
    FROM CrossMunicipalSupportOffers o
    JOIN Centers c ON c.center_id = o.target_center_id
   WHERE o.offer_id = p_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFERTA_NO_EXISTE';
  END IF;

  -- La lectura de arriba omite RLS por ser SECURITY DEFINER, así que esta
  -- verificación es lo único que impide notificar a nombre de otra comuna.
  IF v_offer.from_municipality_id IS DISTINCT FROM current_tenant() THEN
    RAISE EXCEPTION 'SOLO_LA_COMUNA_DE_ORIGEN_PUEDE_AVISAR';
  END IF;

  SELECT name INTO v_from FROM Municipalities
   WHERE municipality_id = v_offer.from_municipality_id;

  -- Una fila POR PERSONA que pueda actuar sobre la oferta: el administrador de la
  -- comuna destino y sus trabajadores con es_apoyo_admin, que son los mismos que el
  -- guard de rutas deja entrar a la bandeja de ofertas. read_at es por fila, así que
  -- un aviso compartido dejaría que el primero en leerlo apague el badge de todos.
  INSERT INTO CenterNotifications
    (center_id, municipality_id, emergency_id, destinatary, title, message, channel, kind)
  SELECT
    v_offer.target_center_id,
    v_offer.target_municipality_id,
    v_offer.emergency_id,
    u.user_id,
    'Ofrecimiento de apoyo de otra comuna',
    v_from || ' ofrece apoyo para ' || v_offer.center_name ||
      '. Revisa la oferta para aceptarla o rechazarla.',
    'system',
    'support_offer'
  FROM Users u
  WHERE u.municipality_id = v_offer.target_municipality_id
    AND u.is_active = TRUE
    AND (u.role_id = 1 OR u.es_apoyo_admin = TRUE)
  RETURNING notification_id INTO v_id;

  -- Si la comuna destino no tiene a nadie que pueda responder, el aviso queda dirigido
  -- a la comuna para que no se pierda.
  IF v_id IS NULL THEN
    INSERT INTO CenterNotifications
      (center_id, municipality_id, emergency_id, title, message, channel, kind)
    VALUES (
      v_offer.target_center_id,
      v_offer.target_municipality_id,
      v_offer.emergency_id,
      'Ofrecimiento de apoyo de otra comuna',
      v_from || ' ofrece apoyo para ' || v_offer.center_name ||
        '. Revisa la oferta para aceptarla o rechazarla.',
      'system',
      'support_offer'
    )
    RETURNING notification_id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;


-- ----------------------------------------------------------
-- 7c. Listado de ofertas con datos para mostrar
--
--    El listado necesita el nombre del centro y de la comuna de DESTINO, pero un
--    JOIN normal a Centers pasa por RLS: la comuna que OFRECE no puede resolver
--    el nombre del centro ajeno y la fila salía sin destino.
--
--    Esta función replica exactamente la visibilidad de la política cmso_read
--    (origen, destino o superadmin) y resuelve los nombres del lado de la base.
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION support_offers_visible()
RETURNS TABLE (
  offer_id INT, emergency_id INT, emergency_name TEXT,
  from_municipality_id INT, from_municipality_name TEXT,
  target_center_id VARCHAR, target_center_name TEXT,
  target_municipality_id INT, target_municipality_name TEXT,
  item_id INT, item_name TEXT,
  message TEXT, status TEXT, created_at TIMESTAMPTZ,
  created_by INT, created_by_name TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT o.offer_id, o.emergency_id, e.name::TEXT,
         o.from_municipality_id, mf.name::TEXT,
         o.target_center_id, c.name::TEXT,
         c.municipality_id, mt.name::TEXT,
         o.item_id, p.name::TEXT,
         o.message::TEXT, o.status::TEXT, o.created_at,
         o.created_by, u.nombre::TEXT
  FROM CrossMunicipalSupportOffers o
  JOIN Emergencies e     ON e.emergency_id = o.emergency_id
  JOIN Municipalities mf ON mf.municipality_id = o.from_municipality_id
  JOIN Centers c         ON c.center_id = o.target_center_id
  JOIN Municipalities mt ON mt.municipality_id = c.municipality_id
  LEFT JOIN Products p   ON p.item_id = o.item_id
  LEFT JOIN Users u      ON u.user_id = o.created_by
  WHERE is_superadmin()
     OR o.from_municipality_id = current_tenant()
     OR c.municipality_id = current_tenant()
  ORDER BY o.created_at DESC;
$$;

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
REVOKE ALL ON FUNCTION emergency_shared_centers(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION notify_support_offer(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION support_offers_visible() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION refresh_token_issue(INT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_find(INT, TEXT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_revoke_by_hash(TEXT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_revoke_by_id(BIGINT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_revoke_all(INT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_purge() TO appcopio_app;
GRANT EXECUTE ON FUNCTION refresh_token_stats() TO appcopio_app;
GRANT EXECUTE ON FUNCTION emergency_shared_centers(INT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION notify_support_offer(INT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION support_offers_visible() TO appcopio_app;
