/** Utilidades de importes. Internamente todo va en céntimos (enteros). */

export function toCents(value: number | string): number {
  const n = typeof value === "string" ? parseEuroNumber(value) : value;
  return Math.round(n * 100);
}

/**
 * Interpreta números en formato español o internacional:
 * "1.234,56" → 1234.56 ; "1,234.56" → 1234.56 ; "-45,1" → -45.1
 */
export function parseEuroNumber(input: string): number {
  let s = input.trim().replace(/[€\s]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`Importe no válido: ${input}`);
  return n;
}

const fmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export function formatCents(cents: number): string {
  return fmt.format(cents / 100);
}
