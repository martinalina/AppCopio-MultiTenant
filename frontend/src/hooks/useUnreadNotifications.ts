import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { NotificationKind } from "@/services/notifications.service";

export interface AppNotification {
  notification_id: string;
  center_id: string | null;
  center_name?: string;
  /** Si viene junto a emergency_id, el aviso es para el encargado de ESA activación. */
  activation_id?: number | null;
  municipality_id: number | null;
  /** Si viene, la notificación es una invitación a esa emergencia. */
  emergency_id: number | null;
  /** Clase de aviso: distingue invitación de comuna, de centro y oferta de apoyo. */
  kind?: NotificationKind | null;
  emergency_name?: string | null;
  /** Si viene, la emergencia ya terminó y la invitación no tiene sentido. */
  emergency_ended_at?: string | null;
  title: string;
  message: string;
  event_at: string;
  read_at: string | null;
}

const INTERVALO_MS = 30000;

/**
 * Sondea el buzón del usuario cada 30s.
 *
 * Devuelve también la lista (antes solo contaba y descartaba las filas), porque el
 * aviso en pantalla de invitación a emergencia necesita el contenido, no solo el total.
 */
export function useUnreadNotifications() {
  const { user, isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated || !user?.user_id) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.get<AppNotification[]>("/notifications/me");
      const lista = Array.isArray(data) ? data : [];
      setNotifications(lista);
      setUnreadCount(lista.filter((n) => !n.read_at).length);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.user_id]);

  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(() => void fetchNotifications(), INTERVALO_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  return { unreadCount, notifications, loading, refetch: fetchNotifications };
}
