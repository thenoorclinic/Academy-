/** Trimestres fiscales (modelo 303/130): T1 ene-mar, T2 abr-jun, T3 jul-sep, T4 oct-dic. */

export type Quarter = `${number}-T${1 | 2 | 3 | 4}`;

export function quarterOf(isoDate: string): Quarter {
  const [y, m] = isoDate.split("-").map(Number);
  if (!y || !m) throw new Error(`Fecha no válida: ${isoDate}`);
  return `${y}-T${Math.ceil(m / 3) as 1 | 2 | 3 | 4}`;
}

export function quarterRange(q: string): { from: string; to: string } {
  const match = /^(\d{4})-T([1-4])$/.exec(q);
  if (!match) throw new Error(`Trimestre no válido: ${q}`);
  const year = Number(match[1]);
  const n = Number(match[2]);
  const startMonth = (n - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const pad = (v: number) => String(v).padStart(2, "0");
  return { from: `${year}-${pad(startMonth)}-01`, to: `${year}-${pad(endMonth)}-${pad(lastDay)}` };
}

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Nombre de carpeta legible: "2026-T3 (Jul-Sep)". */
export function quarterLabel(q: string): string {
  const n = Number(q.slice(-1));
  return `${q} (${MONTHS[(n - 1) * 3]}-${MONTHS[(n - 1) * 3 + 2]})`;
}

export function currentQuarter(now = new Date()): Quarter {
  return quarterOf(now.toISOString().slice(0, 10));
}

export function previousQuarter(q: string): Quarter {
  const year = Number(q.slice(0, 4));
  const n = Number(q.slice(-1));
  return (n === 1 ? `${year - 1}-T4` : `${year}-T${n - 1}`) as Quarter;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
