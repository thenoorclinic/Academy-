import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireContext } from "@/lib/context";
import { updateSupplierAction } from "@/app/actions";

export default async function ProveedoresPage() {
  const ctx = await requireContext("invoices:read");
  const suppliers = await db.query.suppliers.findMany({ where: eq(schema.suppliers.clinicId, ctx.clinicId), orderBy: asc(schema.suppliers.name) });
  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold">Proveedores</h1>
        <p className="text-sm text-black/60">
          Se crean solos al importar facturas. Añade cómo aparecen en el banco (alias) y el email de facturación para reclamar facturas.
        </p>
      </header>
      <section className="space-y-3">
        {suppliers.map((s) => (
          <form key={s.id} action={updateSupplierAction} className="card grid gap-3 md:grid-cols-5 md:items-end">
            <input type="hidden" name="supplierId" value={s.id} />
            <div>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-black/50">{s.taxId ?? "sin NIF"}</p>
            </div>
            <label className="text-xs">
              Alias en banco
              <input name="bankAliases" className="input" defaultValue={s.bankAliases.join(", ")} />
            </label>
            <label className="text-xs">
              Dominios email
              <input name="emailDomains" className="input" defaultValue={s.emailDomains.join(", ")} />
            </label>
            <label className="text-xs">
              Email facturación
              <input name="billingEmail" type="email" className="input" defaultValue={s.billingEmail ?? ""} />
            </label>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs">
                <input type="checkbox" name="noInvoiceExpected" defaultChecked={s.noInvoiceExpected} /> No emite factura
              </label>
              <button className="btn-ghost">Guardar</button>
            </div>
          </form>
        ))}
        {suppliers.length === 0 && <p className="card text-black/50">Aún no hay proveedores.</p>}
      </section>
    </>
  );
}
