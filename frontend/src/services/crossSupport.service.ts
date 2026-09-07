// src/services/crossSupport.service.ts
//
// Tablero intercomunal y ofertas de apoyo. Solo disponible para comunas que
// están participando en la emergencia.
import { api } from "@/lib/api";

export type EstadoOferta = "pending" | "accepted" | "rejected" | "cancelled";

export type PrioridadCentro = {
  item_id: number;
  item_name: string;
  priority: "alto" | "medio" | "bajo";
};

/**
 * Centro de otra comuna visible durante la emergencia.
 *
 * El backend limita los campos en la propia base de datos: nunca llegan datos de
 * personas, familias, catastro ni cantidades de inventario.
 */
export type CentroCompartido = {
  center_id: string;
  name: string;
  /**
   * Ojo: `Centers.latitude` es DECIMAL en Postgres y node-postgres devuelve los
   * `numeric` como TEXTO. Hay que convertir con Number() antes de usarlos como
   * coordenada, o el mapa recibe NaN y no dibuja nada.
   */
  latitude: number | string | null;
  longitude: number | string | null;
  capacity: number | null;
  fullness_percentage: number | string | null;
  operational_status: string | null;
  municipality_id: number;
  municipality_shortname: string;
  activation_id: number;
  prioridades: PrioridadCentro[];
};

/** Coordenada utilizable, o null si el centro no tiene ubicación registrada. */
export function coordenadaDe(c: CentroCompartido): { lat: number; lng: number } | null {
  const lat = Number(c.latitude);
  const lng = Number(c.longitude);
  if (c.latitude == null || c.longitude == null || isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

export type NivelUrgencia = "alto" | "medio" | "bajo" | "ninguna";

/** Urgencia máxima declarada por el centro. Define el color del pin y el orden. */
export function urgenciaDe(c: CentroCompartido): NivelUrgencia {
  if (c.prioridades.some((p) => p.priority === "alto")) return "alto";
  if (c.prioridades.some((p) => p.priority === "medio")) return "medio";
  if (c.prioridades.length > 0) return "bajo";
  return "ninguna";
}

const PESO_URGENCIA: Record<NivelUrgencia, number> = { alto: 0, medio: 1, bajo: 2, ninguna: 3 };

export function compararPorUrgencia(a: CentroCompartido, b: CentroCompartido): number {
  return PESO_URGENCIA[urgenciaDe(a)] - PESO_URGENCIA[urgenciaDe(b)];
}

export type Oferta = {
  offer_id: number;
  emergency_id: number;
  emergency_name: string;
  from_municipality_id: number;
  from_municipality_name: string;
  target_center_id: string;
  target_center_name: string | null;
  target_municipality_id: number | null;
  target_municipality_name: string | null;
  item_id: number | null;
  item_name: string | null;
  message: string | null;
  status: EstadoOferta;
  created_at: string;
  created_by_name: string | null;
};

export async function getBoard(emergencyId: number): Promise<CentroCompartido[]> {
  const { data } = await api.get<CentroCompartido[]>(`/cross-support/board/${emergencyId}`);
  return data;
}

export async function listOffers(box: "enviadas" | "recibidas" | "todas" = "todas"): Promise<Oferta[]> {
  const { data } = await api.get<Oferta[]>(`/cross-support/offers`, { params: { box } });
  return data;
}

export async function createOffer(payload: {
  emergency_id: number;
  target_center_id: string;
  item_id?: number | null;
  message?: string | null;
}): Promise<Oferta> {
  const { data } = await api.post<Oferta>(`/cross-support/offers`, payload);
  return data;
}

/**
 * `cancelled` solo lo puede hacer la comuna que ofreció;
 * `accepted` / `rejected` solo la que recibe. El backend lo valida.
 */
export async function setOfferStatus(offerId: number, status: EstadoOferta) {
  const { data } = await api.patch(`/cross-support/offers/${offerId}`, { status });
  return data;
}
