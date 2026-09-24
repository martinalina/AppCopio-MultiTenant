// src/services/superEventService.ts
//
// SuperEventos: el contenedor de emergencias donde vive TODA la colaboración
// intermunicipal (participantes, tablero, ofertas de apoyo).
//
// La emergencia sigue siendo un evento LOCAL de una comuna —nivel "emergencia
// menor"— y agrupa las activaciones de sus centros. El SuperEvento agrupa
// emergencias de varias comunas y les pone nivel: mayor, desastre o catástrofe.
//
// Ver db/002d_supereventos.sql para el esquema y las políticas RLS que respaldan
// cada una de estas operaciones.
import { Db } from '../types/db';

export type NivelEvento = 'mayor' | 'desastre' | 'catastrofe';
export type EstadoParticipacion = 'invitada' | 'participando' | 'rechazada';

export const NIVELES: NivelEvento[] = ['mayor', 'desastre', 'catastrofe'];

export type SuperEvent = {
  super_event_id: number;
  name: string;
  level: NivelEvento;
  type: string | null;
  description: string | null;
  started_at: string;
  ended_at: string | null;
  created_by_municipality_id: number | null;
  /** Estado de participación de la comuna del request. null = no la invitaron. */
  mi_estado: EstadoParticipacion | null;
  /** Emergencia con la que MI comuna aporta a este SuperEvento. */
  mi_emergency_id: number | null;
  mi_emergency_name: string | null;
  total_participando: number;
};

export type SuperEventParticipant = {
  municipality_id: number;
  name: string;
  shortname: string;
  status: EstadoParticipacion;
  emergency_id: number | null;
  emergency_name: string | null;
  joined_at: string;
  responded_at: string | null;
};

/** Error de negocio con código estable para la UI. */
function fallo(status: number, code: string, publicMessage: string) {
  const e = new Error(code);
  (e as any).status = status;
  (e as any).publicMessage = publicMessage;
  return e;
}

export function esNivelValido(v: any): v is NivelEvento {
  return typeof v === 'string' && (NIVELES as string[]).includes(v);
}

/**
 * SuperEventos visibles. RLS (super_events_read) ya limita el conjunto: el Super
 * Administrador ve todos y una comuna ve solo aquellos en los que tiene fila de
 * participación, incluida la de estado 'invitada' —así puede ver a qué la invitan.
 *
 * El conteo de participantes va por super_event_participants_of() y no por un
 * COUNT directo: sep_read solo deja ver la fila propia, así que un COUNT normal
 * devolvería siempre 1.
 */
export async function listSuperEvents(db: Db): Promise<SuperEvent[]> {
  const { rows } = await db.query(
    `SELECT se.super_event_id, se.name, se.level, se.type, se.description,
            se.started_at, se.ended_at, se.created_by_municipality_id,
            (SELECT p.status FROM SuperEventParticipants p
              WHERE p.super_event_id = se.super_event_id
                AND p.municipality_id = current_tenant()) AS mi_estado,
            mia.emergency_id   AS mi_emergency_id,
            mia.name           AS mi_emergency_name,
            (SELECT COUNT(*) FROM super_event_participants_of(se.super_event_id) p
              WHERE p.status = 'participando')::int AS total_participando
       FROM SuperEvents se
       -- La emergencia propia se resuelve por JOIN normal: Emergencies está bajo
       -- aislamiento de tenant, así que solo puede calzar la de mi comuna.
       LEFT JOIN Emergencies mia
              ON mia.super_event_id = se.super_event_id
             AND mia.created_by_municipality_id = current_tenant()
      ORDER BY se.started_at DESC`
  );
  return rows as SuperEvent[];
}

export async function listParticipants(
  db: Db,
  superEventId: number
): Promise<SuperEventParticipant[]> {
  const { rows } = await db.query(
    `SELECT * FROM super_event_participants_of($1)`,
    [superEventId]
  );
  return rows as SuperEventParticipant[];
}

/** Estado de participación de una comuna. null si no tiene fila. */
export async function estadoDe(
  db: Db,
  superEventId: number,
  municipalityId: number
): Promise<EstadoParticipacion | null> {
  const { rows } = await db.query(
    `SELECT status FROM SuperEventParticipants
      WHERE super_event_id = $1 AND municipality_id = $2`,
    [superEventId, municipalityId]
  );
  return rows[0]?.status ?? null;
}

