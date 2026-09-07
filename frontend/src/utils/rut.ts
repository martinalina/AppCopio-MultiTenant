// src/utils/rut.ts
//
// Utilidades de RUT chileno. Vivían dentro de UserUpsertModal con una nota que decía
// "mueve a @/utils/rut si lo reutilizas"; ahora las usan también los formularios de
// administrador de municipalidad, así que se centralizan acá.

/** Deja solo dígitos y K, en mayúscula. */
export const cleanRut = (v: string) => v.replace(/[^0-9kK]/g, "").toUpperCase();

/** Formatea a 12.345.678-9 mientras se escribe. */
export const formatRut = (v: string) => {
  const s = cleanRut(v);
  if (s.length <= 1) return s;
  const body = s.slice(0, -1);
  const dv = s.slice(-1);
  const bodyWithDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${bodyWithDots}-${dv}`;
};

/** Dígito verificador (módulo 11) del cuerpo del RUT. */
export const computeDV = (bodyDigits: string) => {
  let sum = 0;
  let mul = 2;
  for (let i = bodyDigits.length - 1; i >= 0; i--) {
    sum += parseInt(bodyDigits[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
};

/** Valida el dígito verificador. Acepta el RUT con o sin formato. */
export const isValidRut = (rutFormattedOrNot: string) => {
  const s = cleanRut(rutFormattedOrNot);
  if (s.length < 2) return false;
  const body = s.slice(0, -1);
  const dv = s.slice(-1);
  return computeDV(body) === dv.toUpperCase();
};
