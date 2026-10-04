import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { runFullSync } from "@/services/pipeline";

export const maxDuration = 300;

/** Sincronización automática diaria (Vercel Cron → Authorization: Bearer CRON_SECRET). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const clinics = await db.query.clinics.findMany({ columns: { id: true } });
  const results: Record<string, unknown> = {};
  for (const c of clinics) {
    results[c.id] = await runFullSync(c.id, "cron");
    await audit({ clinicId: c.id, action: "sync.cron" });
  }
  return NextResponse.json({ ok: true, results });
}
