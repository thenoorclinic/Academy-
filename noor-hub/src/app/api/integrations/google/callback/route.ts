import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { exchangeCodeAndStore, verifyState } from "@/services/google/client";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await requireContext("integrations:manage");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/ajustes?error=google", url));
  const payload = await verifyState(state).catch(() => null);
  // El state debe corresponder al MISMO usuario y clínica que inició el flujo.
  if (!payload || payload.userId !== ctx.userId || payload.clinicId !== ctx.clinicId) {
    return NextResponse.redirect(new URL("/ajustes?error=state", url));
  }
  const id = await exchangeCodeAndStore(code, ctx.clinicId, ctx.userId);
  await audit({ clinicId: ctx.clinicId, userId: ctx.userId, action: "integration.google.connected", entityType: "integration", entityId: id });
  return NextResponse.redirect(new URL("/ajustes?ok=google", url));
}
