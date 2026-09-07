-- ==========================================================
-- PASO 3: INSERCIÓN DE DATOS DE PRUEBA COMPLETOS
-- ==========================================================

-- Roles base.
-- Ids EXPLÍCITOS: el rol 4 (Super Administrador) ya se insertó en 002a, así que si
-- estos tres dependieran del SERIAL quedarían como 5/6/7 y todos los role_id = 1/2/3
-- de más abajo violarían la FK. El setval va al final del archivo.
INSERT INTO Roles (role_id, role_name) VALUES
(1, 'Administrador'),
(2, 'Trabajador Municipal'),
(3, 'Contacto Ciudadano');

-- ==========================================================
-- MUNICIPALIDADES
-- Ids explícitos para que el resto del seed sea determinista.
-- Todo el contenido histórico de este archivo pertenece a Valparaíso (id 1).
-- ==========================================================
INSERT INTO Municipalities (municipality_id, name, shortname) VALUES
(1, 'Valparaíso',   'VALPO'),
(2, 'Viña del Mar', 'VINA'),
(3, 'Quilpué',      'QUILP'),
(4, 'Concón',       'CONCO');
SELECT setval('municipalities_municipality_id_seq', (SELECT MAX(municipality_id) FROM Municipalities));

-- ==========================================================
-- DEFAULT TEMPORAL DE SEMBRADO
-- El bloque histórico de abajo (usuarios, inventarios, activaciones, personas y
-- familias de Valparaíso) no trae municipality_id en sus listas de columnas.
-- En vez de editar ~150 tuplas a mano, se fija un default de sembrado y se ELIMINA
-- al final del archivo. La app nunca debe depender de estos defaults: el
-- municipality_id siempre viene del JWT o de la entidad padre.
-- ==========================================================
ALTER TABLE Users                ALTER COLUMN municipality_id SET DEFAULT 1;
ALTER TABLE CentersActivations   ALTER COLUMN municipality_id SET DEFAULT 1;
ALTER TABLE Persons              ALTER COLUMN municipality_id SET DEFAULT 1;
ALTER TABLE FamilyGroups         ALTER COLUMN municipality_id SET DEFAULT 1;
ALTER TABLE CenterInventoryItems ALTER COLUMN municipality_id SET DEFAULT 1;

