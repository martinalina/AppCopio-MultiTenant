// src/components/emergency/sharedCenterUi.ts
//
// Vocabulario visual compartido por las dos vistas del tablero intercomunal, para
// que un centro se lea igual en la tarjeta que en el pin del mapa.
import type { NivelUrgencia } from "@/services/crossSupport.service";

export const COLOR_PRIORIDAD: Record<string, "error" | "warning" | "default"> = {
  alto: "error",
  medio: "warning",
  bajo: "default",
};

/** Color del pin según la urgencia máxima declarada por el centro. */
export const COLOR_URGENCIA: Record<NivelUrgencia, string> = {
  alto: "#d32f2f",
  medio: "#ed6c02",
  bajo: "#0288d1",
  ninguna: "#9e9e9e",
};

export const ETIQUETA_URGENCIA: Record<NivelUrgencia, string> = {
  alto: "Necesidad alta",
  medio: "Necesidad media",
  bajo: "Necesidad baja",
  ninguna: "Sin necesidades declaradas",
};
