export type NotificationStatus = 'queued' | 'sent' | 'failed';

/**
 * Clase de aviso. Sin esto la UI tenía que deducirla de qué campos venían llenos, y
 * tres avisos distintos comparten forma (ver centernotif_kind_chk en 002b).
 */
export type NotificationKind =
  /** Invitación de una comuna a un SuperEvento. Reemplaza a 'emergency_invitation':
   *  desde 002d ya no se invita a emergencias, que son siempre locales. */
  | 'super_event_invitation'
  | 'activation_invitation'
  | 'support_offer'
  | 'volunteer_contact';

export type CenterNotification = {
  notification_id: string;
  /** null cuando la notificación va dirigida a una comuna y no a un centro. */
  center_id: string | null;
  center_name: string;
  activation_id: number | null;
  destinatary_id: number | null;
  destinatary_name: string;
  title: string;
  message: string;
  event_at: string; // ISO
  channel: string;
  status: NotificationStatus;
  sent_at: string | null;
  read_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
  /** Destino municipal (invitaciones a SuperEventos y avisos de comuna). */
  municipality_id?: number | null;
  /** Si viene, la UI ofrece aceptar/rechazar la invitación a ese SuperEvento. */
  super_event_id?: number | null;
  /** Emergencia LOCAL a la que se refiere el aviso (lo usa 'activation_invitation'). */
  emergency_id?: number | null;
  /** Clase de aviso: decide a dónde enlaza y qué UI lo atiende. */
  kind?: NotificationKind | null;
}

export type CreateNotificationInput = {
  /** Uno de los dos destinos es obligatorio (lo exige centernotif_destino_chk). */
  center_id?: string | null;
  municipality_id?: number | null;
  super_event_id?: number | null;
  emergency_id?: number | null;
  activation_id?: number | null;
  destinatary?: number; // Users.user_id
  title: string;
  message: string;
  event_at?: Date | string; // por defecto now()
  channel?: string;         // por defecto 'system'
  kind?: NotificationKind;
};

export type ListOpts = {
  limit?: number;
  offset?: number;
  status?: NotificationStatus | 'any';
  since?: Date | string;
  until?: Date | string;
};