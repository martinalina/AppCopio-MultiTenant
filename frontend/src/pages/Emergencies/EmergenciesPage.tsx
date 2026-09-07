// src/pages/Emergencies/EmergenciesPage.tsx
//
// Una sola pantalla con dos caras según el rol:
//  - Super Administrador: declara emergencias regionales e invita comunas.
//  - Admin municipal: responde invitaciones y vincula sus activaciones abiertas.
import * as React from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, Divider, FormControlLabel, List,
  ListItem, ListItemText, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import LinkIcon from "@mui/icons-material/Link";

import { useAuth } from "@/contexts/AuthContext";
import { isSuperAdmin } from "@/utils/authz";
import {
  listEmergencies, createEmergency, listParticipants, inviteMunicipalities,
  respondInvitation, closeEmergency, listOpenActivations, linkActivations,
  listMunicipalities,
  type Emergency, type EmergencyParticipant, type OpenActivation, type Municipality,
} from "@/services/superadmin.service";

const COLOR_ESTADO: Record<string, "success" | "warning" | "default"> = {
  participando: "success",
  invitada: "warning",
  rechazada: "default",
};

function mensajeError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

export default function EmergenciesPage() {
  const { user } = useAuth();
  const esSuper = isSuperAdmin(user);

  const [rows, setRows] = React.useState<Emergency[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const [crearAbierto, setCrearAbierto] = React.useState(false);
  const [nombre, setNombre] = React.useState("");
  const [tipo, setTipo] = React.useState("");
  const [guardando, setGuardando] = React.useState(false);

  const [invitarPara, setInvitarPara] = React.useState<Emergency | null>(null);
  const [comunas, setComunas] = React.useState<Municipality[]>([]);
  const [participantes, setParticipantes] = React.useState<EmergencyParticipant[]>([]);
  const [seleccion, setSeleccion] = React.useState<number[]>([]);

  const [vincularPara, setVincularPara] = React.useState<Emergency | null>(null);
  const [activaciones, setActivaciones] = React.useState<OpenActivation[]>([]);
  const [activSel, setActivSel] = React.useState<number[]>([]);

  const [cerrarPara, setCerrarPara] = React.useState<Emergency | null>(null);

  const cargar = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listEmergencies());
    } catch (e: any) {
      setError(mensajeError(e, "No se pudieron cargar las emergencias."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void cargar(); }, [cargar]);

  const crear = async () => {
    setGuardando(true);
    try {
      await createEmergency({ name: nombre.trim(), type: tipo.trim() || null });
      setCrearAbierto(false);
      setNombre(""); setTipo("");
      await cargar();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo crear la emergencia."));
    } finally {
      setGuardando(false);
    }
  };

  const abrirInvitar = async (em: Emergency) => {
    setInvitarPara(em);
    setSeleccion([]);
    try {
      const [ms, ps] = await Promise.all([listMunicipalities(), listParticipants(em.emergency_id)]);
      setComunas(ms);
      setParticipantes(ps);
    } catch (e: any) {
      setError(mensajeError(e, "No se pudieron cargar las comunas."));
    }
  };

  const invitar = async () => {
    if (!invitarPara) return;
    setGuardando(true);
    try {
      await inviteMunicipalities(invitarPara.emergency_id, seleccion);
      setAviso(`Se enviaron ${seleccion.length} invitación(es). Las comunas la verán en pantalla.`);
      setInvitarPara(null);
      await cargar();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo invitar."));
    } finally {
      setGuardando(false);
    }
  };

  const responder = async (em: Emergency, aceptar: boolean) => {
    try {
      await respondInvitation(em.emergency_id, aceptar);
      setAviso(aceptar
        ? `Tu comuna ahora participa en "${em.name}". Ya puedes vincular activaciones.`
        : `Rechazaste la invitación a "${em.name}".`);
      await cargar();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo responder la invitación."));
    }
  };

  const abrirVincular = async (em: Emergency) => {
    setVincularPara(em);
    setActivSel([]);
    try {
      const abiertas = await listOpenActivations();
      setActivaciones(abiertas);
      setActivSel(abiertas.filter((a) => a.emergency_id === em.emergency_id).map((a) => a.activation_id));
    } catch (e: any) {
      setError(mensajeError(e, "No se pudieron cargar las activaciones."));
    }
  };

  const vincular = async () => {
    if (!vincularPara) return;
    setGuardando(true);
    try {
      const r = await linkActivations(vincularPara.emergency_id, { activation_ids: activSel });
      setAviso(`${r.vinculadas} activación(es) vinculadas a "${vincularPara.name}".`);
      setVincularPara(null);
    } catch (e: any) {
      setError(mensajeError(e, "No se pudieron vincular las activaciones."));
    } finally {
      setGuardando(false);
    }
  };

  const cerrar = async () => {
    if (!cerrarPara) return;
    setGuardando(true);
    try {
      const r = await closeEmergency(cerrarPara.emergency_id);
      setAviso(
        r.activaciones_abiertas > 0
          ? `Emergencia cerrada. Ojo: quedan ${r.activaciones_abiertas} activación(es) abiertas vinculadas, ` +
            `así que las comunas participantes SIGUEN viendo esas prioridades hasta que se cierren.`
          : "Emergencia cerrada. No quedan activaciones abiertas vinculadas."
      );
      setCerrarPara(null);
      await cargar();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo cerrar la emergencia."));
    } finally {
      setGuardando(false);
    }
  };

  const yaInvitadas = new Set(participantes.map((p) => p.municipality_id));
  const invitables = comunas.filter((c) => !yaInvitadas.has(c.municipality_id));

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4" fontWeight={700}>Emergencias</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCrearAbierto(true)}>
          {esSuper ? "Declarar emergencia regional" : "Declarar emergencia"}
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Participar en una emergencia comparte con las demás comunas las <strong>prioridades</strong> de
        tus centros activos vinculados. Los datos de personas, familias e inventario nunca se comparten.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {aviso && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert>}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Emergencia</TableCell>
                <TableCell>Alcance</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Mi comuna</TableCell>
                <TableCell>Participando</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={28} /></TableCell></TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No hay emergencias visibles para ti.</Typography>
                </TableCell></TableRow>
              )}
              {!loading && rows.map((em) => (
                <TableRow key={em.emergency_id} hover>
                  <TableCell>
                    <Typography fontWeight={500}>{em.name}</Typography>
                    {em.type && <Typography variant="caption" color="text.secondary">{em.type}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Chip size="small"
                          label={em.created_by_municipality_id == null ? "Regional" : "Comunal"} />
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={em.ended_at ? "Cerrada" : "Vigente"}
                          color={em.ended_at ? "default" : "error"} />
                  </TableCell>
                  <TableCell>
                    {em.mi_estado
                      ? <Chip size="small" label={em.mi_estado} color={COLOR_ESTADO[em.mi_estado]} />
                      : <Typography variant="caption" color="text.secondary">—</Typography>}
                  </TableCell>
                  <TableCell>{em.total_participando}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
                      {em.mi_estado === "invitada" && !em.ended_at && (
                        <>
                          <Button size="small" variant="contained" onClick={() => responder(em, true)}>Aceptar</Button>
                          <Button size="small" color="inherit" onClick={() => responder(em, false)}>Rechazar</Button>
                        </>
                      )}
                      {em.mi_estado === "participando" && !em.ended_at && (
                        <Button size="small" startIcon={<LinkIcon />} onClick={() => abrirVincular(em)}>
                          Vincular activaciones
                        </Button>
                      )}
                      {esSuper && !em.ended_at && (
                        <Button size="small" startIcon={<GroupAddIcon />} onClick={() => abrirInvitar(em)}>
                          Invitar comunas
                        </Button>
                      )}
                      {!em.ended_at && (
                        <Button size="small" color="warning" onClick={() => setCerrarPara(em)}>Cerrar</Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Declarar */}
      <Dialog open={crearAbierto} onClose={() => setCrearAbierto(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{esSuper ? "Declarar emergencia regional" : "Declarar emergencia"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nombre" value={nombre} required fullWidth
                       onChange={(e) => setNombre(e.target.value)} />
            <TextField label="Tipo (incendio, sismo, meteorológico…)" value={tipo} fullWidth
                       onChange={(e) => setTipo(e.target.value)} />
            <Alert severity="info">
              {esSuper
                ? "Como Super Administrador, la emergencia nace regional y sin participantes: debes invitar a las comunas."
                : "Tu comuna queda inscrita automáticamente como participante."}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCrearAbierto(false)} disabled={guardando}>Cancelar</Button>
          <Button variant="contained" onClick={crear} disabled={!nombre.trim() || guardando}>
            {guardando ? "Creando…" : "Declarar"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Invitar comunas */}
      <Dialog open={!!invitarPara} onClose={() => setInvitarPara(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Invitar comunas a "{invitarPara?.name}"</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle2" gutterBottom>Ya convocadas</Typography>
          {participantes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Todavía ninguna.</Typography>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
              {participantes.map((p) => (
                <Chip key={p.municipality_id} size="small" label={`${p.shortname}: ${p.status}`}
                      color={COLOR_ESTADO[p.status]} />
              ))}
            </Stack>
          )}
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>Invitar a</Typography>
          {invitables.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No quedan comunas por invitar.</Typography>
          ) : (
            <List dense>
              {invitables.map((c) => (
                <ListItem key={c.municipality_id} disablePadding>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={seleccion.includes(c.municipality_id)}
                        onChange={(e) =>
                          setSeleccion((prev) =>
                            e.target.checked
                              ? [...prev, c.municipality_id]
                              : prev.filter((x) => x !== c.municipality_id))}
                      />
                    }
                    label={`${c.name} (${c.shortname})`}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvitarPara(null)} disabled={guardando}>Cancelar</Button>
          <Button variant="contained" onClick={invitar} disabled={seleccion.length === 0 || guardando}>
            {guardando ? "Invitando…" : `Invitar (${seleccion.length})`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Vinculación masiva */}
      <Dialog open={!!vincularPara} onClose={() => setVincularPara(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Vincular activaciones a "{vincularPara?.name}"</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Marca las activaciones abiertas de tu comuna que forman parte de esta emergencia.
            Solo las marcadas comparten sus prioridades con las demás comunas participantes.
          </DialogContentText>
          {activaciones.length === 0 ? (
            <Typography color="text.secondary">Tu comuna no tiene activaciones abiertas.</Typography>
          ) : (
            <List dense>
              {activaciones.map((a) => (
                <ListItem key={a.activation_id} disablePadding>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={activSel.includes(a.activation_id)}
                        onChange={(e) =>
                          setActivSel((prev) =>
                            e.target.checked
                              ? [...prev, a.activation_id]
                              : prev.filter((x) => x !== a.activation_id))}
                      />
                    }
                    label={
                      <ListItemText
                        primary={`${a.center_name} (${a.center_id})`}
                        secondary={a.emergency_id ? `Ya vinculada a la emergencia ${a.emergency_id}` : "Sin emergencia"}
                      />
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVincularPara(null)} disabled={guardando}>Cancelar</Button>
          <Button variant="contained" onClick={vincular} disabled={activSel.length === 0 || guardando}>
            {guardando ? "Vinculando…" : `Vincular (${activSel.length})`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cerrar */}
      <Dialog open={!!cerrarPara} onClose={() => setCerrarPara(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Cerrar "{cerrarPara?.name}"</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Cerrar la emergencia la marca como terminada, pero <strong>no corta por sí solo</strong> el
            acceso entre comunas: las prioridades se dejan de compartir cuando se cierran las
            activaciones vinculadas o se las desvincula.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCerrarPara(null)} disabled={guardando}>Cancelar</Button>
          <Button variant="contained" color="warning" onClick={cerrar} disabled={guardando}>
            {guardando ? "Cerrando…" : "Cerrar emergencia"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
