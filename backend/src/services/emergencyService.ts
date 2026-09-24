// src/services/emergencyService.ts
//
// Emergencias LOCALES de una comuna. Desde 002d una emergencia es siempre de una
// comuna (created_by_municipality_id NOT NULL) y agrupa las activaciones de sus
// centros: es el nivel "emergencia menor" y la unidad de organización interna.
// La colaboración entre comunas vive en el SuperEvento, no acá.
//
// Este servicio existe porque dos rutas distintas crean emergencias: POST
// /emergencies y POST /super-events/:id/respond cuando la comuna acepta creando
// una nueva. Las dos deben avisar igual a los encargados de centro, y el criterio
// de a quién avisar no puede quedar duplicado.
import { Db } from '../types/db';
import { createNotification } from './notificationService';

export type EstadoInvitacionCentro = 'sin_invitar' | 'invitada' | 'aceptada' | 'rechazada';

export type ActivacionConEstado = {
  activation_id: number;
  center_id: string;
  center_name: string;
  started_at: string;
  /** Emergencia a la que pertenece HOY la activación (puede ser otra, o ninguna). */
  emergencia_actual_id: number | null;
  emergencia_actual_nombre: string | null;
  estado_invitacion: EstadoInvitacionCentro;
  invited_at: string | null;
  responded_at: string | null;
};

function fallo(status: number, code: string, publicMessage: string) {
  const e = new Error(code);
  (e as any).status = status;
  (e as any).publicMessage = publicMessage;
  return e;
}

/**
 * Crea la emergencia y convoca a sus centros.
 *
 * El aviso a los encargados se dispara ACÁ, al nacer la emergencia, y no al
 * aceptar una invitación intercomunal: es el momento en que la pregunta "¿tu
 * centro se suma?" tiene sentido. Antes llegaba tarde y descontextualizado.
 *
 * Solo se convoca a las activaciones SIN emergencia. Convocar a las que ya están
 * en otra las movería de lugar sin que nadie lo pidiera; ese traslado es
 * deliberado y pasa por invitarActivaciones().
 */
export async function createEmergency(
  db: Db,
  input: {
    name: string;
    type?: string | null;
    created_by: number;
    municipality_id: number;
    super_event_id?: number | null;
  }
) {
  const { rows } = await db.query(
    `INSERT INTO Emergencies (name, type, created_by, created_by_municipality_id, super_event_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING emergency_id, name, type, started_at, ended_at,
               created_by_municipality_id, super_event_id`,
    [input.name.trim(), input.type ?? null, input.created_by, input.municipality_id,
     input.super_event_id ?? null]
  );
  const emergencia = rows[0];

  const { rows: sueltas } = await db.query(
    `SELECT activation_id FROM CentersActivations
      WHERE ended_at IS NULL AND emergency_id IS NULL`
  );

  const avisos = await invitarActivaciones(db, {
    emergency_id: emergencia.emergency_id,
    emergency_name: emergencia.name,
    municipality_id: input.municipality_id,
    activation_ids: sueltas.map((a: any) => a.activation_id),
    invited_by: input.created_by,
  });

  return { ...emergencia, avisos_a_encargados: avisos.avisos, centros_convocados: avisos.activaciones };
}

/**
 * Invita (o REINVITA) a un conjunto de activaciones a sumarse a la emergencia.
 *
 * Acepta cualquier activación abierta de la comuna sin importar su estado previo:
 * rechazada, vinculada a otra emergencia, o libre porque la suya terminó. Es lo
 * que permite corregir después de la primera tanda — quien elige la lista es el
 * llamador, esta función no filtra.
 *
 * El destinatario es el encargado asignado a la activación (ActivationAssignments
 * vigente); si no hay ninguno, el encargado municipal del centro. Si tampoco hay,
 * no se manda nada: ese centro lo vincula el administrador a mano.
 */