-- Usuarios de prueba (contraseña para todos: '12345')
INSERT INTO Users (username, password_hash, email, role_id, nombre, rut, is_active, es_apoyo_admin)
VALUES
('admin', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'admin@appcopio.cl', 1, 'Admin AppCopio', '11.111.111-1', TRUE, TRUE),
('juan.perez', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'juan.perez@municipalidad.cl', 2, 'Juan Pérez', '22.222.222-2', TRUE, FALSE),
('carla.rojas', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'carla.rojas@comunidad.cl', 3, 'Carla Rojas', '33.333.333-3', TRUE, FALSE),
('martinalina', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'martinalinamandarina@gmail.com', 2, 'Martina Tejo', '44.444.444-4', TRUE, TRUE),
('tito', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'tito.orellana@usm.cl', 2, 'Tito Orellana', '55.333.333-3', TRUE, FALSE),
('bruno', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'bruno.bonati@usm.cl', 2, 'Bruno Bonati', '55.533.333-3', TRUE, FALSE),
('paali', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'pali@comunidad.cl', 3, 'Paula Castillo', '53.333.333-3', TRUE, FALSE),
('mati', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'matias@comunidad.cl', 3, 'Matias Godoy', '55.553.333-3', TRUE, FALSE),
('paulsen', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'bpaulsenm@gmail.com', 3, 'Benjamin Paulsen', '55.555.333-3', TRUE, FALSE);
INSERT INTO Users (username, password_hash, email, role_id, nombre, rut, celular, is_active, es_apoyo_admin)
VALUES
('maria.saavedra', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'maria.saavedra@comunidad.cl', 3, 'María Saavedra', '12.345.678-5', '987654321', TRUE, FALSE), -- Sede Vecinal Cerro Cordillera
('rodrigo.pizarro', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'rodrigo.pizarro@daemvalpo.cl', 3, 'Rodrigo Pizarro', '16.789.234-3', '987650001', TRUE, FALSE),-- Escuela Básica Cerro Las Cañas
('cesar.rojas', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'cesar.rojas@comunidad.cl', 3, 'César Rojas', '14.256.789-2', '987650002', TRUE, FALSE), -- Centro Comunitario El Litre
('patricia.olivares', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'patricia.olivares@comunidad.cl', 3, 'Patricia Olivares', '13.579.246-1', '987650003', TRUE, FALSE),-- Sede Vecinal Cerro Polanco
('gonzalo.arancibia', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'gonzalo.arancibia@comunidad.cl', 3, 'Gonzalo Arancibia', '18.345.672-9', '987650004', TRUE, FALSE), -- Centro Cultural Playa Ancha
('hector.munoz', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'hector.munoz@comunidad.cl', 3, 'Héctor Muñoz', '17.234.568-4', '987650005', TRUE, FALSE), -- Sede Juntas de Vecinos Cerro Barón
('carolina.jeldes', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m',  'carolina.jeldes@daemvalpo.cl', 3, 'Carolina Jeldes', '19.876.543-2', '987650006', TRUE, FALSE), -- Escuela Básica Los Placeres
('ivan.veliz', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m','ivan.veliz@deportes.cl', 3, 'Iván Véliz', '20.123.456-8', '987650007', TRUE, FALSE); -- Centro Deportivo Rodelillo

-- Super Administrador: sin comuna (lo exige users_municipality_role_chk).
-- Solo crea municipalidades y su primer administrador; el resto lo ve, no lo modifica.
-- Va DESPUÉS de los usuarios de prueba a propósito: el resto del archivo referencia
-- user_id 1..17 a mano (updated_by, requested_by, activated_by, changed_by), así que
-- insertarlo antes correría todos esos ids en uno.
INSERT INTO Users (username, password_hash, email, role_id, nombre, rut, is_active, es_apoyo_admin, municipality_id)
VALUES ('superadmin', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'superadmin@appcopio.cl', 4, 'Super Administrador', '10.000.000-0', TRUE, FALSE, NULL);

-- Centros de Valparaíso, con center_id EXPLÍCITO.
-- El trigger trg_generate_center_id respeta un center_id que venga en el INSERT
-- (`IF NEW.center_id IS NOT NULL THEN RETURN NEW`), así que sembrar los ids a mano
-- mantiene el archivo determinista y deja intactas las ~158 referencias de más abajo.
-- El contador de la comuna se sincroniza justo después.
INSERT INTO Centers (center_id, municipality_id, name, address, type, capacity, latitude, longitude) VALUES
('VALPO-C001', 1, 'Gimnasio Municipal de Valparaíso', 'Av. Argentina 123', 'albergue', 150, -33.0458, -71.6197),
('VALPO-C002', 1, 'Liceo Bicentenario', 'Independencia 456', 'albergue comunitario', 80, -33.0465, -71.6212),
('VALPO-C003', 1, 'Sede Vecinal Cerro Alegre', 'Lautaro Rosas 789', 'albergue comunitario', 50, -33.0401, -71.6285),
('VALPO-C004', 1, 'Escuela República de Uruguay', 'Av. Uruguay 321', 'albergue', 120, -33.0475, -71.6143),
('VALPO-C005', 1, 'Sede Vecinal Cerro Cordillera', 'Calle Castillo 210, Cerro Cordillera', 'albergue comunitario', 70, -33.0448, -71.6259),
('VALPO-C006', 1, 'Escuela Básica Cerro Las Cañas', 'Av. Alemania 3950, Cerro Las Cañas', 'albergue', 100, -33.0469, -71.5955),
('VALPO-C007', 1, 'Centro Comunitario El Litre', 'San Juan de Dios 950, El Litre', 'albergue comunitario', 80, -33.0462, -71.6135),
('VALPO-C008', 1, 'Sede Vecinal Cerro Polanco', 'Calle Polanco 120, Cerro Polanco', 'albergue', 90, -33.0477, -71.6032),
('VALPO-C009', 1, 'Centro Cultural Playa Ancha', 'Av. Gran Bretaña 1200', 'albergue', 110, -33.0335, -71.6460),
('VALPO-C010', 1, 'Sede Juntas de Vecinos Cerro Barón', 'Av. Matta 850', 'albergue comunitario', 60, -33.0400, -71.6000),
('VALPO-C011', 1, 'Escuela Básica Los Placeres', 'Av. Los Placeres 200', 'albergue', 20, -33.0450, -71.5740),
('VALPO-C012', 1, 'Centro Deportivo Rodelillo', 'Av. Rodelillo 1500', 'albergue comunitario', 70, -33.0640, -71.5680);

-- El próximo centro que cree un admin de Valparaíso debe ser VALPO-C013.
UPDATE Municipalities SET center_seq_counter = 12 WHERE municipality_id = 1;

-- Centers Descriptions
INSERT INTO CentersDescription (
    center_id,
    nombre_organizacion,
    nombre_dirigente,
    cargo_dirigente,
    telefono_contacto,
    tipo_inmueble,
    numero_habitaciones,
    estado_conservacion,
    muro_hormigon,
    piso_radier,
    techo_losa,
    observaciones_espacios_comunes,
    agua_potable,
    electricidad,
    alcantarillado,
    estado_banos,
    wc_proporcion_personas,
    duchas_proporcion_personas,
    observaciones_banos_y_servicios_higienicos,
    posee_habitaciones,
    separacion_familias,
    observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas,
    cocina_comedor_adecuados,
    cuenta_con_refrigerador,
    sistema_evacuacion_definido,
    observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro,
    existe_lugar_animales_fuera,
    observaciones_dimension_animal,
    existen_extintores,
    existen_generadores,
    existen_luces_emergencias
) VALUES (
    'VALPO-C001',
    'Municipalidad de Valparaíso',
    'Juan Herrera',
    'Encargado de Operaciones',
    '987654321',
    'Edificio público',
    10,
    5, -- Excelente
    TRUE,
    TRUE,
    TRUE,
    'Amplios espacios para albergue, buena iluminación y ventilación.',
    5, -- Excelente
    5, -- Excelente
    5, -- Excelente
    5, -- Excelente
    4, -- Buena proporción
    4, -- Buena proporción
    'Baños en buen estado, limpios y con acceso para personas con movilidad reducida.',
    3, -- Con habitaciones
    3, -- Separa a las familias
    'Las habitaciones están separadas por mamparas para dar privacidad a las familias.',
    5, -- Excelente
    4, -- Adecuado
    5, -- Sí, hay varios
    5, -- Sí, definido
    'El plan de evacuación está claramente señalizado y se realizan simulacros regularmente.',
    1, -- Sí, dentro
    4, -- Sí, fuera con espacio separado
    'Se habilitó un área exterior para mascotas con jaulas y recipientes de agua.',
    TRUE,
    TRUE,
    TRUE
);

-- Datos de descripción para el Liceo Bicentenario (C002)
INSERT INTO CentersDescription (
    center_id,
    nombre_organizacion,
    telefono_contacto,
    tipo_inmueble,
    numero_habitaciones,
    estado_conservacion,
    muro_albaneria,
    piso_baldosa,
    techo_losa,
    espacio_10_afectados,
    diversidad_funcional,
    observaciones_servicios_basicos,
    agua_potable,
    electricidad,
    alcantarillado,
    observaciones_herramientas_mobiliario,
    cuenta_equipamiento_basico_cocina,
    observaciones_condiciones_seguridad_proteccion_generales,
    sistema_evacuacion_definido,
    existen_luces_emergencias
) VALUES (
    'VALPO-C002',
    'Liceo Bicentenario Valparaíso',
    '912345678',
    'Edificio público',
    20,
    4, -- Bueno
    TRUE,
    TRUE,
    TRUE,
    4, -- Sí, mucho
    4, -- Con acceso universal
    'Cuenta con todos los servicios básicos en buen estado.',
    4, -- Bueno
    4, -- Bueno
    4, -- Bueno
    'El mobiliario es limitado, se recomienda traer mesas y sillas adicionales.',
    3, -- Sí, equipamiento básico
    'Plan de emergencia en desarrollo, se necesitan más señaléticas.',
    3, -- En desarrollo
    TRUE
);

-- Datos de descripción para la Sede Vecinal (C003)
INSERT INTO CentersDescription (
    center_id,
    nombre_organizacion,
    nombre_dirigente,
    tipo_inmueble,
    estado_conservacion,
    muro_tabique,
    piso_tierra,
    techo_planchas,
    observaciones_espacios_comunes,
    agua_estanques,
    electricidad,
    observaciones_servicios_basicos,
    estado_banos,
    observaciones_banos_y_servicios_higienicos,
    cocina_comedor_adecuados,
    cuenta_con_refrigerador,
    observaciones_herramientas_mobiliario,
    sistema_evacuacion_definido,
    observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_fuera,
    observaciones_dimension_animal
) VALUES (
    'VALPO-C003',
    'Junta de Vecinos Cerro Alegre',
    'Ana Beltrán',
    'Sede social',
    2, -- Regular
    TRUE,
    TRUE,
    TRUE,
    'Espacio pequeño, ideal para grupos familiares reducidos. Sin áreas recreativas.',
    3, -- Se llena de la red
    3, -- Con cortes
    'El suministro de agua no es constante, depende del llenado de estanques.',
    2, -- Deteriorado
    'Los baños están en malas condiciones y no hay duchas disponibles.',
    2, -- Poco adecuado
    1, -- No
    'Solo cuenta con un par de mesas y sillas. La cocina no tiene equipamiento.',
    1, -- No, no definido
    'No hay señaléticas ni plan de evacuación.',
    3, -- Sí, fuera con amarras
    'No hay un área cercada para los animales.'
);

-- Datos de descripción para la Escuela República de Uruguay (C004)
INSERT INTO CentersDescription (
    center_id,
    nombre_organizacion,
    telefono_contacto,
    tipo_inmueble,
    numero_habitaciones,
    estado_conservacion,
    muro_albaneria,
    piso_ceramico,
    techo_planchas,
    espacio_recreacion,
    observaciones_servicios_basicos,
    agua_potable,
    electricidad,
    alcantarillado,
    estado_banos,
    observaciones_banos_y_servicios_higienicos,
    cuenta_con_mesas_sillas,
    cocina_comedor_adecuados,
    sistema_evacuacion_definido,
    observaciones_condiciones_seguridad_proteccion_generales,
    existen_extintores,
    existen_rampas,
    existen_luces_emergencias
) VALUES (
    'VALPO-C004',
    'Escuela República de Uruguay',
    '998765432',
    'Escuela',
    15,
    4, -- Bueno
    TRUE,
    TRUE,
    TRUE,
    4, -- Sí, con juegos
    'Todos los servicios básicos en buen estado y funcionamiento.',
    4, -- Bueno
    4, -- Bueno
    4, -- Bueno
    4, -- Bueno
    'Baños limpios y funcionales, adaptados para uso masivo.',
    5, -- Excelente
    4, -- Adecuado
    5, -- Sí, definido
    'Plan de evacuación establecido, salidas de emergencia señalizadas y extintores en cada pasillo.',
    TRUE,
    TRUE,
    TRUE
);

-- 1) Sede Vecinal Cerro Cordillera
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    observaciones_espacios_comunes,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas, observaciones_banos_y_servicios_higienicos,
    posee_habitaciones, separacion_familias, observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido, observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro, existe_lugar_animales_fuera, observaciones_dimension_animal,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES (
    (SELECT center_id FROM Centers WHERE name='Sede Vecinal Cerro Cordillera'),
    'Junta de Vecinos Cerro Cordillera', 'María Saavedra', 'Presidenta', '987654321',
    'Sede social de dos pisos', 6, 3,
    TRUE, TRUE, FALSE,
    'Salón multiuso con ventilación cruzada; patio pequeño apto para cocina comunitaria.',
    4, 4, 3,
    3, 3, 2, 'Baños funcionales, requieren refuerzo en ventilación.',
    3, 3, 'Habitaciones divididas con biombos y paneles livianos.',
    4, 3, 2,
    3, 'Vías de evacuación señalizadas en primer piso; plan básico impreso.',
    1, 3, 'Se habilita espacio exterior techado para mascotas.',
    TRUE, FALSE, TRUE
);

-- 2) Escuela Básica Cerro Las Cañas
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    observaciones_espacios_comunes,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas, observaciones_banos_y_servicios_higienicos,
    posee_habitaciones, separacion_familias, observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido, observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro, existe_lugar_animales_fuera, observaciones_dimension_animal,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES (
    (SELECT center_id FROM Centers WHERE name='Escuela Básica Cerro Las Cañas'),
    'DAEM Valparaíso', 'Rodrigo Pizarro', 'Director', '987650001',
    'Establecimiento educacional', 12, 4,
    TRUE, TRUE, TRUE,
    'Patios amplios, gimnasio techado y salas con acceso universal en primer piso.',
    5, 5, 5,
    4, 4, 4, 'Baños separados por género y accesibles; duchas en camarines del gimnasio.',
    3, 4, 'Salas reconvertidas en dormitorios por familia; buen control de aforo.',
    5, 4, 4,
    5, 'Rutas de evacuación y puntos de encuentro señalizados; simulacros semestrales.',
    1, 4, 'Sector de canchas habilitado para mascotas con jaulas y bebederos.',
    TRUE, TRUE, TRUE
);

