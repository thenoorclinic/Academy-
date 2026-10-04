import { sha256 } from "@/lib/crypto";
import { parseEuroNumber } from "@/lib/money";
import type { NormalizedTransaction } from "./types";

/**
 * Importador CSV genérico para extractos descargados desde la banca online.
 * Detecta separador y columnas habituales en bancos españoles:
 *   Fecha | F. Valor | Concepto/Descripción | Importe  (o Cargo / Abono)
 */
export function parseBankCsv(content: string, accountKey: string): NormalizedTransaction[] {
  const rows = content
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (rows.length < 2) return [];
  const delimiter = (rows[0]!.match(/;/g)?.length ?? 0) >= (rows[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";

  // Algunos bancos meten líneas de cabecera informativas: buscamos la fila con "fecha".
  const headerIdx = rows.findIndex((r) => /fecha|date/i.test(r));
  if (headerIdx < 0) throw new Error("No se encuentra la fila de cabecera (columna Fecha)");
  const headers = splitCsv(rows[headerIdx]!, delimiter).map((h) => h.toLowerCase().trim());

  const find = (...patterns: RegExp[]) => headers.findIndex((h) => patterns.some((p) => p.test(h)));
  const iDate = find(/^fecha( operaci[oó]n| contable)?$/, /^f\.? ?operaci/, /^date$/, /fecha/);
  const iValue = find(/valor/);
  const iDesc = find(/concepto/, /descripci/, /detalle/, /description/, /movimiento/);
  const iAmount = find(/^importe/, /^amount/, /^cantidad/);
  const iDebit = find(/cargo/, /debe/, /debit/);
  const iCredit = find(/abono/, /haber/, /credit/);
  if (iDate < 0 || iDesc < 0 || (iAmount < 0 && iDebit < 0)) {
    throw new Error("Formato CSV no reconocido: se necesitan columnas Fecha, Concepto e Importe");
  }

  const counter = new Map<string, number>();
  const out: NormalizedTransaction[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const cells = splitCsv(row, delimiter);
    const dateStr = cells[iDate]?.trim();
    if (!dateStr) continue;
    const bookingDate = parseDate(dateStr);
    if (!bookingDate) continue;
    let amount: number;
    if (iAmount >= 0) amount = parseEuroNumber(cells[iAmount] ?? "0");
    else {
      const debit = cells[iDebit]?.trim() ? Math.abs(parseEuroNumber(cells[iDebit]!)) : 0;
      const credit = iCredit >= 0 && cells[iCredit]?.trim() ? Math.abs(parseEuroNumber(cells[iCredit]!)) : 0;
      amount = credit - debit;
    }
    const description = (cells[iDesc] ?? "").trim();
    const amountCents = Math.round(amount * 100);
    const base = `${accountKey}|${bookingDate}|${amountCents}|${description}`;
    const n = (counter.get(base) ?? 0) + 1;
    counter.set(base, n);
    out.push({
      externalId: `csv_${sha256(`${base}|${n}`).slice(0, 24)}`,
      bookingDate,
      valueDate: iValue >= 0 ? parseDate(cells[iValue] ?? "") ?? undefined : undefined,
      amountCents,
      currency: "EUR",
      description,
    });
  }
  return out;
}

function splitCsv(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}
