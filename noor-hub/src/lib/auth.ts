import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Autenticación de USUARIOS de la app (quién entra).
 * Es independiente de la conexión de Gmail/Drive de la clínica (qué buzón se lee):
 * en el futuro varias personas entrarán con su propia cuenta, pero el buzón de
 * compras seguirá siendo uno, conectado una vez por un administrador.
 *
 * Registro cerrado: solo pueden crear cuenta los emails de ALLOWED_EMAILS
 * o con una invitación pendiente.
 */
async function isEmailAllowed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const allow = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allow.includes(normalized)) return true;
  const invite = await db.query.invitations.findFirst({
    where: and(eq(schema.invitations.email, normalized), isNull(schema.invitations.acceptedAt)),
  });
  return Boolean(invite);
}

export const auth = betterAuth({
  baseURL: process.env.APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24, // se renueva a diario si hay actividad
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!(await isEmailAllowed(user.email))) return false;
        },
        after: async (user) => {
          await acceptInvitations(user.id, user.email);
        },
      },
    },
  },
  plugins: [nextCookies()],
});

/** Convierte invitaciones pendientes en memberships al crear la cuenta. */
async function acceptInvitations(userId: string, email: string) {
  const pending = await db.query.invitations.findMany({
    where: and(eq(schema.invitations.email, email.toLowerCase()), isNull(schema.invitations.acceptedAt)),
  });
  for (const inv of pending) {
    await db
      .insert(schema.memberships)
      .values({ userId, clinicId: inv.clinicId, role: inv.role })
      .onConflictDoNothing();
    await db
      .update(schema.invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invitations.id, inv.id));
  }
}
