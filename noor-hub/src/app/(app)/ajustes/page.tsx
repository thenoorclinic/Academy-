import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getClinic, requireContext } from "@/lib/context";
import { updateSettingsAction } from "@/app/actions";

const BANKS = ["Banco Santander", "BBVA", "CaixaBank", "Banco Sabadell", "Bankinter", "ING", "Unicaja", "Kutxabank", "Abanca", "Openbank", "Revolut"];

export default async function AjustesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const ctx = await requireContext("integrations:manage");
  const sp = await searchParams;
  const clinic = await getClinic(ctx.clinicId);
  const integrations = await db.query.integrations.findMany({ where: eq(schema.integrations.clinicId, ctx.clinicId) });
  const google = integrations.find((i) => i.provider === "google");
  const banks = integrations.filter((i) => i.provider === "enablebanking");

  return (
    <>
      <h1 className="text-2xl font-semibold">Ajustes</h1>
      {sp.ok && <p className="card bg-emerald-50">Conexión realizada correctamente.</p>}
      {sp.error && <p className="card bg-red-50">No se pudo completar la conexión ({sp.error}). Inténtalo de nuevo.</p>}

      <section className="card space-y-3">
        <h2 className="font-semibold">1 · Gmail y Google Drive</h2>
        <p className="text-sm text-black/60">
          Conecta el buzón donde recibes las facturas (p. ej. acostamedicalconsulting@gmail.com). La app solo puede <b>leer</b> emails, crear{" "}
          <b>borradores</b> y gestionar los archivos que ella misma crea en Drive.
        </p>
        {google ? (
          <p className="text-sm">
            Conectado: <b>{google.externalAccount}</b>{" "}
            <span className={`badge ${google.status === "active" ? "bg-emerald-100" : "bg-red-100"}`}>{google.status}</span>
          </p>
        ) : null}
        <a href="/api/integrations/google/connect" className="btn-primary">
          {google ? "Reconectar Google" : "Conectar Google"}
        </a>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">2 · Banco (PSD2, solo lectura)</h2>
        <p className="text-sm text-black/60">
          Autorizas el acceso en la web de tu banco. Por normativa PSD2 el permiso caduca cada 180 días como máximo y habrá que renovarlo.
          Alternativa sin conexión: importa el extracto Norma 43 en la sección Banco.
        </p>
        <ul className="text-sm">
          {banks.map((b) => (
            <li key={b.id}>
              {b.externalAccount} <span className="badge bg-black/5">{b.status}</span>{" "}
              {b.expiresAt && <span className="text-xs text-black/50">caduca {b.expiresAt.toLocaleDateString("es-ES")}</span>}
            </li>
          ))}
        </ul>
        <form action="/api/integrations/bank/connect" method="get" className="flex gap-2">
          <select name="bank" className="input !w-auto">
            {BANKS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <button className="btn-primary">Conectar banco</button>
        </form>
      </section>

      <form action={updateSettingsAction} className="card grid gap-3 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">3 · Datos de la clínica y gestoría</h2>
        <label className="text-xs">
          Razón social
          <input name="legalName" className="input" defaultValue={clinic.legalName ?? ""} />
        </label>
        <label className="text-xs">
          CIF / NIF
          <input name="taxId" className="input" defaultValue={clinic.taxId ?? ""} />
        </label>
        <label className="text-xs">
          Email de la gestoría
          <input name="gestoriaEmail" type="email" className="input" defaultValue={clinic.settings.gestoriaEmail ?? ""} />
        </label>
        <label className="text-xs">
          Nombre de contacto en la gestoría
          <input name="gestoriaName" className="input" defaultValue={clinic.settings.gestoriaName ?? ""} />
        </label>
        <label className="text-xs">
          Buscar facturas desde (primera vez)
          <input name="syncFrom" type="date" className="input" defaultValue={clinic.settings.syncFrom ?? ""} />
        </label>
        <label className="text-xs">
          Búsqueda Gmail adicional (avanzado)
          <input name="extraGmailQuery" className="input" placeholder='label:facturas OR from:pedidos@proveedor.com' defaultValue={clinic.settings.extraGmailQuery ?? ""} />
        </label>
        <div className="md:col-span-2">
          <button className="btn-primary">Guardar</button>
        </div>
      </form>
    </>
  );
}
