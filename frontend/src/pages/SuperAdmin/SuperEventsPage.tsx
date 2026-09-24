// src/pages/SuperAdmin/SuperEventsPage.tsx
//
// Vista del Super Administrador sobre los SuperEventos.
//
// Reemplaza a la antigua pantalla de "emergencias regionales": el Super
// Administrador ya NO crea emergencias —no tiene comuna, y toda emergencia es
// local— sino SuperEventos, que es justamente lo que aquellas querían ser.
//
// Tiene dos caminos, y el segundo es el que resuelve el caso borde que motivó el
// rediseño:
//   1. Crear un SuperEvento e invitar comunas (se anticipa al evento).
//   2. AGRUPAR emergencias que ya existen y aún no tienen SuperEvento (llega
//      después, cuando cada comuna ya venía manejando la suya por separado).
import * as React from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, FormControl, FormControlLabel,
  InputLabel, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MergeIcon from "@mui/icons-material/Merge";
import GroupAddIcon from "@mui/icons-material/GroupAdd";

import {
  listSuperEvents, createSuperEvent, groupEmergencies, listOrphanEmergencies,
  NIVELES, type NivelEvento, type SuperEvent, type EmergenciaHuerfana,
} from "@/services/superEvents.service";
import SuperEventLevelChip from "@/components/superevent/SuperEventLevelChip";
import { InviteDialog, CloseDialog } from "@/pages/SuperEvents/SuperEventsPage";

function mensajeError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

