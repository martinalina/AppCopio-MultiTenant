// src/components/superevent/AcceptSuperEventDialog.tsx
//
// Aceptar un SuperEvento OBLIGA a aportar una emergencia. No es un botón de "sí":
// una comuna participando siempre tiene la suya, así el tablero nunca muestra
// participantes vacíos.
//
// Los dos caminos NO son equivalentes, y por eso el diálogo los trata distinto:
//
//  a) Emergencia EXISTENTE -> no se avisa a los encargados de centro, porque ya se
//     les preguntó cuando esa emergencia se creó. Como nadie vuelve a preguntar, el
//     diálogo muestra la lista EXACTA de centros que quedarán compartidos antes de
//     confirmar: es la única oportunidad de ver qué se está exponiendo.
//
//  b) Emergencia NUEVA -> nace acá, así que sí se avisa a cada encargado de
//     activación suelta para que decida si su centro se suma.
import * as React from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, FormControl, FormControlLabel, InputLabel, List,
  ListItem, ListItemText, MenuItem, Radio, RadioGroup, Select, Stack, TextField,
  Typography,
} from "@mui/material";

import {
  listLinkedActivations, type ActivacionVinculada, type Emergency,
} from "@/services/superadmin.service";

type Props = {
  abierto: boolean;
  superEventName: string;
  /** Emergencias locales abiertas y sin SuperEvento: las únicas que se pueden aportar. */
  emergenciasDisponibles: Emergency[];
  /**
   * Emergencia que YA está vinculada a este SuperEvento, si el Super Administrador
   * agrupó a la comuna en vez de invitarla en frío. No aparece en
   * `emergenciasDisponibles` —esa lista exige super_event_id nulo—, pero es la que
   * corresponde aportar: el backend la acepta de forma idempotente.
   */
  emergenciaVinculada?: Emergency | null;
  enviando: boolean;
  error: string | null;
  onClose: () => void;
  onAceptar: (
    aporte: { emergency_id: number } | { new_emergency: { name: string; type: string | null } }
  ) => void;
};

