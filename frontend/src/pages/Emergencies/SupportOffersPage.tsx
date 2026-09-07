// src/pages/Emergencies/SupportOffersPage.tsx
//
// Bandeja de ofertas de apoyo. Las acciones dependen del lado:
//   - enviadas  -> solo se pueden cancelar
//   - recibidas -> solo se pueden aceptar o rechazar
import * as React from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, Typography,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { paths } from "@/routes/paths";
import { listOffers, setOfferStatus, type Oferta, type EstadoOferta } from "@/services/crossSupport.service";

const COLOR_ESTADO: Record<EstadoOferta, "warning" | "success" | "error" | "default"> = {
  pending: "warning",
  accepted: "success",
  rejected: "error",
  cancelled: "default",
};

const ETIQUETA_ESTADO: Record<EstadoOferta, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

function mensajeError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

export default function SupportOffersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<"recibidas" | "enviadas">("recibidas");
  const [rows, setRows] = React.useState<Oferta[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const cargar = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listOffers(tab));
    } catch (e: any) {
      setError(mensajeError(e, "No se pudieron cargar las ofertas."));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  React.useEffect(() => { void cargar(); }, [cargar]);

  const responder = async (offer: Oferta, status: EstadoOferta) => {
    try {
      await setOfferStatus(offer.offer_id, status);
      setAviso(`Oferta ${ETIQUETA_ESTADO[status].toLowerCase()}.`);
      await cargar();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo actualizar la oferta."));
    }
  };

  const esRecibida = tab === "recibidas";

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" gap={2}>
        <Typography variant="h4" fontWeight={700}>Ofertas de apoyo</Typography>
        <Button startIcon={<DashboardIcon />} onClick={() => navigate(paths.intermunicipalBoard)}>
          Ir al tablero intercomunal
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Ofrecimientos de recursos entre comunas participantes de una misma emergencia.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {aviso && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert>}

      <Paper>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tab value="recibidas" label="Recibidas" />
          <Tab value="enviadas" label="Enviadas" />
        </Tabs>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{esRecibida ? "Ofrece" : "Destino"}</TableCell>
                <TableCell>Centro</TableCell>
                <TableCell>Ítem</TableCell>
                <TableCell>Mensaje</TableCell>
                <TableCell>Emergencia</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={28} /></TableCell></TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {esRecibida
                      ? "Ninguna comuna ha ofrecido apoyo a tus centros todavía."
                      : "Tu comuna no ha ofrecido apoyo todavía. Usa el tablero intercomunal para hacerlo."}
                  </Typography>
                </TableCell></TableRow>
              )}
              {!loading && rows.map((o) => (
                <TableRow key={o.offer_id} hover>
                  <TableCell>
                    {esRecibida ? o.from_municipality_name : (o.target_municipality_name ?? "—")}
                  </TableCell>
                  <TableCell>{o.target_center_name ?? o.target_center_id}</TableCell>
                  <TableCell>{o.item_name ?? "Apoyo general"}</TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>{o.message ?? "—"}</TableCell>
                  <TableCell>{o.emergency_name}</TableCell>
                  <TableCell>
                    <Chip size="small" label={ETIQUETA_ESTADO[o.status]} color={COLOR_ESTADO[o.status]} />
                  </TableCell>
                  <TableCell align="right">
                    {o.status !== "pending" ? (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    ) : esRecibida ? (
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button size="small" variant="contained" onClick={() => responder(o, "accepted")}>
                          Aceptar
                        </Button>
                        <Button size="small" color="inherit" onClick={() => responder(o, "rejected")}>
                          Rechazar
                        </Button>
                      </Stack>
                    ) : (
                      <Button size="small" color="warning" onClick={() => responder(o, "cancelled")}>
                        Cancelar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        Solo la comuna que ofrece puede cancelar; solo la que recibe puede aceptar o rechazar.
        {user?.municipality_name && ` Estás operando como ${user.municipality_name}.`}
      </Typography>
    </Box>
  );
}
