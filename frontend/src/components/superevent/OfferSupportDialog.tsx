// src/components/superevent/OfferSupportDialog.tsx
//
// Diálogo para ofrecer apoyo a un centro de otra comuna. Vive fuera de la página
// porque lo abren las dos vistas del tablero: el listado y el mapa.
import * as React from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, TextField,
} from "@mui/material";

import { createOffer, type CentroCompartido } from "@/services/crossSupport.service";

type Props = {
  centro: CentroCompartido | null;
  superEventId: number | "";
  onClose: () => void;
  /** Se llama con el texto de confirmación cuando la oferta quedó registrada. */
  onSent: (aviso: string) => void;
};

export default function OfferSupportDialog({ centro, superEventId, onClose, onSent }: Props) {
  const [itemId, setItemId] = React.useState<number | "">("");
  const [mensaje, setMensaje] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Cada vez que se abre para un centro distinto, el formulario parte limpio.
  React.useEffect(() => {
    if (centro) {
      setItemId("");
      setMensaje("");
      setError(null);
    }
  }, [centro?.center_id]);

  const enviar = async () => {
    if (!centro || superEventId === "") return;
    setEnviando(true);
    setError(null);
    try {
      await createOffer({
        super_event_id: Number(superEventId),
        target_center_id: centro.center_id,
        item_id: itemId === "" ? null : Number(itemId),
        message: mensaje.trim() || null,
      });
      onSent(`Oferta enviada a ${centro.name}. La comuna recibirá un aviso en pantalla.`);
      onClose();
    } catch (e: any) {
      // El error se muestra dentro del diálogo para no perder lo escrito.
      setError(
        e?.response?.data?.message || e?.response?.data?.error || "No se pudo enviar la oferta."
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={!!centro} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Ofrecer apoyo a {centro?.name}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          La comuna de {centro?.municipality_shortname} recibirá un aviso en pantalla y
          podrá aceptar o rechazar tu ofrecimiento.
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="item-label">Ítem (opcional)</InputLabel>
            <Select<number | "">
              labelId="item-label" label="Ítem (opcional)" value={itemId}
              onChange={(e) => setItemId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <MenuItem value="">Apoyo general</MenuItem>
              {centro?.prioridades.map((p) => (
                <MenuItem key={p.item_id} value={p.item_id}>
                  {p.item_name} (prioridad {p.priority})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Mensaje" value={mensaje} fullWidth multiline rows={3}
            placeholder="Ej: Tenemos 500 botellas de agua disponibles para traslado hoy."
            onChange={(e) => setMensaje(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={enviar} disabled={enviando}>
          {enviando ? "Enviando…" : "Enviar oferta"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
