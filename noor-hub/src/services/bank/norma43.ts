import { sha256 } from "@/lib/crypto";
import type { NormalizedAccount, NormalizedTransaction } from "./types";

/**
 * Parser del formato AEB Norma 43 (Cuaderno 43): el extracto estándar que
 * exportan todos los bancos españoles (Santander, BBVA, CaixaBank, Sabadell…).
 * Sirve como alternativa sin API si el banco no está disponible vía PSD2.
 */
export function parseNorma43(content: string): { account: NormalizedAccount; transactions: NormalizedTransaction[] }[] {
  const lines = content.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const result: { account: NormalizedAccount; transactions: NormalizedTransaction[] }[] = [];
  let current: (typeof result)[number] | undefined;
  let last: NormalizedTransaction | undefined;

  for (const raw of lines) {
    const line = raw.padEnd(80, " ");
    const code = line.slice(0, 2);
    if (code === "11") {
      const bank = line.slice(2, 6);
      const branch = line.slice(6, 10);
      const number = line.slice(10, 20);
      const currency = line.slice(47, 50) === "978" ? "EUR" : line.slice(47, 50);
      current = {
        account: {
          externalId: `${bank}${branch}${number}`,
          name: line.slice(51, 77).trim() || `Cuenta ${bank} ****${number.slice(-4)}`,
          ibanMasked: `**** ${bank} ${branch} ****${number.slice(-4)}`,
          currency,
        },
        transactions: [],
      };
      result.push(current);
    } else if (code === "22" && current) {
      const opDate = yymmdd(line.slice(10, 16));
      const valueDate = yymmdd(line.slice(16, 22));
      const sign = line.slice(27, 28) === "1" ? -1 : 1;
      const amountCents = sign * Number(line.slice(28, 42));
      const doc = line.slice(42, 52).trim();
      const ref1 = line.slice(52, 64).trim();
      const ref2 = line.slice(64, 80).trim();
      last = {
        externalId: "",
        bookingDate: opDate,
        valueDate,
        amountCents,
        currency: current.account.currency,
        description: [ref2, ref1].filter(Boolean).join(" "),
        raw: { commonConcept: line.slice(22, 24), ownConcept: line.slice(24, 27), doc, ref1, ref2 },
      };
      current.transactions.push(last);
    } else if (code === "23" && last) {
      const extra = `${line.slice(4, 42).trim()} ${line.slice(42, 80).trim()}`.trim();
      if (extra) last.description = `${last.description} ${extra}`.trim();
    }
  }

  // Id estable: hash de cuenta + datos del movimiento + ordinal (dos cargos idénticos el mismo día son posibles).
  for (const acc of result) {
    const counter = new Map<string, number>();
    for (const t of acc.transactions) {
      const base = `${acc.account.externalId}|${t.bookingDate}|${t.amountCents}|${t.description}`;
      const n = (counter.get(base) ?? 0) + 1;
      counter.set(base, n);
      t.externalId = `n43_${sha256(`${base}|${n}`).slice(0, 24)}`;
    }
  }
  return result;
}

function yymmdd(s: string): string {
  const yy = Number(s.slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${year}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}
