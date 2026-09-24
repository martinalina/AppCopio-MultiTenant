// src/services/superEvents.service.ts
//
// SuperEventos: el contenedor donde vive la colaboración intermunicipal.
//
// Una Emergencia es un evento LOCAL de una comuna (nivel "emergencia menor") y
// agrupa las activaciones de sus centros. Un SuperEvento agrupa emergencias de
// varias comunas y les pone nivel. Ver superadmin.service.ts para las emergencias.
import { api } from "@/lib/api";

/**
 * Niveles que sobrepasan la capacidad comunal. 'menor' no está: ese nivel ES una
 * emergencia suelta, no necesita SuperEvento.
 */
export type NivelEvento = "mayor" | "desastre" | "catastrofe";

export const NIVELES: { value: NivelEvento; label: string; definicion: string }[] = [
  {
    value: "mayor",
    label: "Emergencia mayor",
    definicion: "Sobrepasa la capacidad de respuesta de la comuna. Requiere apoyo provincial o regional.",
  },
  {
    value: "desastre",
    label: "Desastre",
    definicion: "Sobrepasa la capacidad de respuesta regional. Requiere movilización de recursos a nivel nacional.",
  },
  {
    value: "catastrofe",
    label: "Catástrofe",
    definicion: "Excede la capacidad de respuesta del país. Requiere Gobierno Central y asistencia internacional.",
  },
];

export const ETIQUETA_NIVEL: Record<NivelEvento, string> = {
  mayor: "Emergencia mayor",
  desastre: "Desastre",
  catastrofe: "Catástrofe",
};

export type EstadoParticipacion = "invitada" | "participando" | "rechazada";

export type SuperEvent = {
  super_event_id: number;
  name: string;
  level: NivelEvento;
  type: string | null;
  description: string | null;
  started_at: string;
  ended_at: string | null;
  /** null = lo creó el Super Administrador. Solo esa comuna (o él) puede cerrarlo. */
  created_by_municipality_id: number | null;
  /** Estado de MI comuna. null solo para el Super Administrador, que no participa. */
  mi_estado: EstadoParticipacion | null;
  /** Emergencia con la que MI comuna aporta. null mientras no haya aceptado. */
  mi_emergency_id: number | null;
  mi_emergency_name: string | null;
  total_participando: number;
};

export type SuperEventParticipant = {
  municipality_id: number;
  name: string;
  shortname: string;
  status: EstadoParticipacion;
  /** Emergencia que aporta esa comuna. null si todavía no respondió. */
  emergency_id: number | null;
  emergency_name: string | null;
  joined_at: string;
  responded_at: string | null;
};

/** Emergencia abierta que todavía no pertenece a ningún SuperEvento. */
export type EmergenciaHuerfana = {
  emergency_id: number;
  name: string;
  type: string | null;
  started_at: string;
  created_by_municipality_id: number;
  municipality_shortname: string;
  activaciones_vinculadas: number;
};

export async function listSuperEvents(): Promise<SuperEvent[]> {
  const { data } = await api.get<SuperEvent[]>("/super-events");
  return data;
}

/** Crea un SuperEvento vacío. Solo el Super Administrador. */
export async function createSuperEvent(payload: {
  name: string;
  level: NivelEvento;
  type?: string | null;
  description?: string | null;
}): Promise<SuperEvent> {
  const { data } = await api.post<SuperEvent>("/super-events", payload);
  return data;
}

/**
 * AUTOCREADO: envuelve una emergencia local que ya existe en un SuperEvento nuevo
 * e invita a las comunas indicadas. Es el camino cuando dos comunas deciden
 * colaborar sobre un evento que cada una ya venía manejando por su cuenta.
 */
export async function createFromEmergency(
  emergencyId: number,
  payload: {
    name: string;
    level: NivelEvento;
    type?: string | null;
    description?: string | null;
    municipality_ids?: number[];
  }
) {
  const { data } = await api.post(`/super-events/from-emergency/${emergencyId}`, payload);
  return data;
}

/** Agrupa emergencias existentes bajo un SuperEvento. Solo el Super Administrador. */
export async function groupEmergencies(superEventId: number, emergencyIds: number[]) {
  const { data } = await api.post(`/super-events/${superEventId}/group-emergencies`, {
    emergency_ids: emergencyIds,
  });
  return data;
}

export async function listOrphanEmergencies(): Promise<EmergenciaHuerfana[]> {
  const { data } = await api.get<EmergenciaHuerfana[]>("/super-events/emergencies/orphans");
  return data;
}

export async function listSuperEventParticipants(
  superEventId: number
): Promise<SuperEventParticipant[]> {
  const { data } = await api.get<SuperEventParticipant[]>(
    `/super-events/${superEventId}/participants`
  );
  return data;
}

/** Invita comunas. Puede hacerlo cualquier comuna participante, no solo la originaria. */
export async function inviteToSuperEvent(superEventId: number, municipalityIds: number[]) {
  const { data } = await api.post(`/super-events/${superEventId}/invite`, {
    municipality_ids: municipalityIds,
  });
  return data;
}

/**
 * Responde la invitación.
 *
 * Aceptar OBLIGA a aportar exactamente una emergencia: o `emergency_id` de una
 * local que ya exista y no tenga SuperEvento, o `new_emergency` para crearla.
 *
 * La diferencia importa: con una emergencia EXISTENTE no se avisa a los
 * encargados de centro (ya se les preguntó cuando se creó), así que la UI debe
 * mostrar antes qué centros quedarán compartidos. Con una NUEVA sí se les avisa.
 */
export async function respondSuperEvent(
  superEventId: number,
  payload:
    | { accept: false }
    | { accept: true; emergency_id: number }
    | { accept: true; new_emergency: { name: string; type?: string | null } }
): Promise<{
  super_event_id: number;
  status: EstadoParticipacion;
  emergency_id?: number;
  emergency_name?: string;
  avisos_a_encargados?: number;
}> {
  const { data } = await api.post(`/super-events/${superEventId}/respond`, payload);
  return data;
}

/**
 * Cierra el SuperEvento. A diferencia del cierre de una emergencia, este SÍ corta
 * el acceso: el tablero queda vacío y no se pueden crear ofertas nuevas. Las
 * emergencias locales siguen abiertas, cada comuna se sigue organizando con la suya.
 */
export async function closeSuperEvent(superEventId: number): Promise<{
  super_event_id: number;
  name: string;
  ended_at: string;
  emergencias_abiertas: number;
}> {
  const { data } = await api.patch(`/super-events/${superEventId}/close`);
  return data;
}
