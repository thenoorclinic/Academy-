import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { encryptJson } from "@/lib/crypto";
import { createSession } from "@/services/bank/enablebanking";
import { ensureBankAccount, runBankSync } from "@/services/bank/sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await requireContext("integrations:manage");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/ajustes?error=bank", url));
  const { payload } = await jwtVerify(state, new TextEncoder().encode(process.env.BETTER_AUTH_SECRET)).catch(() => ({ payload: null }));
  if (!payload || payload.userId !== ctx.userId || payload.clinicId !== ctx.clinicId) {
    return NextResponse.redirect(new URL("/ajustes?error=state", url));
  }
  const session = await createSession(code);
  const [integ] = await db
    .insert(schema.integrations)
    .values({
      clinicId: ctx.clinicId,
      provider: "enablebanking",
      externalAccount: String(payload.bankName ?? "Banco"),
      secretEnc: encryptJson({ sessionId: session.sessionId }),
      expiresAt: session.validUntil ? new Date(session.validUntil) : null,
      createdBy: ctx.userId,
    })
    .returning();
  for (const acc of session.accounts) await ensureBankAccount(ctx.clinicId, acc, integ!.id);
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "integration.bank.connected", entityType: "integration", entityId: integ!.id });
  await runBankSync(ctx.clinicId, { trigger: "button" }).catch(() => undefined);
  return NextResponse.redirect(new URL("/banco?ok=bank", url));
}
