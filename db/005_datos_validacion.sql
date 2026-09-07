-- ==========================================================
-- 005_datos_validacion.sql
--
-- Datos para poder VALIDAR el multi-tenant de punta a punta.
--
-- Va en un archivo aparte y no dentro de 003_datos.sql por una razón concreta:
-- ./db se monta como docker-entrypoint-initdb.d y los scripts corren en orden
-- alfabético, así que este es el último. Aquí ya existen todos los usuarios y
-- centros de todas las comunas, y los SELECT de destinatario no devuelven NULL
-- —que es exactamente lo que le pasaba a la notificación de invitación cuando
-- vivía a mitad de 003_datos.sql, antes de que se crearan los usuarios de las
-- comunas nuevas.
--
-- Qué agrega:
--   1. Actividad real fuera de Valparaíso (sin esto el tablero intercomunal solo
--      puede funcionar en un sentido: emergency_shared_centers() exige centro
--      activo + activación vigente + comuna participando).
--   2. Tres emergencias en estados distintos, para cubrir el camino regional, el
--      de vinculación masiva y el municipal.
--   3. Ofertas de colaboración en los cuatro estados posibles.
--   4. Notificaciones dirigidas a quien puede actuar sobre ellas.
--
-- Corre como superusuario, así que no pasa por RLS. Ninguna notificación usa un
-- canal distinto de 'system': la validación NO debe enviar correos.
-- ==========================================================


-- ----------------------------------------------------------
-- 1. Un trabajador con apoyo admin en Viña
--
--    Hoy solo Valparaíso tiene uno (martinalina). Hace falta en una segunda comuna
--    para comprobar que los avisos intercomunales llegan al administrador Y a los
--    apoyos, y que tm.vina —trabajador sin apoyo— no los recibe.
-- ----------------------------------------------------------
INSERT INTO Users (username, password_hash, email, role_id, nombre, rut, is_active, es_apoyo_admin, municipality_id)
VALUES ('apoyo.vina', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m',
        'apoyo@vinadelmar.cl', 2, 'Camila Herrera', '30.444.444-4', TRUE, TRUE, 2);


-- ----------------------------------------------------------
-- 2. Activaciones vigentes fuera de Valparaíso
--
--    municipality_id va explícito: CentersActivations no tiene trigger de herencia
--    y el default temporal de sembrado (=1) de 003_datos.sql ya fue retirado.
-- ----------------------------------------------------------
INSERT INTO CentersActivations (center_id, activated_by, municipality_id, emergency_id, notes) VALUES
-- Viña participa de la emergencia 1: estos dos centros se comparten con las demás comunas.
('VINA-C001',  (SELECT user_id FROM Users WHERE username = 'admin.vina'),    2, 1,
 'Albergue principal por el incendio forestal.'),
('VINA-C002',  (SELECT user_id FROM Users WHERE username = 'admin.vina'),    2, 1,
 'Acopio vecinal para damnificados.'),
-- Quilpué las deja SIN emergencia a propósito: son las que se vinculan en lote en la E2.
('QUILP-C001', (SELECT user_id FROM Users WHERE username = 'admin.quilpue'), 3, NULL,
 'Activación preventiva por pronóstico de lluvia.'),
('QUILP-C002', (SELECT user_id FROM Users WHERE username = 'admin.quilpue'), 3, NULL,
 'Punto de acopio en El Belloto.');

-- Sincroniza la bandera redundante con las activaciones recién creadas.
UPDATE Centers c
SET is_active = EXISTS (
  SELECT 1 FROM CentersActivations ca
  WHERE ca.center_id = c.center_id AND ca.ended_at IS NULL
);


-- ----------------------------------------------------------
-- 3. Necesidades declaradas
--
--    Variadas a propósito: el mapa del tablero colorea el pin por la urgencia
--    máxima del centro, así que hacen falta centros altos, medios y sin ninguna
--    para ver la escala completa.
-- ----------------------------------------------------------
INSERT INTO CenterItemPriority (center_id, item_id, priority, updated_by) VALUES
-- Viña: una alta y una media. VINA-C002 queda sin prioridades (pin gris).
('VINA-C001', 3, 'alto',  (SELECT user_id FROM Users WHERE username = 'admin.vina')),
('VINA-C001', 8, 'medio', (SELECT user_id FROM Users WHERE username = 'admin.vina')),
-- Quilpué: solo medias. Sus prioridades NO deben verse hasta que acepte la invitación.
('QUILP-C001', 1, 'medio', (SELECT user_id FROM Users WHERE username = 'admin.quilpue')),
('QUILP-C001', 6, 'medio', (SELECT user_id FROM Users WHERE username = 'admin.quilpue'));


