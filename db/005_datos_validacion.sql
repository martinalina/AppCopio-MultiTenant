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
-- Qué agrega, ya sobre el modelo de SUPEREVENTOS de 002d:
--   1. Actividad real fuera de Valparaíso (sin esto el tablero intercomunal solo
--      puede funcionar en un sentido: super_event_shared_centers() exige centro
--      activo + activación vigente + comuna participando).
--   2. Tres SuperEventos en estados distintos: uno regional en marcha, uno
--      autocreado por una comuna, y uno CERRADO para comprobar que el cierre
--      corta el acceso de verdad.
--   3. Una emergencia LOCAL sin SuperEvento, que es el caso más común.
--   4. Invitaciones a centros en todos sus estados, para la pantalla de gestión.
--   5. Ofertas de colaboración en los cuatro estados posibles.
--   6. Notificaciones dirigidas a quien puede actuar sobre ellas.
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
-- 2. SuperEventos 2 y 3
--
--    SE1 lo siembra 003: regional, nivel 'mayor', en marcha, con la emergencia
--       de Valparaíso ya dentro.
--    SE2 lo AUTOCREA una comuna (Viña) al querer colaborar: por eso
--       created_by_municipality_id = 2 y no NULL. Es el camino 3 del diseño.
--    SE3 está CERRADO. Existe para comprobar el cambio de conducta de 002d: sus
--       emergencias y activaciones siguen ABIERTAS, y aun así no debe compartirse
--       ni un solo centro. Antes de 002d el cierre era puramente informativo.
-- ----------------------------------------------------------
INSERT INTO SuperEvents (super_event_id, name, level, type, description, created_by, created_by_municipality_id, ended_at) VALUES
(2, 'Aluvión Marga Marga', 'desastre', 'aluvion',
 'Sobrepasa la capacidad regional: requiere movilización de recursos a nivel nacional.',
 (SELECT user_id FROM Users WHERE username = 'admin.vina'), 2, NULL),
(3, 'Temporal agosto 2024', 'mayor', 'temporal',
 'Cerrado. Sirve para verificar que el cierre corta el acceso intercomunal.',
 (SELECT user_id FROM Users WHERE username = 'superadmin'), NULL, now() - interval '2 days');

SELECT setval('superevents_super_event_id_seq', (SELECT MAX(super_event_id) FROM SuperEvents));


-- ----------------------------------------------------------
-- 3. Emergencias 2 a 6
--
--    TODAS son locales de una comuna: created_by_municipality_id es NOT NULL
--    desde 002d. La "emergencia regional" del Super Administrador ya no existe.
--
--    E3 queda deliberadamente SIN SuperEvento: es el caso más común (evento menor
--    acotado a una comuna) y es la emergencia que Quilpué puede aportar cuando
--    acepte la invitación al SE1.
-- ----------------------------------------------------------
INSERT INTO Emergencies (emergency_id, name, type, created_by, created_by_municipality_id, super_event_id) VALUES
(2, 'Incendio forestal Viña del Mar 2024', 'incendio',
 (SELECT user_id FROM Users WHERE username = 'admin.vina'), 2, 1),
(3, 'Sistema frontal Quilpué', 'temporal',
 (SELECT user_id FROM Users WHERE username = 'admin.quilpue'), 3, NULL),
(4, 'Aluvión quebrada Viña del Mar', 'aluvion',
 (SELECT user_id FROM Users WHERE username = 'admin.vina'), 2, 2),
(5, 'Temporal agosto Concón', 'temporal',
 (SELECT user_id FROM Users WHERE username = 'admin.concon'), 4, 3),
(6, 'Temporal agosto Viña', 'temporal',
 (SELECT user_id FROM Users WHERE username = 'admin.vina'), 2, 3);

SELECT setval('emergencies_emergency_id_seq', (SELECT MAX(emergency_id) FROM Emergencies));


-- ----------------------------------------------------------
-- 4. Participación en los SuperEventos
--
--    SE1 ya trae de 003: Valparaíso participando y Quilpué invitada.
--    Se agrega Viña participando, que es la que hace posible el tablero en los
--    dos sentidos.
-- ----------------------------------------------------------
INSERT INTO SuperEventParticipants
  (super_event_id, municipality_id, status, invited_by, invited_by_municipality_id, responded_at) VALUES
