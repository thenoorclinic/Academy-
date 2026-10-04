import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { sha256 } from "@/lib/crypto";
import { toCents } from "@/lib/money";
import { addDays, currentQuarter, previousQuarter, quarterOf, quarterRange } from "@/lib/quarter";
import { getGoogleClients, isInvalidGrant } from "@/services/google/client";
import { DriveStore, invoiceFileName } from "@/services/google/drive";
import { buildInvoiceQuery, isCandidateAttachment, looksLikeInvoiceLink } from "@/services/google/gmail-query";
import { collectParts, decodeBase64Url, header, isPublicDomain, senderDomain } from "@/services/google/mime";
import { extractInvoice, normalizeTaxId, type Extraction, type ExtractInput } from "./extract";
import { writeQuarterRegister } from "./register";

export type GmailSyncStats = {
  messagesScanned: number;
  invoicesImported: number;
  duplicates: number;
  notInvoices: number;
  linkOnly: number;
  errors: number;
  needsReview: number;
  remaining: boolean;
  quarters: string[];
};

const REVIEW_THRESHOLD = 0.85;

/**
 * Escanea el buzón de compras, importa facturas nuevas y las archiva en Drive.
 * Idempotente: cada email y cada archivo (hash SHA-256) se procesa una sola vez.
 * Procesa por lotes (`maxDocuments`) para no superar el tiempo de ejecución
 * del servidor; si quedan pendientes, `remaining=true` y el siguiente clic o el
 * cron continúan donde se quedó.
 */
export async function runGmailSync(clinicId: string, opts: { trigger: "button" | "cron"; maxDocuments?: number }) {
  const maxDocuments = opts.maxDocuments ?? 25;
  const [run] = await db.insert(schema.syncRuns).values({ clinicId, kind: "gmail", trigger: opts.trigger }).returning();
  const stats: GmailSyncStats = {
    messagesScanned: 0,
    invoicesImported: 0,
    duplicates: 0,
    notInvoices: 0,
    linkOnly: 0,
    errors: 0,
    needsReview: 0,
    remaining: false,
    quarters: [],
  };
  const touchedQuarters = new Set<string>();

  let google: Awaited<ReturnType<typeof getGoogleClients>>;
  try {
    google = await getGoogleClients(clinicId);
  } catch (err) {
    await finish(run!.id, "error", stats, err);
    throw err;
  }

  try {
    const clinic = await db.query.clinics.findFirst({ where: eq(schema.clinics.id, clinicId) });
    const settings = clinic?.settings ?? {};
    const suppliers = await db.query.suppliers.findMany({ where: eq(schema.suppliers.clinicId, clinicId) });
    const store = new DriveStore(google.drive, settings.driveRootFolderName, settings.driveRootFolderId);

    const after = await syncStartDate(clinicId, settings.syncFrom);
    const q = buildInvoiceQuery({
      after,
      supplierDomains: suppliers.flatMap((s) => s.emailDomains),
      extra: settings.extraGmailQuery,
    });

    let pageToken: string | undefined;
    let processedDocs = 0;
    outer: do {
      const list = await google.gmail.users.messages.list({ userId: "me", q, maxResults: 50, pageToken });
      const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
      pageToken = list.data.nextPageToken ?? undefined;
      if (ids.length === 0) break;

      const seen = await db
        .select({ messageId: schema.gmailMessages.messageId })
        .from(schema.gmailMessages)
        .where(and(eq(schema.gmailMessages.clinicId, clinicId), inArray(schema.gmailMessages.messageId, ids)));
      const seenSet = new Set(seen.map((s) => s.messageId));

      for (const messageId of ids) {
        if (seenSet.has(messageId)) continue;
        if (processedDocs >= maxDocuments) {
          stats.remaining = true;
          break outer;
        }
        stats.messagesScanned++;
        const result = await processMessage({ clinicId, messageId, google, store, suppliers });
        processedDocs += result.documentsExtracted;
        stats.invoicesImported += result.imported.length;
        stats.duplicates += result.duplicates;
        stats.needsReview += result.imported.filter((i) => i.status === "needs_review").length;
        result.imported.forEach((i) => touchedQuarters.add(i.quarter));
        if (result.status === "not_invoice") stats.notInvoices++;
        if (result.status === "link_only") stats.linkOnly++;
        if (result.status === "error") stats.errors++;
      }
    } while (pageToken);

    // Regenera el "Libro registro de facturas recibidas" de los trimestres afectados.
    for (const quarter of touchedQuarters) {
      await writeQuarterRegister(clinicId, quarter, store);
    }
    stats.quarters = [...touchedQuarters].sort();
    await finish(run!.id, stats.errors ? "partial" : "success", stats);
    return stats;
  } catch (err) {
    if (isInvalidGrant(err)) await google.markExpired();
    await finish(run!.id, "error", stats, err);
    throw err;
  }
}

