// src/components/emergency/SharedCentersList.tsx
//
// Vista de listado del tablero intercomunal: responde "quién necesita qué, y con
// cuánta urgencia". Es la grilla que antes vivía dentro de la página.
import * as React from "react";
import {
  Box, Button, Card, CardContent, Chip, LinearProgress, Stack, Typography,
} from "@mui/material";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import PlaceIcon from "@mui/icons-material/Place";

import {
  coordenadaDe, type CentroCompartido, type PrioridadCentro,
} from "@/services/crossSupport.service";
import type { UserLocation } from "@/hooks/useGeolocation";
import { calculateDistance, formatDistance } from "@/utils/distance";
import { COLOR_PRIORIDAD } from "./sharedCenterUi";

type Props = {
  centros: CentroCompartido[];
  /** Si hay ubicación del usuario, cada tarjeta muestra su distancia. */
  ubicacion: UserLocation | null;
  onOfrecer: (centro: CentroCompartido) => void;
};

export default function SharedCentersList({ centros, ubicacion, onOfrecer }: Props) {
  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
      {centros.map((c) => {
        const coord = coordenadaDe(c);
        const distancia =
          ubicacion && coord
            ? calculateDistance(ubicacion.latitude, ubicacion.longitude, coord.lat, coord.lng)
            : null;

        return (
          <Card key={c.center_id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={c.municipality_shortname} color="primary" />
                <Chip size="small" variant="outlined" label={c.center_id} />
                {distancia != null && (
                  <Chip
                    size="small" variant="outlined" color="info"
                    icon={<PlaceIcon />} label={`a ${formatDistance(distancia)}`}
                  />
                )}
              </Stack>
              <Typography variant="h6" sx={{ mb: 1, fontSize: "1.05rem" }}>{c.name}</Typography>

              <Typography variant="caption" color="text.secondary">
                Abastecimiento: {Number(c.fullness_percentage ?? 0).toFixed(0)}%
                {c.capacity != null && ` · Capacidad ${c.capacity}`}
                {c.operational_status && ` · ${c.operational_status}`}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(Number(c.fullness_percentage ?? 0), 100)}
                sx={{ my: 1, height: 6, borderRadius: 3 }}
              />

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>Necesidades</Typography>
              {c.prioridades.length === 0 ? (
                <Typography variant="body2" color="text.secondary">Sin prioridades declaradas.</Typography>
              ) : (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {c.prioridades.map((p: PrioridadCentro) => (
                    <Chip
                      key={p.item_id} size="small"
                      label={`${p.item_name} · ${p.priority}`}
                      color={COLOR_PRIORIDAD[p.priority] ?? "default"}
                    />
                  ))}
                </Stack>
              )}

              <Button
                fullWidth variant="contained" startIcon={<VolunteerActivismIcon />}
                sx={{ mt: 2 }} onClick={() => onOfrecer(c)}
              >
                Ofrecer apoyo
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
}