export async function invitarActivaciones(
  db: Db,
  input: {
    emergency_id: number;
    emergency_name: string;
    municipality_id: number;
    activation_ids: number[];
    invited_by: number;
  }
): Promise<{ avisos: number; activaciones: number }> {
  if (input.activation_ids.length === 0) return { avisos: 0, activaciones: 0 };

  const { rows: activaciones } = await db.query(
    `SELECT ca.activation_id, ca.center_id, c.name AS center_name,
            ca.emergency_id AS emergencia_actual_id,
            eo.name AS emergencia_actual_nombre,
            COALESCE(
              array_remove(array_agg(DISTINCT aa.user_id) FILTER (WHERE aa.end_date IS NULL), NULL),
              ARRAY[]::int[]
            ) AS encargados,
            c.municipal_manager_id
       FROM CentersActivations ca
       JOIN Centers c ON c.center_id = ca.center_id
       LEFT JOIN Emergencies eo ON eo.emergency_id = ca.emergency_id
       LEFT JOIN ActivationAssignments aa ON aa.activation_id = ca.activation_id
      WHERE ca.ended_at IS NULL
        AND ca.activation_id = ANY($1::int[])
        AND ca.emergency_id IS DISTINCT FROM $2
      GROUP BY ca.activation_id, ca.center_id, c.name, ca.emergency_id,
               eo.name, c.municipal_manager_id`,
    [input.activation_ids, input.emergency_id]
  );

  let avisos = 0;
  for (const act of activaciones) {
    // ON CONFLICT DO UPDATE: reinvitar reabre la MISMA fila en vez de acumular
    // historial. La PK (emergency_id, activation_id) es lo que lo hace posible.
    await db.query(
      `INSERT INTO EmergencyActivationInvitations
         (emergency_id, activation_id, status, invited_by, invited_at)
       VALUES ($1, $2, 'invitada', $3, now())
       ON CONFLICT (emergency_id, activation_id) DO UPDATE
         SET status = 'invitada', invited_by = EXCLUDED.invited_by,
             invited_at = now(), responded_at = NULL, responded_by = NULL`,
      [input.emergency_id, act.activation_id, input.invited_by]
    );

    const destinatarios: number[] = act.encargados?.length
      ? act.encargados
      : act.municipal_manager_id
      ? [act.municipal_manager_id]
      : [];

    // Si el centro ya está en otra emergencia, aceptar lo MUEVE. El encargado
    // tiene que enterarse antes de decidir, no después.
    const aviso = act.emergencia_actual_id != null
      ? `Tu centro ${act.center_name} está participando hoy en "${act.emergencia_actual_nombre}". ` +
        `Si aceptas sumarse a "${input.emergency_name}", se trasladará a esa emergencia.`
      : `Tu comuna abrió "${input.emergency_name}". ¿Quieres que ${act.center_name} participe? ` +
        `Al aceptar, quedará dentro de esa emergencia y podrá compartirse si más adelante ` +
        `se suma a un SuperEvento.`;

    for (const destinatary of destinatarios) {
      await createNotification(db, {
        center_id: act.center_id,
        activation_id: act.activation_id,
        municipality_id: input.municipality_id,
        emergency_id: input.emergency_id,
        destinatary,
        kind: 'activation_invitation',
        title: 'Tu centro puede sumarse a una emergencia',
        message: aviso,
        channel: 'system',
      });
      avisos++;
    }
  }

  return { avisos, activaciones: activaciones.length };
}

/**
 * Todas las activaciones abiertas de la comuna con su estado frente a esta
 * emergencia. Es lo que ve el administrador en la pantalla de gestión de centros.
 */
export async function listActivationsStatus(
  db: Db,
  emergencyId: number
): Promise<ActivacionConEstado[]> {
  const { rows } = await db.query(
    `SELECT * FROM emergency_activations_status($1)`,
    [emergencyId]
  );
  return rows as ActivacionConEstado[];
}