-- SE1: Viña acepta y aporta su emergencia 2.
(1, 2, 'participando', (SELECT user_id FROM Users WHERE username = 'superadmin'), NULL, now()),
-- SE2: lo autocreó Viña, que queda dentro; Valparaíso pendiente y Concón ya rechazó.
--      invited_by_municipality_id = 2 deja ver que invitó una comuna, no el Super Admin.
(2, 2, 'participando', NULL, NULL, now()),
(2, 1, 'invitada',   (SELECT user_id FROM Users WHERE username = 'admin.vina'), 2, NULL),
(2, 4, 'rechazada',  (SELECT user_id FROM Users WHERE username = 'admin.vina'), 2, now()),
-- SE3 (cerrado): dos comunas participando y con centros activos. Aun así el
--     tablero debe devolver 0 filas, porque el SuperEvento tiene ended_at.
(3, 4, 'participando', (SELECT user_id FROM Users WHERE username = 'superadmin'), NULL, now()),
(3, 2, 'participando', (SELECT user_id FROM Users WHERE username = 'superadmin'), NULL, now());


-- ----------------------------------------------------------
-- 5. Activaciones vigentes fuera de Valparaíso
--
--    municipality_id va explícito: CentersActivations no tiene trigger de herencia
--    y el default temporal de sembrado (=1) de 003_datos.sql ya fue retirado.
-- ----------------------------------------------------------
INSERT INTO CentersActivations (center_id, activated_by, municipality_id, emergency_id, notes) VALUES
-- Viña aporta estos dos al SE1 a través de su emergencia 2.
('VINA-C001',  (SELECT user_id FROM Users WHERE username = 'admin.vina'),    2, 2,
 'Albergue principal por el incendio forestal.'),
('VINA-C002',  (SELECT user_id FROM Users WHERE username = 'admin.vina'),    2, 2,
 'Acopio vecinal para damnificados.'),
-- Quilpué las deja SUELTAS a propósito (emergency_id NULL): son el material de la
-- pantalla de gestión de centros y de la vinculación en lote.
('QUILP-C001', (SELECT user_id FROM Users WHERE username = 'admin.quilpue'), 3, NULL,
 'Activación preventiva por pronóstico de lluvia.'),
('QUILP-C002', (SELECT user_id FROM Users WHERE username = 'admin.quilpue'), 3, NULL,
 'Punto de acopio en El Belloto.'),
-- Estas dos cuelgan del SuperEvento CERRADO. Activación abierta y emergencia
-- abierta: lo único cerrado es el SuperEvento, que es justo lo que se prueba.
('VINA-C003',  (SELECT user_id FROM Users WHERE username = 'admin.vina'),    2, 6,
 'Albergue por temporal de agosto.'),
('CONCO-C001', (SELECT user_id FROM Users WHERE username = 'admin.concon'),  4, 5,
 'Albergue por temporal de agosto.');

-- Sincroniza la bandera redundante con las activaciones recién creadas.
UPDATE Centers c
SET is_active = EXISTS (
  SELECT 1 FROM CentersActivations ca
  WHERE ca.center_id = c.center_id AND ca.ended_at IS NULL
);


-- ----------------------------------------------------------
-- 6. Invitaciones a centros, en todos sus estados
--
--    Es lo que alimenta la pantalla de gestión continua: sin estas filas, el
--    administrador no puede distinguir "nunca se invitó" de "se invitó y
--    rechazó", que es el hueco que 002d vino a tapar.
--
--    Las de Viña entraron aceptadas. Las de Quilpué quedan una RECHAZADA y una
--    PENDIENTE frente a su emergencia 3, así que la pantalla tiene los cuatro
--    estados: aceptada (Viña), rechazada y invitada (Quilpué) y sin_invitar
--    (VALPO-C003, que no tiene fila en ninguna emergencia).
-- ----------------------------------------------------------
INSERT INTO EmergencyActivationInvitations
  (emergency_id, activation_id, status, invited_by, responded_by, responded_at)
SELECT 2, ca.activation_id, 'aceptada',
       (SELECT user_id FROM Users WHERE username = 'admin.vina'),
       (SELECT user_id FROM Users WHERE username = 'admin.vina'), now()
