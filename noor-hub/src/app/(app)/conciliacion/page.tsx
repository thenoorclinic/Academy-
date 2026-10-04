import { requireContext } from "@/lib/context";
import { formatCents } from "@/lib/money";
import { reconcileQuarter } from "@/services/reconcile/service";
import { manualMatchAction, markNoInvoiceAction, reconcileAction } from "@/app/actions";
import { ActionButton } from "@/components/ActionButton";
import { ClaimButton } from "@/components/ClaimButton";
import { QuarterPicker, quarterFromParams } from "@/components/QuarterPicker";

export default async function ConciliacionPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext("bank:read");
  const quarter = quarterFromParams(await searchParams);
  const r = await reconcileQuarter(ctx.clinicId, quarter);
  const tx = (id: string) => r.transactions.get(id)!;
  const inv = (id: string) => r.invoices.get(id)!;
  const unpaid = r.invoicesWithoutPayment.map(inv);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Conciliación</h1>
          <QuarterPicker value={quarter} path="/conciliacion" />
        </div>
        <ActionButton action={reconcileAction.bind(null, quarter)} label="Recalcular conciliación" variant="ghost" />
      </header>

      <section className="card">
        <h2 className="text-lg font-semibold">
          Tienes {r.chargesWithoutInvoice.length} cargos sin factura · {formatCents(r.totals.chargesWithoutInvoiceCents)}
        </h2>
        <table className="table mt-3">
          <tbody>
            {r.chargesWithoutInvoice.map((id) => {
              const t = tx(id);
              return (
                <tr key={id}>
                  <td className="whitespace-nowrap">{t.bookingDate}</td>
                  <td>{t.description}</td>
                  <td className="whitespace-nowrap text-right font-medium">{formatCents(t.amountCents)}</td>
                  <td className="space-y-1 text-right">
                    <ClaimButton transactionId={id} />
                    <form action={markNoInvoiceAction} className="flex justify-end gap-1">
                      <input type="hidden" name="transactionId" value={id} />
                      <select name="reason" className="input !w-auto !py-1 text-xs">
                        <option>Impuestos / Seguridad Social</option>
                        <option>Nóminas</option>
                        <option>Traspaso entre cuentas</option>
                        <option>Préstamo / leasing (cuota)</option>
                        <option>Comisión bancaria</option>
                        <option>Otro: no requiere factura</option>
                      </select>
                      <button className="btn-ghost !px-2 !py-1 text-xs">No requiere</button>
                    </form>
                    {unpaid.length > 0 && (
                      <form action={manualMatchAction} className="flex justify-end gap-1">
                        <input type="hidden" name="transactionId" value={id} />
                        <select name="invoiceId" className="input !w-auto !py-1 text-xs">
                          {unpaid.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.supplierName} · {i.issueDate} · {formatCents(i.totalCents)}
                            </option>
                          ))}
                        </select>
                        <button className="btn-ghost !px-2 !py-1 text-xs">Vincular</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">Desalineamientos factura ↔ pago ({r.mismatches.length})</h2>
        <table className="table mt-3">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th className="text-right">Factura</th>
              <th className="text-right">Cargo</th>
              <th className="text-right">Diferencia</th>
              <th>Posible causa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {r.mismatches.map((m) => (
              <tr key={`${m.invoiceId}-${m.transactionId}`}>
                <td>
                  {inv(m.invoiceId).supplierName}
                  <div className="text-xs text-black/50">
                    Factura {inv(m.invoiceId).issueDate} · Cargo {tx(m.transactionId).bookingDate}
                  </div>
                </td>
                <td className="text-right">{formatCents(m.invoiceCents)}</td>
                <td className="text-right">{formatCents(m.chargeCents)}</td>
                <td className="text-right font-medium text-red-700">{formatCents(m.differenceCents)}</td>
                <td className="text-xs">{m.reason}</td>
                <td>
                  <form action={manualMatchAction}>
                    <input type="hidden" name="invoiceId" value={m.invoiceId} />
                    <input type="hidden" name="transactionId" value={m.transactionId} />
                    <button className="btn-ghost !px-2 !py-1 text-xs">Aceptar igualmente</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold">Facturas sin pago detectado ({unpaid.length})</h2>
          <p className="mb-2 text-xs text-black/50">Pendientes de pago, o pagadas en efectivo / con otra cuenta o tarjeta.</p>
          <ul className="space-y-1 text-sm">
            {unpaid.map((i) => (
              <li key={i.id}>
                {i.issueDate} · {i.supplierName} · <b>{formatCents(i.totalCents)}</b>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2 className="font-semibold">Posibles duplicados ({r.duplicates.length})</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {r.duplicates.map((d, idx) => (
              <li key={idx}>
                {d.reason}:{" "}
                {d.type === "invoice"
                  ? d.ids.map((id) => `${inv(id).supplierName} ${inv(id).invoiceNumber}`).join(", ")
                  : d.ids.map((id) => `${tx(id).bookingDate} ${formatCents(tx(id).amountCents)}`).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold">Conciliados ({r.matches.length})</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {r.matches.map((m, idx) => (
            <li key={idx}>
              <span className="badge mr-2 bg-emerald-100">{m.kind}</span>
              {m.invoiceIds.map((id) => `${inv(id)?.supplierName ?? "—"} ${formatCents(inv(id)?.totalCents ?? 0)}`).join(" + ")} ⇄{" "}
              {m.transactionIds.map((id) => `${tx(id)?.bookingDate ?? ""} ${formatCents(tx(id)?.amountCents ?? 0)}`).join(" + ")}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