export default function AcceptSuperEventDialog({
  abierto, superEventName, emergenciasDisponibles, emergenciaVinculada, enviando, error,
  onClose, onAceptar,
}: Props) {
  const [modo, setModo] = React.useState<"existente" | "nueva">("existente");
  const [emergencyId, setEmergencyId] = React.useState<number | "">("");
  const [nombre, setNombre] = React.useState("");
  const [tipo, setTipo] = React.useState("");

  const [centros, setCentros] = React.useState<ActivacionVinculada[] | null>(null);
  const [cargandoCentros, setCargandoCentros] = React.useState(false);

  // La agrupada va primero: es la que el SuperEvento ya tiene y la que se espera
  // confirmar. El resto de la maquinaria (vista previa de centros, confirmación) no
  // necesita distinguirla, porque se aporta igual que cualquier otra existente.
  const opcionesExistentes = React.useMemo(
    () => (emergenciaVinculada ? [emergenciaVinculada, ...emergenciasDisponibles] : emergenciasDisponibles),
    [emergenciaVinculada, emergenciasDisponibles]
  );

  // Sin emergencias disponibles, el único camino posible es crear una.
  React.useEffect(() => {
    if (abierto) {
      setModo(opcionesExistentes.length > 0 ? "existente" : "nueva");
      setEmergencyId(emergenciaVinculada?.emergency_id ?? "");
      setNombre("");
      setTipo("");
      setCentros(null);
    }
  }, [abierto, opcionesExistentes.length, emergenciaVinculada?.emergency_id]);

  // La vista previa es lo que evita que la comuna comparta centros sin saberlo.
  React.useEffect(() => {
    if (modo !== "existente" || emergencyId === "") {
      setCentros(null);
      return;
    }
    let vigente = true;
    setCargandoCentros(true);
    listLinkedActivations(Number(emergencyId))
      .then((r) => { if (vigente) setCentros(r); })
      .catch(() => { if (vigente) setCentros([]); })
      .finally(() => { if (vigente) setCargandoCentros(false); });
    return () => { vigente = false; };
  }, [modo, emergencyId]);

  const puedeEnviar =
    modo === "existente" ? emergencyId !== "" : nombre.trim().length > 0;

  const confirmar = () => {
    if (modo === "existente") {
      onAceptar({ emergency_id: Number(emergencyId) });
    } else {
      onAceptar({ new_emergency: { name: nombre.trim(), type: tipo.trim() || null } });
    }
  };

  return (
    <Dialog open={abierto} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Aceptar «{superEventName}»</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Para participar debes aportar una emergencia de tu comuna. El SuperEvento
          agrupa las emergencias de todas las comunas participantes, y lo que se
          comparte son los centros vinculados a ellas.
        </DialogContentText>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {emergenciaVinculada && (
          <Alert severity="info" sx={{ mb: 2 }}>
            El Super Administrador agrupó «{emergenciaVinculada.name}» bajo este
            SuperEvento, así que ya viene preseleccionada. Tus centros no se comparten
            con nadie hasta que aceptes.
          </Alert>
        )}

        <RadioGroup value={modo} onChange={(e) => setModo(e.target.value as "existente" | "nueva")}>
          <FormControlLabel
            value="existente"
            control={<Radio />}
            disabled={opcionesExistentes.length === 0}
            label={
              opcionesExistentes.length === 0
                ? "Usar una emergencia existente (no tienes ninguna disponible)"
                : "Usar una emergencia que ya tengo"
            }
          />
          {modo === "existente" && (
            <Box sx={{ pl: 4, pb: 2 }}>
              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel id="em-label">Emergencia</InputLabel>
                <Select<number | "">
                  labelId="em-label" label="Emergencia" value={emergencyId}
                  onChange={(e) => setEmergencyId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  {opcionesExistentes.map((em) => (
                    <MenuItem key={em.emergency_id} value={em.emergency_id}>
                      {em.name}
                      {em.type ? ` · ${em.type}` : ""}
                      {em.emergency_id === emergenciaVinculada?.emergency_id ? " · ya agrupada" : ""}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {cargandoCentros && <CircularProgress size={20} />}

              {centros != null && !cargandoCentros && (
                centros.length === 0 ? (
                  <Alert severity="warning">
                    Esa emergencia no tiene centros vinculados, así que no aportarás
                    ninguno al tablero. Puedes sumarlos después desde «Gestionar centros»
                    en Emergencias.
                  </Alert>
                ) : (
                  <Alert severity="info">
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      Vas a compartir {centros.length} centro(s) con las demás comunas:
                    </Typography>
                    <List dense disablePadding>
                      {centros.map((c) => (
                        <ListItem key={c.activation_id} disableGutters sx={{ py: 0 }}>
                          <ListItemText
                            primary={c.center_name}
                            secondary={`${c.center_id} · ${c.prioridades} necesidad(es) declarada(s)`}
                          />
                        </ListItem>
                      ))}
                    </List>
                    <Typography variant="caption">
                      Se comparte ubicación, capacidad, ocupación y necesidades. Nunca
                      personas, familias, catastro ni cantidades de inventario.
                    </Typography>
                  </Alert>
                )
              )}
            </Box>
          )}

          <FormControlLabel value="nueva" control={<Radio />} label="Crear una emergencia nueva" />
          {modo === "nueva" && (
            <Box sx={{ pl: 4 }}>
              <Stack spacing={2}>
                <TextField
                  label="Nombre de la emergencia" value={nombre} fullWidth size="small"
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: Incendio forestal sector alto"
                />
                <TextField
                  label="Tipo (opcional)" value={tipo} fullWidth size="small"
                  onChange={(e) => setTipo(e.target.value)}
                  placeholder="incendio, temporal, aluvión…"
                />
                <Alert severity="info">
                  Se avisará al encargado de cada centro activo sin emergencia para que
                  decida si se suma. Solo los que acepten se comparten.
                </Alert>
              </Stack>
            </Box>
          )}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={confirmar} disabled={enviando || !puedeEnviar}>
          {enviando ? "Enviando…" : "Aceptar y participar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Chip reutilizable para el estado de participación de una comuna. */
export function EstadoParticipacionChip({ estado }: { estado: string | null }) {
  if (!estado) return <Chip label="No invitada" size="small" variant="outlined" />;
  const color =
    estado === "participando" ? "success" : estado === "invitada" ? "warning" : "default";
  // 'retirada' comparte el color neutro de 'rechazada'; la etiqueta ya las distingue.
  return <Chip label={estado} color={color as any} size="small" />;
}