FROM CentersActivations ca
WHERE ca.center_id IN ('VINA-C001', 'VINA-C002') AND ca.ended_at IS NULL;

INSERT INTO EmergencyActivationInvitations
  (emergency_id, activation_id, status, invited_by, responded_by, responded_at)
-- Rechazada: el centro dijo que no. OJO que ca.emergency_id sigue NULL y no se
-- toca — rechazar no debe desvincular al centro de donde ya estaba.
SELECT 3, ca.activation_id, 'rechazada',
       (SELECT user_id FROM Users WHERE username = 'admin.quilpue'),
       (SELECT user_id FROM Users WHERE username = 'admin.quilpue'), now()
FROM CentersActivations ca
WHERE ca.center_id = 'QUILP-C001' AND ca.ended_at IS NULL;

INSERT INTO EmergencyActivationInvitations
  (emergency_id, activation_id, status, invited_by)
-- Pendiente de responder.
SELECT 3, ca.activation_id, 'invitada',
       (SELECT user_id FROM Users WHERE username = 'admin.quilpue')
FROM CentersActivations ca
WHERE ca.center_id = 'QUILP-C002' AND ca.ended_at IS NULL;


-- ----------------------------------------------------------
-- 7. Necesidades declaradas
--
--    Variadas a propósito: el mapa del tablero colorea el pin por la urgencia
--    máxima del centro, así que hacen falta centros altos, medios y sin ninguna
--    para ver la escala completa.
-- ----------------------------------------------------------
INSERT INTO CenterItemPriority (center_id, item_id, priority, updated_by) VALUES
-- Viña: una alta y una media. VINA-C002 queda sin prioridades (pin gris).
('VINA-C001', 3, 'alto',  (SELECT user_id FROM Users WHERE username = 'admin.vina')),
('VINA-C001', 8, 'medio', (SELECT user_id FROM Users WHERE username = 'admin.vina')),
-- Quilpué: solo medias. Sus prioridades NO deben verse hasta que acepte la
-- invitación al SE1 Y aporte una emergencia con centros vinculados.
('QUILP-C001', 1, 'medio', (SELECT user_id FROM Users WHERE username = 'admin.quilpue')),
('QUILP-C001', 6, 'medio', (SELECT user_id FROM Users WHERE username = 'admin.quilpue')),
-- Concón, dentro del SuperEvento CERRADO: estas prioridades NO deben ser visibles
-- para Viña, aunque ambas comunas estén 'participando' en ese SuperEvento.
('CONCO-C001', 1, 'alto', (SELECT user_id FROM Users WHERE username = 'admin.concon'));


-- ----------------------------------------------------------
-- 8. Ofertas de colaboración en los cuatro estados
--
--    Todas en el SuperEvento 1, el único con centros compartidos en ambos
--    sentidos, para que las dos bandejas (enviadas / recibidas) tengan contenido
--    desde los dos lados.
-- ----------------------------------------------------------
INSERT INTO CrossMunicipalSupportOffers
  (super_event_id, from_municipality_id, target_center_id, item_id, message, created_by, status) VALUES
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
-- 9. Notificaciones en pantalla, dirigidas a quien puede actuar
--
--    Una fila POR PERSONA (administrador y trabajadores con es_apoyo_admin), igual
--    que hace la aplicación: read_at es por fila, así que un aviso compartido
--    dejaría que el primero en leerlo apague el badge de todos los demás.
--
--    channel = 'system': aviso solo por aplicación, sin correo.
-- ----------------------------------------------------------

-- Invitación pendiente del SE1 a Quilpué. La declaró el Super Administrador.
INSERT INTO CenterNotifications (municipality_id, super_event_id, destinatary, kind, title, message, channel)
SELECT 3, 1, u.user_id, 'super_event_invitation', 'Invitación a un SuperEvento',
       'El Super Administrador invitó a tu comuna a participar en "Incendio forestal región de Valparaíso 2024". ' ||
       'Al aceptar deberás aportar una emergencia: puedes usar una existente o crear una nueva.',
       'system'
FROM Users u
WHERE u.municipality_id = 3 AND u.is_active = TRUE AND (u.role_id = 1 OR u.es_apoyo_admin = TRUE);