-- 3) Centro Comunitario El Litre
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    observaciones_espacios_comunes,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas, observaciones_banos_y_servicios_higienicos,
    posee_habitaciones, separacion_familias, observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido, observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro, existe_lugar_animales_fuera, observaciones_dimension_animal,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES (
    (SELECT center_id FROM Centers WHERE name='Centro Comunitario El Litre'),
    'Organización Comunitaria El Litre', 'César Rojas', 'Coordinador', '987650002',
    'Centro comunitario', 5, 3,
    FALSE, TRUE, FALSE,
    'Salón central con cocina abierta; acceso por rampa lateral.',
    4, 4, 4,
    3, 3, 2, 'Duchas portátiles instaladas en patio trasero.',
    2, 2, 'Dormitorios temporales en carpas interiores con paneles de privacidad.',
    4, 3, 2,
    3, 'Plan de evacuación básico; requiere más señalética fotoluminiscente.',
    1, 2, 'Se usan corrales modulares en exterior.',
    TRUE, FALSE, TRUE
);

-- 4) Sede Vecinal Cerro Polanco
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    observaciones_espacios_comunes,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas, observaciones_banos_y_servicios_higienicos,
    posee_habitaciones, separacion_familias, observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido, observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro, existe_lugar_animales_fuera, observaciones_dimension_animal,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES (
    (SELECT center_id FROM Centers WHERE name='Sede Vecinal Cerro Polanco'),
    'Junta de Vecinos Cerro Polanco', 'Patricia Olivares', 'Encargada sede', '987650003',
    'Sede social', 6, 3,
    TRUE, TRUE, FALSE,
    'Salón principal con buena iluminación; conexión cercana a transporte.',
    4, 4, 3,
    3, 3, 2, 'Requiere refuerzo de agua caliente en duchas.',
    3, 3, 'División por módulos apilables, priorizando familias con NNA.',
    4, 3, 2,
    3, 'Vías de evacuación libres y punto de encuentro exterior.',
    1, 2, 'Área exterior techada admite animales con correa.',
    TRUE, FALSE, TRUE
);

-- 5) Centro Cultural Playa Ancha
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    observaciones_espacios_comunes,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas, observaciones_banos_y_servicios_higienicos,
    posee_habitaciones, separacion_familias, observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido, observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro, existe_lugar_animales_fuera, observaciones_dimension_animal,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES (
    (SELECT center_id FROM Centers WHERE name='Centro Cultural Playa Ancha'),
    'Corporación Cultural Playa Ancha', 'Gonzalo Arancibia', 'Administrador', '987650004',
    'Centro cultural/gimnasio', 10, 4,
    TRUE, TRUE, TRUE,
    'Gimnasio multiuso y foyer amplio; accesibilidad por rampas y baños inclusivos.',
    5, 5, 5,
    4, 4, 4, 'Camarines con duchas operativas; incluyen dispensadores y papeleros.',
    3, 4, 'Dormitorios en sala de ensayo y camarines, separados por familia.',
    5, 4, 4,
    5, 'Plan de evacuación completo con croquis y radios VHF.',
    1, 4, 'Zona perimetral para mascotas con jaulas; registro de animales.',
    TRUE, TRUE, TRUE
);

