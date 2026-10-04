import { describe, expect, it } from "vitest";
import { parseNorma43 } from "./norma43";
import { parseBankCsv } from "./csv";

const n43 = [
  "11" + "0049" + "1500" + "0123456789" + "260701" + "260731" + "2" + "00000000500000" + "978" + "3" + "THE NOOR CLINIC".padEnd(26) + "   ",
  "22" + "    " + "1500" + "260715" + "260715" + "02" + "011" + "1" + "00000000121000" + "0000000000" + "000000000000" + "ALUMIERMD EUROPE".padEnd(16),
  "23" + "01" + "RECIBO FRA F-2026-118".padEnd(38) + "".padEnd(38),
  "22" + "    " + "1500" + "260720" + "260720" + "12" + "099" + "2" + "00000000035000" + "0000000000" + "000000000000" + "TPV VENTAS".padEnd(16),
  "33" + "".padEnd(78),
  "88" + "".padEnd(78),
].join("\n");

describe("parseNorma43", () => {
  it("lee cuentas y movimientos con signo y concepto complementario", () => {
    const [acc] = parseNorma43(n43);
    expect(acc!.account.currency).toBe("EUR");
    expect(acc!.transactions).toHaveLength(2);
    expect(acc!.transactions[0]).toMatchObject({ bookingDate: "2026-07-15", amountCents: -121000 });
    expect(acc!.transactions[0]!.description).toContain("ALUMIERMD EUROPE");
    expect(acc!.transactions[0]!.description).toContain("RECIBO FRA F-2026-118");
    expect(acc!.transactions[1]!.amountCents).toBe(35000);
    expect(acc!.transactions[0]!.externalId).not.toBe(acc!.transactions[1]!.externalId);
  });
});

describe("parseBankCsv", () => {
  it("formato español con columna Importe", () => {
    const csv = "Movimientos cuenta ES12...\nFecha;Fecha valor;Concepto;Importe;Saldo\n15/07/2026;15/07/2026;RECIBO ALUMIERMD;-1.210,00;3.790,00\n20/07/2026;20/07/2026;TPV;350,00;4.140,00";
    const tx = parseBankCsv(csv, "acc");
    expect(tx).toHaveLength(2);
    expect(tx[0]).toMatchObject({ bookingDate: "2026-07-15", amountCents: -121000, description: "RECIBO ALUMIERMD" });
    expect(tx[1]!.amountCents).toBe(35000);
  });
  it("formato con columnas Cargo / Abono", () => {
    const csv = 'Fecha,Descripción,Cargo,Abono\n2026-07-15,"ENDESA, ADEUDO",181.50,\n2026-07-16,TRANSFER,,100.00';
    const tx = parseBankCsv(csv, "acc");
    expect(tx.map((t) => t.amountCents)).toEqual([-18150, 10000]);
    expect(tx[0]!.description).toBe("ENDESA, ADEUDO");
  });
});
