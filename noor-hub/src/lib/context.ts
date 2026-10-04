import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { auth } from "./auth";
import { can, type Permission, type Role } from "./rbac";

export type ClinicContext = {
  userId: string;
  userEmail: string;
  userName: string;
  clinicId: string;
  clinicName: string;
  role: Role;
};

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`No tienes permiso para: ${permission}`);
  }
}

/**
 * Punto ÚNICO de entrada para cualquier página, server action o API interna:
 * resuelve usuario + clínica activa + rol, y comprueba el permiso pedido.
 * Toda consulta de negocio debe filtrar por `ctx.clinicId`.
 */
export async function requireContext(permission?: Permission): Promise<ClinicContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const memberships = await db
    .select({
      clinicId: schema.memberships.clinicId,
      role: schema.memberships.role,
      clinicName: schema.clinics.name,
    })
    .from(schema.memberships)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.memberships.clinicId))
    .where(eq(schema.memberships.userId, session.user.id));

  if (memberships.length === 0) redirect("/onboarding");

  const selected = (await cookies()).get("clinic")?.value;
  const active = memberships.find((m) => m.clinicId === selected) ?? memberships[0]!;

  const ctx: ClinicContext = {
    userId: session.user.id,
    userEmail: session.user.email,
    userName: session.user.name,
    clinicId: active.clinicId,
    clinicName: active.clinicName,
    role: active.role,
  };
  if (permission && !can(ctx.role, permission)) throw new ForbiddenError(permission);
  return ctx;
}

export async function getClinic(clinicId: string) {
  const clinic = await db.query.clinics.findFirst({ where: eq(schema.clinics.id, clinicId) });
  if (!clinic) throw new Error("Clínica no encontrada");
  return clinic;
}

export async function hasMembership(userId: string, clinicId: string) {
  const m = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.userId, userId), eq(schema.memberships.clinicId, clinicId)),
  });
  return Boolean(m);
}