-- ----------------------------------------------------------
-- 4. Emergencias 2 y 3
--
--    E1 (sembrada en 003) es regional y ya está en marcha.
--    E2 es regional y sirve para la vinculación masiva: Quilpué participa pero sus
--       activaciones están sueltas.
--    E3 la declara una COMUNA (Viña), camino que ningún dato sembrado cubría.
-- ----------------------------------------------------------
INSERT INTO Emergencies (emergency_id, name, type, created_by, created_by_municipality_id) VALUES
(2, 'Sistema frontal región de Valparaíso', 'temporal',
 (SELECT user_id FROM Users WHERE username = 'superadmin'), NULL),
(3, 'Aluvión quebrada Viña del Mar', 'aluvion',
 (SELECT user_id FROM Users WHERE username = 'admin.vina'), 2);

SELECT setval('emergencies_emergency_id_seq', (SELECT MAX(emergency_id) FROM Emergencies));

INSERT INTO EmergencyParticipants (emergency_id, municipality_id, status, invited_by, responded_at) VALUES
-- E2: tres comunas dentro, Concón invitada y pendiente de responder.
(2, 1, 'participando', (SELECT user_id FROM Users WHERE username = 'superadmin'), now()),
(2, 2, 'participando', (SELECT user_id FROM Users WHERE username = 'superadmin'), now()),
(2, 3, 'participando', (SELECT user_id FROM Users WHERE username = 'superadmin'), now()),
(2, 4, 'invitada',     (SELECT user_id FROM Users WHERE username = 'superadmin'), NULL),
-- E3: la declara Viña, que queda dentro; Valparaíso pendiente y Concón ya rechazó.
(3, 2, 'participando', NULL, now()),
(3, 1, 'invitada',     (SELECT user_id FROM Users WHERE username = 'admin.vina'), NULL),
(3, 4, 'rechazada',    (SELECT user_id FROM Users WHERE username = 'admin.vina'), now());


-- ----------------------------------------------------------
-- 5. Ofertas de colaboración en los cuatro estados
--
--    Todas en la emergencia 1, la única con centros compartidos en ambos sentidos,
--    para que las dos bandejas (enviadas / recibidas) tengan contenido desde los
--    dos lados.
-- ----------------------------------------------------------
INSERT INTO CrossMunicipalSupportOffers
  (emergency_id, from_municipality_id, target_center_id, item_id, message, created_by, status) VALUES
-- Pendiente: es la que se acepta o rechaza a mano durante la validación.
(1, 2, 'VALPO-C001', 1, 'Tenemos 400 botellas de agua listas para traslado esta tarde.',
 (SELECT user_id FROM Users WHERE username = 'admin.vina'), 'pending'),
-- Aceptada y rechazada, en el sentido contrario.
(1, 1, 'VINA-C001', 3, 'Podemos enviar 50 kits de higiene.',
 (SELECT user_id FROM Users WHERE username = 'admin'), 'accepted'),
(1, 1, 'VINA-C002', NULL, 'Ofrecemos apoyo general con voluntarios.',
 (SELECT user_id FROM Users WHERE username = 'admin'), 'rejected'),
-- Cancelada por quien la ofreció.
(1, 2, 'VALPO-C002', 2, 'Teníamos frazadas disponibles, pero ya se comprometieron.',
 (SELECT user_id FROM Users WHERE username = 'admin.vina'), 'cancelled');


-- ----------------------------------------------------------
-- 6. Notificaciones en pantalla, dirigidas a quien puede actuar
--
--    Una fila POR PERSONA (administrador y trabajadores con es_apoyo_admin), igual
--    que hace la aplicación: read_at es por fila, así que un aviso compartido
--    dejaría que el primero en leerlo apague el badge de todos los demás.
--
--    channel = 'system': aviso solo por aplicación, sin correo.
-- ----------------------------------------------------------

