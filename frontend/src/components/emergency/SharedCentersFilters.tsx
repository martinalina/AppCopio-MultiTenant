// src/components/emergency/SharedCentersFilters.tsx
//
// Filtros del tablero intercomunal. Se aplican en el cliente sobre lo que ya devolvió
// la API: son pocos centros y así el listado y el mapa muestran exactamente el mismo
// recorte, sin llamadas adicionales.
import * as React from "react";
import { FormControl, InputLabel, MenuItem, Select, Stack } from "@mui/material";

import type { CentroCompartido } from "@/services/crossSupport.service";

export type Orden = "urgencia" | "cercania";

export type FiltrosTablero = {
  comuna: number | "";
  itemId: number | "";
  prioridadMinima: "todas" | "medio" | "alto";
  orden: Orden;
};

export const FILTROS_INICIALES: FiltrosTablero = {
  comuna: "",
  itemId: "",
  prioridadMinima: "todas",
  orden: "urgencia",
};

type Props = {
  /** Conjunto completo del tablero: de aquí salen las opciones disponibles. */
  centros: CentroCompartido[];
  valor: FiltrosTablero;
  onChange: (f: FiltrosTablero) => void;
  /** Sin ubicación del usuario no se puede ordenar por cercanía. */
  puedeOrdenarPorCercania: boolean;
};

export default function SharedCentersFilters({
  centros, valor, onChange, puedeOrdenarPorCercania,
}: Props) {
  const comunas = React.useMemo(() => {
    const m = new Map<number, string>();
    centros.forEach((c) => m.set(c.municipality_id, c.municipality_shortname));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [centros]);

  const items = React.useMemo(() => {
    const m = new Map<number, string>();
    centros.forEach((c) => c.prioridades.forEach((p) => m.set(p.item_id, p.item_name)));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [centros]);

  const set = (parcial: Partial<FiltrosTablero>) => onChange({ ...valor, ...parcial });

  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel id="f-comuna">Comuna</InputLabel>
        <Select
          labelId="f-comuna" label="Comuna" value={valor.comuna}
          onChange={(e) => set({ comuna: e.target.value === "" ? "" : Number(e.target.value) })}
        >
          <MenuItem value="">Todas</MenuItem>
          {comunas.map(([id, nombre]) => (
            <MenuItem key={id} value={id}>{nombre}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 200 }} disabled={items.length === 0}>
        <InputLabel id="f-item">Ítem necesitado</InputLabel>
        <Select
          labelId="f-item" label="Ítem necesitado" value={valor.itemId}
          onChange={(e) => set({ itemId: e.target.value === "" ? "" : Number(e.target.value) })}
        >
          <MenuItem value="">Cualquiera</MenuItem>
          {items.map(([id, nombre]) => (
            <MenuItem key={id} value={id}>{nombre}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 190 }}>
        <InputLabel id="f-prio">Prioridad mínima</InputLabel>
        <Select
          labelId="f-prio" label="Prioridad mínima" value={valor.prioridadMinima}
          onChange={(e) => set({ prioridadMinima: e.target.value as FiltrosTablero["prioridadMinima"] })}
        >
          <MenuItem value="todas">Todas</MenuItem>
          <MenuItem value="medio">Media o superior</MenuItem>
          <MenuItem value="alto">Solo alta</MenuItem>
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 170 }}>
        <InputLabel id="f-orden">Ordenar por</InputLabel>
        <Select
          labelId="f-orden" label="Ordenar por" value={valor.orden}
          onChange={(e) => set({ orden: e.target.value as Orden })}
        >
          <MenuItem value="urgencia">Urgencia</MenuItem>
          <MenuItem value="cercania" disabled={!puedeOrdenarPorCercania}>
            Cercanía
          </MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );
}
