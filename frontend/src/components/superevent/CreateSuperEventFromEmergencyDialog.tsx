// src/components/superevent/CreateSuperEventFromEmergencyDialog.tsx
//
// AUTOCREADO del SuperEvento: el caso que motivó todo el rediseño.
//
// Una comuna ya venía manejando su emergencia local cuando el evento crece y hace
// falta colaborar. Antes había que haber declarado la emergencia compartida ANTES
// que las locales; si cada comuna ya tenía la suya, tocaba abandonar una o mover
// información a mano. Ahora la emergencia existente se envuelve en un SuperEvento
// nuevo sin tocar sus centros ni sus datos.
//
// De ahí en adelante el SuperEvento es de todas: cualquier comuna participante
// puede invitar a más, no solo la que lo originó.
import * as React from "react";
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, FormControl, FormControlLabel, InputLabel,
  MenuItem, Select, Stack, TextField, Typography,
} from "@mui/material";

import {
  createFromEmergency, NIVELES, type NivelEvento,
} from "@/services/superEvents.service";
import {
  listMunicipalities, type Emergency, type Municipality,
} from "@/services/superadmin.service";
import { useAuth } from "@/contexts/AuthContext";

function mensajeError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

type Props = {
  emergencia: Emergency | null;
  onClose: () => void;
  onHecho: (aviso: string) => void;
};

export default function CreateSuperEventFromEmergencyDialog({
  emergencia, onClose, onHecho,
}: Props) {
  const { user } = useAuth();

  const [nombre, setNombre] = React.useState("");
  const [nivel, setNivel] = React.useState<NivelEvento>("mayor");
  const [comunas, setComunas] = React.useState<Municipality[]>([]);
  const [seleccion, setSeleccion] = React.useState<number[]>([]);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!emergencia) return;
    // El nombre parte del de la emergencia: casi siempre es el mismo evento visto
    // desde una comuna, y así no hay que reescribirlo entero.
    setNombre(emergencia.name);
    setNivel("mayor");
    setSeleccion([]);
    setError(null);
    listMunicipalities()
      .then(setComunas)
      .catch((e) => setError(mensajeError(e, "No se pudieron cargar las comunas.")));
  }, [emergencia?.emergency_id]);

  const invitables = comunas.filter(
    (m) => m.is_active && m.municipality_id !== user?.municipality_id
  );

  const crear = async () => {
    if (!emergencia) return;
    setEnviando(true);
    setError(null);
    try {
      await createFromEmergency(emergencia.emergency_id, {
        name: nombre.trim(),
        level: nivel,
        type: emergencia.type,
        municipality_ids: seleccion,
      });
      onHecho(
        seleccion.length > 0
          ? `SuperEvento creado con «${emergencia.name}» dentro. Se invitó a ${seleccion.length} comuna(s).`
          : `SuperEvento creado con «${emergencia.name}» dentro. Invita comunas desde SuperEventos cuando quieras.`
      );
      onClose();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo crear el SuperEvento."));
    } finally {
      setEnviando(false);
    }
  };

  const definicion = NIVELES.find((n) => n.value === nivel)?.definicion ?? "";

  return (
    <Dialog open={!!emergencia} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Colaborar con otra comuna</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Se creará un SuperEvento que contiene «{emergencia?.name}». Tu emergencia no
          cambia: sigue siendo tuya, con sus mismos centros. Lo que se agrega es la
          capacidad de coordinarte con otras comunas sobre el mismo evento.
        </DialogContentText>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2}>
          <TextField
            label="Nombre del SuperEvento" value={nombre} fullWidth size="small"
            onChange={(e) => setNombre(e.target.value)}
            helperText="Suele ser el nombre del evento sin la referencia a tu comuna."
          />

          <FormControl fullWidth size="small">
            <InputLabel id="nivel-label">Nivel</InputLabel>
            <Select
              labelId="nivel-label" label="Nivel" value={nivel}
              onChange={(e) => setNivel(e.target.value as NivelEvento)}
            >
              {NIVELES.map((n) => (
                <MenuItem key={n.value} value={n.value}>{n.label}</MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              {definicion}
            </Typography>
          </FormControl>

          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Invitar comunas (opcional)
            </Typography>
            <Stack>
              {invitables.map((m) => (
                <FormControlLabel
                  key={m.municipality_id}
                  control={
                    <Checkbox
                      checked={seleccion.includes(m.municipality_id)}
                      onChange={() =>
                        setSeleccion((s) =>
                          s.includes(m.municipality_id)
                            ? s.filter((x) => x !== m.municipality_id)
                            : [...s, m.municipality_id]
                        )
                      }
                    />
                  }
                  label={`${m.name} (${m.shortname})`}
                />
              ))}
            </Stack>
          </Box>

          <Alert severity="info">
            Cada comuna invitada decide si acepta, y al aceptar aporta una emergencia
            propia. Solo entonces se comparten las necesidades de sus centros. Después,
            <strong> cualquier comuna participante puede invitar a más</strong>.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={crear} disabled={enviando || !nombre.trim()}>
          {enviando ? "Creando…" : "Crear SuperEvento"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
