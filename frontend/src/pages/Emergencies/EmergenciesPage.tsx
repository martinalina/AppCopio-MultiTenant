// src/pages/Emergencies/EmergenciesPage.tsx
//
// Emergencias LOCALES de la comuna. Una emergencia agrupa las activaciones de sus
// centros y es la unidad de organización interna: el nivel "emergencia menor".
//
// Acá NO se invita a otras comunas. Cuando el evento sobrepasa la capacidad
// comunal, se usa «Colaborar con otra comuna», que envuelve esta emergencia en un
// SUPEREVENTO sin mover un solo dato —ese es el caso que antes obligaba a
// abandonar una emergencia o rehacerla a mano—. De ahí en adelante todo pasa por
// /supereventos.
//
// El Super Administrador no entra a esta pantalla: no tiene comuna y por lo tanto
// no puede tener emergencias.
import * as React from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import HubIcon from "@mui/icons-material/Hub";
import PlaceIcon from "@mui/icons-material/Place";
import { useNavigate } from "react-router-dom";

import { paths } from "@/routes/paths";
import {
  listEmergencies, createEmergency, closeEmergency, type Emergency,
} from "@/services/superadmin.service";
import EmergencyActivationsDialog from "@/components/emergency/EmergencyActivationsDialog";
import CreateSuperEventFromEmergencyDialog from "@/components/superevent/CreateSuperEventFromEmergencyDialog";
import SuperEventLevelChip from "@/components/superevent/SuperEventLevelChip";

function mensajeError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

