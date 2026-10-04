/**
 * Modelo de datos de NOOR Hub.
 *
 * Principios:
 *  - Multi-tenant desde el día 1: toda entidad de negocio cuelga de `clinic_id`.
 *    Una organización (grupo) puede tener varias clínicas; un usuario puede
 *    pertenecer a varias clínicas con roles distintos (`memberships`).
 *  - Importes en céntimos (integer) para evitar errores de coma flotante.
 *  - Credenciales de terceros (Google, banco) SIEMPRE cifradas (AES-256-GCM)
 *    en `integrations.secret_enc`; nunca en claro.
 *  - Todo cambio relevante deja rastro en `audit_log`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  date,
  real,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ */
/* Identidad (tablas gestionadas por Better Auth)                      */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Tenancy y control de acceso                                         */
/* ------------------------------------------------------------------ */

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const clinics = pgTable("clinics", {
  id: id(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  taxId: text("tax_id"), // CIF/NIF de la clínica
  /** Ajustes: carpeta raíz de Drive, email gestoría, tolerancias de conciliación… */
  settings: jsonb("settings").$type<ClinicSettings>().notNull().default({}),
  createdAt: createdAt(),
});

export type ClinicSettings = {
  driveRootFolderId?: string;
  driveRootFolderName?: string;
  gestoriaEmail?: string;
  gestoriaName?: string;
  /** Fecha desde la que buscar facturas la primera vez (YYYY-MM-DD). */
  syncFrom?: string;
  /** Consulta Gmail adicional definida por el usuario (se combina con OR). */
  extraGmailQuery?: string;
};

export const roleEnum = pgEnum("role", ["owner", "admin", "finance", "staff", "viewer"]);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_clinic").on(t.userId, t.clinicId)],
);

/** Invitaciones por email: al hacer login con ese email se crea la membership. */
export const invitations = pgTable("invitations", {
  id: id(),
  clinicId: text("clinic_id")
    .notNull()
    .references(() => clinics.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Integraciones externas                                              */
/* ------------------------------------------------------------------ */

export const integrationProviderEnum = pgEnum("integration_provider", ["google", "enablebanking"]);
export const integrationStatusEnum = pgEnum("integration_status", ["active", "expired", "revoked", "error"]);

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    /** Cuenta externa (p. ej. email de Gmail o nombre del banco). */
    externalAccount: text("external_account").notNull(),
    scopes: text("scopes"),
    /** Secretos cifrados (refresh token, session id…). Ver lib/crypto.ts */
    secretEnc: text("secret_enc").notNull(),
    status: integrationStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("integrations_clinic").on(t.clinicId, t.provider)],
);

/* ------------------------------------------------------------------ */
/* Proveedores                                                         */
/* ------------------------------------------------------------------ */

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    taxId: text("tax_id"),
    /** Dominios desde los que envía facturas (ej. "alumiermd.com"). */
    emailDomains: text("email_domains").array().notNull().default(sql`'{}'::text[]`),
    /** Textos con los que aparece en el extracto bancario (ej. "ALUMIER", "AMZN"). */
    bankAliases: text("bank_aliases").array().notNull().default(sql`'{}'::text[]`),
    /** Email al que reclamar facturas que faltan. */
    billingEmail: text("billing_email"),
    defaultCategory: text("default_category"),
    /** Si es true, sus cargos no requieren factura (p. ej. comisiones bancarias). */
    noInvoiceExpected: boolean("no_invoice_expected").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("suppliers_clinic").on(t.clinicId), uniqueIndex("suppliers_clinic_taxid").on(t.clinicId, t.taxId)],
);

/* ------------------------------------------------------------------ */
/* Facturas de compra                                                  */
/* ------------------------------------------------------------------ */

