import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireContext } from "@/lib/context";
import { formatCents } from "@/lib/money";
import { updateInvoiceStatusAction, uploadInvoiceAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionButton";
import { QuarterPicker, quarterFromParams } from "@/components/QuarterPicker";

export default async function FacturasPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext("invoices:read");
  const quarter = quarterFromParams(await searchParams);
  const invoices = await db.query.invoices.findMany({
    where: and(eq(schema.invoices.clinicId, ctx.clinicId), eq(schema.invoices.quarter, quarter)),
    orderBy: asc(schema.invoices.issueDate),
  });

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Facturas recibidas</h1>
          <QuarterPicker value={quarter} path="/facturas" />
        </div>
        <a className="btn-ghost" href={`/api/export/register?q=${quarter}`}>
          ⬇ Libro registro (Excel)
        </a>
      </header>

      <section className="card">
        <h2 className="mb-2 font-semibold">Subir factura manualmente</h2>
        <p className="mb-3 text-sm text-black/60">Para facturas en papel (haz una foto con el iPhone), por WhatsApp o descargadas de un enlace.</p>
        <ActionForm action={uploadInvoiceAction} submitLabel="Subir y procesar">
          <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,.xml" className="input" required />
        </ActionForm>
      </section>

      <section className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Proveedor</th>
              <th>Nº</th>
              <th className="text-right">Base</th>
              <th className="text-right">IVA</th>
              <th className="text-right">Total</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className={i.status === "rejected" ? "opacity-40" : ""}>
                <td className="whitespace-nowrap">{i.issueDate}</td>
                <td>
                  {i.supplierName}
                  <div className="text-xs text-black/50">{i.supplierTaxId}</div>
                  {i.notes && <div className="text-xs text-amber-700">{i.notes}</div>}
                </td>
                <td>{i.invoiceNumber}</td>
                <td className="text-right">{formatCents(i.netCents)}</td>
                <td className="text-right">{formatCents(i.vatCents)}</td>
                <td className="text-right font-medium">{formatCents(i.totalCents)}</td>
                <td>
                  <span className={`badge ${i.status === "confirmed" ? "bg-emerald-100" : i.status === "rejected" ? "bg-black/10" : "bg-amber-100"}`}>
                    {i.status === "confirmed" ? "OK" : i.status === "rejected" ? "Descartada" : "Revisar"}
                  </span>
                </td>
                <td className="whitespace-nowrap text-xs">
                  {i.driveWebUrl && (
                    <a className="underline" href={i.driveWebUrl} target="_blank" rel="noreferrer">
                      Ver PDF
                    </a>
                  )}
                  {i.status !== "confirmed" && <StatusButton id={i.id} status="confirmed" label="Confirmar" />}
                  {i.status !== "rejected" && <StatusButton id={i.id} status="rejected" label="Descartar" />}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-black/50">
                  No hay facturas en este trimestre todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={updateInvoiceStatusAction} className="ml-2 inline">
      <input type="hidden" name="invoiceId" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="underline">{label}</button>
    </form>
  );
}
