import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptJson } from "@/lib/crypto";
import { addDays, currentQuarter, previousQuarter, quarterRange } from "@/lib/quarter";
import { fetchTransactions } from "./enablebanking";
import type { NormalizedAccount, NormalizedTransaction } from "./types";

/** Inserta movimientos sin duplicar (clave: cuenta + externalId). */
export async function upsertTransactions(clinicId: string, bankAccountId: string, txs: NormalizedTransaction[]) {
  if (!txs.length) return 0;
  let inserted = 0;
  for (let i = 0; i < txs.length; i += 500) {
    const chunk = txs.slice(i, i + 500);
    const res = await db
      .insert(schema.bankTransactions)
      .values(
        chunk.map((t) => ({
          clinicId,
          bankAccountId,
          externalId: t.externalId,
          bookingDate: t.bookingDate,
          valueDate: t.valueDate,
          amountCents: t.amountCents,
          currency: t.currency,
          description: t.description,
          counterparty: t.counterparty,
          raw: t.raw,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.bankTransactions.id });
    inserted += res.length;
  }
  return inserted;
}

export async function ensureBankAccount(clinicId: string, acc: NormalizedAccount, integrationId?: string) {
  const existing = await db.query.bankAccounts.findFirst({
    where: and(eq(schema.bankAccounts.clinicId, clinicId), eq(schema.bankAccounts.externalId, acc.externalId)),
  });
  if (existing) {
    if (integrationId && existing.integrationId !== integrationId) {
      await db.update(schema.bankAccounts).set({ integrationId }).where(eq(schema.bankAccounts.id, existing.id));
    }
    return existing.id;
  }
  const [row] = await db
    .insert(schema.bankAccounts)
    .values({ clinicId, integrationId, externalId: acc.externalId, name: acc.name, ibanMasked: acc.ibanMasked, currency: acc.currency })
    .returning({ id: schema.bankAccounts.id });
  return row!.id;
}

/** Descarga movimientos nuevos de todas las cuentas conectadas por PSD2. */
export async function runBankSync(clinicId: string, opts: { trigger: "button" | "cron" }) {
  const [run] = await db.insert(schema.syncRuns).values({ clinicId, kind: "bank", trigger: opts.trigger }).returning();
  const stats = { accounts: 0, inserted: 0, expired: 0 };
  try {
    const integrations = await db.query.integrations.findMany({
      where: and(eq(schema.integrations.clinicId, clinicId), eq(schema.integrations.provider, "enablebanking")),
    });
    for (const integ of integrations) {
      if (integ.status !== "active") continue;
      if (integ.expiresAt && integ.expiresAt < new Date()) {
        await db.update(schema.integrations).set({ status: "expired" }).where(eq(schema.integrations.id, integ.id));
        stats.expired++;
        continue;
      }
      decryptJson<{ sessionId: string }>(integ.secretEnc); // valida que el secreto es legible
      const accounts = await db.query.bankAccounts.findMany({ where: eq(schema.bankAccounts.integrationId, integ.id) });
      for (const acc of accounts) {
        const [last] = await db
          .select({ d: sql<string | null>`max(${schema.bankTransactions.bookingDate})::text` })
          .from(schema.bankTransactions)
          .where(eq(schema.bankTransactions.bankAccountId, acc.id));
        const from = last?.d ? addDays(last.d, -5) : quarterRange(previousQuarter(currentQuarter())).from;
        const txs = await fetchTransactions(acc.externalId!, from);
        stats.inserted += await upsertTransactions(clinicId, acc.id, txs);
        stats.accounts++;
        await db.update(schema.bankAccounts).set({ lastSyncedAt: new Date() }).where(eq(schema.bankAccounts.id, acc.id));
      }
    }
    await db.update(schema.syncRuns).set({ status: "success", stats, finishedAt: new Date() }).where(eq(schema.syncRuns.id, run!.id));
    return stats;
  } catch (err) {
    await db
      .update(schema.syncRuns)
      .set({ status: "error", stats, error: err instanceof Error ? err.message : String(err), finishedAt: new Date() })
      .where(eq(schema.syncRuns.id, run!.id));
    throw err;
  }
}
