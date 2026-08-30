-- ==========================================================
-- 002a: MULTI-TENANCY (Municipalities + RLS)
-- Corre después de 002_triggers.sql y antes de 003_datos.sql.
-- Todas las tablas afectadas están vacías en este punto, así que
-- se pueden agregar columnas NOT NULL directamente.
-- ==========================================================

-- ----------------------------------------------------------
-- 0. center_id pasa de VARCHAR(10) a VARCHAR(16)
--    El formato nuevo es SHORTNAME-C00X (hasta 5 + 1 + 1 + 3 = 10),
--    pero al centro 1000 de una comuna LPAD produce 4 dígitos y
--    se desbordaría. Se amplía de una vez en Centers y en las 10
--    tablas que lo referencian (las FK exigen tipos compatibles).
-- ----------------------------------------------------------

ALTER TABLE Centers             ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE CentersActivations  ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE CentersDescription  ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE CenterInventoryItems ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE InventoryLog        ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE CenterItemPriority  ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE CenterAssignments   ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE UpdateRequests      ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE Datasets            ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE CenterNotifications ALTER COLUMN center_id TYPE VARCHAR(16);
ALTER TABLE CenterShifts        ALTER COLUMN center_id TYPE VARCHAR(16);

-- ----------------------------------------------------------
-- 1. Tablas nuevas
-- ----------------------------------------------------------

CREATE TABLE Municipalities (
    municipality_id     SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    shortname           VARCHAR(5) NOT NULL UNIQUE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    center_seq_counter  INT NOT NULL DEFAULT 0,  -- correlativo de centros, reinicia en 0 por comuna
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT municipalities_shortname_upper_chk CHECK (shortname = upper(shortname)),
    CONSTRAINT municipalities_shortname_len_chk CHECK (char_length(shortname) BETWEEN 2 AND 5)
);

-- created_by_municipality_id NULL  => emergencia regional declarada por el Super Administrador.
-- created_by_municipality_id <> NULL => declarada por esa comuna (alcance local que puede escalar).
CREATE TABLE Emergencies (
    emergency_id                SERIAL PRIMARY KEY,
    name                        TEXT NOT NULL,
    type                        TEXT,
    started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at                    TIMESTAMPTZ,
    created_by                  INT REFERENCES Users(user_id) ON DELETE SET NULL,
    created_by_municipality_id  INT REFERENCES Municipalities(municipality_id)
);

CREATE TABLE EmergencyParticipants (
    emergency_id     INT NOT NULL REFERENCES Emergencies(emergency_id) ON DELETE CASCADE,
    municipality_id  INT NOT NULL REFERENCES Municipalities(municipality_id) ON DELETE CASCADE,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (emergency_id, municipality_id)
);

CREATE TABLE CrossMunicipalSupportOffers (
    offer_id             SERIAL PRIMARY KEY,
    emergency_id         INT NOT NULL REFERENCES Emergencies(emergency_id) ON DELETE CASCADE,
    from_municipality_id INT NOT NULL REFERENCES Municipalities(municipality_id),
    target_center_id     VARCHAR(16) NOT NULL REFERENCES Centers(center_id),
    item_id              INT REFERENCES Products(item_id),
    message              TEXT,
    created_by           INT REFERENCES Users(user_id) ON DELETE SET NULL,
    status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2. Rol Super Administrador (id fijo = 4)
--    Se inserta acá para que el CHECK de Users pueda citarlo.
--    Sin OVERRIDING SYSTEM VALUE: role_id es SERIAL, no IDENTITY.
--    El setval de roles_role_id_seq va al final de 003_datos.sql,
--    después de insertar los roles 1/2/3 con id explícito.
-- ----------------------------------------------------------

INSERT INTO Roles (role_id, role_name) VALUES (4, 'Super Administrador');

-- ----------------------------------------------------------
-- 3. Propagación directa de municipality_id (NOT NULL)
-- ----------------------------------------------------------

ALTER TABLE Users
    ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id),
    ADD CONSTRAINT users_municipality_role_chk CHECK (
        (role_id = 4 AND municipality_id IS NULL) OR
        (role_id <> 4 AND municipality_id IS NOT NULL)
    );

