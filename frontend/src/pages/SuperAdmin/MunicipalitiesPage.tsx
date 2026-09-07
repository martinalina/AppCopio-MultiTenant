// src/pages/SuperAdmin/MunicipalitiesPage.tsx
import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import LocationCityIcon from "@mui/icons-material/LocationCity";

import { paths } from "@/routes/paths";
import { formatRut } from "@/utils/rut";
import {
  listMunicipalities, createMunicipality,
  type Municipality, type NuevoAdminInput,
} from "@/services/superadmin.service";

const ADMIN_VACIO: NuevoAdminInput = { username: "", password: "", email: "", nombre: "", rut: "" };

export default function MunicipalitiesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = React.useState<Municipality[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [abierto, setAbierto] = React.useState(false);
  const [guardando, setGuardando] = React.useState(false);
  const [errorForm, setErrorForm] = React.useState<string | null>(null);
  const [nombre, setNombre] = React.useState("");
  const [shortname, setShortname] = React.useState("");
  const [admin, setAdmin] = React.useState<NuevoAdminInput>(ADMIN_VACIO);

  const cargar = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listMunicipalities());
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.error || "No se pudieron cargar las municipalidades.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void cargar(); }, [cargar]);

  const cerrarModal = () => {
    setAbierto(false);
    setErrorForm(null);
    setNombre(""); setShortname(""); setAdmin(ADMIN_VACIO);
  };

  const crear = async () => {
    setGuardando(true);
    setErrorForm(null);
    try {
      await createMunicipality({ name: nombre.trim(), shortname: shortname.trim().toUpperCase(), admin });
      cerrarModal();
      await cargar();
    } catch (e: any) {
      setErrorForm(e?.response?.data?.message || e?.response?.data?.error || "No se pudo crear la municipalidad.");
    } finally {
      setGuardando(false);
    }
  };

  const shortnameValido = shortname.trim().length >= 2 && shortname.trim().length <= 5;
  const puedeCrear =
    nombre.trim() !== "" && shortnameValido &&
    admin.username.trim() !== "" && admin.password.trim() !== "" &&
    admin.email.trim() !== "" && admin.nombre.trim() !== "" && admin.rut.trim() !== "";

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4" fontWeight={700}>Municipalidades</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAbierto(true)}>
          Nueva municipalidad
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Cada municipalidad se crea junto a su primer administrador. El prefijo se usa para
        los identificadores de sus centros (por ejemplo <strong>VALPO-C001</strong>).
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Comuna</TableCell>
                <TableCell>Prefijo</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Centros creados</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={28} /></TableCell></TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">Todavía no hay municipalidades.</Typography>
                </TableCell></TableRow>
              )}
              {!loading && rows.map((m) => (
                <TableRow key={m.municipality_id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <LocationCityIcon fontSize="small" color="action" />
                      <Typography fontWeight={500}>{m.name}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell><Chip label={m.shortname} size="small" /></TableCell>
                  <TableCell>
                    <Chip label={m.is_active ? "Activa" : "Inactiva"} size="small"
                          color={m.is_active ? "success" : "default"} />
                  </TableCell>
                  <TableCell>{m.center_seq_counter ?? 0}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => navigate(paths.superadmin.municipalityDetail(m.municipality_id))}>
                      Gestionar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={abierto} onClose={cerrarModal} maxWidth="sm" fullWidth>
        <DialogTitle>Nueva municipalidad</DialogTitle>
        <DialogContent>
          {errorForm && <Alert severity="error" sx={{ mb: 2 }}>{errorForm}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nombre de la comuna" value={nombre} required fullWidth
                       onChange={(e) => setNombre(e.target.value)} />
            <TextField
              label="Prefijo (2 a 5 letras)" value={shortname} required fullWidth
              onChange={(e) => setShortname(e.target.value.toUpperCase())}
              error={shortname !== "" && !shortnameValido}
              helperText="Se antepone al id de cada centro. Ejemplo: VALPO → VALPO-C001"
            />
            <Typography variant="subtitle2" sx={{ pt: 1 }}>Primer administrador</Typography>
            <TextField label="Nombre completo" value={admin.nombre} required fullWidth
                       onChange={(e) => setAdmin({ ...admin, nombre: e.target.value })} />
            <TextField label="Usuario" value={admin.username} required fullWidth
                       onChange={(e) => setAdmin({ ...admin, username: e.target.value })} />
            <TextField label="RUT" value={admin.rut} required fullWidth placeholder="12.345.678-9"
                       onChange={(e) => setAdmin({ ...admin, rut: formatRut(e.target.value) })} />
            <TextField label="Correo" type="email" value={admin.email} required fullWidth
                       onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
            <TextField label="Contraseña inicial" type="password" value={admin.password} required fullWidth
                       onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrarModal} disabled={guardando}>Cancelar</Button>
          <Button variant="contained" onClick={crear} disabled={!puedeCrear || guardando}>
            {guardando ? "Creando…" : "Crear"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
