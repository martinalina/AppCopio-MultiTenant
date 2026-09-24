// src/components/emergency/EmergencyActivationsDialog.tsx
//
// Gestión continua de los centros de una emergencia.
//
// La tanda de invitaciones que sale al crear la emergencia es solo la PRIMERA, y
// además solo alcanza a los centros que en ese momento no tenían emergencia. Esta
// pantalla existe para todo lo que viene después: volver a invitar a los que
// rechazaron, traer a los que están en otra emergencia y deben trasladarse, y
// sumar a los que quedaron fuera porque entonces pertenecían a una emergencia que
// ya terminó.
//
// Sustituye al diálogo anterior de "vincular activaciones", que solo listaba las
// abiertas sin distinguir en qué estado estaba cada una: era imposible saber si un
// centro faltaba porque nadie le preguntó o porque dijo que no.
//
// Dos acciones, deliberadamente distintas:
//   - Invitar  -> le pregunta al encargado del centro. Es el camino normal.
//   - Vincular -> lo mete de inmediato, sin preguntar. Atajo del administrador.
import * as React from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from "@mui/material";

import {
  inviteActivations, linkActivations, listEmergencyActivations,
  type ActivacionConEstado, type EstadoInvitacionCentro,
} from "@/services/superadmin.service";

const ETIQUETA_ESTADO: Record<EstadoInvitacionCentro, string> = {
  sin_invitar: "Sin invitar",
  invitada: "Pendiente",
  aceptada: "Participando",
  rechazada: "Rechazó",
};

const COLOR_ESTADO: Record<EstadoInvitacionCentro, "default" | "warning" | "success" | "error"> = {
  sin_invitar: "default",
  invitada: "warning",
  aceptada: "success",
  rechazada: "error",
};

type Filtro = "todos" | "sin_emergencia" | "en_otra" | "rechazados" | "pendientes";

const FILTROS: { value: Filtro; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "sin_emergencia", label: "Sin emergencia" },
  { value: "en_otra", label: "En otra emergencia" },
  { value: "rechazados", label: "Rechazados" },
  { value: "pendientes", label: "Pendientes de responder" },
];

type Props = {
  emergencyId: number | null;
  emergencyName: string;
  onClose: () => void;
  /** Para que la pantalla de fondo refresque su conteo de centros vinculados. */
  onCambio: () => void;
};

