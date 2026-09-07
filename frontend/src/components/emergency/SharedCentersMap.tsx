// src/components/emergency/SharedCentersMap.tsx
//
// Vista de mapa del tablero intercomunal: responde "a quién alcanzo a llegar desde
// donde estoy". Muestra los mismos centros que el listado —los de las otras comunas
// que participan de la emergencia— pero ordenados por geografía en vez de urgencia.
//
// Es un mapa propio y no MapComponent: aquel sirve al mapa público y al comunal, con
// otro tipo de dato, otra semántica de color y muchas más acciones.
import * as React from "react";
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";

import {
  coordenadaDe, urgenciaDe, type CentroCompartido,
} from "@/services/crossSupport.service";
import type { UserLocation } from "@/hooks/useGeolocation";
import { calculateDistance, formatDistance } from "@/utils/distance";
import { COLOR_PRIORIDAD, COLOR_URGENCIA, ETIQUETA_URGENCIA } from "./sharedCenterUi";

const apiKey = import.meta.env.VITE_Maps_API_KEY as string | undefined;

// Encuadre de respaldo cuando ningún centro tiene coordenadas.
const CENTRO_REGION = { lat: -33.04, lng: -71.61 };

// Tope del encuadre automático: más cerca que esto se pierde el contexto de la ciudad.
const ZOOM_MAXIMO_AUTOMATICO = 15;

type CentroUbicado = { centro: CentroCompartido; coord: { lat: number; lng: number } };

type Props = {
  centros: CentroCompartido[];
  ubicacion: UserLocation | null;
  onOfrecer: (centro: CentroCompartido) => void;
};

/**
 * Encuadra el mapa sobre los centros mostrados (y la ubicación del usuario, si la
 * hay). Se reencuadra cuando cambia el conjunto: filtrar debe llevar la vista a lo
 * que quedó, no dejar al usuario mirando una zona vacía.
 */
function AjustarEncuadre({ puntos }: { puntos: { lat: number; lng: number }[] }) {
  const map = useMap();
  const clave = puntos.map((p) => `${p.lat},${p.lng}`).join("|");

  React.useEffect(() => {
    if (!map || puntos.length === 0) return;

    if (puntos.length === 1) {
      map.setCenter(puntos[0]);
      map.setZoom(Math.min(14, ZOOM_MAXIMO_AUTOMATICO));
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    puntos.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 64);

    // Con centros muy juntos el encuadre se va hasta zoom 19 (nivel de edificio) y se
    // pierde la referencia de la ciudad, que es justo lo que hace útil esta vista.
    google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > ZOOM_MAXIMO_AUTOMATICO) map.setZoom(ZOOM_MAXIMO_AUTOMATICO);
    });
    // `clave` resume las coordenadas: reencuadra al cambiar el conjunto, no en cada render.
  }, [map, clave]);

  return null;
}

