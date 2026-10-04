import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { db, schema } from "@/db";
import { decryptJson, encryptJson } from "@/lib/crypto";

/**
 * Conexión del BUZÓN DE COMPRAS de la clínica (p. ej. acostamedicalconsulting@gmail.com).
 *
 * Scopes mínimos necesarios (principio de mínimo privilegio):
 *  - gmail.readonly → buscar y leer emails con facturas (nunca borra ni modifica)
 *  - gmail.compose  → crear BORRADORES para reclamar facturas y (fase 2) enviar a la gestoría
 *  - drive.file     → solo ve/crea los archivos y carpetas que crea la propia app
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.file",
];

type GoogleSecret = { refresh_token: string };

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/integrations/google/callback`,
  );
}

const stateKey = () => new TextEncoder().encode(process.env.BETTER_AUTH_SECRET);

/** `state` firmado y con caducidad: evita CSRF en el callback OAuth. */
export async function buildGoogleAuthUrl(clinicId: string, userId: string): Promise<string> {
  const state = await new SignJWT({ clinicId, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(stateKey());
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // garantiza refresh_token
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export async function verifyState(state: string) {
  const { payload } = await jwtVerify(state, stateKey());
  return payload as { clinicId: string; userId: string };
}

export async function exchangeCodeAndStore(code: string, clinicId: string, userId: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google no devolvió refresh_token. Revoca el acceso y vuelve a conectar.");
  client.setCredentials(tokens);
  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const email = data.email ?? "desconocido";

  const secretEnc = encryptJson({ refresh_token: tokens.refresh_token } satisfies GoogleSecret);
  const existing = await db.query.integrations.findFirst({
    where: and(eq(schema.integrations.clinicId, clinicId), eq(schema.integrations.provider, "google")),
  });
  if (existing) {
    await db
      .update(schema.integrations)
      .set({ externalAccount: email, secretEnc, scopes: tokens.scope, status: "active" })
      .where(eq(schema.integrations.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(schema.integrations)
    .values({ clinicId, provider: "google", externalAccount: email, secretEnc, scopes: tokens.scope, createdBy: userId })
    .returning({ id: schema.integrations.id });
  return row!.id;
}

/** Cliente autenticado para la clínica. Lanza error si no hay conexión activa. */
export async function getGoogleClients(clinicId: string) {
  const integration = await db.query.integrations.findFirst({
    where: and(eq(schema.integrations.clinicId, clinicId), eq(schema.integrations.provider, "google")),
  });
  if (!integration || integration.status !== "active") {
    throw new Error("Gmail/Drive no está conectado. Ve a Ajustes → Conectar Google.");
  }
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: decryptJson<GoogleSecret>(integration.secretEnc).refresh_token });
  auth.on("tokens", () => {
    /* access tokens viven solo en memoria; el refresh token no cambia */
  });
  return {
    integration,
    gmail: google.gmail({ version: "v1", auth }),
    drive: google.drive({ version: "v3", auth }),
    markExpired: () =>
      db.update(schema.integrations).set({ status: "expired" }).where(eq(schema.integrations.id, integration.id)),
  };
}

export function isInvalidGrant(err: unknown): boolean {
  return err instanceof Error && /invalid_grant/i.test(err.message);
}
