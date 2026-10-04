import { currentQuarter, previousQuarter } from "@/lib/quarter";
import { runBankSync } from "./bank/sync";
import { runGmailSync } from "./invoices/ingest";
import { runReconcile } from "./reconcile/service";

/**
 * EL BOTÓN: Gmail → Drive/BD → Banco → Conciliación.
 * Cada paso es independiente: si falla uno (p. ej. el banco pide renovar
 * consentimiento) los demás siguen y el resultado lo indica.
 */
export async function runFullSync(clinicId: string, trigger: "button" | "cron") {
  const out: {
    gmail?: Awaited<ReturnType<typeof runGmailSync>>;
    bank?: Awaited<ReturnType<typeof runBankSync>>;
    reconcile?: Record<string, { chargesWithoutInvoice: number; mismatches: number; invoicesWithoutPayment: number }>;
    errors: string[];
  } = { errors: [] };

  try {
    out.gmail = await runGmailSync(clinicId, { trigger, maxDocuments: trigger === "cron" ? 60 : 25 });
  } catch (e) {
    out.errors.push(`Gmail: ${msg(e)}`);
  }
  try {
    out.bank = await runBankSync(clinicId, { trigger });
  } catch (e) {
    out.errors.push(`Banco: ${msg(e)}`);
  }
  // Se concilian el trimestre actual y el anterior (hasta que la gestoría lo cierre).
  out.reconcile = {};
  for (const q of [currentQuarter(), previousQuarter(currentQuarter())]) {
    try {
      const r = await runReconcile(clinicId, q, trigger);
      out.reconcile[q] = {
        chargesWithoutInvoice: r.chargesWithoutInvoice.length,
        mismatches: r.mismatches.length,
        invoicesWithoutPayment: r.invoicesWithoutPayment.length,
      };
    } catch (e) {
      out.errors.push(`Conciliación ${q}: ${msg(e)}`);
    }
  }
  return out;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