/** El SuperEvento existe, es visible y sigue vigente. */
export async function getSuperEventVigente(db: Db, superEventId: number) {
  const { rows } = await db.query(
    `SELECT super_event_id, name, level, ended_at FROM SuperEvents
      WHERE super_event_id = $1`,
    [superEventId]
  );
  const se = rows[0];
  if (!se) {
    throw fallo(404, 'SUPEREVENTO_NO_EXISTE', 'El SuperEvento no existe o no es visible para ti.');
  }
  if (se.ended_at != null) {
    throw fallo(409, 'SUPEREVENTO_CERRADO', `"${se.name}" ya está cerrado.`);
  }
  return se;
}

/**
 * Crea un SuperEvento vacío. Solo el Super Administrador llega acá: las comunas
 * crean el suyo por createFromEmergency, que ya lo deja con una emergencia dentro.
 */
export async function createSuperEvent(
  db: Db,
  input: { name: string; level: NivelEvento; type?: string | null; description?: string | null; created_by: number }
) {
  const { rows } = await db.query(
    `INSERT INTO SuperEvents (name, level, type, description, created_by, created_by_municipality_id)
     VALUES ($1, $2, $3, $4, $5, NULL)
     RETURNING super_event_id, name, level, type, description, started_at, ended_at,
               created_by_municipality_id`,
    [input.name.trim(), input.level, input.type ?? null, input.description ?? null, input.created_by]
  );
  return rows[0];
}

/**
 * AUTOCREADO: una comuna quiere colaborar sobre una emergencia que ya tiene.
 *
 * Es el caso que motivó todo el rediseño: antes había que declarar la emergencia
 * compartida ANTES que las locales, y si cada comuna ya había creado la suya no
 * había forma de unirlas. Ahora la emergencia local existente se envuelve en un
 * SuperEvento nuevo sin mover un solo dato.
 *
 * Todo ocurre dentro de la transacción del request (withTenant), así que si la
 * invitación falla no queda un SuperEvento huérfano.
 */
export async function createFromEmergency(
  db: Db,
  input: {
    emergency_id: number;
    name: string;
    level: NivelEvento;
    type?: string | null;
    description?: string | null;
    created_by: number;
    municipality_id: number;
  }
) {
  // RLS ya acota Emergencies a la propia comuna; esto distingue "no es tuya" de
  // "ya está dentro de otro SuperEvento", que son errores distintos para la UI.
  const { rows: emRows } = await db.query(
    `SELECT emergency_id, name, super_event_id, ended_at FROM Emergencies
      WHERE emergency_id = $1`,
    [input.emergency_id]
  );
  const emergencia = emRows[0];
  if (!emergencia) {
    throw fallo(404, 'EMERGENCIA_NO_EXISTE', 'La emergencia no existe o no pertenece a tu comuna.');
  }
  if (emergencia.super_event_id != null) {
    throw fallo(
      409,
      'EMERGENCIA_YA_EN_SUPEREVENTO',
      `"${emergencia.name}" ya forma parte de un SuperEvento.`
    );
  }
  if (emergencia.ended_at != null) {
    throw fallo(409, 'EMERGENCIA_CERRADA', `"${emergencia.name}" ya está cerrada.`);
  }

  const { rows } = await db.query(
    `INSERT INTO SuperEvents (name, level, type, description, created_by, created_by_municipality_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING super_event_id, name, level, type, description, started_at, ended_at,
               created_by_municipality_id`,
    [
      input.name.trim(),
      input.level,
      input.type ?? null,
      input.description ?? null,
      input.created_by,
      input.municipality_id,
    ]
  );
  const superEvento = rows[0];

  await db.query(
    `UPDATE Emergencies SET super_event_id = $1 WHERE emergency_id = $2`,
    [superEvento.super_event_id, input.emergency_id]
  );

  // Quien lo crea queda dentro de inmediato: no tiene sentido invitarse a sí mismo.
  await db.query(
    `INSERT INTO SuperEventParticipants (super_event_id, municipality_id, status, responded_at)
     VALUES ($1, $2, 'participando', now())`,
    [superEvento.super_event_id, input.municipality_id]
  );

  return { ...superEvento, emergency_id: input.emergency_id };
}