ALTER TABLE Centers
    ADD COLUMN municipality_id INT NOT NULL REFERENCES Municipalities(municipality_id);

-- emergency_id es NULLABLE a propósito: una activación local (derrumbe de una casa,
-- un sector pequeño) no necesita emergencia. Cuando la situación escala, se asocia
-- después con un UPDATE.
ALTER TABLE CentersActivations
    ADD COLUMN municipality_id INT NOT NULL REFERENCES Municipalities(municipality_id),
    ADD COLUMN emergency_id    INT REFERENCES Emergencies(emergency_id);

ALTER TABLE FamilyGroups
    ADD COLUMN municipality_id INT NOT NULL REFERENCES Municipalities(municipality_id);

-- Persons lleva municipality_id propio en vez de una política por subconsulta:
-- es dato sensible que nunca cruza de comuna, y así el WITH CHECK es real
-- (no `true`) y las lecturas no pagan un join de 3 tablas por fila.
ALTER TABLE Persons
    ADD COLUMN municipality_id INT NOT NULL REFERENCES Municipalities(municipality_id);

ALTER TABLE CenterInventoryItems
    ADD COLUMN municipality_id INT NOT NULL REFERENCES Municipalities(municipality_id);

ALTER TABLE Datasets
    ADD COLUMN municipality_id INT NOT NULL REFERENCES Municipalities(municipality_id);

-- ----------------------------------------------------------
-- 4. Propagación opcional (NULL = catálogo global compartido)
--    Los globales se siembran en 003_datos.sql y no hay endpoint
--    para crear más: todo lo creado desde la app lleva el
--    municipality_id de quien lo creó.
-- ----------------------------------------------------------

ALTER TABLE Categories      ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
ALTER TABLE Products        ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
ALTER TABLE Templates       ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);
ALTER TABLE municipal_zones ADD COLUMN municipality_id INT REFERENCES Municipalities(municipality_id);

-- Roles: sin tenant, queda global a propósito.

-- ----------------------------------------------------------
-- 4b. Categories.name y Products.name tenían UNIQUE global.
--     Dos comunas deben poder usar el mismo nombre de producto.
-- ----------------------------------------------------------

ALTER TABLE Categories DROP CONSTRAINT categories_name_key;
ALTER TABLE Products   DROP CONSTRAINT products_name_key;

-- Únicos entre los globales, y únicos por comuna entre sí.
CREATE UNIQUE INDEX categories_name_global_uq ON Categories (name) WHERE municipality_id IS NULL;
CREATE UNIQUE INDEX categories_name_tenant_uq ON Categories (name, municipality_id) WHERE municipality_id IS NOT NULL;

CREATE UNIQUE INDEX products_name_global_uq ON Products (name) WHERE municipality_id IS NULL;
CREATE UNIQUE INDEX products_name_tenant_uq ON Products (name, municipality_id) WHERE municipality_id IS NOT NULL;

-- ----------------------------------------------------------
-- 5. center_id se genera con prefijo de comuna (SHORTNAME-C00X),
--    reiniciando el correlativo en cada comuna.
-- ----------------------------------------------------------

ALTER TABLE Centers ALTER COLUMN center_id DROP DEFAULT;
DROP SEQUENCE IF EXISTS centers_seq;

-- SECURITY DEFINER es obligatorio: el trigger hace UPDATE sobre Municipalities,
-- que tiene FORCE RLS y solo permite UPDATE al superadmin. Sin esto, el UPDATE
-- afecta 0 filas, v_seq queda NULL y ningún admin municipal puede crear un centro.
CREATE OR REPLACE FUNCTION generate_center_id() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shortname TEXT;
  v_seq       INT;
BEGIN
  IF NEW.center_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE Municipalities
     SET center_seq_counter = center_seq_counter + 1
   WHERE municipality_id = NEW.municipality_id
   RETURNING center_seq_counter, shortname INTO v_seq, v_shortname;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'Municipality % no existe', NEW.municipality_id;
  END IF;

  NEW.center_id := v_shortname || '-C' || LPAD(v_seq::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_center_id
BEFORE INSERT ON Centers
FOR EACH ROW
EXECUTE FUNCTION generate_center_id();

-- ----------------------------------------------------------
-- 6. Funciones de contexto para RLS
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION current_tenant() RETURNS INT AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::INT;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_superadmin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.is_superadmin', true), 'false') = 'true';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_public_context() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.public_access', true), 'false') = 'true';
$$ LANGUAGE sql STABLE;