-- Invitación pendiente del SE2 a Valparaíso. La mandó OTRA COMUNA (Viña), no el
-- Super Administrador: es el camino que habilita sep_write.
INSERT INTO CenterNotifications (municipality_id, super_event_id, destinatary, kind, title, message, channel)
SELECT 1, 2, u.user_id, 'super_event_invitation', 'Invitación a un SuperEvento',
       'La comuna de Viña del Mar invitó a tu comuna a participar en "Aluvión Marga Marga".',
       'system'
FROM Users u
WHERE u.municipality_id = 1 AND u.is_active = TRUE AND (u.role_id = 1 OR u.es_apoyo_admin = TRUE);

-- Invitación pendiente de un CENTRO de Quilpué a su emergencia local 3.
--
-- Va dirigida al administrador de la comuna porque estas activaciones de prueba no
-- tienen encargado asignado (ActivationAssignments vacío para Quilpué) ni
-- municipal_manager_id: es el mismo respaldo que aplica la aplicación cuando no
-- encuentra a nadie más específico.
INSERT INTO CenterNotifications
  (center_id, activation_id, municipality_id, emergency_id, destinatary, kind, title, message, channel)
SELECT ca.center_id, ca.activation_id, 3, 3,
       (SELECT user_id FROM Users WHERE username = 'admin.quilpue'),
       'activation_invitation', 'Tu centro puede sumarse a una emergencia',
       'Tu comuna abrió "Sistema frontal Quilpué". ¿Quieres que este centro participe?',
       'system'
FROM CentersActivations ca
WHERE ca.center_id = 'QUILP-C002' AND ca.ended_at IS NULL;

-- Aviso de la oferta pendiente, a Valparaíso. Lleva centro Y superevento, pero se
-- atiende en la bandeja de ofertas: por eso el kind, y no la forma de los campos,
-- decide a dónde enlaza.
INSERT INTO CenterNotifications
  (center_id, municipality_id, super_event_id, destinatary, kind, title, message, channel)
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

-- Participación por SuperEvento y estado.
SELECT se.super_event_id, se.name, se.level,
       CASE WHEN se.ended_at IS NULL THEN 'vigente' ELSE 'cerrado' END AS estado,
       p.status, COUNT(*) AS comunas
FROM SuperEvents se
JOIN SuperEventParticipants p ON p.super_event_id = se.super_event_id
GROUP BY se.super_event_id, se.name, se.level, se.ended_at, p.status
ORDER BY se.super_event_id, p.status;

-- Emergencias: a qué SuperEvento aporta cada comuna. ESPERADO: E3 con
-- super_event_id NULL (emergencia menor suelta) y ninguna comuna repetida dentro
-- del mismo SuperEvento.
SELECT e.emergency_id, e.name, m.shortname AS comuna, e.super_event_id
FROM Emergencies e
JOIN Municipalities m ON m.municipality_id = e.created_by_municipality_id
ORDER BY e.emergency_id;

-- Ninguna emergencia puede quedar sin comuna. ESPERADO: 0 filas.
SELECT emergency_id, name FROM Emergencies WHERE created_by_municipality_id IS NULL;

-- Estado de las invitaciones a centros. Esperado: aceptada 2, rechazada 1,
-- invitada 1 (VALPO-C003 y las demás quedan sin fila = 'sin_invitar').
SELECT status, COUNT(*) FROM EmergencyActivationInvitations GROUP BY status ORDER BY status;

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

-- El SuperEvento cerrado NO debe compartir centros. Se comprueba desde el tenant
-- de Viña, que participa tanto del SE1 (vigente) como del SE3 (cerrado).
-- ESPERADO: solo centros de Valparaíso; NINGUNO de Concón.
-- SET a secas, no SET LOCAL: psql corre cada sentencia en autocommit y SET LOCAL
-- fuera de una transacción no hace nada (solo emite un WARNING).
SET app.current_tenant = '2';
SELECT 'Centros visibles para Viña' AS comprobacion, s.center_id
FROM super_event_shared_center_ids() s
ORDER BY s.center_id;
RESET app.current_tenant;

SELECT 'Datos de validación sembrados.';