-- 6) Sede Juntas de Vecinos Cerro Barón
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    observaciones_espacios_comunes,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas, observaciones_banos_y_servicios_higienicos,
    posee_habitaciones, separacion_familias, observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido, observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro, existe_lugar_animales_fuera, observaciones_dimension_animal,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES (
    (SELECT center_id FROM Centers WHERE name='Sede Juntas de Vecinos Cerro Barón'),
    'Junta de Vecinos Cerro Barón', 'Héctor Muñoz', 'Coordinador', '987650005',
    'Sede social', 4, 3,
    FALSE, TRUE, FALSE,
    'Salón y cocina pequeña; acceso por escalera y rampa portátil.',
    4, 4, 3,
    3, 3, 1, 'Baños en buen estado; se planifican duchas portátiles según afluencia.',
    2, 2, 'Se prioriza separación por género y familias con NNA.',
    4, 3, 2,
    3, 'Señalética básica instalada; simulacro interno realizado.',
    1, 2, 'Patio interior permite animales bajo supervisión.',
    TRUE, FALSE, TRUE
);

-- 7) Escuela Básica Los Placeres (capacidad 20 => dotación más acotada)
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    observaciones_espacios_comunes,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas, observaciones_banos_y_servicios_higienicos,
    posee_habitaciones, separacion_familias, observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido, observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro, existe_lugar_animales_fuera, observaciones_dimension_animal,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES (
    (SELECT center_id FROM Centers WHERE name='Escuela Básica Los Placeres'),
    'DAEM Valparaíso', 'Carolina Jeldes', 'Jefa UTP', '987650006',
    'Establecimiento educacional', 3, 4,
    TRUE, TRUE, TRUE,
    'Uso de biblioteca y sala de computación como dormitorios; patio seguro.',
    5, 5, 5,
    4, 3, 2, 'Baños en excelente estado; duchas disponibles sólo en camarín de profesores.',
    2, 3, 'Se separan familias en salas distintas; aforo bajo por capacidad.',
    5, 4, 3,
    5, 'Evacuación a patio principal; señalética clara.',
    1, 2, 'Espacio exterior delimitado para mascotas.',
    TRUE, FALSE, TRUE
);

-- 8) Centro Deportivo Rodelillo
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    observaciones_espacios_comunes,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas, observaciones_banos_y_servicios_higienicos,
    posee_habitaciones, separacion_familias, observaciones_distribucion_habitaciones,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido, observaciones_condiciones_seguridad_proteccion_generales,
    existe_lugar_animales_dentro, existe_lugar_animales_fuera, observaciones_dimension_animal,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES (
    (SELECT center_id FROM Centers WHERE name='Centro Deportivo Rodelillo'),
    'Corporación de Deportes Valparaíso', 'Iván Véliz', 'Administrador recinto', '987650007',
    'Polideportivo', 8, 4,
    TRUE, TRUE, TRUE,
    'Cancha techada convertible en área de catres; comedor en sala multiuso.',
    5, 5, 4,
    4, 4, 4, 'Camarines con duchas y agua caliente; buena reposición de insumos.',
    3, 4, 'Sectorizado por familias con paneles modulares y carpas interiores.',
    5, 4, 4,
    5, 'Plan y rutas de evacuación visibles; megáfonos y radios disponibles.',
    1, 4, 'Corral perimetral techado y bebederos para mascotas.',
    TRUE, TRUE, TRUE
);

-- Categorías de productos
INSERT INTO Categories (name) VALUES 
('Alimentos y Bebidas'), ('Ropa y Abrigo'), ('Higiene Personal'), 
('Artículos para Mascotas'), ('Herramientas y Equipamiento'), ('Botiquín y Primeros Auxilios');

-- Productos de prueba
INSERT INTO Products (name, unit, category_id)
VALUES
('Agua Embotellada 1.5L', 'un', 1),
('Frazadas (1.5 plazas)', 'un', 2),
('Kit de Higiene Personal (Adulto)', 'un', 3),
('Pañales para Niños (Talla G)', 'paquete', 3),
('Saco de Comida para Perro (10kg)', 'saco', 4),
('Pilas AA', 'pack 4un', 5),
('Paracetamol 500mg', 'caja', 6),
('Arroz (1kg)', 'kg', 1),
('Fideos (500g)', 'paquete', 1),
('Conservas de Atún', 'lata', 1),
('Leche en Polvo (1kg)', 'bolsa', 1),
('Mantas Polares', 'un', 2),
('Papel Higiénico', 'pack 4un', 3),
('Jabón de Tocador', 'un', 3),
('Shampoo (400ml)', 'botella', 3),
('Pasta Dental', 'un', 3),
('Linternas', 'un', 5),
('Velas', 'paquete 10un', 5),
('Ibuprofeno 400mg', 'caja', 6),
('Alcohol Gel (500ml)', 'botella', 6),
('Colchonetas', 'un', 2),
('Almohadas', 'un', 2);

-- Inventario de prueba - todos los centros con stock (ninguno en 0%)
-- Centro C001
INSERT INTO CenterInventoryItems (center_id, item_id, quantity, updated_by) VALUES
('VALPO-C001', 1, 280, 1),
('VALPO-C001', 2, 70, 1),
('VALPO-C001', 3, 40, 1),
('VALPO-C001', 4, 60, 1),
('VALPO-C001', 5, 15, 1),
('VALPO-C001', 6, 25, 1),
('VALPO-C001', 7, 50, 1),
('VALPO-C001', 8, 70, 1),
('VALPO-C001', 9, 105, 1),
('VALPO-C001', 10, 140, 1),
('VALPO-C001', 11, 35, 1),
('VALPO-C001', 12, 50, 1),
('VALPO-C001', 13, 100, 1),
('VALPO-C001', 14, 90, 1),
('VALPO-C001', 15, 35, 1),
('VALPO-C001', 16, 70, 1),
('VALPO-C001', 17, 18, 1),
('VALPO-C001', 18, 30, 1),
('VALPO-C001', 19, 30, 1),
('VALPO-C001', 20, 20, 1),
('VALPO-C001', 21, 40, 1),
('VALPO-C001', 22, 40, 1);

-- Centro C002
INSERT INTO CenterInventoryItems (center_id, item_id, quantity, updated_by) VALUES
('VALPO-C002', 1, 200, 2),
('VALPO-C002', 2, 50, 2),
('VALPO-C002', 3, 28, 2),
('VALPO-C002', 4, 45, 2),
('VALPO-C002', 5, 10, 2),
('VALPO-C002', 6, 18, 2),
('VALPO-C002', 7, 35, 2),
('VALPO-C002', 8, 50, 2),
('VALPO-C002', 9, 75, 2),
('VALPO-C002', 10, 100, 2),
('VALPO-C002', 11, 25, 2),
('VALPO-C002', 12, 35, 2),
('VALPO-C002', 13, 70, 2),
('VALPO-C002', 14, 60, 2),
('VALPO-C002', 15, 25, 2),
('VALPO-C002', 16, 50, 2),
('VALPO-C002', 17, 12, 2),
('VALPO-C002', 18, 22, 2),
('VALPO-C002', 19, 20, 2),
('VALPO-C002', 20, 15, 2),
('VALPO-C002', 21, 28, 2),
('VALPO-C002', 22, 28, 2);

