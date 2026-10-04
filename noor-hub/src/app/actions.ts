"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getClinic, hasMembership, requireContext } from "@/lib/context";
import { sha256 } from "@/lib/crypto";
import { parseBankCsv } from "@/services/bank/csv";
import { parseNorma43 } from "@/services/bank/norma43";
import { ensureBankAccount, upsertTransactions } from "@/services/bank/sync";
import { getGoogleClients } from "@/services/google/client";
import { DriveStore } from "@/services/google/drive";
import { extractInvoice } from "@/services/invoices/extract";
import { saveInvoice } from "@/services/invoices/ingest";
import { writeQuarterRegister } from "@/services/invoices/register";
import { runFullSync } from "@/services/pipeline";
import { createInvoiceClaimDraft } from "@/services/reconcile/claims";
import { runReconcile } from "@/services/reconcile/service";
import { sendGestoriaPack } from "@/services/gestoria/quarterly";

export type ActionResult = { ok: boolean; message: string };

const quarterSchema = z.string().regex(/^\d{4}-T[1-4]$/);

/** EL BOTÓN principal del dashboard. */
export async function syncAllAction(): Promise<ActionResult> {
  const ctx = await requireContext("reconcile:run");
  const r = await runFullSync(ctx.clinicId, "button");
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "sync.button", metadata: { errors: r.errors.length } });
  revalidatePath("/", "layout");
  const g = r.gmail;
  const parts = [
    g ? `${g.invoicesImported} facturas nuevas${g.remaining ? " (quedan más: pulsa otra vez)" : ""}` : null,
    r.bank ? `${r.bank.inserted} movimientos bancarios` : null,
    ...Object.entries(r.reconcile ?? {}).map(([q, s]) => `${q}: ${s.chargesWithoutInvoice} cargos sin factura, ${s.mismatches} desalineamientos`),
  ].filter(Boolean);
  return { ok: r.errors.length === 0, message: [...parts, ...r.errors].join(" · ") };
}

export async function reconcileAction(quarter: string): Promise<ActionResult> {
  const ctx = await requireContext("reconcile:run");
  const q = quarterSchema.parse(quarter);
  const r = await runReconcile(ctx.clinicId, q, "button");
  revalidatePath("/conciliacion");
  return { ok: true, message: `Tienes ${r.chargesWithoutInvoice.length} cargos sin factura y ${r.mismatches.length} desalineamientos en ${q}` };
}

export async function markNoInvoiceAction(formData: FormData) {
  const ctx = await requireContext("bank:write");
  const id = z.string().parse(formData.get("transactionId"));
  const reason = z.string().max(200).parse(formData.get("reason") ?? "No requiere factura");
  await db
    .update(schema.bankTransactions)
    .set({ noInvoiceExpected: true, noInvoiceReason: reason })
    .where(and(eq(schema.bankTransactions.id, id), eq(schema.bankTransactions.clinicId, ctx.clinicId)));
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "tx.no_invoice", entityType: "bank_transaction", entityId: id, metadata: { reason } });
  revalidatePath("/conciliacion");
  revalidatePath("/banco");
}

export async function manualMatchAction(formData: FormData) {
  const ctx = await requireContext("reconcile:run");
  const invoiceId = z.string().parse(formData.get("invoiceId"));
  const transactionId = z.string().parse(formData.get("transactionId"));
  const [inv, tx] = await Promise.all([
    db.query.invoices.findFirst({ where: and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.clinicId, ctx.clinicId)) }),
    db.query.bankTransactions.findFirst({ where: and(eq(schema.bankTransactions.id, transactionId), eq(schema.bankTransactions.clinicId, ctx.clinicId)) }),
  ]);
  if (!inv || !tx) throw new Error("No encontrado");
  await db
    .insert(schema.reconciliationMatches)
    .values({ clinicId: ctx.clinicId, invoiceId, transactionId, method: "manual", score: 1, createdBy: ctx.userId })
    .onConflictDoUpdate({
      target: [schema.reconciliationMatches.invoiceId, schema.reconciliationMatches.transactionId],
      set: { method: "manual", createdBy: ctx.userId },
    });
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "reconcile.manual_match", metadata: { invoiceId, transactionId } });
  revalidatePath("/conciliacion");
}

export async function claimInvoiceAction(formData: FormData) {
  const ctx = await requireContext("reconcile:run");
  const id = z.string().parse(formData.get("transactionId"));
  const r = await createInvoiceClaimDraft(ctx.clinicId, id, ctx.clinicName);
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "claim.draft", entityType: "bank_transaction", entityId: id });
  return { ok: true, message: `Borrador creado en Gmail${r.to ? ` para ${r.to}` : " (añade el destinatario)"}` };
}

export async function updateInvoiceStatusAction(formData: FormData) {
  const ctx = await requireContext("invoices:write");
  const id = z.string().parse(formData.get("invoiceId"));
  const status = z.enum(["confirmed", "rejected", "needs_review"]).parse(formData.get("status"));
  await db
    .update(schema.invoices)
    .set({ status })
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.clinicId, ctx.clinicId)));
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: `invoice.${status}`, entityType: "invoice", entityId: id });
  revalidatePath("/facturas");
}

const MAX_UPLOAD = 15 * 1024 * 1024;