export default function SuperAdminSuperEventsPage() {
  const [eventos, setEventos] = React.useState<SuperEvent[]>([]);
  const [huerfanas, setHuerfanas] = React.useState<EmergenciaHuerfana[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const [creando, setCreando] = React.useState(false);
  const [agrupandoEn, setAgrupandoEn] = React.useState<SuperEvent | null>(null);
  const [invitarA, setInvitarA] = React.useState<SuperEvent | null>(null);
  const [cerrar, setCerrar] = React.useState<SuperEvent | null>(null);

  const cargar = React.useCallback(async () => {
    setCargando(true);
    try {
      const [se, hu] = await Promise.all([listSuperEvents(), listOrphanEmergencies()]);
      setEventos(se);
      setHuerfanas(hu);
    } catch (e: any) {
      setError(mensajeError(e, "No se pudieron cargar los SuperEventos."));
    } finally {
      setCargando(false);
    }
  }, []);

  React.useEffect(() => { void cargar(); }, [cargar]);

  const hecho = (texto: string) => { setAviso(texto); void cargar(); };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
        <Typography variant="h4" fontWeight={700}>SuperEventos</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreando(true)}>
          Nuevo SuperEvento
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Un SuperEvento agrupa las emergencias de varias comunas cuando el evento
        sobrepasa la capacidad de una sola. Las emergencias siguen siendo locales: acá
        se coordinan, no se reemplazan.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {aviso && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert>}

      {cargando ? (
        <CircularProgress />
      ) : (
        <>
          {eventos.length === 0 ? (
            <Alert severity="info" sx={{ mb: 3 }}>Todavía no hay SuperEventos.</Alert>
          ) : (
            <Table size="small" sx={{ mb: 4 }}>
              <TableHead>
                <TableRow>
                  <TableCell>SuperEvento</TableCell>
                  <TableCell>Nivel</TableCell>
                  <TableCell>Origen</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell align="center">Comunas</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {eventos.map((se) => (
                  <TableRow key={se.super_event_id} hover>
                    <TableCell>{se.name}</TableCell>
                    <TableCell><SuperEventLevelChip level={se.level} /></TableCell>
                    <TableCell>
                      <Chip
                        size="small" variant="outlined"
                        label={se.created_by_municipality_id == null ? "Regional" : "Creado por una comuna"}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={se.ended_at ? "Cerrado" : "Vigente"}
                        color={se.ended_at ? "default" : "success"}
                        size="small" variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="center">{se.total_participando}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small" startIcon={<GroupAddIcon />}
                          disabled={!!se.ended_at} onClick={() => setInvitarA(se)}
                        >
                          Invitar
                        </Button>
                        <Button
                          size="small" startIcon={<MergeIcon />}
                          disabled={!!se.ended_at || huerfanas.length === 0}
                          onClick={() => setAgrupandoEn(se)}
                        >
                          Agrupar
                        </Button>
                        <Button size="small" color="inherit" disabled={!!se.ended_at} onClick={() => setCerrar(se)}>
                          Cerrar
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Typography variant="h6" sx={{ mb: 1 }}>Emergencias sin SuperEvento</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Emergencias locales abiertas que ninguna comuna ha sumado a un SuperEvento.
            Si dos o más son en realidad el mismo evento, agrúpalas en uno.
          </Typography>
          {huerfanas.length === 0 ? (
            <Alert severity="info">No hay emergencias sueltas.</Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Emergencia</TableCell>
                  <TableCell>Comuna</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell align="center">Centros vinculados</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {huerfanas.map((em) => (
                  <TableRow key={em.emergency_id}>
                    <TableCell>{em.name}</TableCell>
                    <TableCell>{em.municipality_shortname}</TableCell>
                    <TableCell>{em.type ?? "—"}</TableCell>
                    <TableCell align="center">{em.activaciones_vinculadas}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <CreateDialog abierto={creando} onClose={() => setCreando(false)} onHecho={hecho} />
      <GroupDialog
        superEvento={agrupandoEn} huerfanas={huerfanas}
        onClose={() => setAgrupandoEn(null)} onHecho={hecho}
      />
      <InviteDialog superEvento={invitarA} onClose={() => setInvitarA(null)} onHecho={hecho} />
      <CloseDialog superEvento={cerrar} onClose={() => setCerrar(null)} onHecho={hecho} />
    </Box>
  );
}

function CreateDialog({
  abierto, onClose, onHecho,
}: { abierto: boolean; onClose: () => void; onHecho: (aviso: string) => void }) {
  const [nombre, setNombre] = React.useState("");
  const [nivel, setNivel] = React.useState<NivelEvento>("mayor");
  const [tipo, setTipo] = React.useState("");
  const [descripcion, setDescripcion] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (abierto) { setNombre(""); setNivel("mayor"); setTipo(""); setDescripcion(""); setError(null); }
  }, [abierto]);

  const crear = async () => {
    setEnviando(true);
    setError(null);
    try {
      await createSuperEvent({
        name: nombre.trim(), level: nivel,
        type: tipo.trim() || null, description: descripcion.trim() || null,
      });
      onHecho("SuperEvento creado. Ahora puedes invitar comunas o agrupar emergencias existentes.");
      onClose();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo crear."));
    } finally {
      setEnviando(false);
    }
  };

  const definicion = NIVELES.find((n) => n.value === nivel)?.definicion ?? "";

  return (
    <Dialog open={abierto} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Nuevo SuperEvento</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nombre" value={nombre} fullWidth size="small"
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Incendio forestal región de Valparaíso"
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
          <TextField
            label="Tipo (opcional)" value={tipo} fullWidth size="small"
            onChange={(e) => setTipo(e.target.value)}
            placeholder="incendio, temporal, aluvión…"
          />
          <TextField
            label="Descripción (opcional)" value={descripcion} fullWidth size="small"
            multiline rows={2} onChange={(e) => setDescripcion(e.target.value)}
          />
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

/**
 * Agrupa emergencias existentes. Las comunas dueñas quedan 'participando' sin
 * pasar por invitación: el acto de agrupar ES la decisión de que colaboran.
 *
 * Una comuna solo puede aportar UNA emergencia por SuperEvento, así que el
 * backend rechaza una selección con dos de la misma comuna.
 */
function GroupDialog({
  superEvento, huerfanas, onClose, onHecho,
}: {
  superEvento: SuperEvent | null;
  huerfanas: EmergenciaHuerfana[];
  onClose: () => void;
  onHecho: (aviso: string) => void;
}) {
  const [seleccion, setSeleccion] = React.useState<number[]>([]);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { setSeleccion([]); setError(null); }, [superEvento?.super_event_id]);

  const agrupar = async () => {
    if (!superEvento) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await groupEmergencies(superEvento.super_event_id, seleccion);
      onHecho(`Se agruparon ${r.agrupadas.length} emergencia(s). Sus comunas quedaron participando.`);
      onClose();
    } catch (e: any) {
      setError(mensajeError(e, "No se pudo agrupar."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={!!superEvento} onClose={enviando ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Agrupar emergencias en «{superEvento?.name}»</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Las comunas dueñas quedarán participando de inmediato, sin invitación: agrupar
          ya es la decisión de que colaboran. Solo una emergencia por comuna.
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack>
          {huerfanas.map((em) => (
            <FormControlLabel
              key={em.emergency_id}
              control={
                <Checkbox
                  checked={seleccion.includes(em.emergency_id)}
                  onChange={() =>
                    setSeleccion((s) =>
                      s.includes(em.emergency_id)
                        ? s.filter((x) => x !== em.emergency_id)
                        : [...s, em.emergency_id]
                    )
                  }
                />
              }
              label={`${em.name} · ${em.municipality_shortname} · ${em.activaciones_vinculadas} centro(s)`}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={agrupar} disabled={enviando || seleccion.length === 0}>
          {enviando ? "Agrupando…" : "Agrupar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
