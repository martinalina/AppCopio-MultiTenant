// src/pages/SuperEvents/SuperEventsPage.tsx
//
// Los SuperEventos de la comuna: dónde colabora, con quién y con qué emergencia.
//
// Un SuperEvento agrupa emergencias de varias comunas y es el único lugar donde
// vive la colaboración. Las emergencias locales se gestionan en /emergencias.
//
// Quién puede qué:
//   · Invitar comunas  -> cualquier comuna participante, no solo la que lo originó.
//   · Cerrar           -> solo el Super Administrador o la comuna originaria,
//                         porque cerrar le corta la colaboración a todos.
import * as React from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, FormControlLabel, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, Typography,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import InboxIcon from "@mui/icons-material/Inbox";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import { useNavigate } from "react-router-dom";

import { paths } from "@/routes/paths";
import { useAuth } from "@/contexts/AuthContext";
import {
  listSuperEvents, listSuperEventParticipants, inviteToSuperEvent, closeSuperEvent,
  type SuperEvent, type SuperEventParticipant,
} from "@/services/superEvents.service";
import { listMunicipalities, type Municipality } from "@/services/superadmin.service";
import SuperEventLevelChip from "@/components/superevent/SuperEventLevelChip";
import { EstadoParticipacionChip } from "@/components/superevent/AcceptSuperEventDialog";

function mensajeError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

