// src/services/notifications.service.ts
import { api } from "@/lib/api";

export type NotificationStatus = 'queued' | 'sent' | 'failed';

/**
 * Clase de aviso. Tres avisos distintos comparten forma —invitación de comuna,
 * invitación de centro y ofrecimiento de apoyo—, así que deducirla de qué campos
 * vienen llenos llevaba a enlaces y diálogos equivocados. La columna la fija el
 * backend; puede venir null en filas antiguas.
 */
export type NotificationKind =
  | 'super_event_invitation'
  | 'activation_invitation'
  | 'support_offer'
  | 'volunteer_contact';

export interface CenterNotification {
  notification_id: string;
  title: string;
  message: string;
  event_at: string;
  /** null cuando la notificación va dirigida a la comuna y no a un centro. */
  center_id: string | null;
  center_name?: string;
  municipality_id?: number | null;
  /** Emergencia LOCAL a la que se refiere el aviso (invitación de un centro). */
  emergency_id?: number | null;
  /** Si viene, es una invitación a ese SuperEvento. */
  super_event_id?: number | null;
  kind?: NotificationKind | null;
  emergency_name?: string | null;
  emergency_ended_at?: string | null;
  super_event_name?: string | null;
  super_event_level?: "mayor" | "desastre" | "catastrofe" | null;
  super_event_ended_at?: string | null;
  activation_id?: number | null;
  destinatary_id?: number | null;
  destinatary_name: string | null;
  channel?: string;
  status?: NotificationStatus;
  sent_at?: string | null;
  read_at?: string | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface CreateNotificationDTO {
  center_id: string;
  title: string;
  message: string;
  destinatary_id: number;
  activation_id?: number | null;
  event_at?: string;
  channel?: string;
}

/**
 * Obtiene el historial de notificaciones para un centro específico.
 */
export async function listNotificationsByCenter(centerId: string, signal?: AbortSignal): Promise<CenterNotification[]> {
  try {
    const { data } = await api.get<CenterNotification[]>(`/notifications/by-center/${centerId}`, { signal });
    return data ?? [];
  } catch (error) {
    console.error(`Error fetching notifications for center ${centerId}:`, error);
    return [];
  }
}

/**
 * Crea una nueva notificación.
 */
export async function createNotification(payload: CreateNotificationDTO, signal?: AbortSignal): Promise<CenterNotification> {
  try {
    const { data } = await api.post<CenterNotification>("/notifications", payload, { signal });
    return data;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
}

/**
 * Obtiene las notificaciones del usuario actual.
 */
export async function listUserNotifications(): Promise<CenterNotification[]> {
  try {
    const { data } = await api.get<CenterNotification[]>("/notifications/me");
    return data ?? [];
  } catch (error) {
    console.error("Error fetching user notifications:", error);
    return [];
  }
}

/**
 * Marca una notificación como leída.
 */
export async function markNotificationAsRead(notificationId: string, signal?: AbortSignal): Promise<void> {
  try {
    await api.patch(`/notifications/${notificationId}/mark-read`, {}, { signal });
  } catch (error) {
    console.error(`Error marking notification ${notificationId} as read:`, error);
    throw error;
  }
}

/**
 * Marca todas las notificaciones del usuario como leídas.
 */
export async function markAllNotificationsAsRead(signal?: AbortSignal): Promise<void> {
  try {
    await api.patch('/notifications/mark-all-read', {}, { signal });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
}