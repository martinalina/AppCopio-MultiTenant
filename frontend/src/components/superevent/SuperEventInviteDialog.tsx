// src/components/superevent/SuperEventInviteDialog.tsx
//
// Aviso en pantalla que interrumpe. Se monta una sola vez en el layout y se
// alimenta del sondeo de 30s de useUnreadNotifications; no hay correo de por medio.
//
// Atiende dos invitaciones que ahora viven en niveles distintos del modelo:
//
//  1. kind 'super_event_invitation' -> invitación de otra comuna (o del Super
//     Administrador) a colaborar en un SUPEREVENTO. La responde el administrador, y
//     aceptar no es un botón: abre AcceptSuperEventDialog, porque hay que aportar
//     una emergencia.
//  2. kind 'activation_invitation' -> invitación a que un CENTRO se sume a una
//     emergencia LOCAL. La responde su encargado. Rechazar no desvincula el centro
//     de donde ya estaba; solo registra el rechazo, y el administrador puede volver
//     a invitarlo después desde «Gestionar centros».
//
// Se filtra por `kind` y no por la forma de los campos: el ofrecimiento de apoyo
// también trae centro y SuperEvento, y adivinando caía en la rama equivocada.
import * as React from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from "@mui/material";
import CampaignIcon from "@mui/icons-material/Campaign";

import { useAuth } from "@/contexts/AuthContext";
import { isAdminOrSupport } from "@/utils/authz";
import { useUnreadNotifications, type AppNotification } from "@/hooks/useUnreadNotifications";
import { respondActivation, listEmergencies, type Emergency } from "@/services/superadmin.service";
import { respondSuperEvent } from "@/services/superEvents.service";
import AcceptSuperEventDialog from "./AcceptSuperEventDialog";

export default function SuperEventInviteDialog() {
  const { user } = useAuth();
  const { notifications, refetch } = useUnreadNotifications();
  const [pospuestas, setPospuestas] = React.useState<string[]>([]);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aceptando, setAceptando] = React.useState(false);
  const [emergencias, setEmergencias] = React.useState<Emergency[]>([]);

  const esAdmin = isAdminOrSupport(user);

  const pendiente: AppNotification | undefined = React.useMemo(
    () =>
      notifications.find((n) => {
        if (n.read_at) return false;
        if (pospuestas.includes(n.notification_id)) return false;

        if (n.kind === "super_event_invitation") {
          // Solo el administrador de la comuna puede comprometerla a colaborar.
          if (!esAdmin) return false;
          // No tiene sentido interrumpir por un SuperEvento ya cerrado.
          return !n.super_event_ended_at;
        }
        if (n.kind === "activation_invitation") {
          return !n.emergency_ended_at && n.activation_id != null;
        }
        return false;
      }),
    [notifications, pospuestas, esAdmin]
  );

  const esDeSuperEvento = pendiente?.kind === "super_event_invitation";

  // Las emergencias que la comuna puede aportar: abiertas y sin SuperEvento.
  React.useEffect(() => {
    if (!esDeSuperEvento) return;
    listEmergencies()
      .then((r) => setEmergencias(r.filter((e) => !e.ended_at && e.super_event_id == null)))
      .catch(() => setEmergencias([]));
  }, [esDeSuperEvento, pendiente?.notification_id]);

  if (!pendiente) return null;

  const posponer = () => setPospuestas((p) => [...p, pendiente.notification_id]);

  const mensajeDeError = (e: any) =>
    e?.response?.data?.message || e?.response?.data?.error || "No se pudo responder la invitación.";

  const responderCentro = async (aceptar: boolean) => {
    setEnviando(true);
    setError(null);
    try {
      await respondActivation(
        pendiente.emergency_id as number,
        pendiente.activation_id as number,
        aceptar
      );
      await refetch();
    } catch (e: any) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  };

  const rechazarSuperEvento = async () => {
    setEnviando(true);
    setError(null);
    try {
      await respondSuperEvent(pendiente.super_event_id as number, { accept: false });
      await refetch();
    } catch (e: any) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  };

  const aceptarSuperEvento = async (
    aporte: { emergency_id: number } | { new_emergency: { name: string; type: string | null } }
  ) => {
    setEnviando(true);
    setError(null);
    try {
      await respondSuperEvent(pendiente.super_event_id as number, {
        accept: true,
        ...aporte,
      } as any);
      setAceptando(false);
      await refetch();
    } catch (e: any) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  };

  if (esDeSuperEvento && aceptando) {
    return (
      <AcceptSuperEventDialog
        abierto
        superEventName={pendiente.super_event_name ?? "el SuperEvento"}
        emergenciasDisponibles={emergencias}
        enviando={enviando}
        error={error}
        onClose={() => { setAceptando(false); setError(null); }}
        onAceptar={aceptarSuperEvento}
      />
    );
  }

  return (
    <Dialog open maxWidth="sm" fullWidth onClose={posponer}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <CampaignIcon color="warning" />
        {pendiente.title}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <DialogContentText sx={{ mb: 2 }}>{pendiente.message}</DialogContentText>
        <Alert severity="info">
          {esDeSuperEvento ? (
            <>
              Al aceptar tendrás que aportar una emergencia de tu comuna: puedes usar
              una que ya tengas o crear una nueva. Solo se comparten ubicación,
              capacidad, ocupación y <strong>necesidades</strong> de los centros
              vinculados a esa emergencia; los datos de personas, familias e inventario
              no se comparten en ningún caso.
            </>
          ) : (
            <>
              Al aceptar, este centro quedará dentro de la emergencia y podrá
              compartirse con otras comunas si más adelante se suma a un SuperEvento.
              Si rechazas, el centro se queda donde está; el administrador de tu comuna
              puede volver a invitarlo después.
            </>
          )}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={posponer} disabled={enviando}>Más tarde</Button>
        <Button
          color="inherit"
          onClick={() => (esDeSuperEvento ? rechazarSuperEvento() : responderCentro(false))}
          disabled={enviando}
        >
          Rechazar
        </Button>
        <Button
          variant="contained"
          onClick={() => (esDeSuperEvento ? setAceptando(true) : responderCentro(true))}
          disabled={enviando}
        >
          {enviando ? "Enviando…" : esDeSuperEvento ? "Aceptar…" : "Aceptar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