/** Subida manual (facturas que llegan en papel, por WhatsApp, o desde un enlace). */
export async function uploadInvoiceAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext("invoices:write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Selecciona un archivo" };
  if (file.size > MAX_UPLOAD) return { ok: false, message: "Archivo demasiado grande (máx. 15 MB)" };
  const allowed = ["application/pdf", "image/jpeg", "image/png", "text/xml", "application/xml"];
  if (!allowed.includes(file.type)) return { ok: false, message: "Formato no admitido (PDF, JPG, PNG o XML)" };

  const data = Buffer.from(await file.arrayBuffer());
  const hash = sha256(data);
  const dup = await db.query.invoices.findFirst({
    where: and(eq(schema.invoices.clinicId, ctx.clinicId), eq(schema.invoices.fileSha256, hash)),
  });
  if (dup) return { ok: false, message: "Esta factura ya estaba registrada" };

  const extraction = await extractInvoice(
    file.type === "application/pdf"
      ? { kind: "pdf", data }
      : file.type.includes("xml")
        ? { kind: "xml", text: data.toString("utf8") }
        : { kind: "image", data, mediaType: file.type as "image/jpeg" | "image/png" },
  );
  if (!extraction.is_invoice || !extraction.issue_date || extraction.total_amount == null) {
    return { ok: false, message: `No parece una factura válida (${extraction.document_type})` };
  }
  const clinic = await getClinic(ctx.clinicId);
  const { drive } = await getGoogleClients(ctx.clinicId);
  const store = new DriveStore(drive, clinic.settings.driveRootFolderName, clinic.settings.driveRootFolderId);
  const suppliers = await db.query.suppliers.findMany({ where: eq(schema.suppliers.clinicId, ctx.clinicId) });
  const saved = await saveInvoice({
    clinicId: ctx.clinicId,
    extraction,
    file: { data, name: file.name, mimeType: file.type, sha256: hash },
    source: "upload",
    store,
    suppliers,
  });
  await writeQuarterRegister(ctx.clinicId, saved.quarter, store);
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "invoice.upload", entityType: "invoice", entityId: saved.id });
  revalidatePath("/facturas");
  return { ok: true, message: `Factura de ${extraction.supplier_name} registrada en ${saved.quarter}` };
}

export async function importStatementAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext("bank:write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Selecciona un archivo" };
  if (file.size > MAX_UPLOAD) return { ok: false, message: "Archivo demasiado grande" };
  // Norma 43 suele venir en latin1.
  const buf = Buffer.from(await file.arrayBuffer());
  const text = buf.toString(buf.includes(0xc3) ? "utf8" : "latin1");
  let inserted = 0;
  if (/^11\d{4}/.test(text.trimStart())) {
    for (const acc of parseNorma43(text)) {
      const accountId = await ensureBankAccount(ctx.clinicId, acc.account);
      inserted += await upsertTransactions(ctx.clinicId, accountId, acc.transactions);
    }
  } else {
    const accountName = z.string().min(1).max(80).parse(formData.get("accountName") || "Cuenta principal");
    const accountId = await ensureBankAccount(ctx.clinicId, { externalId: `manual:${accountName}`, name: accountName, currency: "EUR" });
    inserted = await upsertTransactions(ctx.clinicId, accountId, parseBankCsv(text, accountId));
  }
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "bank.import", metadata: { inserted } });
  revalidatePath("/banco");
  return { ok: true, message: `${inserted} movimientos nuevos importados` };
}

export async function updateSupplierAction(formData: FormData) {
  const ctx = await requireContext("suppliers:write");
  const id = z.string().parse(formData.get("supplierId"));
  const list = (v: FormDataEntryValue | null) =>
    String(v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const billingEmail = String(formData.get("billingEmail") ?? "").trim();
  await db
    .update(schema.suppliers)
    .set({
      billingEmail: billingEmail ? z.string().email().parse(billingEmail) : null,
      bankAliases: list(formData.get("bankAliases")).map((a) => a.toUpperCase()),
      emailDomains: list(formData.get("emailDomains")).map((d) => d.toLowerCase()),
      noInvoiceExpected: formData.get("noInvoiceExpected") === "on",
    })
    .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.clinicId, ctx.clinicId)));
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "supplier.update", entityType: "supplier", entityId: id });
  revalidatePath("/proveedores");
}

export async function updateSettingsAction(formData: FormData) {
  const ctx = await requireContext("integrations:manage");
  const clinic = await getClinic(ctx.clinicId);
  const s = z
    .object({
      legalName: z.string().max(120).optional(),
      taxId: z.string().max(20).optional(),
      gestoriaEmail: z.union([z.string().email(), z.literal("")]).optional(),
      gestoriaName: z.string().max(80).optional(),
      syncFrom: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
      extraGmailQuery: z.string().max(300).optional(),
    })
    .parse(Object.fromEntries(formData));
  await db
    .update(schema.clinics)
    .set({
      legalName: s.legalName || null,
      taxId: s.taxId || null,
      settings: {
        ...clinic.settings,
        gestoriaEmail: s.gestoriaEmail || undefined,
        gestoriaName: s.gestoriaName || undefined,
        syncFrom: s.syncFrom || undefined,
        extraGmailQuery: s.extraGmailQuery || undefined,
      },
    })
    .where(eq(schema.clinics.id, ctx.clinicId));
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "settings.update" });
  revalidatePath("/ajustes");
}

export async function sendGestoriaAction(quarter: string): Promise<ActionResult> {
  const ctx = await requireContext("gestoria:send");
  const r = await sendGestoriaPack(ctx.clinicId, quarterSchema.parse(quarter), ctx.userId);
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "gestoria.sent", metadata: { quarter, to: r.to } });
  revalidatePath("/gestoria");
  return { ok: true, message: `Enviado a ${r.to}` };
}

export async function switchClinicAction(formData: FormData) {
  const ctx = await requireContext();
  const clinicId = z.string().parse(formData.get("clinicId"));
  if (!(await hasMembership(ctx.userId, clinicId))) throw new Error("Sin acceso a esa clínica");
  (await cookies()).set("clinic", clinicId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}
