// src/pages/SuperEvents/IntermunicipalBoardPage.tsx
//
// Tablero intercomunal: centros activos de las OTRAS comunas participantes en un
// SUPEREVENTO, con sus necesidades, para poder ofrecerles apoyo.
//
// El SuperEvento agrupa las emergencias locales de varias comunas, así que cada
// centro llega etiquetado con la emergencia que lo aporta y se puede filtrar por
// ella además de por comuna.
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
import { listSuperEvents, type SuperEvent } from "@/services/superEvents.service";
import {
  getBoard, coordenadaDe, compararPorUrgencia, type CentroCompartido,
} from "@/services/crossSupport.service";
import { useGeolocation } from "@/hooks/useGeolocation";
import { calculateDistance } from "@/utils/distance";
import SharedCentersFilters, {
  FILTROS_INICIALES, type FiltrosTablero,
} from "@/components/superevent/SharedCentersFilters";
import SharedCentersList from "@/components/superevent/SharedCentersList";
import SharedCentersMap from "@/components/superevent/SharedCentersMap";
import OfferSupportDialog from "@/components/superevent/OfferSupportDialog";
import SuperEventLevelChip from "@/components/superevent/SuperEventLevelChip";

type Vista = "listado" | "mapa";

function mensajeError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

export default function IntermunicipalBoardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [superEventos, setSuperEventos] = React.useState<SuperEvent[]>([]);
  const [superEventId, setSuperEventId] = React.useState<number | "">("");
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

  // Solo los SuperEventos vigentes donde la comuna ya está participando dan acceso
  // al tablero; el backend rechaza el resto con 403 o 409.
  React.useEffect(() => {
    (async () => {
      try {
        const todos = await listSuperEvents();
        const disponibles = todos.filter((se) => !se.ended_at && se.mi_estado === "participando");
        setSuperEventos(disponibles);
        if (disponibles.length > 0) setSuperEventId(disponibles[0].super_event_id);
      } catch (e: any) {
        setError(mensajeError(e, "No se pudieron cargar los SuperEventos."));
      }
    })();
  }, []);

  React.useEffect(() => {
    if (superEventId === "") { setCentros([]); return; }
    let vivo = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getBoard(Number(superEventId));
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
  }, [superEventId]);

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

  const superEventoActual = React.useMemo(
    () => superEventos.find((se) => se.super_event_id === superEventId) ?? null,
    [superEventos, superEventId]
  );

  const visibles = React.useMemo(() => {
    const umbral = filtros.prioridadMinima;

    const filtrados = centros.filter((c) => {
      if (filtros.comuna !== "" && c.municipality_id !== filtros.comuna) return false;
      if (filtros.emergencia !== "" && c.emergency_id !== filtros.emergencia) return false;
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

      {superEventos.length === 0 ? (
        <Alert severity="info">
          Tu comuna no está participando en ningún SuperEvento vigente. Acepta una invitación
          en <strong>SuperEventos</strong>, o crea uno desde una de tus emergencias, para ver
          el tablero.
        </Alert>
      ) : (
        <>
          <Stack
            direction="row" spacing={2} flexWrap="wrap" useFlexGap
            alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}
          >
            <FormControl sx={{ minWidth: 320 }} size="small">
              <InputLabel id="se-label">SuperEvento</InputLabel>
              <Select
                labelId="se-label" label="SuperEvento" value={superEventId}
                onChange={(e) => setSuperEventId(Number(e.target.value))}
              >
                {superEventos.map((se) => (
                  <MenuItem key={se.super_event_id} value={se.super_event_id}>{se.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {superEventoActual && <SuperEventLevelChip level={superEventoActual.level} />}

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
              Ninguna otra comuna tiene centros vinculados a este SuperEvento todavía.
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
        superEventId={superEventId}
        onClose={() => setOfrecerA(null)}
        onSent={setAviso}
      />
    </Box>
  );
}