/**
 * Agrupa emergencias YA EXISTENTES bajo un SuperEvento. Solo el Super
 * Administrador: es el que tiene visibilidad sobre todas las comunas.
 *
 * Las comunas dueñas quedan 'participando' sin pasar por invitación, porque el
 * acto de agrupar ES la decisión de que colaboran. Las que ya tenían fila
 * conservan su estado.
 */
export async function groupEmergencies(
  db: Db,
  superEventId: number,
  emergencyIds: number[]
) {
  const { rows: candidatas } = await db.query(
    `SELECT emergency_id, name, created_by_municipality_id, super_event_id
       FROM Emergencies
      WHERE emergency_id = ANY($1::int[]) AND ended_at IS NULL`,
    [emergencyIds]
  );

  const yaAgrupadas = candidatas.filter((e: any) => e.super_event_id != null);
  if (yaAgrupadas.length > 0) {
    throw fallo(
      409,
      'EMERGENCIA_YA_EN_SUPEREVENTO',
      `Ya forman parte de otro SuperEvento: ${yaAgrupadas.map((e: any) => e.name).join(', ')}.`
    );
  }

  // Dos emergencias de la MISMA comuna en el mismo SuperEvento violarían el
  // índice único. Se detecta acá para devolver un mensaje entendible en vez de
  // un error 23505 crudo.
  const porComuna = new Map<number, string[]>();
  for (const e of candidatas) {
    const lista = porComuna.get(e.created_by_municipality_id) ?? [];
    lista.push(e.name);
    porComuna.set(e.created_by_municipality_id, lista);
  }
  const duplicadas = [...porComuna.values()].filter((l) => l.length > 1);
  if (duplicadas.length > 0) {
    throw fallo(
      409,
      'DOS_EMERGENCIAS_DE_LA_MISMA_COMUNA',
      `Una comuna solo puede aportar una emergencia por SuperEvento: ${duplicadas[0].join(', ')}.`
    );
  }

  const { rows: agrupadas } = await db.query(
    `UPDATE Emergencies SET super_event_id = $1
      WHERE emergency_id = ANY($2::int[]) AND super_event_id IS NULL AND ended_at IS NULL
      RETURNING emergency_id, name, created_by_municipality_id`,
    [superEventId, emergencyIds]
  );

  for (const e of agrupadas) {
    await db.query(
      `INSERT INTO SuperEventParticipants (super_event_id, municipality_id, status, responded_at)
       VALUES ($1, $2, 'participando', now())
       ON CONFLICT (super_event_id, municipality_id)
       DO UPDATE SET status = 'participando', responded_at = now()`,
      [superEventId, e.created_by_municipality_id]
    );
  }

  return { super_event_id: superEventId, agrupadas };
}

/** Emergencias abiertas y sin SuperEvento. Para agrupar y para aceptar invitaciones. */
export async function listEmergenciasHuerfanas(db: Db) {
  const { rows } = await db.query(
    `SELECT e.emergency_id, e.name, e.type, e.started_at,
            e.created_by_municipality_id, m.shortname AS municipality_shortname,
            (SELECT COUNT(*) FROM CentersActivations ca
              WHERE ca.emergency_id = e.emergency_id AND ca.ended_at IS NULL)::int
              AS activaciones_vinculadas
       FROM Emergencies e
       JOIN Municipalities m ON m.municipality_id = e.created_by_municipality_id
      WHERE e.super_event_id IS NULL AND e.ended_at IS NULL
      ORDER BY e.started_at DESC`
  );
  return rows;
}

