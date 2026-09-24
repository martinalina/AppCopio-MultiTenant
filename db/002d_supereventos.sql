-- ==========================================================
-- 002d: SUPEREVENTOS — contenedor de emergencias relacionadas
--
-- Corre después de 002c_rls_tablas_restantes.sql y antes de 003_datos.sql
-- (orden alfabético: 002c_ < 002d_ < 003_). Las tablas siguen vacías acá.
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- El diseño original fundía dos conceptos en Emergencies: el evento local de una
-- comuna y el contenedor de la colaboración. Eso obligaba a que el contenedor
-- existiera ANTES que las emergencias locales; si cada comuna ya había creado la
-- suya —el caso normal cuando un evento crece— quedaban dos emergencias activas
-- que eran el mismo evento, y había que abandonar una o mover información a mano.
--
-- Acá viven las dos entidades que los separan:
--
--   Emergencies  = evento LOCAL de UNA comuna. Agrupa activaciones de centros de
--                  esa comuna. Es el nivel "emergencia menor": afectación acotada,
--                  capacidades comunales. Es la unidad de organización interna.
--
--   SuperEvents  = contenedor de varias emergencias relacionadas, con nivel
--                  mayor / desastre / catástrofe. Es el ÚNICO lugar donde vive la
--                  colaboración: participantes, tablero y ofertas de apoyo.
--
-- Tres caminos llegan a un SuperEvento:
--   1. El Super Administrador lo crea e invita comunas.
--   2. El Super Administrador agrupa emergencias que ya existen y no tienen uno.
--   3. Dos comunas deciden colaborar: se crea automáticamente al invitar.
--
-- Y a partir de ahí invita CUALQUIER comuna participante, no solo la que lo
-- originó (política sep_write, punto 6.2).
-- ==========================================================


-- ----------------------------------------------------------
-- 1. Las dos tablas nuevas
-- ----------------------------------------------------------

