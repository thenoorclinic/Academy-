/**
 * Datos de DEMOSTRACIÓN para ver la app funcionando sin conectar Gmail ni banco.
 * Uso: npm run seed -- tu-email@gmail.com
 * (El usuario se vincula como owner cuando haga login con Google con ese email.)
 */
import { db, schema } from "../src/db";
import { currentQuarter, quarterOf, quarterRange, addDays } from "../src/lib/quarter";

async function main() {
  const email = (process.argv[2] ?? process.env.ALLOWED_EMAILS?.split(",")[0] ?? "").trim().toLowerCase();
  const [org] = await db.insert(schema.organizations).values({ name: "The NOOR Clinic" }).returning();
  const [clinic] = await db
    .insert(schema.clinics)
    .values({ organizationId: org!.id, name: "The NOOR Clinic", settings: { gestoriaEmail: "gestoria@example.com" } })
    .returning();
  if (email) await db.insert(schema.invitations).values({ clinicId: clinic!.id, email, role: "owner" });

  const sup = async (name: string, taxId: string, aliases: string[], extra: Partial<typeof schema.suppliers.$inferInsert> = {}) =>
    (await db.insert(schema.suppliers).values({ clinicId: clinic!.id, name, taxId, bankAliases: aliases, ...extra }).returning())[0]!;
  const alumier = await sup("AlumierMD Europe S.L.", "B12345678", ["ALUMIER"], { emailDomains: ["alumiermd.com"], billingEmail: "facturas@alumiermd.com" });
  const celluma = await sup("BioPhotas Celluma", "B87654321", ["CELLUMA"]);
  const endesa = await sup("Endesa Energía S.A.U.", "A81948077", ["ENDESA"]);
  await sup("Comisiones bancarias", "BANK", ["COMISION"], { noInvoiceExpected: true });

  const { from } = quarterRange(currentQuarter());
  const d = (n: number) => addDays(from, n);
  const inv = async (s: typeof alumier, day: number, net: number, num: string) => {
    const vat = Math.round(net * 0.21);
    await db.insert(schema.invoices).values({
      clinicId: clinic!.id,
      supplierId: s.id,
      source: "manual",
      status: "confirmed",
      fileSha256: `demo-${num}`,
      fileName: `${num}.pdf`,
      mimeType: "application/pdf",
      supplierName: s.name,
      supplierTaxId: s.taxId,
      invoiceNumber: num,
      issueDate: d(day),
      quarter: quarterOf(d(day)),
      netCents: net,
      vatCents: vat,
      totalCents: net + vat,
      vatBreakdown: [{ rate: 21, baseCents: net, vatCents: vat }],
      category: "producto_cosmetico",
    });
  };
  await inv(alumier, 3, 100_000, "AL-2026-101");
  await inv(celluma, 5, 24_793, "CE-881");
  await inv(celluma, 18, 16_529, "CE-899");
  await inv(endesa, 10, 15_000, "EN-55301");

  const [acc] = await db.insert(schema.bankAccounts).values({ clinicId: clinic!.id, name: "Cuenta principal (demo)", ibanMasked: "ES12 **** **** 1234" }).returning();
  const tx = (day: number, cents: number, description: string) => ({
    clinicId: clinic!.id,
    bankAccountId: acc!.id,
    externalId: `demo-${day}-${cents}`,
    bookingDate: d(day),
    amountCents: cents,
    description,
  });
  await db.insert(schema.bankTransactions).values([
    tx(6, -121_000, "RECIBO ALUMIERMD EUROPE SL"), // ✔ cuadra
    tx(25, -50_000, "TRANSFERENCIA CELLUMA"), // ✔ paga 2 facturas (299,99 + 200,01)
    tx(14, -15_000, "ADEUDO ENDESA ENERGIA"), // ✖ desalineado: factura 181,50
    tx(16, -8_990, "COMPRA TARJETA AMAZON MKTPLACE"), // ✖ sin factura
    tx(20, -3_500, "META PLATFORMS ADS"), // ✖ sin factura
    tx(28, -1_200, "COMISION MANTENIMIENTO"), // ignorado
    tx(29, 45_000, "ABONO TPV VENTAS"), // ingreso
  ]);
  console.log(`Clínica demo creada: ${clinic!.id}${email ? ` · invitación owner para ${email}` : ""}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