async function finish(runId: string, status: "success" | "partial" | "error", stats: GmailSyncStats, err?: unknown) {
  await db
    .update(schema.syncRuns)
    .set({ status, stats, error: err ? String(err instanceof Error ? err.message : err) : null, finishedAt: new Date() })
    .where(eq(schema.syncRuns.id, runId));
}

/** Desde cuándo buscar: último email procesado - 7 días, o inicio del trimestre anterior la primera vez. */
async function syncStartDate(clinicId: string, configured?: string): Promise<string> {
  const [row] = await db
    .select({ last: sql<string | null>`max(${schema.gmailMessages.receivedAt})::date::text` })
    .from(schema.gmailMessages)
    .where(eq(schema.gmailMessages.clinicId, clinicId));
  if (row?.last) return addDays(row.last, -7);
  return configured ?? quarterRange(previousQuarter(currentQuarter())).from;
}

type ProcessCtx = {
  clinicId: string;
  messageId: string;
  google: Awaited<ReturnType<typeof getGoogleClients>>;
  store: DriveStore;
  suppliers: (typeof schema.suppliers.$inferSelect)[];
};

async function processMessage(ctx: ProcessCtx) {
  const { clinicId, messageId, google } = ctx;
  const imported: { id: string; quarter: string; status: string }[] = [];
  let duplicates = 0;
  let documentsExtracted = 0;
  let status: (typeof schema.gmailMessageStatusEnum.enumValues)[number] = "not_invoice";
  let detail: string | undefined;

  const { data: msg } = await google.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const from = header(msg, "From");
  const subject = header(msg, "Subject");
  const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();

  try {
    const { attachments, text } = collectParts(msg.payload);
    const candidates = attachments.filter((a) => isCandidateAttachment(a.filename, a.mimeType));

    for (const att of candidates) {
      const data = att.inlineData
        ? decodeBase64Url(att.inlineData)
        : decodeBase64Url(
            (await google.gmail.users.messages.attachments.get({ userId: "me", messageId, id: att.attachmentId! })).data.data ?? "",
          );
      const hash = sha256(data);
      const dup = await db.query.invoices.findFirst({
        where: and(eq(schema.invoices.clinicId, clinicId), eq(schema.invoices.fileSha256, hash)),
        columns: { id: true },
      });
      if (dup) {
        duplicates++;
        status = status === "imported" ? status : "duplicate";
        continue;
      }

      const input = toExtractInput(att.filename, att.mimeType, data);
      if (!input) continue;
      documentsExtracted++;
      const extraction = await extractInvoice(input, { from, emailSubject: subject });
      if (!extraction.is_invoice || !extraction.issue_date || extraction.total_amount == null) continue;

      const saved = await saveInvoice({
        clinicId,
        extraction,
        file: { data, name: att.filename, mimeType: att.mimeType, sha256: hash },
        gmailMessageId: messageId,
        fromDomain: senderDomain(from),
        store: ctx.store,
        suppliers: ctx.suppliers,
      });
      imported.push(saved);
      status = "imported";
    }

    if (status === "not_invoice" && candidates.length === 0 && looksLikeInvoiceLink(`${subject ?? ""}\n${text}`)) {
      status = "link_only";
      detail = "La factura parece estar en un enlace: descárgala y súbela manualmente.";
    }
  } catch (err) {
    status = "error";
    detail = err instanceof Error ? err.message : String(err);
    console.error(`[gmail] error procesando ${messageId}`, detail);
  }

  await db
    .insert(schema.gmailMessages)
    .values({ clinicId, messageId, fromAddress: from, subject, receivedAt, status, detail })
    .onConflictDoNothing();
  return { status, imported, duplicates, documentsExtracted };
}

function toExtractInput(filename: string, mimeType: string, data: Buffer): ExtractInput | null {
  const name = filename.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return { kind: "pdf", data };
  if (name.endsWith(".xml") || name.endsWith(".xsig")) return { kind: "xml", text: data.toString("utf8") };
  if (/\.(jpe?g)$/.test(name)) return { kind: "image", data, mediaType: "image/jpeg" };
  if (name.endsWith(".png")) return { kind: "image", data, mediaType: "image/png" };
  return null; // HEIC y otros: no soportados por ahora → revisar manualmente
}

/**
 * Guarda una factura extraída: proveedor (alta automática), archivo en Drive,
 * registro en BD y líneas de detalle. Reutilizado por Gmail y por subida manual.
 */