-- Centro C003
INSERT INTO CenterInventoryItems (center_id, item_id, quantity, updated_by) VALUES
('VALPO-C003', 1, 320, 4),
('VALPO-C003', 2, 80, 4),
('VALPO-C003', 3, 45, 4),
('VALPO-C003', 4, 70, 4),
('VALPO-C003', 5, 18, 4),
('VALPO-C003', 6, 30, 4),
('VALPO-C003', 7, 60, 4),
('VALPO-C003', 8, 80, 4),
('VALPO-C003', 9, 120, 4),
('VALPO-C003', 10, 160, 4),
('VALPO-C003', 11, 40, 4),
('VALPO-C003', 12, 60, 4),
('VALPO-C003', 13, 120, 4),
('VALPO-C003', 14, 100, 4),
('VALPO-C003', 15, 40, 4),
('VALPO-C003', 16, 80, 4),
('VALPO-C003', 17, 20, 4),
('VALPO-C003', 18, 35, 4),
('VALPO-C003', 19, 40, 4),
('VALPO-C003', 20, 25, 4),
('VALPO-C003', 21, 45, 4),
('VALPO-C003', 22, 45, 4);

-- Centro C004
INSERT INTO CenterInventoryItems (center_id, item_id, quantity, updated_by) VALUES
('VALPO-C004', 1, 160, 5),
('VALPO-C004', 2, 40, 5),
('VALPO-C004', 3, 22, 5),
('VALPO-C004', 4, 35, 5),
('VALPO-C004', 5, 8, 5),
('VALPO-C004', 6, 15, 5),
('VALPO-C004', 7, 28, 5),
('VALPO-C004', 8, 40, 5),
('VALPO-C004', 9, 60, 5),
('VALPO-C004', 10, 80, 5),
('VALPO-C004', 11, 20, 5),
('VALPO-C004', 12, 28, 5),
('VALPO-C004', 13, 55, 5),
('VALPO-C004', 14, 50, 5),
('VALPO-C004', 15, 20, 5),
('VALPO-C004', 16, 40, 5),
('VALPO-C004', 17, 10, 5),
('VALPO-C004', 18, 18, 5),
('VALPO-C004', 19, 18, 5),
('VALPO-C004', 20, 12, 5),
('VALPO-C004', 21, 22, 5),
('VALPO-C004', 22, 22, 5);

-- Centro C005
INSERT INTO CenterInventoryItems (center_id, item_id, quantity, updated_by) VALUES
('VALPO-C005', 1, 400, 6),
('VALPO-C005', 2, 100, 6),
('VALPO-C005', 3, 55, 6),
('VALPO-C005', 4, 85, 6),
('VALPO-C005', 5, 22, 6),
('VALPO-C005', 6, 35, 6),
('VALPO-C005', 7, 70, 6),
('VALPO-C005', 8, 100, 6),
('VALPO-C005', 9, 150, 6),
('VALPO-C005', 10, 200, 6),
('VALPO-C005', 11, 50, 6),
('VALPO-C005', 12, 75, 6),
('VALPO-C005', 13, 150, 6),
('VALPO-C005', 14, 120, 6),
('VALPO-C005', 15, 50, 6),
('VALPO-C005', 16, 100, 6),
('VALPO-C005', 17, 25, 6),
('VALPO-C005', 18, 40, 6),
('VALPO-C005', 19, 50, 6),
('VALPO-C005', 20, 30, 6),
('VALPO-C005', 21, 55, 6),
('VALPO-C005', 22, 55, 6);

-- Log de inventario correspondiente al stock inicial
INSERT INTO InventoryLog (center_id, item_id, action_type, quantity, reason, created_by)
SELECT center_id, item_id, 'ADD', quantity, 'Stock Inicial', updated_by
FROM CenterInventoryItems;

-- Asignaciones de prueba
INSERT INTO CenterAssignments (user_id, center_id, role, changed_by) 
VALUES 
(2, 'VALPO-C001', 'trabajador municipal', 1), 
(3, 'VALPO-C001', 'contacto ciudadano', 1),
(4, 'VALPO-C002', 'trabajador municipal', 1), 
(7, 'VALPO-C002', 'contacto ciudadano', 1),
(5, 'VALPO-C003', 'trabajador municipal', 1),
(8, 'VALPO-C003', 'contacto ciudadano', 1),
(6, 'VALPO-C004', 'trabajador municipal', 1),
(9, 'VALPO-C004', 'contacto ciudadano', 1),
(2, 'VALPO-C005', 'trabajador municipal', 1),
(10, 'VALPO-C005', 'contacto ciudadano', 1);

UPDATE Centers c
SET municipal_manager_id = ca.user_id
FROM CenterAssignments ca
WHERE ca.center_id = c.center_id
  AND ca.role = 'trabajador municipal'
  AND ca.valid_to IS NULL;

UPDATE Centers c
SET comunity_charge_id = ca.user_id
FROM CenterAssignments ca
WHERE ca.center_id = c.center_id
  AND ca.role = 'contacto ciudadano'
  AND ca.valid_to IS NULL;

-- Solicitudes de prueba (mínimo 5 por centro, todas hechas por contactos ciudadanos)
-- Centro C001
INSERT INTO UpdateRequests (center_id, description, urgency, requested_by) VALUES
('VALPO-C001', 'Se necesitan con urgencia más frazadas para los niños menores de 5 años.', 'Alta', 3),
('VALPO-C001', 'El sistema de calefacción de la sala principal no funciona correctamente.', 'Alta', 3),
('VALPO-C001', 'Solicito reposición de pañales talla M, se están agotando rápidamente.', 'Media', 3),
('VALPO-C001', 'Las duchas del sector B tienen baja presión de agua.', 'Baja', 3),
('VALPO-C001', 'Necesitamos más productos de limpieza, especialmente cloro.', 'Media', 3),
('VALPO-C001', 'Hay goteras en el techo del comedor cuando llueve.', 'Media', 3);

-- Centro C002
INSERT INTO UpdateRequests (center_id, description, urgency, requested_by) VALUES
('VALPO-C002', 'La iluminación del pasillo principal está fallando, varias ampolletas quemadas.', 'Media', 7),
('VALPO-C002', 'Necesitamos urgente reposición de agua embotellada, el stock está muy bajo.', 'Alta', 7),
('VALPO-C002', 'El baño del segundo piso tiene problemas de alcantarillado.', 'Alta', 7),
('VALPO-C002', 'Solicito más mantas polares, hace mucho frío en las noches.', 'Media', 7),
('VALPO-C002', 'Falta señalización de salidas de emergencia en el ala oeste.', 'Media', 7);

