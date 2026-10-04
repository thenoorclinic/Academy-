import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { requireContext } from "@/lib/context";
import { startAuthorization } from "@/services/bank/enablebanking";

export async function GET(req: Request) {
  const ctx = await requireContext("integrations:manage");
  const bankName = new URL(req.url).searchParams.get("bank");
  if (!bankName) return NextResponse.json({ error: "Falta el banco" }, { status: 400 });
  const state = await new SignJWT({ clinicId: ctx.clinicId, userId: ctx.userId, bankName })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.BETTER_AUTH_SECRET));
  const { url } = await startAuthorization({
    bankName,
    state,
    redirectUrl: `${process.env.APP_URL}/api/integrations/bank/callback`,
  });
  return NextResponse.redirect(url);
}
