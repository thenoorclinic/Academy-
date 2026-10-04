/**
 * Motor de conciliación factura ↔ banco. Lógica PURA (sin BD) para poder testearla.
 *
 * Detecta:
 *  1. Coincidencias 1:1 (mismo importe, fechas compatibles, proveedor parecido).
 *  2. Un cargo que paga varias facturas del mismo proveedor (agrupado mensual).
 *  3. Una factura pagada en varios cargos (fraccionado).
 *  4. DESALINEAMIENTOS: cargo y factura claramente del mismo proveedor y fecha
 *     pero con importe distinto (p. ej. factura 121,00 € vs cargo 120,00 €).
 *  5. Cargos sin factura y facturas sin pago.
 *  6. Posibles duplicados (misma factura dos veces, o mismo cargo dos veces).
 */

export type RInvoice = {
  id: string;
  supplierId: string | null;
  supplierName: string;
  invoiceNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  totalCents: number; // negativo si es abono
};

export type RTransaction = {
  id: string;
  bookingDate: string;
  amountCents: number; // negativo = cargo
  description: string;
  counterparty: string | null;
  supplierId: string | null;
  noInvoiceExpected: boolean;
};

export type RSupplier = { id: string; name: string; bankAliases: string[]; noInvoiceExpected: boolean };

export type RMatch = { invoiceIds: string[]; transactionIds: string[]; score: number; kind: "1:1" | "1:N" | "N:1" };

export type RMismatch = {
  invoiceId: string;
  transactionId: string;
  invoiceCents: number;
  chargeCents: number;
  differenceCents: number;
  reason: string;
};

export type RDuplicate = { type: "invoice" | "transaction"; ids: string[]; reason: string };

export type ReconcileResult = {
  matches: RMatch[];
  mismatches: RMismatch[];
  chargesWithoutInvoice: string[];
  invoicesWithoutPayment: string[];
  duplicates: RDuplicate[];
  /** Asignación cargo → proveedor detectada por alias (para enriquecer los datos). */
  supplierGuesses: Record<string, string>;
};

export type ReconcileOptions = {
  /** Tolerancia absoluta para considerar importes iguales (céntimos). */
  toleranceCents?: number;
  /** El cargo puede llegar hasta N días ANTES de la fecha de factura (pagos anticipados, tarjeta). */
  daysBefore?: number;
  /** …y hasta N días DESPUÉS del vencimiento (o de la emisión si no hay vencimiento). */
  daysAfter?: number;
  /** Diferencia relativa máxima para reportar desalineamiento en lugar de "sin factura". */
  mismatchMaxRatio?: number;
  /** Matches ya fijados manualmente: se respetan y no se recalculan. */
  locked?: { invoiceId: string; transactionId: string }[];
};

const DAY = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);