-- Centro C003
INSERT INTO UpdateRequests (center_id, description, urgency, requested_by) VALUES
('VALPO-C003', 'La conexión WiFi es intermitente, dificulta la comunicación con familiares.', 'Media', 8),
('VALPO-C003', 'Requerimos más kits de higiene personal para adultos.', 'Media', 8),
('VALPO-C003', 'El portón de acceso principal tiene la cerradura dañada.', 'Alta', 8),
('VALPO-C003', 'Solicito reposición de medicamentos básicos en el botiquín.', 'Alta', 8),
('VALPO-C003', 'Las cortinas divisorias de privacidad están rotas.', 'Media', 8),
('VALPO-C003', 'Necesitamos más almohadas, no hay suficientes para todas las personas.', 'Media', 8);

-- Centro C004
INSERT INTO UpdateRequests (center_id, description, urgency, requested_by) VALUES
('VALPO-C004', 'Urgente: no hay suficientes frazadas para todas las personas, hace frío.', 'Alta', 9),
('VALPO-C004', 'El techo del baño tiene filtraciones, el piso se moja cuando llueve.', 'Alta', 9),
('VALPO-C004', 'Necesitamos más productos de higiene personal, especialmente jabón.', 'Media', 9),
('VALPO-C004', 'La puerta de entrada no cierra bien, hay corrientes de aire.', 'Media', 9),
('VALPO-C004', 'Solicito más colchonetas, no hay suficientes camas.', 'Alta', 9);

-- Centro C005
INSERT INTO UpdateRequests (center_id, description, urgency, requested_by) VALUES
('VALPO-C005', 'Necesitamos más alimentos no perecederos, especialmente arroz y fideos.', 'Media', 10),
('VALPO-C005', 'El aire acondicionado del gimnasio no funciona, hace mucho calor.', 'Media', 10),
('VALPO-C005', 'Solicito reposición de artículos de limpieza para mantener la higiene.', 'Media', 10),
('VALPO-C005', 'Las graderías necesitan mantenimiento, hay tablas sueltas.', 'Baja', 10),
('VALPO-C005', 'Requerimos más ropa de abrigo, especialmente para niños.', 'Media', 10),
('VALPO-C005', 'Necesitamos más pañales de todas las tallas, se agotan rápidamente.', 'Alta', 10);


-- Activación de centros
INSERT INTO CentersActivations (center_id, activated_by, notes)
VALUES
('VALPO-C001', 1, 'Activación por emergencia de incendio forestal en la zona alta de Valparaíso.'),
('VALPO-C002', 1, 'Apertura para contingencia en sector cerro Cordillera.'),
('VALPO-C003', 1, 'Activación preventiva por alerta meteorológica en Playa Ancha.');


-- Necesidades declaradas por los centros vinculados a la emergencia 1. Son lo que el
-- tablero intercomunal muestra a las otras comunas participantes: sin prioridades
-- sembradas no hay nada que priorizar ni con qué colorear el mapa.
-- VALPO-C001 queda con urgencia alta y VALPO-C002 sin prioridades, para poder ver los
-- dos extremos de la escala.
INSERT INTO CenterItemPriority (center_id, item_id, priority, updated_by) VALUES
('VALPO-C001', 1, 'alto',  1),   -- Agua embotellada
('VALPO-C001', 2, 'medio', 1),   -- Frazadas
('VALPO-C001', 4, 'bajo',  1);   -- Pañales


-- Sincroniza bandera redundante is_active según activaciones vigentes
UPDATE Centers c
SET is_active = EXISTS (
  SELECT 1 FROM CentersActivations ca
  WHERE ca.center_id = c.center_id AND ca.ended_at IS NULL
);

-- Personas y grupos familiares de prueba (mínimo 5 personas por centro activo)

-- Personas para Centro C001 (8 personas en 2 familias)
INSERT INTO Persons (rut, nombre, primer_apellido, edad, genero)
VALUES
('15.111.111-1', 'María', 'González', 34, 'F'),
('21.222.222-2', 'Pedro', 'González', 8, 'M'),
('18.333.333-3', 'Ana', 'González', 12, 'F'),
('16.444.444-4', 'Roberto', 'Muñoz', 45, 'M'),
('17.555.555-5', 'Carmen', 'Soto', 42, 'F'),
('22.666.666-6', 'Luis', 'Muñoz', 16, 'M'),
('23.777.777-7', 'Sofía', 'Muñoz', 5, 'F'),
('19.888.888-8', 'Jorge', 'Muñoz', 68, 'M');

-- Grupos familiares para C001
WITH act AS (
  SELECT activation_id
  FROM CentersActivations
  WHERE center_id = 'VALPO-C001' AND ended_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1
)
INSERT INTO FamilyGroups (activation_id, jefe_hogar_person_id, observaciones)
SELECT act.activation_id, 1, 'Familia monoparental, requieren apoyo especial para menores.'
FROM act
UNION ALL
SELECT act.activation_id, 4, 'Familia numerosa con adulto mayor dependiente.'
FROM act;

INSERT INTO FamilyGroupMembers (family_id, person_id, parentesco) VALUES
(1, 1, 'Jefe de Hogar'),
(1, 2, 'Hijo/a'),
(1, 3, 'Hijo/a'),
(2, 4, 'Jefe de Hogar'),
(2, 5, 'Cónyuge'),
(2, 6, 'Hijo/a'),
(2, 7, 'Hijo/a'),
(2, 8, 'Padre/Madre');

-- Personas para Centro C002 (6 personas en 2 familias)
INSERT INTO Persons (rut, nombre, primer_apellido, edad, genero)
VALUES
('14.111.222-3', 'Patricia', 'Rojas', 38, 'F'),
('20.222.333-4', 'Diego', 'Rojas', 10, 'M'),
('24.333.444-5', 'Valentina', 'Rojas', 3, 'F'),
('13.444.555-6', 'Carlos', 'Fernández', 52, 'M'),
('15.555.666-7', 'Elena', 'Castillo', 48, 'F'),
('21.666.777-8', 'Matías', 'Fernández', 14, 'M');

-- Grupos familiares para C002
WITH act AS (
  SELECT activation_id
  FROM CentersActivations
  WHERE center_id = 'VALPO-C002' AND ended_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1
)
INSERT INTO FamilyGroups (activation_id, jefe_hogar_person_id, observaciones)
SELECT act.activation_id, 9, 'Madre soltera con hijos pequeños.'
FROM act
UNION ALL
SELECT act.activation_id, 12, 'Pareja con adolescente, ambos padres trabajadores.'
FROM act;

INSERT INTO FamilyGroupMembers (family_id, person_id, parentesco) VALUES
(3, 9, 'Jefe de Hogar'),
(3, 10, 'Hijo/a'),
(3, 11, 'Hijo/a'),
(4, 12, 'Jefe de Hogar'),
(4, 13, 'Cónyuge'),
(4, 14, 'Hijo/a');

-- Personas para Centro C003 (7 personas en 2 familias)
INSERT INTO Persons (rut, nombre, primer_apellido, edad, genero)
VALUES
('12.777.888-9', 'Andrea', 'López', 29, 'F'),
('25.888.999-0', 'Benjamín', 'López', 6, 'M'),
('26.999.000-1', 'Isabella', 'López', 2, 'F'),
('11.000.111-2', 'Fernando', 'Parra', 36, 'M'),
('16.111.222-3', 'Gabriela', 'Núñez', 33, 'F'),
('22.222.333-4', 'Catalina', 'Parra', 11, 'F'),
('23.333.444-5', 'Tomás', 'Parra', 7, 'M');

