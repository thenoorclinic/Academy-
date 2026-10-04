import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireContext } from "@/lib/context";
import { formatCents } from "@/lib/money";
import { previousQuarter, currentQuarter } from "@/lib/quarter";
import { buildGestoriaPack } from "@/services/gestoria/quarterly";
import { sendGestoriaAction } from "@/app/actions";
import { ActionButton } from "@/components/ActionButton";
import { QuarterPicker } from "@/components/QuarterPicker";

export default async function GestoriaPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext("invoices:read");
  const sp = await searchParams;
  // Por defecto, el trimestre que toca declarar: el anterior al actual.
  const quarter = sp.q && /^\d{4}-T[1-4]$/.test(sp.q) ? sp.q : previousQuarter(currentQuarter());
  const pack = await buildGestoriaPack(ctx.clinicId, quarter);
  const sent = await db.query.gestoriaSubmissions.findMany({
    where: eq(schema.gestoriaSubmissions.clinicId, ctx.clinicId),
    orderBy: desc(schema.gestoriaSubmissions.sentAt),
    limit: 8,
  });
  const enabled = process.env.FEATURE_GESTORIA_EMAIL === "true";

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Envío trimestral a la gestoría</h1>
          <QuarterPicker value={quarter} path="/gestoria" />
        </div>
        {enabled ? (
          <ActionButton action={sendGestoriaAction.bind(null, quarter)} label={`Enviar ${quarter} a la gestoría`} pendingLabel="Enviando…" />
        ) : (
          <span className="badge bg-black/5">Fase 2 · activar con FEATURE_GESTORIA_EMAIL=true</span>
        )}
      </header>

      {pack.summary.chargesWithoutInvoice > 0 && (
        <p className="card border-l-4 border-amber-500 text-sm">
          Antes de enviar: faltan {pack.summary.chargesWithoutInvoice} facturas ({formatCents(pack.summary.chargesWithoutInvoiceCents)}). El email lo indicará.
        </p>
      )}

      <section className="card">
        <p className="mb-1 text-xs uppercase text-black/50">Para: {pack.clinic.settings.gestoriaEmail ?? "— configura el email en Ajustes —"}</p>
        <p className="mb-3 font-medium">{pack.subject}</p>
        <pre className="whitespace-pre-wrap font-sans text-sm text-black/80">{pack.body("[enlace a la carpeta de Drive del trimestre]")}</pre>
        <p className="mt-3 text-xs text-black/50">Adjunto: Registro facturas recibidas {quarter}.xlsx</p>
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">Histórico de envíos</h2>
        <ul className="text-sm">
          {sent.map((s) => (
            <li key={s.id}>
              {s.quarter} → {s.recipients} · {s.sentAt.toLocaleString("es-ES")}
            </li>
          ))}
          {sent.length === 0 && <li className="text-black/50">Ninguno todavía.</li>}
        </ul>
      </section>
    </>
  );
}
