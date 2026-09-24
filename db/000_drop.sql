-- Multi-tenant, emergencias y supereventos.
-- Faltaban por completo: el script quedaba a medias si se reutilizaba el volumen.
-- Van primero porque el resto de las tablas les referencia municipality_id.
DROP TABLE IF EXISTS EmergencyActivationInvitations CASCADE;
DROP TABLE IF EXISTS CrossMunicipalSupportOffers CASCADE;
DROP TABLE IF EXISTS SuperEventParticipants CASCADE;
DROP TABLE IF EXISTS SuperEvents CASCADE;
DROP TABLE IF EXISTS Emergencies CASCADE;
DROP TABLE IF EXISTS Municipalities CASCADE;

-- Tablas de datos y relaciones principales
DROP TABLE IF EXISTS FamilyGroupMembers CASCADE;
DROP TABLE IF EXISTS FamilyGroups CASCADE;
DROP TABLE IF EXISTS Persons CASCADE;
DROP TABLE IF EXISTS CenterInventoryItems CASCADE;
DROP TABLE IF EXISTS InventoryLog CASCADE;
DROP TABLE IF EXISTS UpdateRequests CASCADE;
DROP TABLE IF EXISTS CenterAssignments CASCADE;
DROP TABLE IF EXISTS ActivationAssignments CASCADE;
DROP TABLE IF EXISTS CentersActivations CASCADE;
DROP TABLE IF EXISTS CentersDescription CASCADE;
DROP TABLE IF EXISTS CenterItemPriority CASCADE;
DROP TABLE IF EXISTS Products CASCADE;
DROP TABLE IF EXISTS Categories CASCADE;
DROP TABLE IF EXISTS Centers CASCADE;
DROP TABLE IF EXISTS RefreshTokens CASCADE; 
DROP TABLE IF EXISTS Users CASCADE;
DROP TABLE IF EXISTS Roles CASCADE;

-- Tablas del módulo "Datasets"
DROP TABLE IF EXISTS DatasetRecordCoreRelations CASCADE;
DROP TABLE IF EXISTS DatasetRecordRelations CASCADE;
DROP TABLE IF EXISTS DatasetRecordOptionValues CASCADE;
DROP TABLE IF EXISTS DatasetFieldOptions CASCADE;
DROP TABLE IF EXISTS DatasetRecords CASCADE;
DROP TABLE IF EXISTS DatasetFields CASCADE;
DROP TABLE IF EXISTS Datasets CASCADE;

-- Tablas del módulo "Templates"
DROP TABLE IF EXISTS TemplateFields CASCADE;
DROP TABLE IF EXISTS Templates CASCADE;

-- Tablas de "Log", "Notificaciones" y "Zonas"
DROP TABLE IF EXISTS AuditLog CASCADE;
DROP TABLE IF EXISTS CenterNotifications CASCADE; 
DROP TABLE IF EXISTS municipal_zones CASCADE;


DROP TABLE IF EXISTS CenterShiftHistory CASCADE;
DROP TABLE IF EXISTS CenterShifts CASCADE;
DROP SEQUENCE IF EXISTS centers_seq CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

-- Funciones de colaboración intermunicipal.
DROP FUNCTION IF EXISTS super_event_shared_center_ids() CASCADE;
DROP FUNCTION IF EXISTS super_event_participants_of(INT) CASCADE;
DROP FUNCTION IF EXISTS super_event_shared_centers(INT) CASCADE;
DROP FUNCTION IF EXISTS emergency_activations_status(INT) CASCADE;
DROP FUNCTION IF EXISTS notify_super_event_invitation(INT, INT) CASCADE;
DROP FUNCTION IF EXISTS notify_support_offer(INT) CASCADE;
DROP FUNCTION IF EXISTS support_offers_visible() CASCADE;
DROP EXTENSION IF EXISTS pgcrypto CASCADE;