-- Grupos familiares para C003
WITH act AS (
  SELECT activation_id
  FROM CentersActivations
  WHERE center_id = 'VALPO-C003' AND ended_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1
)
INSERT INTO FamilyGroups (activation_id, jefe_hogar_person_id, observaciones)
SELECT act.activation_id, 15, 'Madre joven con dos hijos pequeños.'
FROM act
UNION ALL
SELECT act.activation_id, 18, 'Familia nuclear con dos hijos escolares.'
FROM act;

INSERT INTO FamilyGroupMembers (family_id, person_id, parentesco) VALUES
(5, 15, 'Jefe de Hogar'),
(5, 16, 'Hijo/a'),
(5, 17, 'Hijo/a'),
(6, 18, 'Jefe de Hogar'),
(6, 19, 'Cónyuge'),
(6, 20, 'Hijo/a'),
(6, 21, 'Hijo/a');


-- ==========================================================
-- EMERGENCIA DE EJEMPLO (colaboración intermunicipal)
-- Regional: la declara el Super Administrador, por eso
-- created_by_municipality_id queda NULL.
-- ==========================================================
INSERT INTO Emergencies (emergency_id, name, type, created_by, created_by_municipality_id)
VALUES (1, 'Incendio forestal Valparaíso 2024', 'incendio',
        (SELECT user_id FROM Users WHERE username = 'superadmin'), NULL);
SELECT setval('emergencies_emergency_id_seq', (SELECT MAX(emergency_id) FROM Emergencies));

-- Valparaíso y Viña ya participan; Quilpué queda INVITADA (pendiente de responder) y
-- Concón sin fila. Así el flujo de invitación se puede probar de punta a punta desde el
-- primer arranque, y sirve para verificar que una comuna invitada todavía NO ve las
-- prioridades ajenas.
INSERT INTO EmergencyParticipants (emergency_id, municipality_id, status, invited_by) VALUES
(1, 1, 'participando', NULL),
(1, 2, 'participando', NULL),
(1, 3, 'invitada', (SELECT user_id FROM Users WHERE username = 'superadmin'));

-- La notificación en pantalla de esta invitación NO se siembra aquí: los usuarios de
-- Quilpué se crean más abajo en este mismo archivo, así que el SELECT del destinatario
-- devolvía NULL y el aviso terminaba visible para toda la comuna. Vive en
-- 005_datos_validacion.sql, que corre cuando ya existen todos los usuarios.

-- Dos de las tres activaciones de Valparaíso se cuelgan de la emergencia; la tercera
-- queda local (emergency_id NULL) para ejercitar ambos caminos.
UPDATE CentersActivations SET emergency_id = 1
WHERE center_id IN ('VALPO-C001', 'VALPO-C002');

-- ==========================================================
-- COMUNAS ADICIONALES: Viña del Mar (2), Quilpué (3), Concón (4)
-- 3 usuarios y 3 centros con descripción por comuna, para poder
-- validar el aislamiento sin crear nada a mano.
-- ==========================================================