const STOPWORDS = new Set([
  "sl", "slu", "sa", "sociedad", "limitada", "spain", "espana", "españa", "iberia", "europe", "the", "de", "del", "la", "el",
  "y", "and", "s", "l", "u", "recibo", "adeudo", "compra", "tarjeta", "pago", "transferencia", "domiciliacion", "cargo",
  "sepa", "core", "ref", "fra", "factura", "concepto", "com", "www", "es",
]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/** Similitud 0..1 entre el nombre del proveedor (y sus alias) y el texto del movimiento. */
export function nameSimilarity(supplierNames: string[], txText: string): number {
  const txTokens = tokens(txText);
  const txJoined = txTokens.join("");
  let best = 0;
  for (const name of supplierNames) {
    const nTokens = tokens(name);
    if (!nTokens.length) continue;
    // Alias exacto contenido en el texto del banco (ej. "ALUMIER" en "RECIBO ALUMIERMD EUROPE").
    const compact = nTokens.join("");
    if (compact.length >= 4 && txJoined.includes(compact)) return 1;
    let hits = 0;
    for (const t of nTokens) {
      if (txTokens.some((x) => x === t || (t.length >= 5 && (x.startsWith(t) || t.startsWith(x)) && x.length >= 4))) hits++;
    }
    best = Math.max(best, hits / nTokens.length);
  }
  return best;
}

function dateScore(inv: RInvoice, txDate: string, before: number, after: number): number {
  const issue = toTime(inv.issueDate);
  const due = toTime(inv.dueDate ?? inv.issueDate);
  const t = toTime(txDate);
  if (t < issue - before * DAY || t > Math.max(due, issue) + after * DAY) return 0;
  // Máxima puntuación entre emisión y vencimiento; decae linealmente fuera.
  if (t >= issue && t <= Math.max(due, issue) + 5 * DAY) return 1;
  const dist = t < issue ? (issue - t) / DAY / before : (t - Math.max(due, issue)) / DAY / after;
  return Math.max(0.2, 1 - dist);
}

export function reconcile(
  invoices: RInvoice[],
  transactions: RTransaction[],
  suppliers: RSupplier[],
  opts: ReconcileOptions = {},
): ReconcileResult {
  const tol = opts.toleranceCents ?? 2;
  const before = opts.daysBefore ?? 20;
  const after = opts.daysAfter ?? 60;
  const mismatchMaxRatio = opts.mismatchMaxRatio ?? 0.25;
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const matches: RMatch[] = [];
  const usedInv = new Set<string>();
  const usedTx = new Set<string>();

  // 0) Matches manuales fijados.
  for (const l of opts.locked ?? []) {
    matches.push({ invoiceIds: [l.invoiceId], transactionIds: [l.transactionId], score: 1, kind: "1:1" });
    usedInv.add(l.invoiceId);
    usedTx.add(l.transactionId);
  }

  // Solo cargos (salidas). Los abonos de proveedores (devoluciones) se emparejan con rectificativas.
  const txText = (t: RTransaction) => `${t.description} ${t.counterparty ?? ""}`;
  const namesFor = (inv: RInvoice) => {
    const s = inv.supplierId ? supplierById.get(inv.supplierId) : undefined;
    return [inv.supplierName, ...(s ? [s.name, ...s.bankAliases] : [])];
  };

  // Proveedor por alias para cada movimiento (enriquecimiento + filtros).
  const supplierGuesses: Record<string, string> = {};
  for (const t of transactions) {
    if (t.supplierId) {
      supplierGuesses[t.id] = t.supplierId;
      continue;
    }
    let bestId: string | undefined;
    let best = 0;
    for (const s of suppliers) {
      const score = nameSimilarity([s.name, ...s.bankAliases], txText(t));
      if (score > best) {
        best = score;
        bestId = s.id;
      }
    }
    if (bestId && best >= 0.99) supplierGuesses[t.id] = bestId;
  }

  const sameSign = (inv: RInvoice, t: RTransaction) =>
    (inv.totalCents >= 0 && t.amountCents < 0) || (inv.totalCents < 0 && t.amountCents > 0);

  type Cand = { inv: RInvoice; tx: RTransaction; score: number; name: number; date: number; diff: number };
  const pairScore = (inv: RInvoice, tx: RTransaction): Cand | null => {
    if (!sameSign(inv, tx)) return null;
    const date = dateScore(inv, tx.bookingDate, before, after);
    if (date === 0) return null;
    const guessed = supplierGuesses[tx.id];
    const name = guessed && inv.supplierId && guessed === inv.supplierId ? 1 : nameSimilarity(namesFor(inv), txText(tx));
    const diff = Math.abs(Math.abs(tx.amountCents) - Math.abs(inv.totalCents));
    return { inv, tx, name, date, diff, score: 0.6 * name + 0.4 * date };
  };

  const openInvoices = () => invoices.filter((i) => !usedInv.has(i.id));
  const openTx = () => transactions.filter((t) => !usedTx.has(t.id) && !t.noInvoiceExpected);

  // 1) 1:1 con importe exacto. Con importe exacto basta con una fecha compatible;
  //    el nombre desempata cuando hay varias facturas del mismo importe.
  const exact: Cand[] = [];
  for (const inv of openInvoices()) {
    for (const tx of openTx()) {
      const c = pairScore(inv, tx);
      if (c && c.diff <= tol) exact.push(c);
    }
  }
  exact.sort((a, b) => b.score - a.score || a.diff - b.diff);
  for (const c of exact) {
    if (usedInv.has(c.inv.id) || usedTx.has(c.tx.id)) continue;
    // Importe exacto pero nombre totalmente distinto: solo aceptamos si no hay ambigüedad.
    if (c.name < 0.3) {
      const competitors = exact.filter(
        (o) => o !== c && !usedInv.has(o.inv.id) && !usedTx.has(o.tx.id) && (o.tx.id === c.tx.id || o.inv.id === c.inv.id),
      );
      if (competitors.length > 0 || c.date < 1) continue;
    }
    matches.push({ invoiceIds: [c.inv.id], transactionIds: [c.tx.id], score: round(c.score), kind: "1:1" });
    usedInv.add(c.inv.id);
    usedTx.add(c.tx.id);
  }

  // 2) Un cargo → varias facturas del mismo proveedor (suma exacta, hasta 6 facturas).
  for (const tx of openTx()) {
    const supplierId = supplierGuesses[tx.id];
    const pool = openInvoices().filter((inv) => {
      const c = pairScore(inv, tx);
      return c && (c.name >= 0.6 || (supplierId && inv.supplierId === supplierId));
    });
    const combo = subsetSum(pool, Math.abs(tx.amountCents), tol, (i) => Math.abs(i.totalCents), 6);
    if (combo && combo.length > 1) {
      matches.push({ invoiceIds: combo.map((i) => i.id), transactionIds: [tx.id], score: 0.9, kind: "1:N" });
      combo.forEach((i) => usedInv.add(i.id));
      usedTx.add(tx.id);
    }
  }

  // 3) Una factura → varios cargos (fraccionado, hasta 6 cargos).
  for (const inv of openInvoices()) {
    const pool = openTx().filter((tx) => {
      const c = pairScore(inv, tx);
      return c && c.name >= 0.6;
    });
    const combo = subsetSum(pool, Math.abs(inv.totalCents), tol, (t) => Math.abs(t.amountCents), 6);
    if (combo && combo.length > 1) {
      matches.push({ invoiceIds: [inv.id], transactionIds: combo.map((t) => t.id), score: 0.85, kind: "N:1" });
      usedInv.add(inv.id);
      combo.forEach((t) => usedTx.add(t.id));
    }
  }

  // 4) Desalineamientos: mismo proveedor y fecha, importe distinto.
  const mismatches: RMismatch[] = [];
  const near: Cand[] = [];
  for (const inv of openInvoices()) {
    for (const tx of openTx()) {
      const c = pairScore(inv, tx);
      if (!c || c.name < 0.6 || c.diff <= tol) continue;
      if (c.diff / Math.max(Math.abs(inv.totalCents), 1) > mismatchMaxRatio) continue;
      near.push(c);
    }
  }
  near.sort((a, b) => b.score - a.score || a.diff - b.diff);
  const mmInv = new Set<string>();
  const mmTx = new Set<string>();
  for (const c of near) {
    if (mmInv.has(c.inv.id) || mmTx.has(c.tx.id)) continue;
    mmInv.add(c.inv.id);
    mmTx.add(c.tx.id);
    const chargeCents = Math.abs(c.tx.amountCents);
    const invoiceCents = Math.abs(c.inv.totalCents);
    mismatches.push({
      invoiceId: c.inv.id,
      transactionId: c.tx.id,
      invoiceCents,
      chargeCents,
      differenceCents: chargeCents - invoiceCents,
      reason: describeDifference(invoiceCents, chargeCents),
    });
  }

  // 5) Pendientes.
  const chargesWithoutInvoice = transactions
    .filter((t) => t.amountCents < 0 && !usedTx.has(t.id) && !mmTx.has(t.id) && !t.noInvoiceExpected)
    .filter((t) => {
      const s = supplierGuesses[t.id] ? supplierById.get(supplierGuesses[t.id]!) : undefined;
      return !s?.noInvoiceExpected;
    })
    .map((t) => t.id);
  const invoicesWithoutPayment = invoices.filter((i) => !usedInv.has(i.id) && !mmInv.has(i.id)).map((i) => i.id);

  return {
    matches,
    mismatches,
    chargesWithoutInvoice,
    invoicesWithoutPayment,
    duplicates: findDuplicates(invoices, transactions),
    supplierGuesses,
  };
}

function describeDifference(invoiceCents: number, chargeCents: number): string {
  const diff = chargeCents - invoiceCents;
  const ratio = Math.abs(diff) / invoiceCents;
  const vatLike = [0.21, 0.1, 0.04].find((r) => Math.abs(chargeCents - Math.round(invoiceCents * (1 + r))) <= 2 || Math.abs(invoiceCents - Math.round(chargeCents * (1 + r))) <= 2);
  if (vatLike) return `La diferencia coincide con un IVA del ${vatLike * 100}%: ¿factura sin IVA o importe base cargado?`;
  if (ratio < 0.04 && diff > 0) return "Cargo ligeramente mayor: posible comisión bancaria o cambio de divisa.";
  if (diff > 0) return "Se ha cobrado más de lo facturado.";
  return "Se ha cobrado menos de lo facturado: ¿pago parcial o descuento no reflejado en la factura?";
}

function findDuplicates(invoices: RInvoice[], transactions: RTransaction[]): RDuplicate[] {
  const out: RDuplicate[] = [];
  const byNumber = new Map<string, string[]>();
  for (const i of invoices) {
    if (!i.invoiceNumber) continue;
    const key = `${i.supplierId ?? i.supplierName.toLowerCase()}|${i.invoiceNumber.replace(/\s/g, "").toUpperCase()}`;
    byNumber.set(key, [...(byNumber.get(key) ?? []), i.id]);
  }
  for (const ids of byNumber.values()) {
    if (ids.length > 1) out.push({ type: "invoice", ids, reason: "Misma factura (proveedor + número) registrada varias veces" });
  }
  const byTx = new Map<string, string[]>();
  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    const key = `${t.bookingDate}|${t.amountCents}|${tokens(t.description).join(" ")}`;
    byTx.set(key, [...(byTx.get(key) ?? []), t.id]);
  }
  for (const ids of byTx.values()) {
    if (ids.length > 1) out.push({ type: "transaction", ids, reason: "Cargo idéntico repetido el mismo día: ¿cobro duplicado?" });
  }
  return out;
}

/** Búsqueda acotada de subconjunto cuya suma ≈ objetivo (n pequeño, poda por importe). */
function subsetSum<T>(items: T[], target: number, tol: number, value: (x: T) => number, maxSize: number): T[] | null {
  const sorted = [...items].filter((x) => value(x) <= target + tol).sort((a, b) => value(b) - value(a)).slice(0, 18);
  let best: T[] | null = null;
  const dfs = (start: number, acc: T[], sum: number) => {
    if (best) return;
    if (Math.abs(sum - target) <= tol && acc.length > 1) {
      best = [...acc];
      return;
    }
    if (acc.length >= maxSize || sum > target + tol) return;
    for (let i = start; i < sorted.length; i++) {
      acc.push(sorted[i]!);
      dfs(i + 1, acc, sum + value(sorted[i]!));
      acc.pop();
      if (best) return;
    }
  };
  dfs(0, [], 0);
  return best;
}

const round = (n: number) => Math.round(n * 100) / 100;
