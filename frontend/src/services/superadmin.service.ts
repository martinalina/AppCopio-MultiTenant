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
// Emergencias LOCALES de la comuna
//
// Desde el rediseño de SuperEventos, una emergencia es SIEMPRE de una comuna
// (nivel "emergencia menor") y agrupa las activaciones de sus centros. Invitar
// comunas, el tablero y las ofertas viven en superEvents.service.ts.
// ---------------------------------------------------------------

export type Emergency = {
  emergency_id: number;
  name: string;
  type: string | null;
  started_at: string;
  ended_at: string | null;
  created_by_municipality_id: number;
  /** SuperEvento al que aporta, si ya se sumó a alguno. */
  super_event_id: number | null;
  super_event_name: string | null;
  super_event_level: "mayor" | "desastre" | "catastrofe" | null;
  super_event_ended_at: string | null;
  centros_vinculados: number;
};

/** Estado de una activación frente a una emergencia, para la pantalla de gestión. */
export type EstadoInvitacionCentro = "sin_invitar" | "invitada" | "aceptada" | "rechazada";

export type ActivacionConEstado = {
  activation_id: number;
  center_id: string;
  center_name: string;
  started_at: string;
  /** En qué emergencia está HOY. Puede ser otra: aceptar la trasladaría. */
  emergencia_actual_id: number | null;
  emergencia_actual_nombre: string | null;
  estado_invitacion: EstadoInvitacionCentro;
  invited_at: string | null;
  responded_at: string | null;
};

export type ActivacionVinculada = {
  activation_id: number;
  center_id: string;
  center_name: string;
  started_at: string;
  prioridades: number;
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

/**
 * Crea la emergencia. El backend avisa de inmediato a los encargados de las
 * activaciones SUELTAS (sin emergencia) para que decidan si su centro se suma;
 * devuelve cuántos avisos salieron.
 */
export async function createEmergency(payload: { name: string; type?: string | null }): Promise<
  Emergency & { avisos_a_encargados: number; centros_convocados: number }
> {
  const { data } = await api.post("/emergencies", payload);
  return data;
}

/** TODAS las activaciones abiertas de la comuna con su estado frente a la emergencia. */
export async function listEmergencyActivations(
  emergencyId: number
): Promise<ActivacionConEstado[]> {
  const { data } = await api.get<ActivacionConEstado[]>(`/emergencies/${emergencyId}/activations`);
  return data;
}

/** Solo las efectivamente vinculadas: es lo que se compartirá si entra a un SuperEvento. */
export async function listLinkedActivations(
  emergencyId: number
): Promise<ActivacionVinculada[]> {
  const { data } = await api.get<ActivacionVinculada[]>(
    `/emergencies/${emergencyId}/linked-activations`
  );
  return data;
}

/**
 * Invita o REINVITA centros, sin importar su estado previo: sirve para los que
 * rechazaron, los que están en otra emergencia y deben trasladarse, y los que
 * quedaron fuera de la primera tanda.
 */
export async function inviteActivations(emergencyId: number, activationIds: number[]) {
  const { data } = await api.post(`/emergencies/${emergencyId}/invite-activations`, {
    activation_ids: activationIds,
  });
  return data;
}

/** El encargado responde. Rechazar NO desvincula el centro: solo registra el rechazo. */
export async function respondActivation(emergencyId: number, activationId: number, accept: boolean) {
  const { data } = await api.post(
    `/emergencies/${emergencyId}/activations/${activationId}/respond`,
    { accept }
  );
  return data;
}

/** Cierra la emergencia local. No corta la colaboración: eso lo hace cerrar el SuperEvento. */
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

/** Vinculación directa del administrador, sin preguntarle al encargado. */
export async function linkActivations(
  emergencyId: number,
  payload: { activation_ids?: number[]; all_open?: boolean }
) {
  const { data } = await api.post(`/emergencies/${emergencyId}/link-activations`, payload);
  return data;
}