CREATE TABLE SuperEvents (
    super_event_id  SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    -- Los tres niveles que sobrepasan la capacidad comunal. 'menor' no está:
    -- ese nivel ES una Emergencia suelta, no necesita contenedor.
    level           TEXT NOT NULL
        CHECK (level IN ('mayor', 'desastre', 'catastrofe')),
    type            TEXT,
    description     TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    created_by      INT REFERENCES Users(user_id) ON DELETE SET NULL,
    -- NULL = lo creó el Super Administrador. OJO: no confiere privilegios de
    -- invitación —cualquier participante invita— solo de cierre y edición.
    created_by_municipality_id INT REFERENCES Municipalities(municipality_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN SuperEvents.level IS
  'mayor = sobrepasa a la comuna (apoyo provincial o regional); desastre = sobrepasa a la region (nivel nacional); catastrofe = sobrepasa al pais (gobierno central y asistencia internacional).';

CREATE TABLE SuperEventParticipants (
    super_event_id  INT NOT NULL REFERENCES SuperEvents(super_event_id) ON DELETE CASCADE,
    municipality_id INT NOT NULL REFERENCES Municipalities(municipality_id) ON DELETE CASCADE,
    -- Igual que en EmergencyParticipants: tener fila alcanza para VER el
    -- SuperEvento (y así saber a qué te invitan), pero la colaboración real
    -- exige 'participando'.
    status          TEXT NOT NULL DEFAULT 'invitada'
        CHECK (status IN ('invitada', 'participando', 'rechazada')),
    invited_by      INT REFERENCES Users(user_id) ON DELETE SET NULL,
    -- Nuevo respecto de EmergencyParticipants: ahora invita cualquier comuna
    -- participante, así que hay que poder decir quién invitó a quién.
    invited_by_municipality_id INT REFERENCES Municipalities(municipality_id),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at    TIMESTAMPTZ,
    PRIMARY KEY (super_event_id, municipality_id)
);


-- ----------------------------------------------------------
-- 2. Emergencies se cuelga de un SuperEvento
--
--    Nulo es el caso normal y más frecuente: la comuna se organiza sola. La
--    columna solo se llena cuando esa emergencia se aporta a un SuperEvento.
--
--    Que toda emergencia sea LOCAL ya está resuelto en 002a, donde
--    created_by_municipality_id se declara NOT NULL.
-- ----------------------------------------------------------

ALTER TABLE Emergencies
    ADD COLUMN super_event_id INT REFERENCES SuperEvents(super_event_id) ON DELETE SET NULL;

-- Una comuna aporta A LO SUMO UNA emergencia por SuperEvento. Sin esto, "mi
-- emergencia en este SuperEvento" sería ambiguo y el tablero tendría que
-- desempatar. Parcial, porque las emergencias sueltas no compiten entre sí.
CREATE UNIQUE INDEX emergencies_one_per_municipality_per_superevent_uq
    ON Emergencies (super_event_id, created_by_municipality_id)
    WHERE super_event_id IS NOT NULL;

CREATE INDEX idx_emergencies_super_event ON Emergencies (super_event_id);


-- ----------------------------------------------------------
-- 3. Invitaciones a centros: EmergencyActivationInvitations
--
--    Hasta ahora el rechazo de un centro NO se registraba en ninguna parte:
--    respondActivation(accept=false) solo ponía emergency_id = NULL y marcaba la
--    notificación leída. Era imposible distinguir "nunca se invitó" de "se
--    invitó y rechazó", así que el administrador no podía volver a invitar a
--    conciencia ni saber qué centros faltaban por responder.
--
--    Es una tabla INTRA-comuna: no cruza nada entre municipalidades.
-- ----------------------------------------------------------

CREATE TABLE EmergencyActivationInvitations (
    emergency_id    INT NOT NULL REFERENCES Emergencies(emergency_id) ON DELETE CASCADE,
    activation_id   INT NOT NULL REFERENCES CentersActivations(activation_id) ON DELETE CASCADE,
    municipality_id INT REFERENCES Municipalities(municipality_id),
    status          TEXT NOT NULL DEFAULT 'invitada'
        CHECK (status IN ('invitada', 'aceptada', 'rechazada')),
    invited_by      INT REFERENCES Users(user_id) ON DELETE SET NULL,
    responded_by    INT REFERENCES Users(user_id) ON DELETE SET NULL,
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at    TIMESTAMPTZ,
    -- La PK compuesta es lo que permite REINVITAR con ON CONFLICT DO UPDATE:
    -- una sola fila por par, siempre con el último estado, sin historial duplicado.
    PRIMARY KEY (emergency_id, activation_id)
);

CREATE INDEX idx_eai_activation ON EmergencyActivationInvitations (activation_id);

-- municipality_id es redundante con la emergencia, pero evita un JOIN dentro de
-- la política RLS (mismo criterio que el resto de 002c). Lo completa el trigger,
-- que ya existe en 002c y resuelve la comuna desde la activación.
CREATE TRIGGER trg_eai_comuna BEFORE INSERT ON EmergencyActivationInvitations
  FOR EACH ROW EXECUTE FUNCTION heredar_comuna_de_activacion();

-- El NOT NULL va DESPUÉS del trigger, igual que en 002c: así un INSERT puede
-- omitir la columna y el trigger la completa.
ALTER TABLE EmergencyActivationInvitations ALTER COLUMN municipality_id SET NOT NULL;


-- ----------------------------------------------------------
-- 4. Las ofertas de apoyo cuelgan del SuperEvento
--
--    La oferta es un acto de colaboración, así que cuelga del SuperEvento. La
--    comuna DESTINO se sigue derivando por Centers.municipality_id, así que no
--    hace falta columna de destino.
--
--    002a crea la tabla sin esta columna precisamente porque SuperEvents todavía
--    no existía.
-- ----------------------------------------------------------

ALTER TABLE CrossMunicipalSupportOffers
    ADD COLUMN super_event_id INT NOT NULL
        REFERENCES SuperEvents(super_event_id) ON DELETE CASCADE;


-- ----------------------------------------------------------
-- 5. Notificaciones: destino SuperEvento
--
--    emergency_id (002b) se conserva porque 'activation_invitation' lo sigue
--    usando: ese aviso es intra-comuna, sobre una emergencia local. El CHECK de
--    kind ya admite 'super_event_invitation' desde 002b.
-- ----------------------------------------------------------

ALTER TABLE CenterNotifications
    ADD COLUMN super_event_id INT REFERENCES SuperEvents(super_event_id) ON DELETE CASCADE;

CREATE INDEX idx_centernotif_super_event ON CenterNotifications (super_event_id);


-- ----------------------------------------------------------
-- 6. Políticas RLS
-- ----------------------------------------------------------

-- Emergencies no aparece acá: su política (emergencies_tenant_isolation, en 002a)
-- es aislamiento de tenant puro y no cambia. La lectura ampliada entre comunas no
-- pasa por esa tabla, la resuelven las funciones super_event_* del punto 7.

-- 6.1. SuperEvents y sus participantes.
ALTER TABLE SuperEvents ENABLE ROW LEVEL SECURITY;
ALTER TABLE SuperEvents FORCE ROW LEVEL SECURITY;
ALTER TABLE SuperEventParticipants ENABLE ROW LEVEL SECURITY;
ALTER TABLE SuperEventParticipants FORCE ROW LEVEL SECURITY;

CREATE POLICY super_events_read ON SuperEvents
  FOR SELECT
  USING (
    is_superadmin()
    OR super_event_id IN (
        SELECT p.super_event_id FROM SuperEventParticipants p
        WHERE p.municipality_id = current_tenant()
    )
  );

CREATE POLICY super_events_write ON SuperEvents
  FOR INSERT
  WITH CHECK (is_superadmin() OR created_by_municipality_id = current_tenant());

-- Cerrar o editar el SuperEvento: solo el Super Administrador o la comuna que lo
-- originó. Invitar SÍ puede cualquiera (sep_write), pero cerrarlo le cortaría la
-- colaboración a todos los demás.
CREATE POLICY super_events_update ON SuperEvents
  FOR UPDATE
  USING      (is_superadmin() OR created_by_municipality_id = current_tenant())
  WITH CHECK (is_superadmin() OR created_by_municipality_id = current_tenant());
-- Sin política de DELETE: nadie borra un SuperEvento (mismo criterio que Emergencies).

CREATE POLICY sep_read ON SuperEventParticipants
  FOR SELECT
  USING (is_superadmin() OR municipality_id = current_tenant());

-- EL CAMBIO CLAVE DE ESTE ARCHIVO: invita cualquier comuna que ya esté
-- 'participando', no solo la que originó el SuperEvento. Es lo que permite que
-- un evento que crece sume comunas sin pasar por su comuna de origen.
--
-- La política consulta su propia tabla, pero NO hay recursión: es de INSERT, y la
-- subconsulta se resuelve bajo sep_read, que no se autoconsulta. (El caso de 002b
-- que provocaba "infinite recursion detected in policy" era una política de
-- SELECT leyéndose a sí misma.)
--
-- OJO AL INSERTAR: invitar crea una fila cuyo municipality_id es el de la comuna
-- INVITADA, no el de quien invita, así que sep_read no la deja ver a su autora.
-- Eso es deliberado, pero tiene una consecuencia: el INSERT no puede llevar
-- ON CONFLICT ni RETURNING. Con ON CONFLICT, Postgres exige que la fila nueva sea
-- visible bajo la política de SELECT y aborta con "new row violates row-level
-- security policy" aunque el WITH CHECK de acá se cumpla —se verificó que falla
-- incluso con WITH CHECK (true), y que deja de fallar si sep_read es USING(true)—.
-- Por eso inviteMunicipalities() inserta a secas y trata el 23505 como "ya estaba
-- invitada".
CREATE POLICY sep_write ON SuperEventParticipants
  FOR INSERT
  WITH CHECK (
    is_superadmin()
    OR super_event_id IN (
        SELECT p.super_event_id FROM SuperEventParticipants p
        WHERE p.municipality_id = current_tenant()
          AND p.status = 'participando'
    )
  );

-- Responder la invitación: cada comuna cambia el estado de su propia fila.
CREATE POLICY sep_update ON SuperEventParticipants
  FOR UPDATE
  USING      (is_superadmin() OR municipality_id = current_tenant())
  WITH CHECK (is_superadmin() OR municipality_id = current_tenant());

CREATE POLICY sep_delete ON SuperEventParticipants
  FOR DELETE
  USING (is_superadmin() OR municipality_id = current_tenant());

-- 6.2. Invitaciones a centros: aislamiento de tenant simple.
ALTER TABLE EmergencyActivationInvitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE EmergencyActivationInvitations FORCE ROW LEVEL SECURITY;

CREATE POLICY eai_tenant_isolation ON EmergencyActivationInvitations
  USING      (is_superadmin() OR municipality_id = current_tenant())
  WITH CHECK (is_superadmin() OR municipality_id = current_tenant());


-- ----------------------------------------------------------
-- 7. Funciones de colaboración: se rehacen sobre SuperEvents
--
--    Siguen siendo SECURITY DEFINER por la misma razón de 002b: resolver el
--    conjunto compartido entre comunas es imposible desde una política, porque
--    las subconsultas a Centers / CentersActivations quedan atrapadas por el
--    propio tenant y nunca devuelven nada ajeno.
--
--    Todas exigen se.ended_at IS NULL, y eso importa: cerrar el SuperEvento corta
--    la colaboración de verdad. En el diseño original el cierre era puramente
--    informativo y el acceso sobrevivía hasta que se cerraran las activaciones una
--    por una.
-- ----------------------------------------------------------

-- 7a. Centros que esta comuna puede ver de las demás. Exige 'participando' en
--     AMBOS lados: la comuna dueña del centro y la que lee.
CREATE OR REPLACE FUNCTION super_event_shared_center_ids()
RETURNS TABLE (center_id VARCHAR)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT DISTINCT c.center_id
  FROM Centers c
  JOIN CentersActivations ca
    ON ca.center_id = c.center_id AND ca.ended_at IS NULL
  JOIN Emergencies e
    ON e.emergency_id = ca.emergency_id AND e.super_event_id IS NOT NULL
  JOIN SuperEvents se
    ON se.super_event_id = e.super_event_id AND se.ended_at IS NULL
  JOIN SuperEventParticipants duena
    ON duena.super_event_id = se.super_event_id
   AND duena.municipality_id = c.municipality_id
   AND duena.status = 'participando'
  JOIN SuperEventParticipants yo
    ON yo.super_event_id = se.super_event_id
   AND yo.municipality_id = current_tenant()
   AND yo.status = 'participando'
  WHERE c.is_active = TRUE;
$$;

-- 7b. Quiénes participan, y con qué emergencia aporta cada uno.
--
--     sep_read solo deja ver la fila propia, así que una consulta directa nunca
--     mostraría a las demás comunas. Responde solo a participantes o superadmin.
CREATE OR REPLACE FUNCTION super_event_participants_of(p_super_event_id INT)
RETURNS TABLE (municipality_id INT, name TEXT, shortname TEXT, status TEXT,
               emergency_id INT, emergency_name TEXT,
               joined_at TIMESTAMPTZ, responded_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT p.municipality_id, m.name::TEXT, m.shortname::TEXT, p.status,
         e.emergency_id, e.name::TEXT,
         p.joined_at, p.responded_at
  FROM SuperEventParticipants p
  JOIN Municipalities m ON m.municipality_id = p.municipality_id
  -- LEFT: una comuna 'invitada' o 'rechazada' todavía no aportó emergencia.
  LEFT JOIN Emergencies e
    ON e.super_event_id = p.super_event_id
   AND e.created_by_municipality_id = p.municipality_id
  WHERE p.super_event_id = p_super_event_id
    AND (
      is_superadmin()
      OR EXISTS (
        SELECT 1 FROM SuperEventParticipants yo
        WHERE yo.super_event_id = p_super_event_id
          AND yo.municipality_id = current_tenant()
      )
    )
  ORDER BY m.name;
$$;

-- 7c. El tablero intercomunal.
--
--     Devuelve SOLO lo que la regla 6 del proyecto permite cruzar entre comunas:
--     ubicación, capacidad, % de llenado y estado operacional. NUNCA
--     CentersDescription, FamilyGroups, Persons ni cantidades de inventario.
--
--     Nuevo: cada centro viene etiquetado con la emergencia que lo aporta, porque
--     ahora el SuperEvento agrupa emergencias y el tablero las muestra agrupadas.
CREATE OR REPLACE FUNCTION super_event_shared_centers(p_super_event_id INT)
RETURNS TABLE (
  center_id VARCHAR, name TEXT, latitude DECIMAL, longitude DECIMAL,
  capacity INT, fullness_percentage INT, operational_status TEXT,
  municipality_id INT, municipality_shortname TEXT, activation_id INT,
  emergency_id INT, emergency_name TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.center_id, c.name::TEXT, c.latitude, c.longitude,
         c.capacity, c.fullness_percentage, c.operational_status::TEXT,
         c.municipality_id, m.shortname::TEXT, ca.activation_id,
         e.emergency_id, e.name::TEXT
  FROM Centers c
  JOIN Municipalities m ON m.municipality_id = c.municipality_id
  JOIN CentersActivations ca
    ON ca.center_id = c.center_id AND ca.ended_at IS NULL
  JOIN Emergencies e
    ON e.emergency_id = ca.emergency_id AND e.super_event_id = p_super_event_id
  JOIN SuperEvents se
    ON se.super_event_id = e.super_event_id AND se.ended_at IS NULL
  JOIN SuperEventParticipants duena
    ON duena.super_event_id = se.super_event_id
   AND duena.municipality_id = c.municipality_id
   AND duena.status = 'participando'
  WHERE c.is_active = TRUE
    AND (
      is_superadmin()
      OR EXISTS (
        SELECT 1 FROM SuperEventParticipants yo
        WHERE yo.super_event_id = p_super_event_id
          AND yo.municipality_id = current_tenant()
          AND yo.status = 'participando'
      )
    )
  ORDER BY m.name, e.name, c.name;
$$;

-- 7d. Prioridades compartidas entre comunas. Es la tercera y última política de
--     lectura de CenterItemPriority; las otras dos —la propia y la pública— están
--     en 002b.
CREATE POLICY cip_intermunicipal_read ON CenterItemPriority
  FOR SELECT
  USING (
    is_superadmin()
    OR center_id IN (SELECT s.center_id FROM super_event_shared_center_ids() s)
  );

-- 7e. Aviso de oferta a la comuna DESTINO. Igual que en 002c, pero sobre
--     super_event_id: la política centernotif_tenant solo deja escribir avisos
--     para la propia comuna, y avisarle a la otra es justamente el punto.
CREATE OR REPLACE FUNCTION notify_support_offer(p_offer_id INT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offer RECORD;
  v_from  TEXT;
  v_id    UUID;
BEGIN
  SELECT o.offer_id, o.super_event_id, o.from_municipality_id, o.target_center_id,
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

  -- Una fila POR PERSONA que pueda actuar sobre la oferta: read_at es por fila,
  -- así que un aviso compartido dejaría que el primero en leerlo apague el badge
  -- de todos los demás.
  INSERT INTO CenterNotifications
    (center_id, municipality_id, super_event_id, destinatary, title, message, channel, kind)
  SELECT
    v_offer.target_center_id,
    v_offer.target_municipality_id,
    v_offer.super_event_id,
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

  -- Si la comuna destino no tiene a nadie que pueda responder, el aviso queda
  -- dirigido a la comuna para que no se pierda.
  IF v_id IS NULL THEN
    INSERT INTO CenterNotifications
      (center_id, municipality_id, super_event_id, title, message, channel, kind)
    VALUES (
      v_offer.target_center_id,
      v_offer.target_municipality_id,
      v_offer.super_event_id,
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

-- 7f. Listado de ofertas con nombres resueltos.
--
--     Un JOIN normal a Centers pasa por RLS: la comuna que OFRECE no puede
--     resolver el nombre del centro ajeno y la fila saldría sin destino. Esta
--     función replica exactamente la visibilidad de la política cmso_read (origen,
--     destino o superadmin) y resuelve los nombres del lado de la base.
CREATE OR REPLACE FUNCTION support_offers_visible()
RETURNS TABLE (
  offer_id INT, super_event_id INT, super_event_name TEXT, super_event_level TEXT,
  from_municipality_id INT, from_municipality_name TEXT,
  target_center_id VARCHAR, target_center_name TEXT,
  target_municipality_id INT, target_municipality_name TEXT,
  item_id INT, item_name TEXT,
  message TEXT, status TEXT, created_at TIMESTAMPTZ,
  created_by INT, created_by_name TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT o.offer_id, o.super_event_id, se.name::TEXT, se.level::TEXT,
         o.from_municipality_id, mf.name::TEXT,
         o.target_center_id, c.name::TEXT,
         c.municipality_id, mt.name::TEXT,
         o.item_id, p.name::TEXT,
         o.message::TEXT, o.status::TEXT, o.created_at,
         o.created_by, u.nombre::TEXT
  FROM CrossMunicipalSupportOffers o
  JOIN SuperEvents se    ON se.super_event_id = o.super_event_id
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


-- 7g. Aviso de invitación a la comuna INVITADA
--
--     Mismo muro que resolvió notify_support_offer en 002c: la política
--     centernotif_tenant solo deja escribir avisos para la PROPIA comuna, y una
--     invitación tiene que aterrizar en la comuna de enfrente.
--
--     Antes esto no se notaba porque en la práctica solo invitaba el Super
--     Administrador, que pasa por is_superadmin(). Ahora invita cualquier comuna
--     participante (sep_write), así que el caso es la regla y no la excepción.
--
--     La función es deliberadamente estrecha: no recibe texto libre ni
--     destinatario, solo qué SuperEvento y a qué comuna. Verifica que quien llama
--     tenga derecho a invitar ahí y que la fila de invitación EXISTA —es decir,
--     que el INSERT en SuperEventParticipants ya haya pasado por sep_write— así
--     que no es un camino alternativo para invitar, solo para avisar.
CREATE OR REPLACE FUNCTION notify_super_event_invitation(
  p_super_event_id INT, p_municipality_id INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nombre     TEXT;
  v_invitante  TEXT;
  v_comuna_inv INT;
  v_mensaje    TEXT;
  v_insertadas INT;
BEGIN
  SELECT se.name, p.invited_by_municipality_id
    INTO v_nombre, v_comuna_inv
    FROM SuperEvents se
    JOIN SuperEventParticipants p
      ON p.super_event_id = se.super_event_id
     AND p.municipality_id = p_municipality_id
   WHERE se.super_event_id = p_super_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITACION_NO_EXISTE';
  END IF;

  -- Lo único que impide avisar a nombre de un SuperEvento ajeno: la lectura de
  -- arriba omite RLS por ser SECURITY DEFINER.
  IF NOT is_superadmin() AND NOT EXISTS (
       SELECT 1 FROM SuperEventParticipants yo
        WHERE yo.super_event_id = p_super_event_id
          AND yo.municipality_id = current_tenant()
          AND yo.status = 'participando'
     ) THEN
    RAISE EXCEPTION 'SOLO_UNA_COMUNA_PARTICIPANTE_PUEDE_INVITAR';
  END IF;

  IF v_comuna_inv IS NULL THEN
    v_invitante := 'El Super Administrador';
  ELSE
    SELECT 'La comuna de ' || name INTO v_invitante
      FROM Municipalities WHERE municipality_id = v_comuna_inv;
  END IF;

  v_mensaje := v_invitante || ' invitó a tu comuna a participar en "' || v_nombre ||
    '". Al aceptar deberás aportar una emergencia: puedes usar una existente o crear ' ||
    'una nueva. Los centros vinculados a esa emergencia compartirán sus necesidades ' ||
    'con las demás comunas participantes.';

  -- Una fila POR PERSONA que pueda responder: read_at es por fila, así que un
  -- aviso compartido dejaría que el primero en leerlo apague el badge de todos.
  INSERT INTO CenterNotifications
    (municipality_id, super_event_id, destinatary, title, message, channel, kind)
  SELECT p_municipality_id, p_super_event_id, u.user_id,
         'Invitación a un SuperEvento', v_mensaje, 'system', 'super_event_invitation'
    FROM Users u
   WHERE u.municipality_id = p_municipality_id
     AND u.is_active = TRUE
     AND (u.role_id = 1 OR u.es_apoyo_admin = TRUE);

  GET DIAGNOSTICS v_insertadas = ROW_COUNT;

  -- Si la comuna no tiene a nadie que pueda aceptarla, el aviso queda dirigido a
  -- la comuna para que la invitación no se pierda.
  IF v_insertadas = 0 THEN
    INSERT INTO CenterNotifications
      (municipality_id, super_event_id, title, message, channel, kind)
    VALUES (p_municipality_id, p_super_event_id,
            'Invitación a un SuperEvento', v_mensaje, 'system', 'super_event_invitation');
    v_insertadas := 1;
  END IF;

  RETURN v_insertadas;
END;
$$;


-- ----------------------------------------------------------
-- 8. Estado de las invitaciones a centros de UNA emergencia
--
--    Alimenta la pantalla de gestión continua: TODAS las activaciones abiertas de
--    la comuna, con su estado frente a esta emergencia y en cuál están hoy.
--
--    Es consulta de tenant normal —todo es de la propia comuna— así que NO es
--    SECURITY DEFINER: RLS la acota sola. Vive acá y no en el servicio para que
--    el COALESCE que reconcilia los dos caminos de vinculación quede en un solo
--    lugar: hay activaciones que entraron por invitación aceptada y otras que el
--    administrador vinculó a mano con link-activations, sin invitación previa.
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION emergency_activations_status(p_emergency_id INT)
RETURNS TABLE (
  activation_id INT, center_id VARCHAR, center_name TEXT, started_at TIMESTAMPTZ,
  emergencia_actual_id INT, emergencia_actual_nombre TEXT,
  estado_invitacion TEXT, invited_at TIMESTAMPTZ, responded_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT ca.activation_id, ca.center_id, c.name::TEXT, ca.started_at,
         ca.emergency_id, eo.name::TEXT,
         COALESCE(
           i.status,
           CASE WHEN ca.emergency_id = p_emergency_id THEN 'aceptada' ELSE 'sin_invitar' END
         )::TEXT,
         i.invited_at, i.responded_at
  FROM CentersActivations ca
  JOIN Centers c ON c.center_id = ca.center_id
  LEFT JOIN Emergencies eo ON eo.emergency_id = ca.emergency_id
  LEFT JOIN EmergencyActivationInvitations i
    ON i.emergency_id = p_emergency_id AND i.activation_id = ca.activation_id
  WHERE ca.ended_at IS NULL
  ORDER BY c.name;
$$;


-- ----------------------------------------------------------
-- 9. Permisos
-- ----------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appcopio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appcopio_app;

REVOKE ALL ON FUNCTION super_event_shared_center_ids()      FROM PUBLIC;
REVOKE ALL ON FUNCTION super_event_participants_of(INT)     FROM PUBLIC;
REVOKE ALL ON FUNCTION super_event_shared_centers(INT)      FROM PUBLIC;
REVOKE ALL ON FUNCTION emergency_activations_status(INT)    FROM PUBLIC;
REVOKE ALL ON FUNCTION notify_super_event_invitation(INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION notify_support_offer(INT)            FROM PUBLIC;
REVOKE ALL ON FUNCTION support_offers_visible()             FROM PUBLIC;

GRANT EXECUTE ON FUNCTION super_event_shared_center_ids()   TO appcopio_app;
GRANT EXECUTE ON FUNCTION super_event_participants_of(INT)  TO appcopio_app;
GRANT EXECUTE ON FUNCTION super_event_shared_centers(INT)   TO appcopio_app;
GRANT EXECUTE ON FUNCTION emergency_activations_status(INT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION notify_super_event_invitation(INT, INT) TO appcopio_app;
GRANT EXECUTE ON FUNCTION notify_support_offer(INT)         TO appcopio_app;
GRANT EXECUTE ON FUNCTION support_offers_visible()          TO appcopio_app;
