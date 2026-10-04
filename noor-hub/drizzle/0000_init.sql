CREATE TYPE "public"."gmail_message_status" AS ENUM('imported', 'not_invoice', 'link_only', 'duplicate', 'error');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('google', 'enablebanking');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('active', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('invoice', 'simplified', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."invoice_source" AS ENUM('gmail', 'upload', 'manual');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('needs_review', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'finance', 'staff', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."sync_kind" AS ENUM('gmail', 'bank', 'reconcile', 'gestoria');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'partial', 'error');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"integration_id" text,
	"external_id" text,
	"name" text NOT NULL,
	"iban_masked" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"bank_account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"booking_date" date NOT NULL,
	"value_date" date,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"description" text NOT NULL,
	"counterparty" text,
	"supplier_id" text,
	"no_invoice_expected" boolean DEFAULT false NOT NULL,
	"no_invoice_reason" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gestoria_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"quarter" text NOT NULL,
	"recipients" text NOT NULL,
	"gmail_message_id" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_by" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"message_id" text NOT NULL,
	"from_address" text,
	"subject" text,
	"received_at" timestamp with time zone,
	"status" "gmail_message_status" NOT NULL,
	"detail" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"external_account" text NOT NULL,
	"scopes" text,
	"secret_enc" text NOT NULL,
	"status" "integration_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "role" NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"description" text NOT NULL,
	"quantity" real,
	"unit_price_cents" integer,
	"amount_cents" integer NOT NULL,
	"vat_rate" real
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"supplier_id" text,
	"source" "invoice_source" NOT NULL,
	"kind" "invoice_kind" DEFAULT 'invoice' NOT NULL,
	"status" "invoice_status" DEFAULT 'needs_review' NOT NULL,
	"file_sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"drive_file_id" text,
	"drive_web_url" text,
	"gmail_message_id" text,
	"supplier_name" text NOT NULL,
	"supplier_tax_id" text,
	"invoice_number" text,
	"issue_date" date NOT NULL,
	"due_date" date,
	"quarter" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"withholding_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text,
	"payment_method" text,
	"notes" text,
	"extraction_confidence" real,
	"extraction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"clinic_id" text NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"method" "match_method" NOT NULL,
	"score" real,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"email_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"bank_aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"billing_email" text,
	"default_category" text,
	"no_invoice_expected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text NOT NULL,
	"kind" "sync_kind" NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestoria_submissions" ADD CONSTRAINT "gestoria_submissions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestoria_submissions" ADD CONSTRAINT "gestoria_submissions_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_messages" ADD CONSTRAINT "gmail_messages_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_clinic_date" ON "audit_log" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_tx_account_ext" ON "bank_transactions" USING btree ("bank_account_id","external_id");--> statement-breakpoint
CREATE INDEX "bank_tx_clinic_date" ON "bank_transactions" USING btree ("clinic_id","booking_date");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_messages_clinic_msg" ON "gmail_messages" USING btree ("clinic_id","message_id");--> statement-breakpoint
CREATE INDEX "integrations_clinic" ON "integrations" USING btree ("clinic_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_clinic_sha" ON "invoices" USING btree ("clinic_id","file_sha256");--> statement-breakpoint
CREATE INDEX "invoices_clinic_quarter" ON "invoices" USING btree ("clinic_id","quarter");--> statement-breakpoint
CREATE INDEX "invoices_supplier" ON "invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_clinic" ON "memberships" USING btree ("user_id","clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_invoice_tx" ON "reconciliation_matches" USING btree ("invoice_id","transaction_id");--> statement-breakpoint
CREATE INDEX "suppliers_clinic" ON "suppliers" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_clinic_taxid" ON "suppliers" USING btree ("clinic_id","tax_id");--> statement-breakpoint
CREATE INDEX "sync_runs_clinic" ON "sync_runs" USING btree ("clinic_id","started_at");