/** Activaciones efectivamente vinculadas. Alimenta la vista previa de "qué voy a compartir". */
export async function listLinkedActivations(db: Db, emergencyId: number) {
  const { rows } = await db.query(
    `SELECT ca.activation_id, ca.center_id, c.name AS center_name, ca.started_at,
            (SELECT COUNT(*) FROM CenterItemPriority cip
              WHERE cip.center_id = c.center_id)::int AS prioridades
       FROM CentersActivations ca
       JOIN Centers c ON c.center_id = ca.center_id
      WHERE ca.emergency_id = $1 AND ca.ended_at IS NULL
      ORDER BY c.name`,
    [emergencyId]
  );
  return rows;
}

/**
 * El encargado responde. Aceptar vincula el centro; RECHAZAR NO TOCA la
 * activación.
 *
 * Antes rechazar hacía SET emergency_id = NULL, lo que desvinculaba al centro
 * incluso de la emergencia en la que ya estaba legítimamente. Ahora el rechazo
 * solo se registra.
 */
export async function responderActivacion(
  db: Db,
  input: { emergency_id: number; activation_id: number; accept: boolean; user_id: number }
) {
  const { rows: existe } = await db.query(
    `SELECT activation_id FROM CentersActivations
      WHERE activation_id = $1 AND ended_at IS NULL`,
    [input.activation_id]
  );
  if (!existe[0]) {
    throw fallo(404, 'ACTIVACION_NO_DISPONIBLE', 'Activación no encontrada o ya cerrada.');
  }

  if (input.accept) {
    await db.query(
      `UPDATE CentersActivations SET emergency_id = $1 WHERE activation_id = $2`,
      [input.emergency_id, input.activation_id]
    );
  }

  await db.query(
    `INSERT INTO EmergencyActivationInvitations
       (emergency_id, activation_id, status, responded_by, responded_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (emergency_id, activation_id) DO UPDATE
       SET status = EXCLUDED.status, responded_by = EXCLUDED.responded_by,
           responded_at = now()`,
    [input.emergency_id, input.activation_id, input.accept ? 'aceptada' : 'rechazada', input.user_id]
  );

  await db.query(
    `UPDATE CenterNotifications
        SET read_at = now(), updated_at = now()
      WHERE emergency_id = $1 AND activation_id = $2
        AND kind = 'activation_invitation' AND read_at IS NULL`,
    [input.emergency_id, input.activation_id]
  );

  return {
    emergency_id: input.emergency_id,
    activation_id: input.activation_id,
    status: input.accept ? 'aceptada' : 'rechazada',
  };
}

/**
 * Vinculación directa del administrador, sin preguntarle al encargado.
 *
 * Deja registro 'aceptada' para que la pantalla de gestión no muestre
 * "sin_invitar" sobre un centro que ya está dentro.
 */
export async function vincularActivaciones(
  db: Db,
  input: { emergency_id: number; activation_ids?: number[]; all_open?: boolean; user_id: number }
) {
  // all_open solo toma las SUELTAS (emergency_id IS NULL), no todas las abiertas:
  // un atajo masivo no debe arrastrar centros que ya están en otra emergencia.
  // Para moverlos hay que seleccionarlos uno a uno, que es una decisión explícita.
  const { rows } = input.all_open
    ? await db.query(
        `UPDATE CentersActivations SET emergency_id = $1
          WHERE ended_at IS NULL AND emergency_id IS NULL
          RETURNING activation_id, center_id`,
        [input.emergency_id]
      )
    : await db.query(
        `UPDATE CentersActivations SET emergency_id = $1
          WHERE activation_id = ANY($2::int[]) AND ended_at IS NULL
          RETURNING activation_id, center_id`,
        [input.emergency_id, (input.activation_ids ?? []).map(Number)]
      );

  for (const a of rows) {
    await db.query(
      `INSERT INTO EmergencyActivationInvitations
         (emergency_id, activation_id, status, invited_by, responded_by, responded_at)
       VALUES ($1, $2, 'aceptada', $3, $3, now())
       ON CONFLICT (emergency_id, activation_id) DO UPDATE
         SET status = 'aceptada', responded_by = EXCLUDED.responded_by, responded_at = now()`,
      [input.emergency_id, a.activation_id, input.user_id]
    );
  }

  return { emergency_id: input.emergency_id, vinculadas: rows.length, activaciones: rows };
}
