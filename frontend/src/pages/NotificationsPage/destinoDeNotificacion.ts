// src/pages/NotificationsPage/destinoDeNotificacion.ts
//
// A dónde lleva el enlace de una notificación. Vive aparte porque la regla la usan
// tanto el listado del buzón como el badge, y porque antes estaba implícita en un
// ternario que decidía solo por center_id: como el ofrecimiento de apoyo trae el
// centro destino, el enlace llevaba al detalle del centro en vez de a la bandeja de
// ofertas, que es donde se acepta.
import { paths } from "@/routes/paths";
import type { CenterNotification } from "@/services/notifications.service";

/**
 * Devuelve la ruta a la que debe llevar la notificación, o null si no hay a dónde ir.
 *
 * Se decide por `kind`. Las filas anteriores a esa columna no la traen, así que se
 * cae a la forma de los campos —que es exactamente la ambigüedad que motivó `kind`,
 * pero solo se aplica a datos viejos.
 */
export function destinoDeNotificacion(n: CenterNotification): string | null {
  switch (n.kind) {
    case "support_offer":
      return paths.supportOffers;
    // La invitación de comuna lleva a SuperEventos; la de un centro, a la
    // emergencia LOCAL, que es donde el encargado la responde.
    case "super_event_invitation":
      return paths.superEvents;
    case "activation_invitation":
      return paths.emergencies;
    case "volunteer_contact":
      return n.center_id ? `/center/${n.center_id}/details` : null;
  }

  // Respaldo para filas sin kind.
  if (n.super_event_id != null) return paths.superEvents;
  if (n.emergency_id != null && n.activation_id != null) return paths.emergencies;
  if (n.center_id) return `/center/${n.center_id}/details`;
  if (n.emergency_id != null) return paths.emergencies;
  return null;
}

/** Texto del enlace, acorde al destino. */
export function etiquetaDeDestino(n: CenterNotification): string {
  const destino = destinoDeNotificacion(n);
  if (destino === paths.supportOffers) return "Ver ofertas de apoyo";
  if (destino === paths.superEvents) return "Ir a SuperEventos";
  if (destino === paths.emergencies) return "Ir a emergencias";
  return "Ver detalles";
}