/**
 * Invita comunas. La política sep_write permite hacerlo al Super Administrador o
 * a CUALQUIER comuna que ya esté 'participando' — no solo a la que originó el
 * SuperEvento. Esa es la diferencia central con el modelo anterior.
 *
 * El INSERT va a secas y la duplicación se detecta por el error 23505, en vez de
 * resolverse con ON CONFLICT o consultando antes si la fila existe. Las dos
 * alternativas fallan por la misma razón: la fila que se crea es de la comuna
 * INVITADA, y sep_read no se la muestra a quien invita.
 *
 *   - Un SELECT previo no vería la fila ajena y siempre diría "no existe".
 *   - ON CONFLICT exige que la fila nueva sea visible bajo la política de SELECT
 *     y aborta con "new row violates row-level security policy" aunque el
 *     WITH CHECK se cumpla (ver el comentario de sep_write en 002d).
 *
 * Las comprobaciones de unicidad de Postgres sí ignoran RLS, así que el 23505 es
 * la única señal fiable de que esa comuna ya estaba invitada.
 *
 * Cada INSERT va dentro de un SAVEPOINT porque todo el request corre en UNA
 * transacción (withTenant): sin él, la primera comuna repetida abortaría la
 * transacción entera y se caerían también las invitaciones siguientes.
 */
export async function inviteMunicipalities(
  db: Db,
  superEventId: number,
  municipalityIds: number[],
  invitedBy: number,
  invitedByMunicipalityId: number | null
) {
  const invitadas: number[] = [];
  const yaEstaban: number[] = [];

  for (const raw of municipalityIds) {
    const municipalityId = Number(raw);
    if (!Number.isFinite(municipalityId)) continue;

    await db.query('SAVEPOINT invitacion');
    try {
      await db.query(
        `INSERT INTO SuperEventParticipants
           (super_event_id, municipality_id, status, invited_by, invited_by_municipality_id)
         VALUES ($1, $2, 'invitada', $3, $4)`,
        [superEventId, municipalityId, invitedBy, invitedByMunicipalityId]
      );
      await db.query('RELEASE SAVEPOINT invitacion');
      invitadas.push(municipalityId);
    } catch (err: any) {
      await db.query('ROLLBACK TO SAVEPOINT invitacion');
      await db.query('RELEASE SAVEPOINT invitacion');
      if (err?.code === '23505') {
        yaEstaban.push(municipalityId);
        continue;
      }
      throw err;
    }
  }

  return { invitadas, yaEstaban };
}

/** Vincula una emergencia local ya existente al SuperEvento. */
export async function aportarEmergenciaExistente(
  db: Db,
  superEventId: number,
  emergencyId: number
) {
  const { rows: emRows } = await db.query(
    `SELECT emergency_id, name, super_event_id, ended_at FROM Emergencies
      WHERE emergency_id = $1`,
    [emergencyId]
  );
  const emergencia = emRows[0];
  if (!emergencia) {
    throw fallo(404, 'EMERGENCIA_NO_EXISTE', 'La emergencia no existe o no pertenece a tu comuna.');
  }
  if (emergencia.ended_at != null) {
    throw fallo(409, 'EMERGENCIA_CERRADA', `"${emergencia.name}" ya está cerrada.`);
  }
  if (emergencia.super_event_id === superEventId) {
    return emergencia; // idempotente: ya estaba aportada a este mismo SuperEvento
  }
  if (emergencia.super_event_id != null) {
    throw fallo(
      409,
      'EMERGENCIA_YA_EN_SUPEREVENTO',
      `"${emergencia.name}" ya forma parte de otro SuperEvento.`
    );
  }

  try {
    const { rows } = await db.query(
      `UPDATE Emergencies SET super_event_id = $1 WHERE emergency_id = $2
       RETURNING emergency_id, name, super_event_id`,
      [superEventId, emergencyId]
    );
    return rows[0];
  } catch (err: any) {
    // emergencies_one_per_municipality_per_superevent_uq
    if (err?.code === '23505') {
      throw fallo(
        409,
        'YA_APORTASTE_EMERGENCIA',
        'Tu comuna ya aporta otra emergencia a este SuperEvento. Solo se admite una.'
      );
    }
    throw err;
  }
}

/** Marca leídas las invitaciones en pantalla de este SuperEvento para la comuna. */
export async function marcarInvitacionLeida(
  db: Db,
  superEventId: number,
  municipalityId: number
) {
  await db.query(
    `UPDATE CenterNotifications
        SET read_at = now(), updated_at = now()
      WHERE super_event_id = $1 AND municipality_id = $2
        AND kind = 'super_event_invitation' AND read_at IS NULL`,
    [superEventId, municipalityId]
  );
}