export async function saveInvoice(opts: {
  clinicId: string;
  extraction: Extraction;
  file: { data: Buffer; name: string; mimeType: string; sha256: string };
  source?: "gmail" | "upload";
  gmailMessageId?: string;
  fromDomain?: string | null;
  store: DriveStore;
  suppliers: (typeof schema.suppliers.$inferSelect)[];
}) {
  const { clinicId, extraction: x, store } = opts;
  const issueDate = x.issue_date!;
  const quarter = quarterOf(issueDate);
  const supplierName = x.supplier_name?.trim() || "Proveedor desconocido";
  const supplierId = await upsertSupplier(clinicId, supplierName, normalizeTaxId(x.supplier_tax_id), opts.fromDomain, x.category, opts.suppliers);

  const totalCents = toCents(x.total_amount!);
  const ext = opts.file.name.split(".").pop() ?? "pdf";
  const folder = await store.purchasesFolder(quarter);
  const driveFile = await store.upload({
    folderId: folder,
    name: invoiceFileName({ issueDate, supplierName, invoiceNumber: x.invoice_number, totalCents, ext }),
    mimeType: opts.file.mimeType || "application/pdf",
    data: opts.file.data,
  });

  const missing = !x.supplier_tax_id || !x.invoice_number || x.net_amount == null;
  const status = x.confidence >= REVIEW_THRESHOLD && !missing && !x.notes ? "confirmed" : "needs_review";
  const kind = x.document_type === "credit_note" ? "credit_note" : x.document_type === "simplified" ? "simplified" : "invoice";

  const [row] = await db
    .insert(schema.invoices)
    .values({
      clinicId,
      supplierId,
      source: opts.source ?? "gmail",
      kind,
      status,
      fileSha256: opts.file.sha256,
      fileName: opts.file.name,
      mimeType: opts.file.mimeType,
      driveFileId: driveFile.id,
      driveWebUrl: driveFile.webViewLink,
      gmailMessageId: opts.gmailMessageId,
      supplierName,
      supplierTaxId: normalizeTaxId(x.supplier_tax_id),
      invoiceNumber: x.invoice_number,
      issueDate,
      dueDate: x.due_date,
      quarter,
      currency: x.currency || "EUR",
      netCents: toCents(x.net_amount ?? x.total_amount! - (x.vat_amount ?? 0)),
      vatCents: toCents(x.vat_amount ?? 0),
      withholdingCents: toCents(x.withholding_amount ?? 0),
      totalCents,
      vatBreakdown: x.vat_breakdown.map((v) => ({ rate: v.rate, baseCents: toCents(v.base), vatCents: toCents(v.vat) })),
      category: x.category,
      paymentMethod: x.payment_method,
      notes: x.notes,
      extractionConfidence: x.confidence,
      extraction: x as unknown as Record<string, unknown>,
    })
    .returning({ id: schema.invoices.id });

  if (x.lines.length) {
    await db.insert(schema.invoiceLines).values(
      x.lines.map((l) => ({
        invoiceId: row!.id,
        description: l.description.slice(0, 500),
        quantity: l.quantity,
        unitPriceCents: l.unit_price == null ? null : toCents(l.unit_price),
        amountCents: toCents(l.amount),
        vatRate: l.vat_rate,
      })),
    );
  }
  return { id: row!.id, quarter, status };
}

async function upsertSupplier(
  clinicId: string,
  name: string,
  taxId: string | null,
  domain: string | null | undefined,
  category: string,
  cache: (typeof schema.suppliers.$inferSelect)[],
): Promise<string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const found =
    (taxId && cache.find((s) => s.taxId === taxId)) ||
    cache.find((s) => norm(s.name) === norm(name)) ||
    (domain && !isPublicDomain(domain) && cache.find((s) => s.emailDomains.includes(domain)));
  if (found) {
    if (domain && !isPublicDomain(domain) && !found.emailDomains.includes(domain)) {
      found.emailDomains = [...found.emailDomains, domain];
      await db.update(schema.suppliers).set({ emailDomains: found.emailDomains }).where(eq(schema.suppliers.id, found.id));
    }
    return found.id;
  }
  // Alias bancario inicial: primera palabra significativa del nombre (ej. "ALUMIER").
  const alias = name
    .toUpperCase()
    .replace(/\b(S\.?L\.?U?|S\.?A\.?|SOCIEDAD|LIMITADA)\b/g, "")
    .trim()
    .split(/\s+/)[0];
  const [row] = await db
    .insert(schema.suppliers)
    .values({
      clinicId,
      name,
      taxId,
      emailDomains: domain && !isPublicDomain(domain) ? [domain] : [],
      bankAliases: alias && alias.length >= 3 ? [alias] : [],
      defaultCategory: category,
    })
    .onConflictDoNothing()
    .returning();
  if (row) {
    cache.push(row);
    return row.id;
  }
  // Conflicto por tax_id (carrera): recuperar el existente.
  const existing = await db.query.suppliers.findFirst({
    where: and(eq(schema.suppliers.clinicId, clinicId), eq(schema.suppliers.taxId, taxId!)),
  });
  return existing!.id;
}
