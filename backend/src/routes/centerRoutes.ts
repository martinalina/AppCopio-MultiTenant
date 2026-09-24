// src/routes/centerRoutes.ts
import { Router, RequestHandler } from 'express';
import pool from '../config/db';
import { requireUser, requireTenant, SUPERADMIN_ROLE_ID } from "../auth/requireUser";

// CAMBIO: Importamos TODAS las funciones necesarias desde nuestro servicio, incluyendo las de inventario.
import {
    getAllCenters, getCenterById,
    createCenter as createCenterService,
    updateCenter as updateCenterService,
    deleteCenterById,
    updateActivationStatus,
    updateOperationalStatus,
    getActiveCenters,
    getActiveActivation,
    getCenterCapacity,
    getCenterPeople,
    getInventoryByCenterId,
    addInventoryItem as addInventoryItemService,
    updateInventoryItem as updateInventoryItemService,
    deleteInventoryItem as deleteInventoryItemService,
    getAssignedUsersByCenter as getAssignedUsersByCenter,
    updateCenterFullness as updateCenterFullnessService,
    getAllActivationsByCenter,
    getActivationDetail
} from '../services/centerService';

// Importar funciones nuevas de inventario
import {
    registerInventoryExit,
    registerMultipleExits,
    createBox,
    getInventoryStats
} from '../services/inventoryService';

import { sendNotification } from '../services/notificationService';

import { getCenterGroups } from '../services/familyService';
import { requireAuth, requireCenterManagement, optionalAuth } from '../auth/middleware';
import { withTenant, withTenantOrPublic } from '../auth/tenantContext';


const router = Router();

// =================================================================
// 1. CONTROLADORES: GESTIÓN DE CENTROS (CRUD)
// =================================================================

