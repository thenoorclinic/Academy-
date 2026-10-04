import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, quarterRange } from "@/lib/quarter";
import { reconcile, type ReconcileResult } from "./engine";

export type ReconcileReport = ReconcileResult & {
  quarter: string;
  invoices: Map<string, typeof schema.invoices.$inferSelect>;
  transactions: Map<string, typeof schema.bankTransactions.$inferSelect>;
  totals: { chargesWithoutInvoiceCents: number; invoicesWithoutPaymentCents: number };
};

/**
 * Concilia un trimestre. Se amplía la ventana de movimientos ±60 días para
 * capturar pagos anticipados o con vencimiento posterior al cierre del trimestre.
 * Los matches automáticos se recalculan; los manuales se respetan.
 */
export async function reconcileQuarter(clinicId: string, quarter: string, opts: { persist?: boolean } = {}): Promise<ReconcileReport> {
  const { from, to } = quarterRange(quarter);
  const [invoices, transactions, suppliers, manual] = await Promise.all([
    db.query.invoices.findMany({
      where: and(eq(schema.invoices.clinicId, clinicId), eq(schema.invoices.quarter, quarter), ne(schema.invoices.status, "rejected")),
    }),
    db.query.bankTransactions.findMany({
      where: and(
        eq(schema.bankTransactions.clinicId, clinicId),
        gte(schema.bankTransactions.bookingDate, addDays(from, -30)),
        lte(schema.bankTransactions.bookingDate, addDays(to, 60)),
      ),
    }),
    db.query.suppliers.findMany({ where: eq(schema.suppliers.clinicId, clinicId) }),
    db.query.reconciliationMatches.findMany({
      where: and(eq(schema.reconciliationMatches.clinicId, clinicId), eq(schema.reconciliationMatches.method, "manual")),
    }),
  ]);

  // Movimientos ya conciliados con facturas de OTROS trimestres no deben contar como "sin factura".
  const otherMatches = transactions.length
    ? await db
        .select({ transactionId: schema.reconciliationMatches.transactionId, invoiceId: schema.reconciliationMatches.invoiceId })
        .from(schema.reconciliationMatches)
        .innerJoin(schema.invoices, eq(schema.invoices.id, schema.reconciliationMatches.invoiceId))
        .where(
          and(
            inArray(
              schema.reconciliationMatches.transactionId,
              transactions.map((t) => t.id),
            ),
            ne(schema.invoices.quarter, quarter),
          ),
        )
    : [];
  const takenElsewhere = new Set(otherMatches.map((m) => m.transactionId));

  // Solo cargos cuya fecha cae en el trimestre cuentan como "sin factura"; el resto sirve de candidato.
  const candidateTx = transactions.filter((t) => !takenElsewhere.has(t.id));
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const result = reconcile(
    invoices.map((i) => ({
      id: i.id,
      supplierId: i.supplierId,
      supplierName: i.supplierName,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      totalCents: i.totalCents,
    })),
    candidateTx.map((t) => ({
      id: t.id,
      bookingDate: t.bookingDate,
      amountCents: t.amountCents,
      description: t.description,
      counterparty: t.counterparty,
      supplierId: t.supplierId,
      noInvoiceExpected: t.noInvoiceExpected,
    })),
    suppliers,
    { locked: manual.filter((m) => invoiceIds.has(m.invoiceId)).map((m) => ({ invoiceId: m.invoiceId, transactionId: m.transactionId })) },
  );

  const txById = new Map(transactions.map((t) => [t.id, t]));
  result.chargesWithoutInvoice = result.chargesWithoutInvoice.filter((id) => {
    const d = txById.get(id)!.bookingDate;
    return d >= from && d <= to;
  });

  if (opts.persist) {
    await db.transaction(async (trx) => {
      if (invoices.length) {
        await trx
          .delete(schema.reconciliationMatches)
          .where(
            and(
              eq(schema.reconciliationMatches.clinicId, clinicId),
              eq(schema.reconciliationMatches.method, "auto"),
              inArray(schema.reconciliationMatches.invoiceId, [...invoiceIds]),
            ),
          );
      }
      const rows = result.matches.flatMap((m) =>
        m.invoiceIds.flatMap((invoiceId) =>
          m.transactionIds.map((transactionId) => ({ clinicId, invoiceId, transactionId, method: "auto" as const, score: m.score })),
        ),
      );
      if (rows.length) await trx.insert(schema.reconciliationMatches).values(rows).onConflictDoNothing();
      // Guardamos el proveedor detectado en cada movimiento (mejora futuras conciliaciones).
      for (const [txId, supplierId] of Object.entries(result.supplierGuesses)) {
        if (!txById.get(txId)?.supplierId) {
          await trx.update(schema.bankTransactions).set({ supplierId }).where(eq(schema.bankTransactions.id, txId));
        }
      }
    });
  }

  const invMap = new Map(invoices.map((i) => [i.id, i]));
  return {
    ...result,
    quarter,
    invoices: invMap,
    transactions: txById,
    totals: {
      chargesWithoutInvoiceCents: result.chargesWithoutInvoice.reduce((s, id) => s + Math.abs(txById.get(id)!.amountCents), 0),
      invoicesWithoutPaymentCents: result.invoicesWithoutPayment.reduce((s, id) => s + invMap.get(id)!.totalCents, 0),
    },
  };
}

export async function runReconcile(clinicId: string, quarter: string, trigger: "button" | "cron") {
  const [run] = await db.insert(schema.syncRuns).values({ clinicId, kind: "reconcile", trigger }).returning();
  try {
    const report = await reconcileQuarter(clinicId, quarter, { persist: true });
    const stats = {
      quarter,
      matches: report.matches.length,
      mismatches: report.mismatches.length,
      chargesWithoutInvoice: report.chargesWithoutInvoice.length,
      invoicesWithoutPayment: report.invoicesWithoutPayment.length,
      duplicates: report.duplicates.length,
    };
    await db.update(schema.syncRuns).set({ status: "success", stats, finishedAt: new Date() }).where(eq(schema.syncRuns.id, run!.id));
    return report;
  } catch (err) {
    await db
      .update(schema.syncRuns)
      .set({ status: "error", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() })
      .where(eq(schema.syncRuns.id, run!.id));
    throw err;
  }
}
