// src/components/superevent/SuperEventLevelChip.tsx
//
// El nivel de un SuperEvento se lee igual en todas las pantallas. El color sigue la
// escala de gravedad de la tabla de niveles: mayor sobrepasa a la comuna, desastre a
// la región, catástrofe al país.
//
// La "emergencia menor" no aparece acá porque no es un SuperEvento: es una
// Emergencia suelta, local de una comuna.
import { Chip, Tooltip } from "@mui/material";

import { ETIQUETA_NIVEL, NIVELES, type NivelEvento } from "@/services/superEvents.service";

const COLOR_NIVEL: Record<NivelEvento, "warning" | "error" | "secondary"> = {
  mayor: "warning",
  desastre: "error",
  catastrofe: "secondary",
};

export default function SuperEventLevelChip({
  level,
  size = "small",
}: {
  level: NivelEvento;
  size?: "small" | "medium";
}) {
  const definicion = NIVELES.find((n) => n.value === level)?.definicion ?? "";
  return (
    <Tooltip title={definicion}>
      <Chip label={ETIQUETA_NIVEL[level]} color={COLOR_NIVEL[level]} size={size} />
    </Tooltip>
  );
}
