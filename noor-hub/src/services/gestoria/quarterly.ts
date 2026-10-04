import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatCents } from "@/lib/money";
import { quarterLabel } from "@/lib/quarter";
import { getGoogleClients } from "@/services/google/client";
import { DriveStore } from "@/services/google/drive";
import { buildMime } from "@/services/google/mime";
import { buildQuarterRegister } from "@/services/invoices/register";
import { reconcileQuarter } from "@/services/reconcile/service";

/**
 * FASE 2 — Paquete trimestral para la gestoría.
 * Contenido del email:
 *  - Resumen: nº facturas, base, IVA soportado por tipo, retenciones, total.
 *  - Excel "Libro registro de facturas recibidas" adjunto.
 *  - Enlace a la carpeta de Drive del trimestre (compartida en solo lectura con la gestoría).
 *  - Avisos: cargos sin factura y facturas pendientes de revisar.
 */
export async function buildGestoriaPack(clinicId: string, quarter: string) {
  const clinic = await db.query.clinics.findFirst({ where: eq(schema.clinics.id, clinicId) });
  if (!clinic) throw new Error("Clínica no encontrada");
  const report = await reconcileQuarter(clinicId, quarter);
  const invoices = [...report.invoices.values()];

  const vatByRate = new Map<number, { base: number; vat: number }>();
  for (const inv of invoices) {
    for (const v of inv.vatBreakdown.length ? inv.vatBreakdown : [{ rate: 0, baseCents: inv.netCents, vatCents: inv.vatCents }]) {
      const cur = vatByRate.get(v.rate) ?? { base: 0, vat: 0 };
      cur.base += v.baseCents;
      cur.vat += v.vatCents;
      vatByRate.set(v.rate, cur);
    }
  }
  const sum = (f: (i: (typeof invoices)[number]) => number) => invoices.reduce((s, i) => s + f(i), 0);
  const summary = {
    invoices: invoices.length,
    netCents: sum((i) => i.netCents),
    vatCents: sum((i) => i.vatCents),
    withholdingCents: sum((i) => i.withholdingCents),
    totalCents: sum((i) => i.totalCents),
    needsReview: invoices.filter((i) => i.status === "needs_review").length,
    chargesWithoutInvoice: report.chargesWithoutInvoice.length,
    chargesWithoutInvoiceCents: report.totals.chargesWithoutInvoiceCents,
    mismatches: report.mismatches.length,
  };

  const vatLines = [...vatByRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, v]) => `  · IVA ${rate}%: base ${formatCents(v.base)} — cuota ${formatCents(v.vat)}`)
    .join("\n");

  const warnings = [
    summary.chargesWithoutInvoice
      ? `⚠ Hay ${summary.chargesWithoutInvoice} cargos bancarios (${formatCents(summary.chargesWithoutInvoiceCents)}) cuya factura aún no tenemos; os la haremos llegar en cuanto la recibamos.`
      : null,
    summary.needsReview ? `⚠ ${summary.needsReview} facturas están marcadas para revisión.` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const subject = `${clinic.name} — Facturas recibidas ${quarterLabel(quarter)}`;
  const body = (folderUrl?: string) => `Hola${clinic.settings.gestoriaName ? ` ${clinic.settings.gestoriaName}` : ""},

Os enviamos la documentación de facturas recibidas (compras y gastos) del ${quarterLabel(quarter)} de ${clinic.legalName ?? clinic.name}${clinic.taxId ? ` (${clinic.taxId})` : ""}.

Resumen:
  · Nº de facturas: ${summary.invoices}
  · Base imponible: ${formatCents(summary.netCents)}
  · IVA soportado: ${formatCents(summary.vatCents)}
${vatLines}
  · Retenciones IRPF: ${formatCents(summary.withholdingCents)}
  · Total: ${formatCents(summary.totalCents)}

Adjuntamos el libro registro en Excel.${folderUrl ? `\nTodas las facturas en PDF están en esta carpeta: ${folderUrl}` : ""}
${warnings ? `\n${warnings}\n` : ""}
Un saludo,
${clinic.name}`;

  return { clinic, summary, subject, body };
}

export async function sendGestoriaPack(clinicId: string, quarter: string, userId: string) {
  if (process.env.FEATURE_GESTORIA_EMAIL !== "true") throw new Error("El envío a gestoría (fase 2) no está activado");
  const pack = await buildGestoriaPack(clinicId, quarter);
  const to = pack.clinic.settings.gestoriaEmail;
  if (!to) throw new Error("Configura el email de la gestoría en Ajustes");

  const { gmail, drive } = await getGoogleClients(clinicId);
  const store = new DriveStore(drive, pack.clinic.settings.driveRootFolderName, pack.clinic.settings.driveRootFolderId);
  const folderId = await store.quarterFolder(quarter);
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { type: "user", role: "reader", emailAddress: to },
    sendNotificationEmail: false,
  });
  const { data: folder } = await drive.files.get({ fileId: folderId, fields: "webViewLink" });

  const xlsx = await buildQuarterRegister(clinicId, quarter);
  const raw = buildMime({
    to,
    subject: pack.subject,
    text: pack.body(folder.webViewLink ?? undefined),
    attachments: [
      { filename: `Registro facturas recibidas ${quarter}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: xlsx },
    ],
  });
  const { data } = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  await db.insert(schema.gestoriaSubmissions).values({
    clinicId,
    quarter,
    recipients: to,
    gmailMessageId: data.id,
    summary: pack.summary,
    sentBy: userId,
  });
  return { messageId: data.id, to };
}