-- ----------------------------------------------------------
-- 6b. Funciones SECURITY DEFINER para los dos casos que no pueden
--     tener tenant seteado.
-- ----------------------------------------------------------

-- /api/auth no puede pasar por withTenant: la comuna se conoce DESPUÉS de
-- leer al usuario. Con RLS sobre Users, un SELECT directo devuelve 0 filas
-- y el login falla para todo el mundo. Esta función es la única vía de
-- lectura de Users sin tenant, y está acotada a un username exacto.
CREATE OR REPLACE FUNCTION auth_lookup_user(p_username TEXT)
RETURNS TABLE (
  user_id INT, username TEXT, password_hash TEXT, is_active BOOLEAN,
  role_id INT, es_apoyo_admin BOOLEAN, rut TEXT, email TEXT, nombre TEXT,
  genero TEXT, celular TEXT, imagen_perfil TEXT, created_at TIMESTAMPTZ,
  municipality_id INT, municipality_shortname TEXT, municipality_name TEXT,
  role_name TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.user_id, u.username::TEXT, u.password_hash::TEXT, u.is_active,
         u.role_id, u.es_apoyo_admin, u.rut::TEXT, u.email::TEXT, u.nombre::TEXT,
         u.genero::TEXT, u.celular::TEXT, u.imagen_perfil::TEXT, u.created_at,
         u.municipality_id, m.shortname::TEXT, m.name::TEXT,
         r.role_name::TEXT
  FROM Users u
  LEFT JOIN Roles r ON r.role_id = u.role_id
  LEFT JOIN Municipalities m ON m.municipality_id = u.municipality_id
  WHERE u.username = p_username;
$$;

-- Mismo caso para GET /auth/me, que resuelve por user_id desde el JWT.
CREATE OR REPLACE FUNCTION auth_lookup_user_by_id(p_user_id INT)
RETURNS TABLE (
  user_id INT, username TEXT, password_hash TEXT, is_active BOOLEAN,
  role_id INT, es_apoyo_admin BOOLEAN, rut TEXT, email TEXT, nombre TEXT,
  genero TEXT, celular TEXT, imagen_perfil TEXT, created_at TIMESTAMPTZ,
  municipality_id INT, municipality_shortname TEXT, municipality_name TEXT,
  role_name TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.user_id, u.username::TEXT, u.password_hash::TEXT, u.is_active,
         u.role_id, u.es_apoyo_admin, u.rut::TEXT, u.email::TEXT, u.nombre::TEXT,
         u.genero::TEXT, u.celular::TEXT, u.imagen_perfil::TEXT, u.created_at,
         u.municipality_id, m.shortname::TEXT, m.name::TEXT,
         r.role_name::TEXT
  FROM Users u
  LEFT JOIN Roles r ON r.role_id = u.role_id
  LEFT JOIN Municipalities m ON m.municipality_id = u.municipality_id
  WHERE u.user_id = p_user_id;
$$;

-- El endpoint público de aforo necesita CONTAR personas, pero jamás verlas.
-- Devuelve solo el número: los datos de personas nunca cruzan al contexto público.
CREATE OR REPLACE FUNCTION public_center_occupancy(p_center_id VARCHAR)
RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(COUNT(fgm.person_id), 0)::INT
  FROM FamilyGroupMembers fgm
  JOIN FamilyGroups fg ON fg.family_id = fgm.family_id AND fg.status = 'activo'
  JOIN CentersActivations ca ON ca.activation_id = fg.activation_id AND ca.ended_at IS NULL
  WHERE ca.center_id = p_center_id;
$$;

-- ----------------------------------------------------------
-- 7. RLS: tablas con tenant DIRECTO
--    Ojo: los nombres van en minúscula. Las tablas se crearon sin
--    comillas, así que en pg_class son 'users', 'centers', etc.
--    format('%I','Users') produciría "Users" y fallaría.
-- ----------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','centers','centersactivations','familygroups','persons','centerinventoryitems','datasets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I USING (municipality_id = current_tenant() OR is_superadmin())
       WITH CHECK (municipality_id = current_tenant() OR is_superadmin())',
      t, t
    );
  END LOOP;
END $$;

-- Excepción: el mapa público (sin login) muestra SOLO los centros activos.
CREATE POLICY centers_public_read ON Centers
  FOR SELECT
  USING (is_public_context() AND is_active = TRUE);

-- El formulario público de voluntarios necesita resolver la activación abierta de un
-- centro activo, y el tablero público de avisos de servicio lee el Dataset asociado.
-- Ambas lecturas quedan acotadas al mismo límite que el mapa público: centro activo.
-- La subconsulta a Centers también pasa por RLS, así que en contexto público solo
-- resuelve centros activos.
CREATE POLICY centersactivations_public_read ON CentersActivations
  FOR SELECT
  USING (
    is_public_context()
    AND ended_at IS NULL
    AND center_id IN (SELECT c.center_id FROM Centers c WHERE c.is_active = TRUE)
  );

CREATE POLICY datasets_public_read ON Datasets
  FOR SELECT
  USING (
    is_public_context()
    AND center_id IN (SELECT c.center_id FROM Centers c WHERE c.is_active = TRUE)
  );

-- ----------------------------------------------------------
-- 8. RLS: catálogos opcionalmente compartidos (NULL = global)
-- ----------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','products','templates','municipal_zones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_or_global ON %I
         USING (municipality_id IS NULL OR municipality_id = current_tenant() OR is_superadmin())
         WITH CHECK (municipality_id IS NULL OR municipality_id = current_tenant() OR is_superadmin())',
      t, t
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------
-- 9. RLS: tablas de colaboración intermunicipal
-- ----------------------------------------------------------

ALTER TABLE Emergencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE Emergencies FORCE ROW LEVEL SECURITY;

CREATE POLICY emergencies_participant_read ON Emergencies
  FOR SELECT
  USING (
    is_superadmin()
    OR created_by_municipality_id = current_tenant()
    OR emergency_id IN (SELECT ep.emergency_id FROM EmergencyParticipants ep WHERE ep.municipality_id = current_tenant())
  );

-- Alcance distinto según quién declara: el superadmin puede declarar una
-- regional (created_by_municipality_id NULL); un admin municipal solo puede
-- declarar una a nombre de su propia comuna.
CREATE POLICY emergencies_write ON Emergencies
  FOR INSERT
  WITH CHECK (is_superadmin() OR created_by_municipality_id = current_tenant());

CREATE POLICY emergencies_update ON Emergencies
  FOR UPDATE
  USING (is_superadmin() OR created_by_municipality_id = current_tenant())
  WITH CHECK (is_superadmin() OR created_by_municipality_id = current_tenant());

ALTER TABLE EmergencyParticipants ENABLE ROW LEVEL SECURITY;
ALTER TABLE EmergencyParticipants FORCE ROW LEVEL SECURITY;

CREATE POLICY emergency_participants_read ON EmergencyParticipants
  FOR SELECT
  USING (is_superadmin() OR municipality_id = current_tenant());

-- Una comuna se une a sí misma; nadie inscribe a otra.
CREATE POLICY emergency_participants_write ON EmergencyParticipants
  FOR INSERT WITH CHECK (is_superadmin() OR municipality_id = current_tenant());

CREATE POLICY emergency_participants_delete ON EmergencyParticipants
  FOR DELETE USING (is_superadmin() OR municipality_id = current_tenant());

ALTER TABLE CrossMunicipalSupportOffers ENABLE ROW LEVEL SECURITY;
ALTER TABLE CrossMunicipalSupportOffers FORCE ROW LEVEL SECURITY;

CREATE POLICY cmso_participant_read ON CrossMunicipalSupportOffers
  FOR SELECT
  USING (
    is_superadmin()
    OR emergency_id IN (SELECT ep.emergency_id FROM EmergencyParticipants ep WHERE ep.municipality_id = current_tenant())
  );

-- Escritura: SOLO la comuna de origen.
CREATE POLICY cmso_own_write ON CrossMunicipalSupportOffers
  FOR INSERT WITH CHECK (from_municipality_id = current_tenant());

CREATE POLICY cmso_own_update ON CrossMunicipalSupportOffers
  FOR UPDATE USING (from_municipality_id = current_tenant()) WITH CHECK (from_municipality_id = current_tenant());

-- Municipalities: sin tenant propio. Lectura abierta, escritura solo superadmin.
ALTER TABLE Municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE Municipalities FORCE ROW LEVEL SECURITY;

CREATE POLICY municipalities_read_all ON Municipalities FOR SELECT USING (true);
CREATE POLICY municipalities_superadmin_write ON Municipalities
  FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY municipalities_superadmin_update ON Municipalities
  FOR UPDATE USING (is_superadmin()) WITH CHECK (is_superadmin());
-- Nota: el contador center_seq_counter lo mueve generate_center_id(), que es
-- SECURITY DEFINER y por eso no choca con esta política.

-- ----------------------------------------------------------
-- 10. RLS: lectura ampliada de prioridades entre comunas participantes
-- ----------------------------------------------------------

ALTER TABLE CenterItemPriority ENABLE ROW LEVEL SECURITY;
ALTER TABLE CenterItemPriority FORCE ROW LEVEL SECURITY;

CREATE POLICY cip_intermunicipal_read ON CenterItemPriority
  FOR SELECT
  USING (
    is_superadmin()
    OR center_id IN (
        SELECT c.center_id
        FROM Centers c
        JOIN CentersActivations ca ON ca.center_id = c.center_id AND ca.ended_at IS NULL
        JOIN EmergencyParticipants ep ON ep.emergency_id = ca.emergency_id
        WHERE c.is_active = TRUE AND ep.municipality_id = current_tenant()
    )
  );

-- Escritura: SOLO sobre centros de la propia comuna.
CREATE POLICY cip_own_write ON CenterItemPriority
  FOR INSERT WITH CHECK (
    center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant())
  );
