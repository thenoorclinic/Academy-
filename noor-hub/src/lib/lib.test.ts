import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";
import { parseEuroNumber, toCents } from "./money";
import { previousQuarter, quarterLabel, quarterOf, quarterRange } from "./quarter";
import { can } from "./rbac";
import { invoiceFileName } from "@/services/google/drive";
import { buildInvoiceQuery, isCandidateAttachment } from "@/services/google/gmail-query";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("crypto", () => {
  it("cifra y descifra; el texto cifrado no contiene el secreto", () => {
    const enc = encryptSecret("refresh-token-123", KEY);
    expect(enc).not.toContain("refresh-token-123");
    expect(decryptSecret(enc, KEY)).toBe("refresh-token-123");
  });
  it("detecta manipulación (GCM)", () => {
    const enc = encryptSecret("x", KEY).split(".");
    enc[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(enc.join("."), KEY)).toThrow();
  });
});

describe("money", () => {
  it("interpreta formatos español e internacional", () => {
    expect(parseEuroNumber("1.234,56")).toBe(1234.56);
    expect(parseEuroNumber("1,234.56")).toBe(1234.56);
    expect(parseEuroNumber("-45,1 €")).toBe(-45.1);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe("quarter", () => {
  it("calcula trimestres y rangos", () => {
    expect(quarterOf("2026-09-30")).toBe("2026-T3");
    expect(quarterOf("2026-10-01")).toBe("2026-T4");
    expect(quarterRange("2026-T1")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(previousQuarter("2026-T1")).toBe("2025-T4");
    expect(quarterLabel("2026-T3")).toBe("2026-T3 (Jul-Sep)");
  });
});

describe("rbac", () => {
  it("deniega por defecto", () => {
    expect(can("owner", "members:manage")).toBe(true);
    expect(can("staff", "bank:read")).toBe(false);
    expect(can("viewer", "invoices:write")).toBe(false);
  });
});

describe("gmail/drive helpers", () => {
  it("genera nombres de archivo limpios", () => {
    expect(
      invoiceFileName({ issueDate: "2026-08-14", supplierName: "AlumierMD Europe, S.L.", invoiceNumber: "F/2026/118", totalCents: 123456, ext: "pdf" }),
    ).toBe("2026-08-14_AlumierMD Europe S.L._F2026118_1234,56EUR.pdf");
  });
  it("construye la consulta de Gmail", () => {
    const q = buildInvoiceQuery({ after: "2026-07-01", supplierDomains: ["alumiermd.com"] });
    expect(q).toContain("after:2026/07/01");
    expect(q).toContain("from:alumiermd.com");
    expect(q).toContain("-in:sent");
  });
  it("filtra adjuntos", () => {
    expect(isCandidateAttachment("Factura_118.pdf", "application/pdf")).toBe(true);
    expect(isCandidateAttachment("logo.png", "image/png")).toBe(false);
    expect(isCandidateAttachment("doc.docx", "application/msword")).toBe(false);
  });
});
