import { z } from "zod";

/**
 * Validación centralizada de variables de entorno. Si falta algo crítico
 * la app falla al arrancar en lugar de comportarse de forma impredecible.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Clave maestra AES-256 (32 bytes en base64) para cifrar tokens de terceros. */
  ENCRYPTION_KEY: z.string().min(40),
  /** Emails autorizados a crear cuenta (bootstrap). Luego se gestiona con invitaciones. */
  ALLOWED_EMAILS: z.string().default(""),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().optional(),
  EXTRACTION_MODEL: z.string().default("claude-opus-5-5"),

  ENABLEBANKING_APP_ID: z.string().optional(),
  /** Clave privada RSA (PEM) de la aplicación Enable Banking. */
  ENABLEBANKING_PRIVATE_KEY: z.string().optional(),

  CRON_SECRET: z.string().min(16).optional(),
  FEATURE_GESTORIA_EMAIL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
