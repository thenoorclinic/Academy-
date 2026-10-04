import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatCents } from "@/lib/money";
import { getGoogleClients } from "@/services/google/client";
import { buildMime } from "@/services/google/mime";

/**
 * "Perseguir proveedores" automáticamente: crea un BORRADOR en Gmail
 * reclamando la factura de un cargo sin justificar. Se deja como borrador
 * (no se envía solo) para que revises el tono y el destinatario.
 */
export async function createInvoiceClaimDraft(clinicId: string, transactionId: string, clinicName: string) {
  const tx = await db.query.bankTransactions.findFirst({ where: eq(schema.bankTransactions.id, transactionId) });
  if (!tx || tx.clinicId !== clinicId) throw new Error("Movimiento no encontrado");
  const supplier = tx.supplierId ? await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, tx.supplierId) }) : undefined;
  const to = supplier?.billingEmail ?? (supplier?.emailDomains[0] ? `facturacion@${supplier.emailDomains[0]}` : "");

  const date = new Date(`${tx.bookingDate}T00:00:00Z`).toLocaleDateString("es-ES");
  const text = `Hola${supplier ? ` equipo de ${supplier.name}` : ""},

En nuestro extracto bancario figura un cargo de ${formatCents(Math.abs(tx.amountCents))} con fecha ${date} (concepto: "${tx.description}"), del que no hemos recibido la factura correspondiente.

¿Podríais enviárnosla a este correo, por favor? La necesitamos para la declaración trimestral.

Datos de facturación: ${clinicName}.

Muchas gracias,
${clinicName}`;

  const { gmail } = await getGoogleClients(clinicId);
  const raw = buildMime({ to, subject: `Solicitud de factura – cargo de ${formatCents(Math.abs(tx.amountCents))} del ${date}`, text });
  const { data } = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
  return { draftId: data.id, to };
}
