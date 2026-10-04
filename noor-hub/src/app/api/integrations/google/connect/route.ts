import { NextResponse } from "next/server";
import { requireContext } from "@/lib/context";
import { buildGoogleAuthUrl } from "@/services/google/client";

export async function GET() {
  const ctx = await requireContext("integrations:manage");
  return NextResponse.redirect(await buildGoogleAuthUrl(ctx.clinicId, ctx.userId));
}
