import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { buildQuarterRegister } from "@/services/invoices/register";

export async function GET(req: Request) {
  const ctx = await requireContext("invoices:read");
  const quarter = new URL(req.url).searchParams.get("q") ?? "";
  if (!/^\d{4}-T[1-4]$/.test(quarter)) return NextResponse.json({ error: "Trimestre no válido" }, { status: 400 });
  const data = await buildQuarterRegister(ctx.clinicId, quarter);
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "export.register", metadata: { quarter } });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Registro facturas recibidas ${quarter}.xlsx"`,
    },
  });
}
