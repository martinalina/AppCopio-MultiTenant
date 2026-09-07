// src/services/superadmin.service.ts
//
// Endpoints de gestión de municipalidades y emergencias. Todos exigen sesión;
// los de municipalidades exigen además Super Administrador (el backend lo valida
// con requireSuperAdmin, acá solo se ocultan las pantallas).
import { api } from "@/lib/api";

// ---------------------------------------------------------------
// Municipalidades
// ---------------------------------------------------------------

export type Municipality = {
  municipality_id: number;
  name: string;
  shortname: string;
  is_active: boolean;
  center_seq_counter?: number;
  created_at: string;
};

export type MunicipalityAdmin = {
  user_id: number;
  username: string;
  email: string;
  nombre: string | null;
  rut: string | null;
  role_id: number;
  is_active: boolean;
};

export type MunicipalityDetail = Municipality & {
  total_usuarios: string | number;
  total_centros: string | number;
  administrador: MunicipalityAdmin | null;
};

export type MunicipalityUser = MunicipalityAdmin & {
  role_name: string | null;
  es_apoyo_admin: boolean;
  created_at: string;
};

/** Qué hacer con el administrador vigente al nombrar uno nuevo. */
export type AccionAdminActual = "degradar" | "desactivar";

export type NuevoAdminInput = {
  username: string;
  password: string;
  email: string;
  nombre: string;
  rut: string;
};

export async function listMunicipalities(): Promise<Municipality[]> {
  const { data } = await api.get<Municipality[]>("/municipalities");
  return data;
}

export async function getMunicipality(id: number): Promise<MunicipalityDetail> {
  const { data } = await api.get<MunicipalityDetail>(`/municipalities/${id}`);
  return data;
}

export async function listMunicipalityUsers(id: number): Promise<MunicipalityUser[]> {
  const { data } = await api.get<MunicipalityUser[]>(`/municipalities/${id}/users`);
  return data;
}

export async function createMunicipality(payload: {
  name: string;
  shortname: string;
  admin: NuevoAdminInput;
}) {
  const { data } = await api.post("/municipalities", payload);
  return data;
}

/**
 * Nombra al administrador de la comuna. Si ya hay uno, `accion_actual` es obligatorio:
 * el backend responde 409 si falta, porque solo puede haber un administrador activo.
 */
export async function setMunicipalityAdmin(
  id: number,
  payload: {
    accion_actual?: AccionAdminActual;
    promover_user_id?: number;
    nuevo?: NuevoAdminInput;
  }
) {
  const { data } = await api.post(`/municipalities/${id}/admin`, payload);
  return data;
}

// ---------------------------------------------------------------
// Emergencias
// ---------------------------------------------------------------

export type EstadoParticipacion = "invitada" | "participando" | "rechazada";

export type Emergency = {
  emergency_id: number;
  name: string;
  type: string | null;
  started_at: string;
  ended_at: string | null;
  created_by_municipality_id: number | null;
  /** null si la comuna no fue invitada. */
  mi_estado: EstadoParticipacion | null;
  total_participando: string | number;
};

export type EmergencyParticipant = {
  municipality_id: number;
  name: string;
  shortname: string;
  status: EstadoParticipacion;
  joined_at: string;
  responded_at: string | null;
};

export type OpenActivation = {
  activation_id: number;
  center_id: string;
  center_name: string;
  started_at: string;
  emergency_id: number | null;
};

export async function listEmergencies(): Promise<Emergency[]> {
  const { data } = await api.get<Emergency[]>("/emergencies");
  return data;
}

export async function createEmergency(payload: { name: string; type?: string | null }) {
  const { data } = await api.post<Emergency>("/emergencies", payload);
  return data;
}

export async function listParticipants(emergencyId: number): Promise<EmergencyParticipant[]> {
  const { data } = await api.get<EmergencyParticipant[]>(`/emergencies/${emergencyId}/participants`);
  return data;
}

export async function inviteMunicipalities(emergencyId: number, municipalityIds: number[]) {
  const { data } = await api.post(`/emergencies/${emergencyId}/invite`, {
    municipality_ids: municipalityIds,
  });
  return data;
}

/**
 * El encargado de un centro decide si su activación se suma a la emergencia.
 * El administrador puede corregirlo después desde la vinculación masiva.
 */
export async function respondActivation(emergencyId: number, activationId: number, accept: boolean) {
  const { data } = await api.post(
    `/emergencies/${emergencyId}/activations/${activationId}/respond`,
    { accept }
  );
  return data;
}

/** Acepta o rechaza la invitación de la propia comuna. Solo su administrador puede. */
export async function respondInvitation(emergencyId: number, accept: boolean) {
  const { data } = await api.post(`/emergencies/${emergencyId}/respond`, { accept });
  return data;
}

/**
 * Cierra la emergencia. Devuelve cuántas activaciones siguen abiertas: el cierre es
 * informativo y NO corta el acceso intercomunal, así que la UI debe advertirlo.
 */
export async function closeEmergency(emergencyId: number): Promise<{
  emergency_id: number;
  name: string;
  ended_at: string;
  activaciones_abiertas: number;
}> {
  const { data } = await api.patch(`/emergencies/${emergencyId}/close`);
  return data;
}

export async function listOpenActivations(): Promise<OpenActivation[]> {
  const { data } = await api.get<OpenActivation[]>("/emergencies/activations/open");
  return data;
}

export async function linkActivations(
  emergencyId: number,
  payload: { activation_ids?: number[]; all_open?: boolean }
) {
  const { data } = await api.post(`/emergencies/${emergencyId}/link-activations`, payload);
  return data;
}
