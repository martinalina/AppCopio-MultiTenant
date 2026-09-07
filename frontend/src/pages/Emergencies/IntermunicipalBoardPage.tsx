// src/pages/Emergencies/IntermunicipalBoardPage.tsx
//
// Tablero intercomunal: centros activos de las OTRAS comunas participantes, con sus
// necesidades, para poder ofrecerles apoyo.
//
// La página es el contenedor: posee los datos, los filtros, la ubicación y el modo de
// vista. Las dos vistas son presentacionales y consumen el mismo conjunto ya filtrado,
// así que cambiar de vista nunca cambia el recorte, solo el eje con que se lee:
//   · Listado → qué necesita cada comuna y con cuánta urgencia
//   · Mapa    → a quién se alcanza a llegar desde donde uno está
import * as React from "react";
import {
  Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem,
  Select, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import InboxIcon from "@mui/icons-material/Inbox";
import MapIcon from "@mui/icons-material/Map";
import ViewListIcon from "@mui/icons-material/ViewList";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { useNavigate, useSearchParams } from "react-router-dom";

import { paths } from "@/routes/paths";
import { listEmergencies, type Emergency } from "@/services/superadmin.service";
import {
  getBoard, coordenadaDe, compararPorUrgencia, type CentroCompartido,
} from "@/services/crossSupport.service";
import { useGeolocation } from "@/hooks/useGeolocation";
import { calculateDistance } from "@/utils/distance";
import SharedCentersFilters, {
  FILTROS_INICIALES, type FiltrosTablero,
} from "@/components/emergency/SharedCentersFilters";
import SharedCentersList from "@/components/emergency/SharedCentersList";
import SharedCentersMap from "@/components/emergency/SharedCentersMap";
import OfferSupportDialog from "@/components/emergency/OfferSupportDialog";

type Vista = "listado" | "mapa";

function mensajeError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

export default function IntermunicipalBoardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [emergencias, setEmergencias] = React.useState<Emergency[]>([]);
  const [emergencyId, setEmergencyId] = React.useState<number | "">("");
  const [centros, setCentros] = React.useState<CentroCompartido[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const [filtros, setFiltros] = React.useState<FiltrosTablero>(FILTROS_INICIALES);
  const [ofrecerA, setOfrecerA] = React.useState<CentroCompartido | null>(null);

  // El modo vive en la URL para que sobreviva a un refresco y el enlace sea compartible.
  const vista: Vista = searchParams.get("vista") === "mapa" ? "mapa" : "listado";
  const cambiarVista = (nueva: Vista) => {
    const next = new URLSearchParams(searchParams);
    if (nueva === "mapa") next.set("vista", "mapa");
    else next.delete("vista");
    setSearchParams(next, { replace: true });
  };

  const {
    location: ubicacion,
    error: errorUbicacion,
    loading: cargandoUbicacion,
    supported: ubicacionSoportada,
    requestLocation,
  } = useGeolocation();

  // Solo las emergencias vigentes donde la comuna ya está participando dan acceso
  // al tablero; el backend rechaza el resto con 403.
  React.useEffect(() => {
    (async () => {
      try {
        const todas = await listEmergencies();
        const disponibles = todas.filter((e) => !e.ended_at && e.mi_estado === "participando");
        setEmergencias(disponibles);
        if (disponibles.length > 0) setEmergencyId(disponibles[0].emergency_id);
      } catch (e: any) {
        setError(mensajeError(e, "No se pudieron cargar las emergencias."));
      }
    })();
  }, []);

  React.useEffect(() => {
    if (emergencyId === "") { setCentros([]); return; }
    let vivo = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getBoard(Number(emergencyId));
        if (vivo) {
          setCentros(data);
          setFiltros(FILTROS_INICIALES);
        }
      } catch (e: any) {
        if (vivo) setError(mensajeError(e, "No se pudo cargar el tablero."));
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [emergencyId]);

  // Si se pierde la ubicación, el orden por cercanía deja de tener sentido.
  React.useEffect(() => {
    if (!ubicacion && filtros.orden === "cercania") {
      setFiltros((f) => ({ ...f, orden: "urgencia" }));
    }
  }, [ubicacion, filtros.orden]);

  const distanciaA = React.useCallback(
    (c: CentroCompartido): number | null => {
      const coord = coordenadaDe(c);
      if (!ubicacion || !coord) return null;
      return calculateDistance(ubicacion.latitude, ubicacion.longitude, coord.lat, coord.lng);
    },
    [ubicacion]
  );

  const visibles = React.useMemo(() => {
    const umbral = filtros.prioridadMinima;

    const filtrados = centros.filter((c) => {
      if (filtros.comuna !== "" && c.municipality_id !== filtros.comuna) return false;
      if (filtros.itemId !== "" && !c.prioridades.some((p) => p.item_id === filtros.itemId)) return false;
      if (umbral === "alto" && !c.prioridades.some((p) => p.priority === "alto")) return false;
      if (umbral === "medio" && !c.prioridades.some((p) => p.priority === "alto" || p.priority === "medio")) {
        return false;
      }
      return true;
    });

    return [...filtrados].sort((a, b) => {
      if (filtros.orden === "cercania") {
        const da = distanciaA(a);
        const db = distanciaA(b);
        // Los centros sin ubicación quedan al final en vez de desordenar el resto.
        if (da == null && db == null) return a.name.localeCompare(b.name);
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      }
      const porUrgencia = compararPorUrgencia(a, b);
      return porUrgencia !== 0 ? porUrgencia : a.name.localeCompare(b.name);
    });
  }, [centros, filtros, distanciaA]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" gap={2}>
        <Typography variant="h4" fontWeight={700}>Tablero intercomunal</Typography>
        <Button startIcon={<InboxIcon />} onClick={() => navigate(paths.supportOffers)}>
          Ver ofertas de apoyo
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Centros activos de las otras comunas participantes y sus necesidades. Solo se comparten
        ubicación, capacidad, nivel de abastecimiento y prioridades: los datos de personas,
        familias e inventario nunca cruzan de comuna.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {aviso && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert>}

      {emergencias.length === 0 ? (
        <Alert severity="info">
          Tu comuna no está participando en ninguna emergencia vigente. Acepta una invitación
          en <strong>Emergencias</strong> para ver el tablero.
        </Alert>
      ) : (
        <>
          <Stack
            direction="row" spacing={2} flexWrap="wrap" useFlexGap
            alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}
          >
            <FormControl sx={{ minWidth: 320 }} size="small">
              <InputLabel id="em-label">Emergencia</InputLabel>
              <Select
                labelId="em-label" label="Emergencia" value={emergencyId}
                onChange={(e) => setEmergencyId(Number(e.target.value))}
              >
                {emergencias.map((em) => (
                  <MenuItem key={em.emergency_id} value={em.emergency_id}>{em.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <ToggleButtonGroup
              size="small" exclusive value={vista}
              onChange={(_, v: Vista | null) => v && cambiarVista(v)}
            >
              <ToggleButton value="listado"><ViewListIcon sx={{ mr: 0.5 }} fontSize="small" /> Listado</ToggleButton>
              <ToggleButton value="mapa"><MapIcon sx={{ mr: 0.5 }} fontSize="small" /> Mapa</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Stack
            direction="row" spacing={2} flexWrap="wrap" useFlexGap
            alignItems="center" sx={{ mb: 2 }}
          >
            <SharedCentersFilters
              centros={centros} valor={filtros} onChange={setFiltros}
              puedeOrdenarPorCercania={!!ubicacion}
            />
            {ubicacionSoportada && !ubicacion && (
              <Button
                size="small" startIcon={<MyLocationIcon />}
                onClick={requestLocation} disabled={cargandoUbicacion}
              >
                {cargandoUbicacion ? "Ubicando…" : "Usar mi ubicación"}
              </Button>
            )}
          </Stack>

          {!ubicacion && errorUbicacion && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {errorUbicacion} Sin ubicación no se muestran distancias ni se puede ordenar por
              cercanía; el resto del tablero funciona igual.
            </Alert>
          )}

          {loading && <Box sx={{ textAlign: "center", py: 4 }}><CircularProgress /></Box>}

          {!loading && centros.length === 0 && (
            <Alert severity="info">
              Ninguna otra comuna tiene centros vinculados a esta emergencia todavía.
            </Alert>
          )}

          {!loading && centros.length > 0 && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Mostrando {visibles.length} de {centros.length} centros
                {ubicacion && filtros.orden === "cercania" && " · ordenados por cercanía"}
                {filtros.orden === "urgencia" && " · ordenados por urgencia"}
              </Typography>

              {visibles.length === 0 ? (
                <Alert severity="info">Ningún centro cumple con los filtros seleccionados.</Alert>
              ) : vista === "mapa" ? (
                <SharedCentersMap centros={visibles} ubicacion={ubicacion} onOfrecer={setOfrecerA} />
              ) : (
                <SharedCentersList centros={visibles} ubicacion={ubicacion} onOfrecer={setOfrecerA} />
              )}
            </>
          )}
        </>
      )}

      <OfferSupportDialog
        centro={ofrecerA}
        emergencyId={emergencyId}
        onClose={() => setOfrecerA(null)}
        onSent={setAviso}
      />
    </Box>
  );
}
