// src/components/emergency/EmergencyInviteDialog.tsx
//
// Aviso en pantalla relacionado a emergencias. Se monta una sola vez en el layout y se
// alimenta del sondeo de 30s de useUnreadNotifications; no hay correo de por medio.
//
// Atiende dos avisos distintos, según traiga o no activation_id:
//
//  1. Invitación a la COMUNA (sin activation_id) -> la responde el administrador.
//     Al aceptar, el backend avisa al encargado de cada activación vigente.
//  2. Invitación a un CENTRO (con activation_id) -> la responde su encargado, que
//     decide si esa activación se suma. El administrador puede corregirlo después
//     desde la vinculación masiva en /emergencias.
import * as React from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from "@mui/material";
import CampaignIcon from "@mui/icons-material/Campaign";

import { useAuth } from "@/contexts/AuthContext";
import { isAdminOrSupport } from "@/utils/authz";
import { useUnreadNotifications, type AppNotification } from "@/hooks/useUnreadNotifications";
import { respondInvitation, respondActivation } from "@/services/superadmin.service";

export default function EmergencyInviteDialog() {
  const { user } = useAuth();
  const { notifications, refetch } = useUnreadNotifications();
  const [pospuestas, setPospuestas] = React.useState<string[]>([]);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const esAdmin = isAdminOrSupport(user);

  const pendiente: AppNotification | undefined = React.useMemo(
    () =>
      notifications.find((n) => {
        if (n.emergency_id == null || n.read_at) return false;
        // Solo interrumpe lo que se responde aquí mismo. El ofrecimiento de apoyo
        // también trae emergencia y centro, y sin este filtro caía en la rama de
        // "invitación de comuna": el botón Aceptar llamaba a respondInvitation sobre
        // una emergencia en la que la comuna ya participaba.
        const esInvitacion =
          n.kind === "emergency_invitation" ||
          n.kind === "activation_invitation" ||
          // Respaldo para filas anteriores a la columna kind.
          (n.kind == null && (n.activation_id != null || n.center_id == null));
        if (!esInvitacion) return false;
        // No tiene sentido interrumpir por una emergencia ya cerrada.
        if (n.emergency_ended_at) return false;
        if (pospuestas.includes(n.notification_id)) return false;
        // La invitación de comuna solo la puede responder el administrador.
        if (n.activation_id == null && !esAdmin) return false;
        return true;
      }),
    [notifications, pospuestas, esAdmin]
  );

  if (!pendiente) return null;

  const esDeCentro = pendiente.activation_id != null;

  const responder = async (aceptar: boolean) => {
    setEnviando(true);
    setError(null);
    try {
      if (esDeCentro) {
        await respondActivation(
          pendiente.emergency_id as number,
          pendiente.activation_id as number,
          aceptar
        );
      } else {
        await respondInvitation(pendiente.emergency_id as number, aceptar);
      }
      await refetch();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.error || "No se pudo responder la invitación.");
    } finally {
      setEnviando(false);
    }
  };

  const posponer = () => setPospuestas((p) => [...p, pendiente.notification_id]);

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
          {esDeCentro ? (
            <>
              Al aceptar, las demás comunas participantes podrán ver las{" "}
              <strong>prioridades</strong> de este centro mientras su activación siga
              abierta. Si rechazas, el centro queda fuera; el administrador de tu comuna
              puede sumarlo después.
            </>
          ) : (
            <>
              Al aceptar, se avisará al encargado de cada centro activo para que decida si
              se suma. Solo se comparten las <strong>prioridades</strong> de los centros
              que acepten: los datos de personas, familias e inventario no se comparten en
              ningún caso.
            </>
          )}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={posponer} disabled={enviando}>Más tarde</Button>
        <Button color="inherit" onClick={() => responder(false)} disabled={enviando}>
          Rechazar
        </Button>
        <Button variant="contained" onClick={() => responder(true)} disabled={enviando}>
          {enviando ? "Enviando…" : "Aceptar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
