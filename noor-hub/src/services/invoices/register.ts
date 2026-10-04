import ExcelJS from "exceljs";
import { and, asc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DriveStore } from "@/services/google/drive";

/**
 * "Libro registro de facturas recibidas" del trimestre en Excel.
 * Columnas pensadas para que la gestoría pueda importar directamente
 * (fecha, nº, proveedor, NIF, base, tipo IVA, cuota, retención, total).
 */
export async function buildQuarterRegister(clinicId: string, quarter: string): Promise<Buffer> {
  const rows = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.clinicId, clinicId), eq(schema.invoices.quarter, quarter), ne(schema.invoices.status, "rejected")))
    .orderBy(asc(schema.invoices.issueDate));

  const wb = new ExcelJS.Workbook();
  wb.creator = "NOOR Hub";
  const ws = wb.addWorksheet(`Recibidas ${quarter}`);
  ws.columns = [
    { header: "Fecha expedición", key: "date", width: 14 },
    { header: "Nº factura", key: "number", width: 18 },
    { header: "Proveedor", key: "supplier", width: 34 },
    { header: "NIF proveedor", key: "taxId", width: 14 },
    { header: "Tipo", key: "kind", width: 12 },
    { header: "Base imponible", key: "net", width: 14, style: { numFmt: "#,##0.00 €" } },
    { header: "Tipo IVA", key: "rate", width: 10 },
    { header: "Cuota IVA", key: "vat", width: 12, style: { numFmt: "#,##0.00 €" } },
    { header: "Retención IRPF", key: "wh", width: 14, style: { numFmt: "#,##0.00 €" } },
    { header: "Total", key: "total", width: 14, style: { numFmt: "#,##0.00 €" } },
    { header: "Categoría", key: "category", width: 20 },
    { header: "Estado", key: "status", width: 12 },
    { header: "Archivo (Drive)", key: "link", width: 40 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const kindLabel = { invoice: "Completa", simplified: "Simplificada", credit_note: "Rectificativa" } as const;
  for (const inv of rows) {
    // Una fila por tipo de IVA (como exige el libro registro), o una sola si no hay desglose.
    const breakdown = inv.vatBreakdown.length
      ? inv.vatBreakdown
      : [{ rate: inv.netCents ? Math.round((inv.vatCents / inv.netCents) * 100) : 0, baseCents: inv.netCents, vatCents: inv.vatCents }];
    breakdown.forEach((v, idx) => {
      ws.addRow({
        date: inv.issueDate,
        number: inv.invoiceNumber,
        supplier: inv.supplierName,
        taxId: inv.supplierTaxId,
        kind: kindLabel[inv.kind],
        net: v.baseCents / 100,
        rate: `${v.rate}%`,
        vat: v.vatCents / 100,
        wh: idx === 0 ? inv.withholdingCents / 100 : 0,
        total: idx === 0 ? inv.totalCents / 100 : 0,
        category: inv.category,
        status: inv.status === "confirmed" ? "OK" : "Revisar",
        link: inv.driveWebUrl ? { text: "Abrir", hyperlink: inv.driveWebUrl } : "",
      });
    });
  }
  const last = ws.rowCount;
  const totals = ws.addRow({ supplier: "TOTAL" });
  totals.font = { bold: true };
  for (const col of ["F", "H", "I", "J"]) {
    ws.getCell(`${col}${totals.number}`).value = { formula: `SUM(${col}2:${col}${last})` };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function writeQuarterRegister(clinicId: string, quarter: string, store: DriveStore) {
  const data = await buildQuarterRegister(clinicId, quarter);
  return store.upload({
    folderId: await store.quarterFolder(quarter),
    name: `Registro facturas recibidas ${quarter}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data,
    replaceExisting: true,
  });
}
