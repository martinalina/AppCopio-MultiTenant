// src/pages/SuperAdmin/MunicipalityDetailPage.tsx
import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, FormControlLabel, InputLabel, MenuItem, Paper,
  Radio, RadioGroup, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";

import { paths } from "@/routes/paths";
import { formatRut } from "@/utils/rut";
import {
  getMunicipality, listMunicipalityUsers, setMunicipalityAdmin,
  type MunicipalityDetail, type MunicipalityUser,
  type AccionAdminActual, type NuevoAdminInput,
} from "@/services/superadmin.service";

const ADMIN_VACIO: NuevoAdminInput = { username: "", password: "", email: "", nombre: "", rut: "" };

export default function MunicipalityDetailPage() {
  const { municipalityId } = useParams();
  const navigate = useNavigate();
  const id = Number(municipalityId);

  const [detalle, setDetalle] = React.useState<MunicipalityDetail | null>(null);
  const [usuarios, setUsuarios] = React.useState<MunicipalityUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const [abierto, setAbierto] = React.useState(false);
  const [guardando, setGuardando] = React.useState(false);
  const [errorForm, setErrorForm] = React.useState<string | null>(null);
  const [accion, setAccion] = React.useState<AccionAdminActual | "">("");
  const [modo, setModo] = React.useState<"promover" | "nuevo">("promover");
  const [promoverId, setPromoverId] = React.useState<number | "">("");
  const [nuevo, setNuevo] = React.useState<NuevoAdminInput>(ADMIN_VACIO);

  const cargar = React.useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setLoading(true);
    setError(null);
    try {
      const [d, u] = await Promise.all([getMunicipality(id), listMunicipalityUsers(id)]);
      setDetalle(d);
      setUsuarios(u);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.error || "No se pudo cargar la municipalidad.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => { void cargar(); }, [cargar]);

  const adminActual = detalle?.administrador ?? null;
  // Solo se promueve a Trabajadores Municipales (role_id 2): un Contacto Ciudadano es
  // enlace con la comunidad, no personal de la municipalidad. El backend aplica la
  // misma restricción, esto solo evita ofrecer una opción que sería rechazada.
  const candidatos = usuarios.filter(
    (u) => u.is_active && u.role_id === 2 && u.user_id !== adminActual?.user_id
  );

  const cerrarModal = () => {
    setAbierto(false);
    setErrorForm(null);
    setAccion(""); setModo("promover"); setPromoverId(""); setNuevo(ADMIN_VACIO);
  };

  const guardar = async () => {
    setGuardando(true);
    setErrorForm(null);
    try {
      await setMunicipalityAdmin(id, {
        accion_actual: adminActual ? (accion as AccionAdminActual) : undefined,
        promover_user_id: modo === "promover" ? Number(promoverId) : undefined,
        nuevo: modo === "nuevo" ? nuevo : undefined,
      });
      const queHizo =
        accion === "degradar"
          ? "El administrador anterior pasó a Trabajador Municipal."
          : accion === "desactivar"
          ? "La cuenta del administrador anterior quedó desactivada."
          : "";
      setAviso(`Administrador actualizado. ${queHizo}`);
      cerrarModal();
      await cargar();
    } catch (e: any) {
      setErrorForm(e?.response?.data?.message || e?.response?.data?.error || "No se pudo cambiar el administrador.");
    } finally {
      setGuardando(false);
    }
  };

  // Refleja la regla del backend: si ya hay administrador, hay que decir qué pasa con él.
  const nuevoCompleto =
    nuevo.username.trim() !== "" && nuevo.password.trim() !== "" && nuevo.email.trim() !== "" &&
    nuevo.nombre.trim() !== "" && nuevo.rut.trim() !== "";
  const puedeGuardar =
    (!adminActual || accion !== "") &&
    (modo === "promover" ? promoverId !== "" : nuevoCompleto);

  if (loading && !detalle) {
    return <Box sx={{ p: 6, textAlign: "center" }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(paths.superadmin.municipalities)} sx={{ mb: 2 }}>
        Volver a municipalidades
      </Button>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {aviso && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert>}

      {detalle && (
        <>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h4" fontWeight={700}>{detalle.name}</Typography>
            <Chip label={detalle.shortname} />
          </Stack>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            {detalle.total_centros} centros · {detalle.total_usuarios} usuarios
          </Typography>

          <Paper sx={{ p: 3, mb: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="h6">Administrador de la comuna</Typography>
                {adminActual ? (
                  <Typography color="text.secondary">
                    {adminActual.nombre ?? adminActual.username} · {adminActual.email}
                  </Typography>
                ) : (
                  <Typography color="warning.main">Esta comuna no tiene administrador vigente.</Typography>
                )}
              </Box>
              <Button variant="contained" startIcon={<SwapHorizIcon />} onClick={() => setAbierto(true)}>
                {adminActual ? "Cambiar administrador" : "Nombrar administrador"}
              </Button>
            </Stack>
            <Alert severity="info" sx={{ mt: 2 }}>
              Solo puede haber un administrador activo por comuna. Para nombrar uno nuevo hay que
              degradar al actual a Trabajador Municipal o desactivar su cuenta.
            </Alert>
          </Paper>

          <Paper>
            <Typography variant="h6" sx={{ p: 2 }}>Usuarios de la comuna</Typography>
            <Divider />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nombre</TableCell>
                    <TableCell>Usuario</TableCell>
                    <TableCell>Rol</TableCell>
                    <TableCell>Estado</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {usuarios.map((u) => (
                    <TableRow key={u.user_id} hover>
                      <TableCell>{u.nombre ?? "—"}</TableCell>
                      <TableCell>{u.username}</TableCell>
                      <TableCell>
                        <Chip size="small" label={u.role_name ?? u.role_id}
                              color={u.role_id === 1 && u.is_active ? "primary" : "default"} />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={u.is_active ? "Activo" : "Inactivo"}
                              color={u.is_active ? "success" : "default"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </>
      )}

      <Dialog open={abierto} onClose={cerrarModal} maxWidth="sm" fullWidth>
        <DialogTitle>{adminActual ? "Cambiar administrador" : "Nombrar administrador"}</DialogTitle>
        <DialogContent>
          {errorForm && <Alert severity="error" sx={{ mb: 2 }}>{errorForm}</Alert>}

          {adminActual && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                1. ¿Qué hacemos con {adminActual.nombre ?? adminActual.username}?
              </Typography>
              <RadioGroup value={accion} onChange={(e) => setAccion(e.target.value as AccionAdminActual)}>
                <FormControlLabel value="degradar" control={<Radio />}
                  label="Degradarlo a Trabajador Municipal (mantiene su cuenta)" />
                <FormControlLabel value="desactivar" control={<Radio />}
                  label="Desactivar su cuenta (no podrá iniciar sesión)" />
              </RadioGroup>
            </Box>
          )}

          <Typography variant="subtitle2" gutterBottom>
            {adminActual ? "2. " : ""}¿Quién será el nuevo administrador?
          </Typography>
          <RadioGroup row value={modo} onChange={(e) => setModo(e.target.value as "promover" | "nuevo")} sx={{ mb: 2 }}>
            <FormControlLabel value="promover" control={<Radio />} label="Promover a un usuario existente" />
            <FormControlLabel value="nuevo" control={<Radio />} label="Crear un usuario nuevo" />
          </RadioGroup>

          {modo === "promover" ? (
            <FormControl fullWidth>
              <InputLabel id="promover-label">Usuario de la comuna</InputLabel>
              <Select labelId="promover-label" label="Usuario de la comuna" value={promoverId}
                      onChange={(e) => setPromoverId(Number(e.target.value))}>
                {candidatos.map((u) => (
                  <MenuItem key={u.user_id} value={u.user_id}>
                    {u.nombre ?? u.username} — {u.role_name}
                  </MenuItem>
                ))}
              </Select>
              {candidatos.length === 0 && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Esta comuna no tiene Trabajadores Municipales activos para promover.
                  Crea un usuario nuevo.
                </Alert>
              )}
            </FormControl>
          ) : (
            <Stack spacing={2}>
              <TextField label="Nombre completo" value={nuevo.nombre} required fullWidth
                         onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
              <TextField label="Usuario" value={nuevo.username} required fullWidth
                         onChange={(e) => setNuevo({ ...nuevo, username: e.target.value })} />
              <TextField label="RUT" value={nuevo.rut} required fullWidth placeholder="12.345.678-9"
                         onChange={(e) => setNuevo({ ...nuevo, rut: formatRut(e.target.value) })} />
              <TextField label="Correo" type="email" value={nuevo.email} required fullWidth
                         onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} />
              <TextField label="Contraseña inicial" type="password" value={nuevo.password} required fullWidth
                         onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrarModal} disabled={guardando}>Cancelar</Button>
          <Button variant="contained" onClick={guardar} disabled={!puedeGuardar || guardando}>
            {guardando ? "Guardando…" : "Confirmar cambio"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
