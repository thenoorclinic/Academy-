import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * Extracción de datos fiscales de una factura con Claude.
 * Acepta PDF, imagen o XML (Facturae). Devuelve datos estructurados y validados.
 *
 * Privacidad: solo se envían documentos de PROVEEDORES (facturas de compra),
 * nunca historiales de pacientes. Anthropic actúa como encargado del tratamiento
 * (DPA) y la API no usa los datos para entrenar modelos.
 */

export const ExtractionSchema = z.object({
  is_invoice: z
    .boolean()
    .describe("true solo si es una factura, factura simplificada (ticket) o factura rectificativa/abono emitida A la clínica"),
  document_type: z.enum(["invoice", "simplified", "credit_note", "proforma", "quote", "delivery_note", "receipt", "other"]),
  supplier_name: z.string().nullable(),
  supplier_tax_id: z.string().nullable().describe("CIF/NIF/VAT del emisor, sin espacios"),
  customer_tax_id: z.string().nullable().describe("CIF/NIF del destinatario (la clínica)"),
  invoice_number: z.string().nullable(),
  issue_date: z.string().nullable().describe("Fecha de expedición en formato YYYY-MM-DD"),
  due_date: z.string().nullable().describe("Fecha de vencimiento YYYY-MM-DD si aparece"),
  currency: z.string().describe("ISO 4217, normalmente EUR"),
  net_amount: z.number().nullable().describe("Base imponible total"),
  vat_amount: z.number().nullable().describe("Cuota total de IVA"),
  withholding_amount: z.number().nullable().describe("Retención IRPF (importe positivo) si existe"),
  total_amount: z.number().nullable().describe("Total a pagar. Negativo si es un abono"),
  vat_breakdown: z.array(z.object({ rate: z.number(), base: z.number(), vat: z.number() })),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nullable(),
      unit_price: z.number().nullable(),
      amount: z.number(),
      vat_rate: z.number().nullable(),
    }),
  ),
  category: z
    .enum([
      "producto_cosmetico",
      "material_sanitario",
      "aparatologia",
      "formacion",
      "software",
      "marketing",
      "alquiler",
      "suministros",
      "servicios_profesionales",
      "seguros",
      "comisiones_bancarias",
      "otros",
    ])
    .describe("Categoría contable sugerida"),
  payment_method: z.string().nullable().describe("domiciliación, transferencia, tarjeta… si se indica"),
  iban_last4: z.string().nullable().describe("Últimos 4 dígitos del IBAN de cargo/abono si aparece"),
  confidence: z.number().describe("0 a 1: confianza global en la extracción"),
  notes: z.string().nullable().describe("Incidencias: ilegible, faltan datos obligatorios, importes que no cuadran…"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `Eres un asistente contable experto en facturación española (RD 1619/2012) que procesa facturas de compra de una clínica estética en España.
Extrae los datos del documento con exactitud. Reglas:
- Usa punto decimal en los números. No inventes datos: si un campo no aparece, devuelve null.
- Si hay varios tipos de IVA, desglósalos en vat_breakdown.
- Un abono o factura rectificativa lleva importes negativos.
- Proformas, presupuestos, albaranes, confirmaciones de pedido y recordatorios de pago NO son facturas (is_invoice=false).
- Un recibo/justificante de pago sin datos fiscales del emisor es "receipt" e is_invoice=false.
- Comprueba que base + IVA - retención ≈ total; si no cuadra, indícalo en notes y baja la confianza.`;

export type ExtractInput =
  | { kind: "pdf"; data: Buffer }
  | { kind: "image"; data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }
  | { kind: "xml"; text: string };

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic());

export async function extractInvoice(input: ExtractInput, hints: { emailSubject?: string; from?: string } = {}) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.kind === "pdf") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.data.toString("base64") },
    });
  } else if (input.kind === "image") {
    content.push({ type: "image", source: { type: "base64", media_type: input.mediaType, data: input.data.toString("base64") } });
  } else {
    content.push({ type: "text", text: `<facturae_xml>\n${input.text}\n</facturae_xml>` });
  }
  content.push({
    type: "text",
    text: `Contexto del email (puede ayudar a identificar al proveedor): remitente="${hints.from ?? ""}", asunto="${hints.emailSubject ?? ""}".\nExtrae los datos de este documento.`,
  });

  const response = await anthropic().beta.messages.parse({
    model: process.env.EXTRACTION_MODEL ?? "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    // Extracción de datos: tarea acotada → esfuerzo bajo (más rápido y barato).
    output_config: { effort: "low", format: betaZodOutputFormat(ExtractionSchema) },
    // Si el modelo principal rechaza la petición, la API reintenta con otro modelo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new Error("El modelo rechazó procesar el documento");
  if (response.stop_reason === "max_tokens") throw new Error("Respuesta truncada al extraer la factura");
  if (!response.parsed_output) throw new Error("No se pudo interpretar la respuesta de extracción");
  return response.parsed_output;
}

/** Normaliza CIF/NIF: mayúsculas, sin espacios/guiones, sin prefijo ES. */
export function normalizeTaxId(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = id.toUpperCase().replace(/[\s.\-]/g, "");
  return s.startsWith("ES") && s.length > 9 ? s.slice(2) : s;
}