-- Usuarios (contraseña para todos: '12345')
INSERT INTO Users (username, password_hash, email, role_id, nombre, rut, is_active, es_apoyo_admin, municipality_id)
VALUES
-- Viña del Mar
('admin.vina',    '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'admin@vinadelmar.cl',   1, 'Admin Viña del Mar',    '30.111.111-1', TRUE, TRUE,  2),
('tm.vina',       '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'tm@vinadelmar.cl',      2, 'Lorena Bustos',         '30.222.222-2', TRUE, FALSE, 2),
('cc.vina',       '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'cc.vina@comunidad.cl',  3, 'Ignacio Reyes',         '30.333.333-3', TRUE, FALSE, 2),
-- Quilpué
('admin.quilpue', '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'admin@quilpue.cl',      1, 'Admin Quilpué',         '31.111.111-1', TRUE, TRUE,  3),
('tm.quilpue',    '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'tm@quilpue.cl',         2, 'Rodrigo Fuentes',       '31.222.222-2', TRUE, FALSE, 3),
('cc.quilpue',    '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'cc.quilpue@comunidad.cl', 3, 'Marcela Ortiz',       '31.333.333-3', TRUE, FALSE, 3),
-- Concón
('admin.concon',  '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'admin@concon.cl',       1, 'Admin Concón',          '32.111.111-1', TRUE, TRUE,  4),
('tm.concon',     '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'tm@concon.cl',          2, 'Felipe Cárdenas',       '32.222.222-2', TRUE, FALSE, 4),
('cc.concon',     '$2b$10$Psi3QNyicQITWPeGLOVXr.eqO9E72SBodzpSgJ42Z8EGgJZIYYR4m', 'cc.concon@comunidad.cl', 3, 'Daniela Vergara',      '32.333.333-3', TRUE, FALSE, 4);

-- Centros SIN center_id explícito: los genera trg_generate_center_id.
-- Deben quedar VINA-C001..003, QUILP-C001..003 y CONCO-C001..003, lo que valida
-- el trigger y el reinicio del correlativo por comuna durante el propio seed.
INSERT INTO Centers (municipality_id, name, address, type, capacity, latitude, longitude) VALUES
(2, 'Estadio Sausalito',                'Av. Los Castaños s/n, Viña del Mar', 'albergue',             200, -33.0206, -71.5372),
(2, 'Sede Vecinal Forestal Alto',       'Av. Alessandri 2100, Forestal',      'albergue comunitario',  60, -33.0289, -71.5081),
(2, 'Escuela República del Ecuador',    'Calle Limache 1450',                 'albergue',             120, -33.0245, -71.5498),
(3, 'Gimnasio Municipal de Quilpué',    'Av. Los Carrera 900',                'albergue',             150, -33.0472, -71.4423),
(3, 'Sede Vecinal El Belloto Norte',    'Av. Freire 350, El Belloto',         'albergue comunitario',  70, -33.0563, -71.3861),
(3, 'Liceo Municipal de Quilpué',       'Claudio Vicuña 480',                 'albergue',              90, -33.0451, -71.4467),
(4, 'Centro Deportivo Concón',          'Av. Borgoño 2500',                   'albergue',             100, -32.9312, -71.5236),
(4, 'Sede Vecinal Bosques de Montemar', 'Camino Costero 1800',                'albergue comunitario',  50, -32.9598, -71.5451),
(4, 'Escuela Básica Concón',            'Av. Manantiales 640',                'albergue',              80, -32.9260, -71.5178);

-- Descripciones de los 9 centros nuevos (versión acotada del formulario).
INSERT INTO CentersDescription (
    center_id, nombre_organizacion, nombre_dirigente, cargo_dirigente, telefono_contacto,
    tipo_inmueble, numero_habitaciones, estado_conservacion,
    muro_hormigon, piso_radier, techo_losa,
    agua_potable, electricidad, alcantarillado,
    estado_banos, wc_proporcion_personas, duchas_proporcion_personas,
    posee_habitaciones, separacion_familias,
    cuenta_con_mesas_sillas, cocina_comedor_adecuados, cuenta_con_refrigerador,
    sistema_evacuacion_definido,
    existen_extintores, existen_generadores, existen_luces_emergencias
) VALUES
((SELECT center_id FROM Centers WHERE name='Estadio Sausalito'),                'Corporación Municipal de Deportes', 'Lorena Bustos',   'Coordinadora',  '990110011', 'Recinto deportivo techado', 10, 4, TRUE,  TRUE, TRUE,  4, 4, 4, 4, 4, 3, 3, 3, 4, 4, 4, 4, TRUE,  TRUE,  TRUE),
((SELECT center_id FROM Centers WHERE name='Sede Vecinal Forestal Alto'),       'Junta de Vecinos Forestal Alto',    'Ignacio Reyes',   'Presidente',    '990110012', 'Sede social de un piso',     4, 3, TRUE,  TRUE, FALSE, 3, 4, 3, 3, 3, 2, 3, 3, 3, 2, 2, 3, TRUE,  FALSE, TRUE),
((SELECT center_id FROM Centers WHERE name='Escuela República del Ecuador'),    'DAEM Viña del Mar',                 'Paula Herrera',   'Directora',     '990110013', 'Establecimiento educacional', 8, 4, TRUE, TRUE, TRUE,  4, 4, 4, 4, 3, 3, 4, 4, 4, 3, 3, 4, TRUE,  TRUE,  TRUE),
((SELECT center_id FROM Centers WHERE name='Gimnasio Municipal de Quilpué'),    'Municipalidad de Quilpué',          'Rodrigo Fuentes', 'Encargado',     '990220021', 'Gimnasio techado',           6, 4, TRUE,  TRUE, TRUE,  4, 4, 4, 4, 4, 3, 2, 3, 4, 4, 3, 4, TRUE,  TRUE,  TRUE),
((SELECT center_id FROM Centers WHERE name='Sede Vecinal El Belloto Norte'),    'Junta de Vecinos El Belloto Norte', 'Marcela Ortiz',   'Presidenta',    '990220022', 'Sede social de un piso',     5, 3, TRUE,  TRUE, FALSE, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 2, 3, TRUE,  FALSE, FALSE),
((SELECT center_id FROM Centers WHERE name='Liceo Municipal de Quilpué'),       'DAEM Quilpué',                      'Sergio Maldonado','Director',      '990220023', 'Establecimiento educacional', 9, 4, TRUE, TRUE, TRUE,  4, 4, 4, 4, 4, 3, 4, 4, 4, 3, 3, 4, TRUE,  TRUE,  TRUE),
((SELECT center_id FROM Centers WHERE name='Centro Deportivo Concón'),          'Municipalidad de Concón',           'Felipe Cárdenas', 'Encargado',     '990330031', 'Recinto deportivo',          5, 4, TRUE,  TRUE, TRUE,  4, 4, 4, 4, 4, 3, 3, 3, 4, 4, 3, 4, TRUE,  TRUE,  TRUE),
((SELECT center_id FROM Centers WHERE name='Sede Vecinal Bosques de Montemar'), 'Junta de Vecinos Montemar',         'Daniela Vergara', 'Presidenta',    '990330032', 'Sede social de un piso',     4, 3, TRUE,  TRUE, FALSE, 3, 3, 3, 3, 3, 2, 3, 3, 3, 2, 2, 3, TRUE,  FALSE, TRUE),
((SELECT center_id FROM Centers WHERE name='Escuela Básica Concón'),            'DAEM Concón',                       'Rosa Cifuentes',  'Directora',     '990330033', 'Establecimiento educacional', 7, 4, TRUE, TRUE, TRUE,  4, 4, 4, 4, 3, 3, 4, 4, 4, 3, 3, 4, TRUE,  TRUE,  TRUE);

-- ==========================================================
-- FIN DEL SEMBRADO: se quitan los defaults temporales.
-- A partir de acá, cualquier INSERT sin municipality_id explícito falla,
-- que es exactamente lo que queremos: el valor debe venir del JWT o del padre.
-- ==========================================================
ALTER TABLE Users                ALTER COLUMN municipality_id DROP DEFAULT;
ALTER TABLE CentersActivations   ALTER COLUMN municipality_id DROP DEFAULT;
ALTER TABLE Persons              ALTER COLUMN municipality_id DROP DEFAULT;
ALTER TABLE FamilyGroups         ALTER COLUMN municipality_id DROP DEFAULT;
ALTER TABLE CenterInventoryItems ALTER COLUMN municipality_id DROP DEFAULT;

-- La secuencia de Roles queda sobre el mayor id existente (4 = Super Administrador).
SELECT setval('roles_role_id_seq', (SELECT MAX(role_id) FROM Roles));

-- Confirmaciones finales de integridad de datos

-- Centros activos y sus activaciones vigentes
SELECT c.center_id, c.name, c.is_active, ca.activation_id
FROM Centers c
LEFT JOIN CentersActivations ca
  ON ca.center_id = c.center_id AND ca.ended_at IS NULL
ORDER BY c.center_id;

-- Punteros redundantes resueltos desde asignaciones vigentes
SELECT c.center_id, c.municipal_manager_id, c.comunity_charge_id
FROM Centers c
ORDER BY c.center_id;

-- Verifica que el FamilyGroup quedó colgando de una activación vigente
SELECT fg.family_id, fg.activation_id, ca.center_id, ca.ended_at
FROM FamilyGroups fg
JOIN CentersActivations ca ON ca.activation_id = fg.activation_id;

-- Confirmaciones multi-tenant

-- Centros por comuna y correlativo. Esperado: VALPO 12 (contador 12),
-- VINA / QUILP / CONCO 3 cada una (contador 3), y el primer id de cada
-- comuna nueva debe ser SHORTNAME-C001.
SELECT m.shortname, m.center_seq_counter, COUNT(c.center_id) AS centros, MIN(c.center_id) AS primer_id
FROM Municipalities m
LEFT JOIN Centers c ON c.municipality_id = m.municipality_id
GROUP BY m.municipality_id, m.shortname, m.center_seq_counter
ORDER BY m.municipality_id;

-- Roles: deben ser exactamente 1,2,3,4.
SELECT role_id, role_name FROM Roles ORDER BY role_id;

-- El único usuario sin comuna debe ser el Super Administrador.
SELECT username, role_id, municipality_id FROM Users WHERE municipality_id IS NULL;

-- Ningún default de sembrado debe haber quedado vivo (0 filas esperadas).
-- Se excluye el nextval del propio PK de Municipalities, que no es un default de sembrado.
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE column_name = 'municipality_id'
  AND column_default IS NOT NULL
  AND column_default NOT LIKE 'nextval%';

-- Confirmación final
SELECT 'Script definitivo ejecutado. Todas las tablas y datos de prueba han sido creados.';