-- Invitación pendiente de la E1 a Quilpué.
INSERT INTO CenterNotifications (municipality_id, emergency_id, destinatary, kind, title, message, channel)
SELECT 3, 1, u.user_id, 'emergency_invitation', 'Invitación a emergencia',
       'El Super Administrador invitó a tu comuna a participar en "Incendio forestal Valparaíso 2024". ' ||
       'Al aceptar, compartirás las prioridades de tus centros activos con las demás comunas participantes.',
       'system'
FROM Users u
WHERE u.municipality_id = 3 AND u.is_active = TRUE AND (u.role_id = 1 OR u.es_apoyo_admin = TRUE);

-- Invitación pendiente de la E2 a Concón.
INSERT INTO CenterNotifications (municipality_id, emergency_id, destinatary, kind, title, message, channel)
SELECT 4, 2, u.user_id, 'emergency_invitation', 'Invitación a emergencia',
       'El Super Administrador invitó a tu comuna a participar en "Sistema frontal región de Valparaíso".',
       'system'
FROM Users u
WHERE u.municipality_id = 4 AND u.is_active = TRUE AND (u.role_id = 1 OR u.es_apoyo_admin = TRUE);

-- Invitación pendiente de la E3 a Valparaíso (la declaró Viña, no el Super Admin).
INSERT INTO CenterNotifications (municipality_id, emergency_id, destinatary, kind, title, message, channel)
SELECT 1, 3, u.user_id, 'emergency_invitation', 'Invitación a emergencia',
       'La comuna de Viña del Mar invitó a tu comuna a participar en "Aluvión quebrada Viña del Mar".',
       'system'
FROM Users u
WHERE u.municipality_id = 1 AND u.is_active = TRUE AND (u.role_id = 1 OR u.es_apoyo_admin = TRUE);

-- Aviso de la oferta pendiente, a Valparaíso. Lleva centro Y emergencia, pero se
-- atiende en la bandeja de ofertas: por eso el kind, y no la forma de los campos,
-- decide a dónde enlaza.
INSERT INTO CenterNotifications
  (center_id, municipality_id, emergency_id, destinatary, kind, title, message, channel)
SELECT 'VALPO-C001', 1, 1, u.user_id, 'support_offer', 'Ofrecimiento de apoyo de otra comuna',
       'Viña del Mar ofrece apoyo para Gimnasio Municipal de Valparaíso. ' ||
       'Revisa la oferta para aceptarla o rechazarla.',
       'system'
FROM Users u
WHERE u.municipality_id = 1 AND u.is_active = TRUE AND (u.role_id = 1 OR u.es_apoyo_admin = TRUE);


-- ==========================================================
-- COMPROBACIONES DEL SEMBRADO
-- Se leen en la salida de `docker compose logs db` al levantar de cero.
-- ==========================================================

-- Centros activos por comuna. Esperado: las cuatro comunas con al menos uno.
SELECT m.shortname, COUNT(*) FILTER (WHERE c.is_active) AS centros_activos
FROM Municipalities m
JOIN Centers c ON c.municipality_id = m.municipality_id
GROUP BY m.municipality_id, m.shortname
ORDER BY m.municipality_id;

-- Participación por emergencia y estado.
SELECT e.emergency_id, e.name, ep.status, COUNT(*) AS comunas
FROM Emergencies e
JOIN EmergencyParticipants ep ON ep.emergency_id = e.emergency_id
GROUP BY e.emergency_id, e.name, ep.status
ORDER BY e.emergency_id, ep.status;

-- Ofertas por estado. Esperado: una de cada uno.
SELECT status, COUNT(*) FROM CrossMunicipalSupportOffers GROUP BY status ORDER BY status;

-- Notificaciones sin destinatario. ESPERADO: 0 filas.
-- Una notificación sin destinatario la ve todo el personal de la comuna, incluido
-- quien no puede actuar sobre ella.
SELECT notification_id, kind, title, municipality_id
FROM CenterNotifications
WHERE destinatary IS NULL;

-- Notificaciones sin kind. ESPERADO: 0 filas.
SELECT notification_id, title FROM CenterNotifications WHERE kind IS NULL;

SELECT 'Datos de validación sembrados.';