export default function SuperEventsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [eventos, setEventos] = React.useState<SuperEvent[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const [invitarA, setInvitarA] = React.useState<SuperEvent | null>(null);
  const [cerrar, setCerrar] = React.useState<SuperEvent | null>(null);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      setEventos(await listSuperEvents());
    } catch (e: any) {
      setError(mensajeError(e, "No se pudieron cargar los SuperEventos."));
    } finally {
      setCargando(false);
    }
  }, []);

  React.useEffect(() => { void cargar(); }, [cargar]);

  const puedeCerrar = (se: SuperEvent) =>
    se.created_by_municipality_id != null &&
    se.created_by_municipality_id === user?.municipality_id;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
        <Typography variant="h4" fontWeight={700}>SuperEventos</Typography>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<DashboardIcon />} onClick={() => navigate(paths.intermunicipalBoard)}>
            Tablero intercomunal
          </Button>
          <Button startIcon={<InboxIcon />} onClick={() => navigate(paths.supportOffers)}>
            Ofertas de apoyo
          </Button>
        </Stack>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Un SuperEvento agrupa emergencias de varias comunas cuando el evento sobrepasa
        la capacidad de una sola. Para sumar una emergencia tuya a uno nuevo, usa
        «Colaborar con otra comuna» en <strong>Emergencias</strong>.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {aviso && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert>}

      {cargando ? (
        <CircularProgress />
      ) : eventos.length === 0 ? (
        <Alert severity="info">
          Tu comuna no participa en ningún SuperEvento. Cuando otra comuna te invite,
          aparecerá acá y también como aviso en pantalla.
        </Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>SuperEvento</TableCell>
              <TableCell>Nivel</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Mi comuna</TableCell>
              <TableCell>Mi emergencia</TableCell>
              <TableCell align="center">Participando</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {eventos.map((se) => (
              <TableRow key={se.super_event_id} hover>
                <TableCell>
                  {se.name}
                  {se.type && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {se.type}
                    </Typography>
                  )}
                </TableCell>
                <TableCell><SuperEventLevelChip level={se.level} /></TableCell>
                <TableCell>
                  <Chip
                    label={se.ended_at ? "Cerrado" : "Vigente"}
                    color={se.ended_at ? "default" : "success"}
                    size="small" variant="outlined"
                  />
                </TableCell>
                <TableCell><EstadoParticipacionChip estado={se.mi_estado} /></TableCell>
                <TableCell>
                  {se.mi_emergency_name ?? (
                    <Typography variant="body2" color="text.secondary">—</Typography>
                  )}
                </TableCell>
                <TableCell align="center">{se.total_participando}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    {/* Invitar puede cualquier participante: es la diferencia clave
                        con el modelo anterior, donde solo invitaba quien lo creó. */}
                    <Button
                      size="small" startIcon={<GroupAddIcon />}
                      disabled={!!se.ended_at || se.mi_estado !== "participando"}
                      onClick={() => setInvitarA(se)}
                    >
                      Invitar
                    </Button>
                    <Button
                      size="small" color="inherit"
                      disabled={!!se.ended_at || !puedeCerrar(se)}
                      title={
                        puedeCerrar(se)
                          ? "Cerrar termina la colaboración para todas las comunas"
                          : "Solo puede cerrarlo el Super Administrador o la comuna que lo originó"
                      }
                      onClick={() => setCerrar(se)}
                    >
                      Cerrar
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <InviteDialog
        superEvento={invitarA}
        onClose={() => setInvitarA(null)}
        onHecho={(texto) => { setAviso(texto); void cargar(); }}
      />
      <CloseDialog
        superEvento={cerrar}
        onClose={() => setCerrar(null)}
        onHecho={(texto) => { setAviso(texto); void cargar(); }}
      />
    </Box>
  );
}

/** Invita comunas que aún no tienen fila en el SuperEvento. */
export function InviteDialog({
  superEvento, onClose, onHecho,
}: {
  superEvento: SuperEvent | null;
  onClose: () => void;
  onHecho: (aviso: string) => void;
}) {
  const [comunas, setComunas] = React.useState<Municipality[]>([]);
  const [participantes, setParticipantes] = React.useState<SuperEventParticipant[]>([]);
  const [seleccion, setSeleccion] = React.useState<number[]>([]);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!superEvento) return;
    setSeleccion([]);
    setError(null);
    Promise.all([
      listMunicipalities(),
      listSuperEventParticipants(superEvento.super_event_id),
    ])
      .then(([m, p]) => { setComunas(m); setParticipantes(p); })
      .catch((e) => setError(mensajeError(e, "No se pudieron cargar las comunas.")));
  }, [superEvento?.super_event_id]);

  const yaEstan = new Set(participantes.map((p) => p.municipality_id));
  const invitables = comunas.filter((m) => m.is_active && !yaEstan.has(m.municipality_id));

  const enviar = async () => {
    if (!superEvento || seleccion.length === 0) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await inviteToSuperEvent(superEvento.super_event_id, seleccion);
      onHecho(
        `Se invitó a ${r.invitadas.length} comuna(s). Sus administradores verán el aviso en pantalla.`
      );
      onClose();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo invitar."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={!!superEvento} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Invitar comunas a «{superEvento?.name}»</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Cada comuna decide si acepta, y al aceptar debe aportar una emergencia propia.
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {participantes.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Ya en este SuperEvento:
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {participantes.map((p) => (
                <Chip key={p.municipality_id} size="small" label={`${p.shortname}: ${p.status}`} />
              ))}
            </Stack>
          </Box>
        )}

        {invitables.length === 0 ? (
          <Alert severity="info">Todas las comunas activas ya tienen una invitación.</Alert>
        ) : (
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
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={enviar} disabled={enviando || seleccion.length === 0}>
          {enviando ? "Enviando…" : "Invitar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Cerrar el SuperEvento SÍ corta el acceso, a diferencia de cerrar una emergencia. */
export function CloseDialog({
  superEvento, onClose, onHecho,
}: {
  superEvento: SuperEvent | null;
  onClose: () => void;
  onHecho: (aviso: string) => void;
}) {
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const confirmar = async () => {
    if (!superEvento) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await closeSuperEvent(superEvento.super_event_id);
      onHecho(
        `SuperEvento cerrado. La colaboración terminó: el tablero queda vacío y no se pueden ` +
        `enviar más ofertas. Las ${r.emergencias_abiertas} emergencia(s) locales siguen abiertas.`
      );
      onClose();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo cerrar."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={!!superEvento} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Cerrar «{superEvento?.name}»</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Alert severity="warning">
          Cerrar el SuperEvento <strong>termina la colaboración para todas las comunas
          participantes</strong>: el tablero intercomunal deja de mostrar centros y no se
          pueden enviar ofertas nuevas. Cada comuna conserva su emergencia local y sus
          centros; solo se deja de compartir.
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button color="warning" variant="contained" onClick={confirmar} disabled={enviando}>
          {enviando ? "Cerrando…" : "Cerrar SuperEvento"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
