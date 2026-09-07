import * as React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Autocomplete,
  CircularProgress,
  Stack,
  Typography,
  Chip,
  Box,
  MenuItem,
} from "@mui/material";
import { listActiveUsersByRole } from "@/services/users.service";
import type { User } from "@/types/user";
import { listEmergencies, type Emergency } from "@/services/superadmin.service";

interface ActivateCenterDialogProps {
  open: boolean;
  onClose: () => void;
  centerId: string;
  centerName: string;
  defaultManagerId?: number | null;
  onConfirm: (data: { 
    notes: string; 
    emergencyId?: number | null;
    assignedUserIds: number[];  // ← CAMBIO: Array en vez de singular
  }) => Promise<void>;
}

const EMERGENCY_TYPES = [
  { label: "Incendio", icon: "🔥" },
  { label: "Inundación", icon: "💧" },
  { label: "Terremoto", icon: "🌋" },
  { label: "Temporal", icon: "🌪️" },
  { label: "Aluvión", icon: "🏔️" },
];

export default function ActivateCenterDialog({
  open,
  onClose,
  centerId,
  centerName,
  defaultManagerId,
  onConfirm,
}: ActivateCenterDialogProps) {
  const [notes, setNotes] = React.useState("");
  // Emergencias vigentes en las que la comuna YA participa. Vincular es opcional:
  // una activación local (un derrumbe, un sector puntual) no necesita ninguna.
  const [emergencias, setEmergencias] = React.useState<Emergency[]>([]);
  // MUI trata value="" como "sin selección" y deja el campo en blanco, así que
  // "sin emergencia" necesita un valor propio (0) para verse elegido.
  const SIN_EMERGENCIA = 0;
  const [emergencyId, setEmergencyId] = React.useState<number>(SIN_EMERGENCIA);
  const [assignedUsers, setAssignedUsers] = React.useState<User[]>([]);  // ← CAMBIO: Array
  const [availableUsers, setAvailableUsers] = React.useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Cargar usuarios disponibles
  // Al abrir, trae las emergencias vigentes donde la comuna ya participa: son las
  // únicas a las que el backend permite colgar una activación.
  React.useEffect(() => {
    if (!open) return;
    let vivo = true;
    (async () => {
      try {
        const todas = await listEmergencies();
        if (!vivo) return;
        setEmergencias(todas.filter((e) => !e.ended_at && e.mi_estado === "participando"));
      } catch {
        if (vivo) setEmergencias([]);
      }
    })();
    return () => { vivo = false; };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    let alive = true;
    (async () => {
      setLoadingUsers(true);
      try {
        const users = await listActiveUsersByRole(2);
        if (alive) {
          setAvailableUsers(users || []);

          // Si hay un TM asignado por defecto, pre-seleccionarlo
          if (defaultManagerId) {
            const defaultUser = users.find((u) => u.user_id === defaultManagerId);
            if (defaultUser) {
              setAssignedUsers([defaultUser]);  // ← Array con 1 elemento
            }
          }
        }
      } catch (error) {
        console.error("Error al cargar trabajadores municipales:", error);
      } finally {
        if (alive) setLoadingUsers(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, defaultManagerId]);

  // Reset al cerrar
  React.useEffect(() => {
    if (!open) {
      setNotes("");
      setAssignedUsers([]);
    }
  }, [open]);

  const handleQuickNote = (emergencyType: string) => {
    const currentNotes = notes.trim();
    if (currentNotes) {
      setNotes(`${currentNotes} - ${emergencyType}`);
    } else {
      setNotes(`Emergencia: ${emergencyType}`);
    }
  };

  const handleConfirm = async () => {
    if (assignedUsers.length === 0) {  // ← CAMBIO: Verificar array
      alert("Debes seleccionar al menos un encargado para activar el centro");
      return;
    }

    if (!notes.trim()) {
      alert("Debes indicar el motivo de la activación");
      return;
    }

    try {
      setSaving(true);
      await onConfirm({
        notes: notes.trim(),
        emergencyId: emergencyId === SIN_EMERGENCIA ? null : emergencyId,
        assignedUserIds: assignedUsers.map(u => u.user_id),  // ← CAMBIO: Array de IDs
      });
      onClose();
    } catch (error: any) {
      console.error("Error al activar centro:", error);
      alert(error?.message || "Error al activar el centro");
    } finally {
      setSaving(false);
    }
  };

 return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Typography variant="h6" component="div" fontWeight={700}>
          Activar Centro
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {centerName}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={3}>
          {/* Sección 1: Motivo de Emergencia */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              1. Indica el motivo de la emergencia *
            </Typography>
            <Typography variant="caption" color="text.secondary" gutterBottom>
              Describe la situación que requiere activar este centro
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1, mb: 2, gap: 1 }}>
              {EMERGENCY_TYPES.map((type) => (
                <Chip
                  key={type.label}
                  label={`${type.icon} ${type.label}`}
                  onClick={() => handleQuickNote(type.label)}
                  clickable
                  size="small"
                  variant="outlined"
                />
              ))}
            </Stack>

            <TextField
              fullWidth
              multiline
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Incendio forestal en sector alto del cerro..."
              required
            />
          </Box>

          {/* Emergencia (opcional) */}
          {emergencias.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Emergencia asociada (opcional)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Si vinculas esta activación a una emergencia, las demás comunas participantes
                podrán ver las prioridades de este centro. Déjalo vacío para un evento local.
              </Typography>
              <TextField
                select
                fullWidth
                size="small"
                sx={{ mt: 1 }}
                value={emergencyId}
                onChange={(e) => setEmergencyId(Number(e.target.value))}
              >
                <MenuItem value={SIN_EMERGENCIA}>Sin emergencia (evento local)</MenuItem>
                {emergencias.map((em) => (
                  <MenuItem key={em.emergency_id} value={em.emergency_id}>
                    {em.name}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}

          {/* Sección 2: Encargados - CAMBIO PRINCIPAL */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              2. Selecciona los encargados del centro *
            </Typography>
            <Typography variant="caption" color="text.secondary" gutterBottom>
              {defaultManagerId
                ? "Por defecto se pre-seleccionó el Trabajador Municipal. Puedes agregar más encargados."
                : "Selecciona uno o más encargados para este centro"}
            </Typography>

            <Autocomplete
              multiple  // ← CAMBIO: Habilitar selección múltiple
              value={assignedUsers}
              onChange={(_, newValue) => setAssignedUsers(newValue)}
              options={availableUsers}
              loading={loadingUsers}
              getOptionLabel={(option) => option?.nombre || option?.username || ""}
              isOptionEqualToValue={(option, value) => option?.user_id === value?.user_id}
              renderOption={(props, option) => (
                <li {...props} key={option.user_id}>
                  <Box sx={{ display: "flex", width: "100%", alignItems: "center", gap: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2">{option?.nombre || option?.username}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.email}
                      </Typography>
                    </Box>
                    {option.active_assignments ? (
                      <Chip 
                        label={`${option.active_assignments} asign.`} 
                        size="small" 
                        color="warning"
                      />
                    ) : null}
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Encargados"
                  required
                  placeholder="Selecciona uno o más encargados..."
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingUsers ? <CircularProgress size={18} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            {/* Mostrar resumen de seleccionados */}
            {assignedUsers.length > 0 && (
              <Box sx={{ mt: 2, p: 2, bgcolor: "success.lighter", borderRadius: 1 }}>
                <Typography variant="caption" fontWeight={600} gutterBottom>
                  ✓ {assignedUsers.length} encargado{assignedUsers.length !== 1 ? 's' : ''} seleccionado{assignedUsers.length !== 1 ? 's' : ''}:
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1, gap: 1 }}>
                  {assignedUsers.map(user => (
                    <Chip
                      key={user.user_id}
                      label={user.nombre || user.username}
                      size="small"
                      color="success"
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </Box>

          {/* Sección 3: Confirmación */}
          <Box sx={{ bgcolor: "info.lighter", p: 2, borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              <strong>⚠️ Importante:</strong> Al activar este centro se creará un nuevo registro en el
              historial de activaciones y se asignarán {assignedUsers.length || 0} encargado{assignedUsers.length !== 1 ? 's' : ''}. 
              El centro quedará disponible para recibir personas y gestionar recursos.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button 
          onClick={handleConfirm} 
          variant="contained" 
          disabled={saving || assignedUsers.length === 0 || !notes.trim()}
        >
          {saving ? "Activando..." : `Confirmar Activación (${assignedUsers.length} encargados)`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}