export const invoiceSourceEnum = pgEnum("invoice_source", ["gmail", "upload", "manual"]);
export const invoiceKindEnum = pgEnum("invoice_kind", ["invoice", "simplified", "credit_note"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["needs_review", "confirmed", "rejected"]);

export type VatLine = { rate: number; baseCents: number; vatCents: number };

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    supplierId: text("supplier_id").references(() => suppliers.id),
    source: invoiceSourceEnum("source").notNull(),
    kind: invoiceKindEnum("kind").notNull().default("invoice"),
    status: invoiceStatusEnum("status").notNull().default("needs_review"),

    // Documento
    fileSha256: text("file_sha256").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    driveFileId: text("drive_file_id"),
    driveWebUrl: text("drive_web_url"),
    gmailMessageId: text("gmail_message_id"),

    // Datos fiscales extraídos
    supplierName: text("supplier_name").notNull(),
    supplierTaxId: text("supplier_tax_id"),
    invoiceNumber: text("invoice_number"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    /** Trimestre fiscal, p. ej. "2026-T3". Derivado de issue_date. */
    quarter: text("quarter").notNull(),
    currency: text("currency").notNull().default("EUR"),
    netCents: integer("net_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    /** Retención IRPF (profesionales). Se resta del total. */
    withholdingCents: integer("withholding_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    vatBreakdown: jsonb("vat_breakdown").$type<VatLine[]>().notNull().default([]),
    category: text("category"),
    paymentMethod: text("payment_method"),
    notes: text("notes"),

    extractionConfidence: real("extraction_confidence"),
    extraction: jsonb("extraction").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_clinic_sha").on(t.clinicId, t.fileSha256),
    index("invoices_clinic_quarter").on(t.clinicId, t.quarter),
    index("invoices_supplier").on(t.supplierId),
  ],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: real("quantity"),
  unitPriceCents: integer("unit_price_cents"),
  amountCents: integer("amount_cents").notNull(),
  vatRate: real("vat_rate"),
});

/**
 * Registro de emails ya procesados (idempotencia del escaneo de Gmail),
 * incluidos los que NO contenían factura o la tenían solo como enlace.
 */
export const gmailMessageStatusEnum = pgEnum("gmail_message_status", [
  "imported",
  "not_invoice",
  "link_only",
  "duplicate",
  "error",
]);

export const gmailMessages = pgTable(
  "gmail_messages",
  {
    id: id(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    fromAddress: text("from_address"),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    status: gmailMessageStatusEnum("status").notNull(),
    detail: text("detail"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gmail_messages_clinic_msg").on(t.clinicId, t.messageId)],
);

/* ------------------------------------------------------------------ */
/* Banco                                                               */
/* ------------------------------------------------------------------ */

export const bankAccounts = pgTable("bank_accounts", {
  id: id(),
  clinicId: text("clinic_id")
    .notNull()
    .references(() => clinics.id, { onDelete: "cascade" }),
  integrationId: text("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  /** Identificador de la cuenta en el agregador (Enable Banking uid). */
  externalId: text("external_id"),
  name: text("name").notNull(),
  /** IBAN enmascarado (ES12 **** **** 1234). El IBAN completo no se guarda. */
  ibanMasked: text("iban_masked"),
  currency: text("currency").notNull().default("EUR"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: id(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    bankAccountId: text("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    /** Id estable del movimiento (del banco o hash de fecha+importe+concepto). */
    externalId: text("external_id").notNull(),
    bookingDate: date("booking_date", { mode: "string" }).notNull(),
    valueDate: date("value_date", { mode: "string" }),
    /** Negativo = cargo (salida de dinero). Positivo = abono. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    description: text("description").notNull(),
    counterparty: text("counterparty"),
    supplierId: text("supplier_id").references(() => suppliers.id),
    /** Marcado manual: este cargo no lleva factura (impuestos, nóminas, traspasos…). */
    noInvoiceExpected: boolean("no_invoice_expected").notNull().default(false),
    noInvoiceReason: text("no_invoice_reason"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("bank_tx_account_ext").on(t.bankAccountId, t.externalId),
    index("bank_tx_clinic_date").on(t.clinicId, t.bookingDate),
  ],
);

/* ------------------------------------------------------------------ */
/* Conciliación                                                        */
/* ------------------------------------------------------------------ */

export const matchMethodEnum = pgEnum("match_method", ["auto", "manual"]);

/** Relación N:M factura ↔ movimiento (un cargo puede pagar varias facturas y viceversa). */
export const reconciliationMatches = pgTable(
  "reconciliation_matches",
  {
    id: id(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => bankTransactions.id, { onDelete: "cascade" }),
    method: matchMethodEnum("method").notNull(),
    score: real("score"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recon_invoice_tx").on(t.invoiceId, t.transactionId)],
);

/* ------------------------------------------------------------------ */
/* Operación y auditoría                                               */
/* ------------------------------------------------------------------ */

export const syncKindEnum = pgEnum("sync_kind", ["gmail", "bank", "reconcile", "gestoria"]);
export const syncStatusEnum = pgEnum("sync_status", ["running", "success", "partial", "error"]);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    kind: syncKindEnum("kind").notNull(),
    status: syncStatusEnum("status").notNull().default("running"),
    trigger: text("trigger").notNull(), // "button" | "cron"
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_runs_clinic").on(t.clinicId, t.startedAt)],
);

/** Envíos trimestrales a la gestoría (fase 2). */
export const gestoriaSubmissions = pgTable("gestoria_submissions", {
  id: id(),
  clinicId: text("clinic_id")
    .notNull()
    .references(() => clinics.id, { onDelete: "cascade" }),
  quarter: text("quarter").notNull(),
  recipients: text("recipients").notNull(),
  gmailMessageId: text("gmail_message_id"),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  sentBy: text("sent_by").references(() => user.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    clinicId: text("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_clinic_date").on(t.clinicId, t.createdAt)],
);