export default function EmergencyActivationsDialog({
  emergencyId, emergencyName, onClose, onCambio,
}: Props) {
  const [filas, setFilas] = React.useState<ActivacionConEstado[]>([]);
  const [cargando, setCargando] = React.useState(false);
  const [seleccion, setSeleccion] = React.useState<number[]>([]);
  const [filtro, setFiltro] = React.useState<Filtro>("todos");
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const cargar = React.useCallback(async () => {
    if (emergencyId == null) return;
    setCargando(true);
    setError(null);
    try {
      setFilas(await listEmergencyActivations(emergencyId));
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.error || "No se pudieron cargar los centros.");
    } finally {
      setCargando(false);
    }
  }, [emergencyId]);

  React.useEffect(() => {
    if (emergencyId != null) {
      setSeleccion([]);
      setFiltro("todos");
      setAviso(null);
      void cargar();
    }
  }, [emergencyId, cargar]);

  const visibles = React.useMemo(() => {
    switch (filtro) {
      case "sin_emergencia":
        return filas.filter((f) => f.emergencia_actual_id == null);
      case "en_otra":
        return filas.filter(
          (f) => f.emergencia_actual_id != null && f.emergencia_actual_id !== emergencyId
        );
      case "rechazados":
        return filas.filter((f) => f.estado_invitacion === "rechazada");
      case "pendientes":
        return filas.filter((f) => f.estado_invitacion === "invitada");
      default:
        return filas;
    }
  }, [filas, filtro, emergencyId]);

  const alternar = (id: number) =>
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /** Los seleccionados que hoy están en OTRA emergencia: aceptar los trasladaría. */
  const enOtraEmergencia = React.useMemo(
    () =>
      filas.filter(
        (f) =>
          seleccion.includes(f.activation_id) &&
          f.emergencia_actual_id != null &&
          f.emergencia_actual_id !== emergencyId
      ),
    [filas, seleccion, emergencyId]
  );

  const confirmarTraslado = (verbo: string) => {
    if (enOtraEmergencia.length === 0) return true;
    const detalle = enOtraEmergencia
      .map((f) => `· ${f.center_name} (hoy en "${f.emergencia_actual_nombre}")`)
      .join("\n");
    return window.confirm(
      `${verbo} estos centros los sacará de la emergencia en la que están ahora:\n\n${detalle}\n\n¿Continuar?`
    );
  };

  const invitar = async () => {
    if (emergencyId == null || seleccion.length === 0) return;
    if (!confirmarTraslado("Invitar")) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await inviteActivations(emergencyId, seleccion);
      setAviso(
        `Se invitó a ${r.invitadas} centro(s). Se enviaron ${r.avisos_a_encargados} aviso(s) a sus encargados.` +
          (r.avisos_a_encargados < r.invitadas
            ? " Los centros sin encargado asignado no reciben aviso: vincúlalos directamente."
            : "")
      );
      setSeleccion([]);
      await cargar();
      onCambio();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.error || "No se pudo invitar.");
    } finally {
      setEnviando(false);
    }
  };

  const vincular = async () => {
    if (emergencyId == null || seleccion.length === 0) return;
    if (!confirmarTraslado("Vincular")) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await linkActivations(emergencyId, { activation_ids: seleccion });
      setAviso(`Se vincularon ${r.vinculadas} centro(s) sin consultar a sus encargados.`);
      setSeleccion([]);
      await cargar();
      onCambio();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.error || "No se pudo vincular.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={emergencyId != null} onClose={enviando ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Centros de «{emergencyName}»</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Todas las activaciones abiertas de tu comuna. <strong>Invitar</strong> le
          pregunta al encargado del centro; <strong>Vincular</strong> lo suma de
          inmediato, sin consultarle.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {aviso && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert>}

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="f-estado">Mostrar</InputLabel>
            <Select
              labelId="f-estado" label="Mostrar" value={filtro}
              onChange={(e) => setFiltro(e.target.value as Filtro)}
            >
              {FILTROS.map((f) => (
                <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={invitar} disabled={enviando || seleccion.length === 0}>
            Invitar seleccionados
          </Button>
          <Button
            size="small" variant="contained"
            onClick={vincular} disabled={enviando || seleccion.length === 0}
          >
            Vincular seleccionados
          </Button>
        </Stack>

        {cargando ? (
          <CircularProgress size={24} />
        ) : visibles.length === 0 ? (
          <Alert severity="info">No hay centros que cumplan ese filtro.</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Centro</TableCell>
                <TableCell>Emergencia actual</TableCell>
                <TableCell>Invitación</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibles.map((f) => {
                const enEsta = f.emergencia_actual_id === emergencyId;
                const enOtra = f.emergencia_actual_id != null && !enEsta;
                return (
                  <TableRow key={f.activation_id} hover>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={seleccion.includes(f.activation_id)}
                        onChange={() => alternar(f.activation_id)}
                        disabled={enviando}
                      />
                    </TableCell>
                    <TableCell>
                      {f.center_name}
                      <Typography variant="caption" display="block" color="text.secondary">
                        {f.center_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {enEsta ? (
                        <Chip label="Esta emergencia" color="success" size="small" variant="outlined" />
                      ) : enOtra ? (
                        <Chip label={f.emergencia_actual_nombre ?? "Otra"} color="warning" size="small" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={ETIQUETA_ESTADO[f.estado_invitacion]}
                        color={COLOR_ESTADO[f.estado_invitacion]}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  );
}