const listCenters: RequestHandler = async (req, res) => {
    try {
        // El Super Administrador solo administra municipalidades: no debe ver centros,
        // ni siquiera de solo lectura. RLS lo dejaría pasar (is_superadmin() en la
        // política de Centers existe para that: consultas administrativas puntuales,
        // como el conteo de MunicipalityDetailPage), así que la restricción va acá.
        if (req.user?.role_id === SUPERADMIN_ROLE_ID) {
            res.json([]);
            return;
        }
        const centers = await getAllCenters(pool);
        res.json(centers);
    } catch (error) {
        console.error('Error en listCenters:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const getCenter: RequestHandler = async (req, res) => {
    try {
        const center = await getCenterById(pool, req.params.id);
        if (!center) {
            res.status(404).json({ error: 'Centro no encontrado.' });
        } else {
            res.json(center);
        }
    } catch (error) {
        console.error(`Error en getCenter (id: ${req.params.id}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const createCenter: RequestHandler = async (req, res) => {
    const { name, latitude, longitude, type } = req.body;
    
    // Validación de campos requeridos
    if (!name || typeof latitude !== 'number' || typeof longitude !== 'number' || !type) {
        console.log('CREATE CENTER - Validación fallida:', {
            hasName: !!name,
            latitudeType: typeof latitude,
            longitudeType: typeof longitude,
            hasType: !!type,
            latitude_value: latitude,
            longitude_value: longitude
        });
        res.status(400).json({ error: 'Campos requeridos: name, type, latitude, longitude.' });
        return;
    }
    
    // Normalizar el tipo de centro
    const normalizedType = type.toLowerCase() === 'acopio' ? 'acopio' : 'albergue';
    const bodyWithNormalizedType = { ...req.body, type: normalizedType };
    
    // La comuna sale del JWT, nunca del body (regla dura del proyecto).
    let municipalityId: number;
    try {
        municipalityId = requireTenant(req);
    } catch (e: any) {
        res.status(e?.status || 403).json({
            error: e?.message || 'FORBIDDEN',
            message: e?.publicMessage || 'No puedes crear centros sin una comuna asociada.',
        });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const newCenter = await createCenterService(client, bodyWithNormalizedType, municipalityId);
        await client.query('COMMIT');
        res.status(201).json(newCenter);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en createCenter:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
};

const updateCenter: RequestHandler = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updatedCenter = await updateCenterService(client, req.params.id, req.body);
        await client.query('COMMIT');

        if (!updatedCenter) {
            res.status(404).json({ error: 'Centro no encontrado.' });
        } else {
            res.json(updatedCenter);
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error en updateCenter (id: ${req.params.id}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
};

const deleteCenter: RequestHandler = async (req, res) => {
    try {
        const deletedCount = await deleteCenterById(pool, req.params.id);
        if (deletedCount === 0) {
            res.status(404).json({ error: 'Centro no encontrado.' });
        } else {
            res.status(204).send();
        }
    } catch (error) {
        console.error(`Error en deleteCenter (id: ${req.params.id}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

// =================================================================
// 2. CONTROLADORES: ESTADO Y ACTIVACIÓN
// =================================================================

const setActivationStatus: RequestHandler = async (req, res) => {
    const { isActive, notes, assignedUserId, emergency_id } = req.body;
    const userId = requireUser(req).user_id;
    
    if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: 'Se requiere el campo "isActive" (boolean).' });
        return;
    }

    // La emergencia es opcional: una activación local no necesita ninguna. Si viene,
    // basta con que esté vigente: desde 002d toda emergencia es LOCAL de una comuna y
    // la política emergencies_tenant_isolation ya impide ver las ajenas, así que no
    // hace falta comprobar participación (eso ahora vive en el SuperEvento).
    let emergencyId: number | null = null;
    if (isActive && emergency_id != null) {
        emergencyId = Number(emergency_id);
        if (!Number.isFinite(emergencyId)) {
            res.status(400).json({ error: 'emergency_id inválido.' });
            return;
        }
        const { rows } = await pool.query(
            `SELECT emergency_id FROM Emergencies
              WHERE emergency_id = $1 AND ended_at IS NULL`,
            [emergencyId]
        );
        if (rows.length === 0) {
            res.status(400).json({
                error: 'EMERGENCIA_NO_DISPONIBLE',
                message: 'La emergencia no está vigente o no pertenece a tu comuna.',
            });
            return;
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const updatedCenter = await updateActivationStatus(
            client, 
            req.params.id, 
            isActive, 
            userId,
            notes,
            assignedUserId,
            emergencyId
        );
        
        if (!updatedCenter) {
            await client.query("ROLLBACK");
            res.status(404).json({ error: 'Centro no encontrado.' });
            return;
        }
        
        const title = `Centro ${isActive ? "activado" : "desactivado"}: ${updatedCenter.name}`;
        const message = isActive
            ? `El centro "${updatedCenter.name}" ha sido ACTIVADO.${notes ? ` Motivo: ${notes}` : ''}`
            : `El centro "${updatedCenter.name}" ha sido DESACTIVADO.`;

        const recipients = [
            updatedCenter.municipal_manager_id ?? null,
            updatedCenter.comunity_charge_id ?? null,
            assignedUserId ?? null,
        ].filter((x, idx, arr) => x != null && arr.indexOf(x) === idx);
        
        const notifications: Record<string, any> = {};

        for (const rec of recipients) {
            const role =
                rec === updatedCenter.municipal_manager_id ? "municipal_manager"
                : rec === updatedCenter.comunity_charge_id ? "comunity_charge"
                : rec === assignedUserId ? "assigned_manager"
                : "recipient";

            notifications[role] = await sendNotification(client, {
                center_id: updatedCenter.center_id,
                activation_id: updatedCenter.activation_id ?? null,
                destinatary: rec,
                title,
                message,
                channel: "ctrStatus_change",
            });
        }
        
        await client.query('COMMIT');
        return res.json({ ...updatedCenter, notifications });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error en setActivationStatus:`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
};

const setOperationalStatus: RequestHandler = async (req, res) => {
    const { operationalStatus, publicNote } = req.body;
    const validStatuses = ['capacidad maxima', 'cerrado temporalmente', 'abierto'];
    
    if (!validStatuses.includes(operationalStatus)) {
        res.status(400).json({ error: `El estado debe ser uno de: ${validStatuses.join(', ')}.` });
        return;
    }
    try {
        const note = operationalStatus === 'cerrado temporalmente' ? publicNote : null;
        const updatedCenter = await updateOperationalStatus(pool, req.params.id, operationalStatus, note);
        
        if (!updatedCenter) {
            res.status(404).json({ error: 'Centro no encontrado.' });
        } else {
            res.json(updatedCenter);
        }
    } catch (error) {
        console.error(`Error en setOperationalStatus (id: ${req.params.id}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const updateFullness: RequestHandler = async (req, res) => {
    const { fullnessPercentage } = req.body;
    
    // Validación
    if (typeof fullnessPercentage !== 'number' || fullnessPercentage < 0 || fullnessPercentage > 100) {
        res.status(400).json({ error: 'fullnessPercentage debe ser un número entre 0 y 100.' });
        return;
    }
    
    try {
        const updatedCenter = await updateCenterFullnessService(pool, req.params.id, fullnessPercentage);
        if (!updatedCenter) {
            res.status(404).json({ error: 'Centro no encontrado.' });
        } else {
            res.json(updatedCenter);
        }
    } catch (error) {
        console.error(`Error en updateFullness (id: ${req.params.id}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const listActiveCenters: RequestHandler = async (req, res) => {
    try {
        const activeCenters = await getActiveCenters(pool);
        res.json(activeCenters);
    } catch (error) {
        console.error("Error en listActiveCenters:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// GET /centers/:id/active-activation
// Devuelve la activación abierta (ended_at IS NULL) o 204 si no hay
const getCenterActiveActivation: RequestHandler = async (req, res) => {
  const centerId = (req.params.id ?? "").trim();
  // Validación simple: VARCHAR(10) no vacío
  if (!centerId || centerId.length > 10) {
    res.status(400).json({ message: "Invalid center id" });
    return;
  }
  try {
        const centerActivation = await getActiveActivation(pool, centerId);
        if (!centerActivation) {
            res.status(204).end(); // No Content: no hay activación abierta
            return;
        }
        res.json(centerActivation);
  } catch (error) {
    console.error("getCenterActiveActivation error:", error);
    res.status(500).json({ message: "Error fetching active activation" });
  }
};

// =================================================================
// 3. CONTROLADORES: RESIDENTES, CAPACIDAD E INVENTARIO
// =================================================================

const getCapacity: RequestHandler = async (req, res) => {
    try {
        const capacityData = await getCenterCapacity(pool, req.params.centerId);
        if (!capacityData) {
            res.status(404).json({ error: 'Centro no encontrado.' });
        } else {
            res.json(capacityData);
        }
    } catch (error) {
        console.error(`Error en getCapacity (centerId: ${req.params.centerId}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const listPeople: RequestHandler = async (req, res) => {
    try {
        const people = await getCenterPeople(pool, req.params.centerId);
        res.json(people);
    } catch (err) {
        console.error(`Error en listPeople (centerId: ${req.params.centerId}):`, err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const listGroups: RequestHandler = async (req, res) => {
    //const { id } = req.params; // 'id' es un string
    try {
        // No hay validación numérica porque el ID no es un número.
        // Pasamos el 'id' directamente al servicio.
        const groups = await getCenterGroups(pool,req.params.centerID);
        res.status(200).json(groups);

    } catch (err) {
        console.error(`Error en listCenterGroups (centerId: ${req.params.centerID}):`, err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};


const getInventory: RequestHandler = async (req, res) => {
    try {
        const inventory = await getInventoryByCenterId(pool, req.params.centerId);
        res.json(inventory);
    } catch (error) {
        console.error(`Error en getInventory (centerId: ${req.params.centerId}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const addInventoryItem: RequestHandler = async (req, res) => {
    const { centerId } = req.params;
    const userId = (req as any).user?.id;
    const { itemName, categoryId, quantity } = req.body;

    if (!itemName || !categoryId || !quantity || quantity <= 0) {
        res.status(400).json({ error: 'Se requieren: itemName, categoryId y una quantity > 0.' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const newItem = await addInventoryItemService(client, centerId, { ...req.body, userId });
        await client.query('COMMIT');
        res.status(201).json(newItem);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error en addInventoryItem (centerId: ${centerId}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
};

const updateInventoryItem: RequestHandler = async (req, res) => {
    const { centerId, itemId } = req.params;
    const userId = (req as any).user?.id;
    const { quantity } = req.body;
    if (typeof quantity !== 'number' || quantity < 0) {
        res.status(400).json({ error: 'Se requiere "quantity" numérica >= 0.' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updatedItem = await updateInventoryItemService(client, centerId, itemId, { ...req.body, userId });
        await client.query('COMMIT');
        if (!updatedItem) {
            res.status(404).json({ error: 'Ítem no encontrado en el inventario.' });
        } else {
            res.json(updatedItem);
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error en updateInventoryItem (centerId: ${centerId}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
};

const deleteInventoryItem: RequestHandler = async (req, res) => {
    const { centerId, itemId } = req.params;
    const userId = (req as any).user?.id; 
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const deletedCount = await deleteInventoryItemService(client, centerId, itemId, userId);
    
        if (deletedCount === 0) {        
            await client.query('ROLLBACK'); 
            res.status(404).json({ error: 'Ítem no encontrado en el inventario.' });
            return;
        }

        await client.query('COMMIT');
        res.status(204).send(); 
    } catch (error: any) {
        await client.query('ROLLBACK');
        if (error.status) {
            res.status(error.status).json({ error: error.message });
        } else {
            console.error(`Error en deleteInventoryItem (centerId: ${centerId}):`, error);
            res.status(500).json({ error: 'Error interno del servidor.' });
        }
    } finally {
        client.release();
    }
};

// NUEVO: Obtiene todos los usuarios (Encargado Comunitario, Municipal y M:N) asignados a un centro.
const listAssignedUsers: RequestHandler = async (req, res) => {
    try {
        const centerId = req.params.centerId;
        // La función del servicio contiene la compleja lógica SQL (UNION ALL)
        const users = await getAssignedUsersByCenter(pool, centerId); 
        
        // El frontend espera el objeto { users: [...] }
        res.json({ users }); 
    } catch (error) {
        console.error(`Error en listAssignedUsers (centerId: ${req.params.centerId}):`, error);
        res.status(500).json({ error: 'Error interno al obtener los usuarios asignados.' });
    }
};

/**
 * @route GET /centers/:centerId/activations
 * @desc Lista todas las activaciones (historial completo) de un centro
 */
const listCenterActivations: RequestHandler = async (req, res) => {
    const { centerId } = req.params;
    
    try {
        const activations = await getAllActivationsByCenter(pool, centerId);
        res.json(activations);
    } catch (error) {
        console.error(`Error en listCenterActivations (centerId: ${centerId}):`, error);
        res.status(500).json({ error: 'Error interno del servidor al obtener el historial de activaciones.' });
    }
};

/**
 * @route GET /centers/:centerId/activations/:activationId
 * @desc Obtiene el detalle completo de una activación específica
 */
const getCenterActivationDetail: RequestHandler = async (req, res) => {
    const { activationId } = req.params;
    const activationIdNum = parseInt(activationId, 10);
    
    if (isNaN(activationIdNum)) {
        res.status(400).json({ error: 'El activation_id debe ser un número válido.' });
        return;
    }
    
    try {
        const detail = await getActivationDetail(pool, activationIdNum);
        
        if (!detail) {
            res.status(404).json({ error: 'Activación no encontrada.' });
            return;
        }
        
        res.json(detail);
    } catch (error) {
        console.error(`Error en getCenterActivationDetail (activationId: ${activationId}):`, error);
        res.status(500).json({ error: 'Error interno del servidor al obtener el detalle de la activación.' });
    }
};

/**
 * POST /centers/:centerId/inventory/exit
 * Registra la salida de un recurso a un grupo familiar
*/

const registerExit: RequestHandler = async (req, res) => {
    const { centerId } = req.params;
    const userId = requireUser(req).user_id;
    const { itemId, quantity, familyId, reason, notes } = req.body;

    // Validaciones
    if (!itemId || !quantity || !familyId || !reason) {
        res.status(400).json({ 
            error: 'Se requieren: itemId, quantity, familyId y reason.' 
        });
        return;
    }

    if (quantity <= 0) {
        res.status(400).json({ error: 'La cantidad debe ser mayor a 0.' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await registerInventoryExit(client, centerId, {
            itemId,
            quantity,
            familyId,
            reason,
            notes,
            userId
        });

        await client.query('COMMIT');
        res.status(200).json({ 
            message: 'Salida registrada exitosamente.',
            ...result 
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        
        if (error.status) {
            res.status(error.status).json({ error: error.message });
        } else {
            console.error(`Error en registerExit (centerId: ${centerId}):`, error);
            res.status(500).json({ error: 'Error interno del servidor.' });
        }
    } finally {
        client.release();
    }
};

/**
 * POST /centers/:centerId/inventory/exit/bulk
 * Registra múltiples salidas de inventario en una sola operación
 */
const registerBulkExit: RequestHandler = async (req, res) => {
    const { centerId } = req.params;
    const userId = requireUser(req).user_id;
    const { exits } = req.body;

    if (!Array.isArray(exits) || exits.length === 0) {
        res.status(400).json({ 
            error: 'Se requiere un array "exits" con al menos una salida.' 
        });
        return;
    }

    // Validar que todas las salidas tengan los campos requeridos
    for (const exit of exits) {
        if (!exit.itemId || !exit.quantity || !exit.familyId || !exit.reason) {
            res.status(400).json({ 
                error: 'Cada salida debe tener: itemId, quantity, familyId y reason.' 
            });
            return;
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Añadir userId a cada salida
        const exitsWithUser = exits.map(exit => ({ ...exit, userId }));
        
        const results = await registerMultipleExits(client, centerId, exitsWithUser);

        await client.query('COMMIT');
        res.status(200).json({ 
            message: `${results.length} salidas registradas exitosamente.`,
            exits: results 
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        
        if (error.status) {
            res.status(error.status).json({ error: error.message });
        } else {
            console.error(`Error en registerBulkExit (centerId: ${centerId}):`, error);
            res.status(500).json({ error: 'Error interno del servidor.' });
        }
    } finally {
        client.release();
    }
};

/**
 * POST /centers/:centerId/inventory/box
 * Crea una "caja" con múltiples recursos para optimizar registro
 */
const createInventoryBox: RequestHandler = async (req, res) => {
    const { centerId } = req.params;
    const userId = requireUser(req).user_id;
    const { name, description, items } = req.body;

    // Validaciones
    if (!name || !items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ 
            error: 'Se requieren: name y un array "items" con al menos un elemento.' 
        });
        return;
    }

    // Validar que cada ítem tenga los datos necesarios
    for (const item of items) {
        if (!item.quantity || item.quantity <= 0) {
            res.status(400).json({ 
                error: 'Cada ítem debe tener una quantity > 0.' 
            });
            return;
        }

        if (!item.itemId && !item.itemName) {
            res.status(400).json({ 
                error: 'Cada ítem debe tener itemId o itemName.' 
            });
            return;
        }

        // Si se crea un ítem nuevo, validar campos requeridos
        if (item.itemName && (!item.categoryId || !item.unit)) {
            res.status(400).json({ 
                error: 'Para ítems nuevos se requiere: itemName, categoryId y unit.' 
            });
            return;
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await createBox(client, centerId, {
            name,
            description,
            items,
            userId
        });

        await client.query('COMMIT');
        res.status(201).json({
            message: 'Caja creada exitosamente.',
            ...result
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        
        if (error.status) {
            res.status(error.status).json({ error: error.message });
        } else {
            console.error(`Error en createInventoryBox (centerId: ${centerId}):`, error);
            res.status(500).json({ error: 'Error interno del servidor.' });
        }
    } finally {
        client.release();
    }
};

/**
 * GET /centers/:centerId/inventory/stats
 * Obtiene estadísticas de movimientos de inventario
 */
const getInventoryStatistics: RequestHandler = async (req, res) => {
    try {
        const days = req.query.days ? parseInt(req.query.days as string) : 30;
        const stats = await getInventoryStats(pool, req.params.centerId, days);
        res.json(stats);
    } catch (error) {
        console.error(`Error en getInventoryStats (centerId: ${req.params.centerId}):`, error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

/**
 * GET /api/centers/:centerId/available-workers
 * Obtiene usuarios disponibles para asignar turnos en un centro:
 * - Usuarios ya asignados al centro (con asignación activa: valid_to IS NULL)
 * - Usuarios sin ninguna asignación de centro activa
 * Excluye familias (role_id = 4) y usuarios inactivos
 */
const listAvailableWorkers: RequestHandler = async (req, res) => {
    try {
        const centerId = req.params.centerId;
        
        const query = `
            SELECT DISTINCT
                u.user_id,
                u.email,
                u.nombre,
                u.role_id,
                r.role_name,
                u.is_active,
                CASE 
                    WHEN ca.user_id IS NOT NULL THEN true 
                    ELSE false 
                END as is_assigned_to_center
            FROM Users u
            INNER JOIN Roles r ON u.role_id = r.role_id
            LEFT JOIN CenterAssignments ca ON u.user_id = ca.user_id 
                AND ca.center_id = $1 
                AND ca.valid_to IS NULL  -- Solo asignaciones activas
            WHERE u.is_active = true 
            AND u.role_id = 2
            AND (
                -- Usuario está asignado a este centro (asignación activa)
                u.user_id IN (
                    SELECT user_id 
                    FROM CenterAssignments 
                    WHERE center_id = $1 
                    AND valid_to IS NULL
                )
                OR
                -- Usuario no tiene ninguna asignación activa de centro
                u.user_id NOT IN (
                    SELECT user_id 
                    FROM CenterAssignments
                    WHERE valid_to IS NULL
                )
            )
            ORDER BY is_assigned_to_center DESC, u.nombre ASC
        `;
        
        const result = await pool.query(query, [centerId]);
        console.log(`Usuarios disponibles para el centro ${centerId}:`, result.rows);
        res.json({ users: result.rows });
    } catch (error) {
        console.error(`Error en listAvailableWorkers (centerId: ${req.params.centerId}):`, error);
        res.status(500).json({ error: 'Error al obtener usuarios disponibles.' });
    }
};

// =================================================================
// 4. SECCIÓN DE RUTAS (Endpoints)
// =================================================================

// --- Rutas Principales de Centros (CRUD) ---
router.get('/', optionalAuth, withTenantOrPublic,  listCenters);
router.post('/', requireAuth, requireCenterManagement, withTenant, createCenter);
router.get('/:id', requireAuth, withTenant, getCenter);
router.put('/:id', requireAuth, withTenant, updateCenter);
router.delete('/:id', requireAuth, withTenant, deleteCenter);

// --- Rutas de Estado y Activación ---
router.patch('/:id/status', requireAuth, withTenant, setActivationStatus);
router.patch('/:id/operational-status', requireAuth, withTenant, setOperationalStatus);
router.patch('/:id/fullness', requireAuth, withTenant, updateFullness);
router.get('/status/active', requireAuth, withTenant, listActiveCenters);
router.get('/:id/activation', requireAuth, withTenant, getCenterActiveActivation);
router.get('/:centerId/activations', requireAuth, withTenant, listCenterActivations);
router.get('/:centerId/activations/:activationId', requireAuth, withTenant, getCenterActivationDetail);

// --- Rutas de Datos Específicos del Centro ---
router.get('/:centerId/capacity', optionalAuth, withTenantOrPublic,  getCapacity);
router.get('/:centerId/people', requireAuth, withTenant, listPeople);
router.get('/:centerID/residents', requireAuth, withTenant, listGroups)
// --- Rutas de Inventario (Existentes) ---
router.get('/:centerId/inventory', requireAuth, withTenant, getInventory);
router.post('/:centerId/inventory', requireAuth, withTenant, addInventoryItem);
router.put('/:centerId/inventory/:itemId', requireAuth, withTenant, updateInventoryItem);
router.delete('/:centerId/inventory/:itemId', requireAuth, withTenant, deleteInventoryItem);

// --- Rutas de Inventario (NUEVAS para HDU) ---
router.post('/:centerId/inventory/exit', requireAuth, withTenant, registerExit);
router.post('/:centerId/inventory/exit/bulk', requireAuth, withTenant, registerBulkExit);
router.post('/:centerId/inventory/box', requireAuth, withTenant, createInventoryBox);
router.get('/:centerId/inventory/stats', requireAuth, withTenant, getInventoryStatistics);

router.get('/:centerId/assigned-users', requireAuth, withTenant, listAssignedUsers);
router.get('/:centerId/available-workers', requireAuth, withTenant, listAvailableWorkers);

export default router;