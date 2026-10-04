import { describe, expect, it } from "vitest";
import { nameSimilarity, reconcile, type RInvoice, type RSupplier, type RTransaction } from "./engine";

const sup = (id: string, name: string, aliases: string[] = [], noInvoiceExpected = false): RSupplier => ({
  id,
  name,
  bankAliases: aliases,
  noInvoiceExpected,
});
const inv = (id: string, supplierId: string, supplierName: string, issueDate: string, totalCents: number, invoiceNumber: string | null = null): RInvoice => ({
  id,
  supplierId,
  supplierName,
  invoiceNumber: invoiceNumber ?? id,
  issueDate,
  dueDate: null,
  totalCents,
});
const tx = (id: string, bookingDate: string, amountCents: number, description: string, extra: Partial<RTransaction> = {}): RTransaction => ({
  id,
  bookingDate,
  amountCents,
  description,
  counterparty: null,
  supplierId: null,
  noInvoiceExpected: false,
  ...extra,
});

const suppliers = [
  sup("alumier", "AlumierMD Europe S.L.", ["ALUMIER"]),
  sup("celluma", "BioPhotas Celluma", ["CELLUMA"]),
  sup("endesa", "Endesa Energía S.A.U.", ["ENDESA"]),
  sup("bank", "Comisiones banco", ["COMISION MANTENIMIENTO"], true),
];

describe("nameSimilarity", () => {
  it("reconoce alias contenidos en el concepto bancario", () => {
    expect(nameSimilarity(["AlumierMD Europe S.L.", "ALUMIER"], "RECIBO ALUMIERMD EUROPE SL REF 1234")).toBe(1);
  });
  it("devuelve 0 para proveedores sin relación", () => {
    expect(nameSimilarity(["Endesa Energía"], "COMPRA TARJETA AMAZON MARKETPLACE")).toBe(0);
  });
});

describe("reconcile", () => {
  it("empareja 1:1 con importe exacto y detecta cargos sin factura", () => {
    const r = reconcile(
      [inv("i1", "alumier", "AlumierMD Europe S.L.", "2026-07-10", 121_000)],
      [tx("t1", "2026-07-15", -121_000, "RECIBO ALUMIERMD EUROPE"), tx("t2", "2026-07-20", -4_999, "COMPRA AMAZON MKTPLACE")],
      suppliers,
    );
    expect(r.matches).toEqual([expect.objectContaining({ invoiceIds: ["i1"], transactionIds: ["t1"], kind: "1:1" })]);
    expect(r.chargesWithoutInvoice).toEqual(["t2"]);
    expect(r.invoicesWithoutPayment).toEqual([]);
  });

  it("detecta desalineamiento de importe entre factura y cargo del mismo proveedor", () => {
    const r = reconcile(
      [inv("i1", "endesa", "Endesa Energía S.A.U.", "2026-08-01", 18_150)],
      [tx("t1", "2026-08-05", -15_000, "ADEUDO ENDESA ENERGIA")],
      suppliers,
    );
    expect(r.matches).toHaveLength(0);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({ invoiceId: "i1", transactionId: "t1", differenceCents: -3_150 });
    expect(r.mismatches[0]!.reason).toMatch(/IVA del 21%/);
    expect(r.chargesWithoutInvoice).toEqual([]);
  });

  it("un cargo que paga varias facturas del mismo proveedor (1:N)", () => {
    const r = reconcile(
      [
        inv("i1", "celluma", "BioPhotas Celluma", "2026-07-02", 30_000),
        inv("i2", "celluma", "BioPhotas Celluma", "2026-07-16", 20_000),
      ],
      [tx("t1", "2026-07-31", -50_000, "TRANSFERENCIA CELLUMA JULIO")],
      suppliers,
    );
    expect(r.matches).toEqual([expect.objectContaining({ kind: "1:N", transactionIds: ["t1"] })]);
    expect(r.matches[0]!.invoiceIds.sort()).toEqual(["i1", "i2"]);
  });

  it("una factura pagada en varios cargos (N:1)", () => {
    const r = reconcile(
      [inv("i1", "celluma", "BioPhotas Celluma", "2026-07-02", 90_000)],
      [
        tx("t1", "2026-07-05", -30_000, "CELLUMA PLAZO 1"),
        tx("t2", "2026-08-05", -30_000, "CELLUMA PLAZO 2"),
        tx("t3", "2026-08-30", -30_000, "CELLUMA PLAZO 3"),
      ],
      suppliers,
    );
    expect(r.matches).toEqual([expect.objectContaining({ kind: "N:1", invoiceIds: ["i1"] })]);
    expect(r.chargesWithoutInvoice).toEqual([]);
  });

  it("ignora cargos marcados o de proveedores que no emiten factura", () => {
    const r = reconcile(
      [],
      [
        tx("t1", "2026-07-01", -1_200, "COMISION MANTENIMIENTO CUENTA"),
        tx("t2", "2026-07-20", -250_000, "SEGUROS SOCIALES TGSS", { noInvoiceExpected: true }),
        tx("t3", "2026-07-21", 10_000, "ABONO TPV"),
      ],
      suppliers,
    );
    expect(r.chargesWithoutInvoice).toEqual([]);
  });

  it("no empareja si la fecha está fuera de ventana", () => {
    const r = reconcile(
      [inv("i1", "alumier", "AlumierMD Europe S.L.", "2026-01-10", 10_000)],
      [tx("t1", "2026-07-15", -10_000, "RECIBO ALUMIERMD")],
      suppliers,
    );
    expect(r.matches).toHaveLength(0);
    expect(r.chargesWithoutInvoice).toEqual(["t1"]);
    expect(r.invoicesWithoutPayment).toEqual(["i1"]);
  });

  it("respeta matches manuales y detecta duplicados", () => {
    const r = reconcile(
      [
        inv("i1", "alumier", "AlumierMD", "2026-07-10", 10_000, "F-1"),
        inv("i2", "alumier", "AlumierMD", "2026-07-10", 10_000, "F-1"),
      ],
      [tx("t1", "2026-07-11", -10_000, "XYZ"), tx("t2", "2026-07-12", -500, "BAR"), tx("t3", "2026-07-12", -500, "BAR")],
      suppliers,
      { locked: [{ invoiceId: "i2", transactionId: "t1" }] },
    );
    expect(r.matches[0]).toMatchObject({ invoiceIds: ["i2"], transactionIds: ["t1"] });
    expect(r.duplicates.map((d) => d.type).sort()).toEqual(["invoice", "transaction"]);
  });

  it("empareja abonos (rectificativas) con devoluciones", () => {
    const r = reconcile(
      [inv("i1", "alumier", "AlumierMD", "2026-07-10", -5_000)],
      [tx("t1", "2026-07-14", 5_000, "DEVOLUCION ALUMIERMD")],
      suppliers,
    );
    expect(r.matches).toHaveLength(1);
  });
});