export default function SharedCentersMap({ centros, ubicacion, onOfrecer }: Props) {
  const [seleccionado, setSeleccionado] = React.useState<string | null>(null);

  const ubicados = React.useMemo<CentroUbicado[]>(
    () =>
      centros
        .map((centro) => ({ centro, coord: coordenadaDe(centro) }))
        .filter((x): x is CentroUbicado => x.coord !== null),
    [centros]
  );

  const sinCoordenadas = centros.length - ubicados.length;

  const puntos = React.useMemo(() => {
    const ps = ubicados.map((u) => u.coord);
    if (ubicacion) ps.push({ lat: ubicacion.latitude, lng: ubicacion.longitude });
    return ps;
  }, [ubicados, ubicacion]);

  // Si el centro seleccionado desaparece por un cambio de filtro, se cierra la ficha.
  React.useEffect(() => {
    if (seleccionado && !ubicados.some((u) => u.centro.center_id === seleccionado)) {
      setSeleccionado(null);
    }
  }, [ubicados, seleccionado]);

  if (!apiKey) {
    return (
      <Alert severity="warning">
        No hay clave de Google Maps configurada (<code>VITE_Maps_API_KEY</code>), así que el
        mapa no puede cargarse. La vista de listado muestra la misma información.
      </Alert>
    );
  }

  const activo = ubicados.find((u) => u.centro.center_id === seleccionado) ?? null;

  return (
    <Box>
      {sinCoordenadas > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {sinCoordenadas === 1
            ? "1 centro no aparece en el mapa porque no tiene ubicación registrada."
            : `${sinCoordenadas} centros no aparecen en el mapa porque no tienen ubicación registrada.`}{" "}
          Puedes verlos en la vista de listado.
        </Alert>
      )}

      {ubicados.length === 0 ? (
        <Alert severity="info">Ningún centro del tablero tiene ubicación para mostrar en el mapa.</Alert>
      ) : (
        <Box
          sx={{
            height: { xs: 420, md: 620 },
            borderRadius: 2, overflow: "hidden",
            border: 1, borderColor: "divider",
          }}
        >
          <APIProvider apiKey={apiKey}>
            <Map
              defaultCenter={CENTRO_REGION}
              defaultZoom={12}
              mapId="appcopio-map-main"
              gestureHandling="greedy"
              disableDefaultUI
              fullscreenControl
              zoomControl
              style={{ width: "100%", height: "100%" }}
            >
              <AjustarEncuadre puntos={puntos} />

              {ubicacion && (
                <AdvancedMarker
                  position={{ lat: ubicacion.latitude, lng: ubicacion.longitude }}
                  title="Tu ubicación"
                  zIndex={1000}
                >
                  <Box
                    sx={{
                      width: 16, height: 16, borderRadius: "50%",
                      bgcolor: "#1976d2", border: "3px solid #fff",
                      boxShadow: "0 0 0 2px rgba(25,118,210,.4)",
                    }}
                  />
                </AdvancedMarker>
              )}

              {ubicados.map(({ centro, coord }) => {
                const urgencia = urgenciaDe(centro);
                return (
                  <AdvancedMarker
                    key={centro.center_id}
                    position={coord}
                    title={`${centro.name} (${centro.municipality_shortname}) · ${ETIQUETA_URGENCIA[urgencia]}`}
                    onClick={() => setSeleccionado(centro.center_id)}
                  >
                    <Box
                      sx={{
                        width: 26, height: 26, borderRadius: "50%",
                        bgcolor: COLOR_URGENCIA[urgencia],
                        border: "2px solid #fff",
                        boxShadow: 2,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontSize: 13, fontWeight: 700,
                        outline: seleccionado === centro.center_id ? "3px solid #1976d2" : "none",
                      }}
                    >
                      {centro.prioridades.length || ""}
                    </Box>
                  </AdvancedMarker>
                );
              })}

              {activo && (
                <InfoWindow
                  position={activo.coord}
                  onCloseClick={() => setSeleccionado(null)}
                  pixelOffset={[0, -30]}
                >
                  <Box sx={{ minWidth: 240, maxWidth: 300, p: 0.5 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={activo.centro.municipality_shortname} color="primary" />
                      {ubicacion && (
                        <Chip
                          size="small" variant="outlined"
                          label={`a ${formatDistance(
                            calculateDistance(
                              ubicacion.latitude, ubicacion.longitude,
                              activo.coord.lat, activo.coord.lng
                            )
                          )}`}
                        />
                      )}
                    </Stack>
                    <Typography variant="subtitle1" fontWeight={700}>{activo.centro.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Abastecimiento: {Number(activo.centro.fullness_percentage ?? 0).toFixed(0)}%
                      {activo.centro.capacity != null && ` · Capacidad ${activo.centro.capacity}`}
                    </Typography>

                    <Typography variant="subtitle2" sx={{ mt: 1.5, mb: 0.5 }}>Necesidades</Typography>
                    {activo.centro.prioridades.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">Sin prioridades declaradas.</Typography>
                    ) : (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {activo.centro.prioridades.map((p) => (
                          <Chip
                            key={p.item_id} size="small"
                            label={`${p.item_name} · ${p.priority}`}
                            color={COLOR_PRIORIDAD[p.priority] ?? "default"}
                          />
                        ))}
                      </Stack>
                    )}

                    <Button
                      fullWidth size="small" variant="contained" sx={{ mt: 1.5 }}
                      startIcon={<VolunteerActivismIcon />}
                      onClick={() => onOfrecer(activo.centro)}
                    >
                      Ofrecer apoyo
                    </Button>
                  </Box>
                </InfoWindow>
              )}
            </Map>
          </APIProvider>
        </Box>
      )}

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        {(["alto", "medio", "bajo", "ninguna"] as const).map((nivel) => (
          <Stack key={nivel} direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: COLOR_URGENCIA[nivel] }} />
            <Typography variant="caption" color="text.secondary">{ETIQUETA_URGENCIA[nivel]}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
