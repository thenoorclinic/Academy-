import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireContext } from "@/lib/context";
import { formatCents } from "@/lib/money";
import { quarterRange } from "@/lib/quarter";
import { importStatementAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionButton";
import { QuarterPicker, quarterFromParams } from "@/components/QuarterPicker";

export default async function BancoPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext("bank:read");
  const quarter = quarterFromParams(await searchParams);
  const { from, to } = quarterRange(quarter);
  const [accounts, txs, matches] = await Promise.all([
    db.query.bankAccounts.findMany({ where: eq(schema.bankAccounts.clinicId, ctx.clinicId) }),
    db.query.bankTransactions.findMany({
      where: and(
        eq(schema.bankTransactions.clinicId, ctx.clinicId),
        gte(schema.bankTransactions.bookingDate, from),
        lte(schema.bankTransactions.bookingDate, to),
      ),
      orderBy: desc(schema.bankTransactions.bookingDate),
    }),
    db.query.reconciliationMatches.findMany({ where: eq(schema.reconciliationMatches.clinicId, ctx.clinicId), columns: { transactionId: true } }),
  ]);
  const matched = new Set(matches.map((m) => m.transactionId));

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold">Banco</h1>
        <QuarterPicker value={quarter} path="/banco" />
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 font-semibold">Cuentas</h2>
          <ul className="space-y-1 text-sm">
            {accounts.map((a) => (
              <li key={a.id}>
                {a.name} <span className="text-black/50">{a.ibanMasked}</span>{" "}
                <span className="text-xs text-black/40">{a.lastSyncedAt ? `sync ${a.lastSyncedAt.toLocaleString("es-ES")}` : a.integrationId ? "" : "(importación manual)"}</span>
              </li>
            ))}
            {accounts.length === 0 && <li className="text-black/50">Sin cuentas. Conecta tu banco en Ajustes o importa un extracto.</li>}
          </ul>
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold">Importar extracto</h2>
          <p className="mb-3 text-sm text-black/60">Norma 43 (recomendado) o CSV descargado de tu banca online.</p>
          <ActionForm action={importStatementAction} submitLabel="Importar">
            <input type="file" name="file" accept=".n43,.txt,.csv,.aeb,.q43" className="input" required />
            <input name="accountName" placeholder="Nombre de la cuenta (solo CSV)" className="input" />
          </ActionForm>
        </div>
      </section>

      <section className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th className="text-right">Importe</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap">{t.bookingDate}</td>
                <td>
                  {t.description}
                  {t.counterparty && <div className="text-xs text-black/50">{t.counterparty}</div>}
                </td>
                <td className={`whitespace-nowrap text-right ${t.amountCents < 0 ? "" : "text-emerald-700"}`}>{formatCents(t.amountCents)}</td>
                <td>
                  {t.amountCents >= 0 ? (
                    <span className="badge bg-black/5">Ingreso</span>
                  ) : matched.has(t.id) ? (
                    <span className="badge bg-emerald-100">Con factura</span>
                  ) : t.noInvoiceExpected ? (
                    <span className="badge bg-black/5">{t.noInvoiceReason ?? "Sin factura (OK)"}</span>
                  ) : (
                    <span className="badge bg-amber-100">Sin factura</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