export default function EmergenciesPage() {
  const navigate = useNavigate();

  const [rows, setRows] = React.useState<Emergency[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const [crearAbierto, setCrearAbierto] = React.useState(false);
  const [centrosDe, setCentrosDe] = React.useState<Emergency | null>(null);
  const [colaborarCon, setColaborarCon] = React.useState<Emergency | null>(null);
  const [cerrarPara, setCerrarPara] = React.useState<Emergency | null>(null);

  const cargar = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listEmergencies());
    } catch (e: any) {
      setError(mensajeError(e, "No se pudieron cargar las emergencias."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void cargar(); }, [cargar]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
        <Typography variant="h4" fontWeight={700}>Emergencias de mi comuna</Typography>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<HubIcon />} onClick={() => navigate(paths.superEvents)}>
            SuperEventos
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCrearAbierto(true)}>
            Nueva emergencia
          </Button>
        </Stack>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Cada emergencia agrupa los centros activos que participan en ella. Si el evento
        sobrepasa la capacidad de la comuna, súmala a un SuperEvento para colaborar con
        otras municipalidades.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {aviso && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert>}

      {loading ? (
        <CircularProgress />
      ) : rows.length === 0 ? (
        <Alert severity="info">
          Tu comuna no tiene emergencias registradas. Crea una para organizar los centros
          activos que responden a un mismo evento.
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Emergencia</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>SuperEvento</TableCell>
                <TableCell align="center">Centros</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((em) => (
                <TableRow key={em.emergency_id} hover>
                  <TableCell>
                    {em.name}
                    {em.type && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {em.type}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={em.ended_at ? "Cerrada" : "Vigente"}
                      color={em.ended_at ? "default" : "success"}
                      size="small" variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    {em.super_event_id == null ? (
                      <Typography variant="body2" color="text.secondary">Solo mi comuna</Typography>
                    ) : (
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography variant="body2">{em.super_event_name}</Typography>
                        {em.super_event_level && <SuperEventLevelChip level={em.super_event_level} />}
                        {em.super_event_ended_at && (
                          <Chip label="cerrado" size="small" variant="outlined" />
                        )}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell align="center">{em.centros_vinculados}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small" startIcon={<PlaceIcon />}
                        disabled={!!em.ended_at}
                        onClick={() => setCentrosDe(em)}
                      >
                        Gestionar centros
                      </Button>
                      {/* Autocreado del SuperEvento: solo tiene sentido si la
                          emergencia está vigente y todavía no pertenece a uno. */}
                      <Button
                        size="small" startIcon={<HubIcon />}
                        disabled={!!em.ended_at || em.super_event_id != null}
                        title={
                          em.super_event_id != null
                            ? "Esta emergencia ya forma parte de un SuperEvento"
                            : "Crea un SuperEvento con esta emergencia e invita a otras comunas"
                        }
                        onClick={() => setColaborarCon(em)}
                      >
                        Colaborar con otra comuna
                      </Button>
                      <Button
                        size="small" color="inherit"
                        disabled={!!em.ended_at} onClick={() => setCerrarPara(em)}
                      >
                        Cerrar
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <CrearEmergenciaDialog
        abierto={crearAbierto}
        onClose={() => setCrearAbierto(false)}
        onHecho={(texto) => { setAviso(texto); void cargar(); }}
      />

      <EmergencyActivationsDialog
        emergencyId={centrosDe?.emergency_id ?? null}
        emergencyName={centrosDe?.name ?? ""}
        onClose={() => setCentrosDe(null)}
        onCambio={() => void cargar()}
      />

      <CreateSuperEventFromEmergencyDialog
        emergencia={colaborarCon}
        onClose={() => setColaborarCon(null)}
        onHecho={(texto) => { setAviso(texto); void cargar(); }}
      />

      <CerrarEmergenciaDialog
        emergencia={cerrarPara}
        onClose={() => setCerrarPara(null)}
        onHecho={(texto) => { setAviso(texto); void cargar(); }}
      />
    </Box>
  );
}

/**
 * Crear la emergencia dispara la PRIMERA tanda de invitaciones a centros: se avisa
 * al encargado de cada activación abierta que no tenga emergencia. Las que ya están
 * en otra quedan fuera a propósito, para no moverlas sin que nadie lo pida; se las
 * puede traer después desde «Gestionar centros».
 */
function CrearEmergenciaDialog({
  abierto, onClose, onHecho,
}: { abierto: boolean; onClose: () => void; onHecho: (aviso: string) => void }) {
  const [nombre, setNombre] = React.useState("");
  const [tipo, setTipo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (abierto) { setNombre(""); setTipo(""); setError(null); }
  }, [abierto]);

  const crear = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await createEmergency({ name: nombre.trim(), type: tipo.trim() || null });
      onHecho(
        `Emergencia creada. Se convocó a ${r.centros_convocados} centro(s) sin emergencia ` +
        `y se enviaron ${r.avisos_a_encargados} aviso(s) a sus encargados.`
      );
      onClose();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo crear la emergencia."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={abierto} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Nueva emergencia</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nombre" value={nombre} fullWidth size="small" autoFocus
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Incendio forestal cerro Alegre"
          />
          <TextField
            label="Tipo (opcional)" value={tipo} fullWidth size="small"
            onChange={(e) => setTipo(e.target.value)}
            placeholder="incendio, temporal, aluvión…"
          />
          <Alert severity="info">
            Se avisará al encargado de cada centro activo que todavía no pertenezca a
            ninguna emergencia, para que decida si se suma. Los centros que ya están en
            otra emergencia no se tocan: puedes traerlos después desde «Gestionar centros».
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={crear} disabled={enviando || !nombre.trim()}>
          {enviando ? "Creando…" : "Crear"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CerrarEmergenciaDialog({
  emergencia, onClose, onHecho,
}: {
  emergencia: Emergency | null;
  onClose: () => void;
  onHecho: (aviso: string) => void;
}) {
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const confirmar = async () => {
    if (!emergencia) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await closeEmergency(emergencia.emergency_id);
      onHecho(
        r.activaciones_abiertas > 0
          ? `Emergencia cerrada. Quedan ${r.activaciones_abiertas} activación(es) abiertas vinculadas: ` +
            `ciérralas o muévelas a otra emergencia cuando corresponda.`
          : "Emergencia cerrada."
      );
      onClose();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo cerrar la emergencia."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={!!emergencia} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Cerrar «{emergencia?.name}»</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <DialogContentText>
          Cerrar la emergencia es un cambio de estado de tu comuna: los centros siguen
          activos si su activación lo está.
          {emergencia?.super_event_id != null && (
            <>
              {" "}Esta emergencia pertenece a un SuperEvento; la colaboración intercomunal
              termina cuando se cierra <strong>el SuperEvento</strong>, no esta emergencia.
            </>
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button color="warning" variant="contained" onClick={confirmar} disabled={enviando}>
          {enviando ? "Cerrando…" : "Cerrar emergencia"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
