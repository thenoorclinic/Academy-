import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireContext } from "@/lib/context";
import { formatCents } from "@/lib/money";
import { quarterLabel } from "@/lib/quarter";
import { reconcileQuarter } from "@/services/reconcile/service";
import { syncAllAction } from "@/app/actions";
import { ActionButton } from "@/components/ActionButton";
import { QuarterPicker, quarterFromParams } from "@/components/QuarterPicker";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext("invoices:read");
  const quarter = quarterFromParams(await searchParams);
  const [report, google, lastRuns, linkOnly] = await Promise.all([
    reconcileQuarter(ctx.clinicId, quarter),
    db.query.integrations.findFirst({
      where: and(eq(schema.integrations.clinicId, ctx.clinicId), eq(schema.integrations.provider, "google")),
    }),
    db.query.syncRuns.findMany({ where: eq(schema.syncRuns.clinicId, ctx.clinicId), orderBy: desc(schema.syncRuns.startedAt), limit: 5 }),
    db.query.gmailMessages.findMany({
      where: and(eq(schema.gmailMessages.clinicId, ctx.clinicId), eq(schema.gmailMessages.status, "link_only")),
      limit: 5,
      orderBy: desc(schema.gmailMessages.receivedAt),
    }),
  ]);
  const invoices = [...report.invoices.values()];
  const total = invoices.reduce((s, i) => s + i.totalCents, 0);
  const vat = invoices.reduce((s, i) => s + i.vatCents, 0);
  const review = invoices.filter((i) => i.status === "needs_review").length;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{quarterLabel(quarter)}</h1>
          <QuarterPicker value={quarter} path="/" />
        </div>
        {google?.status === "active" ? (
          <ActionButton action={syncAllAction} label="↻ Buscar facturas y conciliar" pendingLabel="Buscando en Gmail, banco y conciliando…" />
        ) : (
          <Link href="/ajustes" className="btn-primary">
            Conectar Gmail y Drive para empezar
          </Link>
        )}
      </header>

      {report.chargesWithoutInvoice.length > 0 && (
        <Link href={`/conciliacion?q=${quarter}`} className="card block border-l-4 border-amber-500">
          <p className="text-lg font-semibold">
            Tienes {report.chargesWithoutInvoice.length} cargos sin factura ({formatCents(report.totals.chargesWithoutInvoiceCents)})
          </p>
          <p className="text-sm text-black/60">Revísalos y reclama las facturas con un clic →</p>
        </Link>
      )}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Facturas" value={String(invoices.length)} hint={review ? `${review} por revisar` : "todas revisadas"} />
        <Kpi label="Gasto total" value={formatCents(total)} />
        <Kpi label="IVA soportado" value={formatCents(vat)} />
        <Kpi
          label="Desalineamientos"
          value={String(report.mismatches.length)}
          hint={`${report.invoicesWithoutPayment.length} facturas sin pago · ${report.duplicates.length} posibles duplicados`}
        />
      </section>

      {linkOnly.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-semibold">Facturas que solo vienen como enlace</h2>
          <p className="mb-3 text-sm text-black/60">Descárgalas y súbelas en Facturas → Subir.</p>
          <ul className="space-y-1 text-sm">
            {linkOnly.map((m) => (
              <li key={m.id}>
                <a className="underline" href={`https://mail.google.com/mail/u/0/#all/${m.messageId}`} target="_blank" rel="noreferrer">
                  {m.subject}
                </a>{" "}
                <span className="text-black/50">— {m.fromAddress}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 font-semibold">Últimas ejecuciones</h2>
        <table className="table">
          <tbody>
            {lastRuns.map((r) => (
              <tr key={r.id}>
                <td>{r.startedAt.toLocaleString("es-ES")}</td>
                <td>{r.kind}</td>
                <td>{r.trigger}</td>
                <td>
                  <span className={`badge ${r.status === "success" ? "bg-emerald-100" : r.status === "running" ? "bg-sky-100" : "bg-red-100"}`}>{r.status}</span>
                </td>
                <td className="text-xs text-black/50">{r.error ?? JSON.stringify(r.stats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-black/50">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-black/50">{hint}</p>}
    </div>
  );
}