CREATE POLICY cip_own_update ON CenterItemPriority
  FOR UPDATE
  USING (center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()))
  WITH CHECK (center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()));
CREATE POLICY cip_own_delete ON CenterItemPriority
  FOR DELETE USING (center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()));

-- ----------------------------------------------------------
-- 11. RLS para tablas sensibles sin columna propia (join al padre)
--     Persons ya tiene municipality_id propio (ver punto 3).
-- ----------------------------------------------------------

ALTER TABLE CentersDescription ENABLE ROW LEVEL SECURITY;
ALTER TABLE CentersDescription FORCE ROW LEVEL SECURITY;
CREATE POLICY centersdesc_tenant ON CentersDescription
  USING (is_superadmin() OR center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()))
  WITH CHECK (center_id IN (SELECT c.center_id FROM Centers c WHERE c.municipality_id = current_tenant()));

ALTER TABLE FamilyGroupMembers ENABLE ROW LEVEL SECURITY;
ALTER TABLE FamilyGroupMembers FORCE ROW LEVEL SECURITY;
CREATE POLICY fgm_tenant ON FamilyGroupMembers
  USING (is_superadmin() OR family_id IN (SELECT fg.family_id FROM FamilyGroups fg WHERE fg.municipality_id = current_tenant()))
  WITH CHECK (family_id IN (SELECT fg.family_id FROM FamilyGroups fg WHERE fg.municipality_id = current_tenant()));

-- ----------------------------------------------------------
-- 12. Rol de aplicación SIN privilegios de superusuario
--     (obligatorio: los superusuarios ignoran RLS incluso con FORCE)
-- ----------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'appcopio_app') THEN
    CREATE ROLE appcopio_app LOGIN PASSWORD 'CAMBIA_ESTA_PASSWORD_EN_.env';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO appcopio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appcopio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appcopio_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appcopio_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO appcopio_app;

-- Las funciones SECURITY DEFINER se otorgan explícitamente y se quitan de PUBLIC.
REVOKE ALL ON FUNCTION auth_lookup_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_lookup_user_by_id(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public_center_occupancy(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(TEXT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_id(INT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION public_center_occupancy(VARCHAR) TO appcopio_app;

-- appcopio_app NO debe tener BYPASSRLS ni SUPERUSER (el default de CREATE ROLE
-- ya los deja fuera). No cambiar esto: sin ello todo el RLS de arriba es decorativo.
