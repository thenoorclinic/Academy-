import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifrado de secretos en reposo (refresh tokens de Google, sesiones bancarias).
 * AES-256-GCM con IV aleatorio y etiqueta de autenticación.
 * Formato: "v1.<iv>.<tag>.<ciphertext>" en base64url. El prefijo de versión
 * permite rotar la clave maestra sin romper los datos existentes.
 */
const VERSION = "v1";

function loadKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY debe ser 32 bytes en base64");
  return key;
}

export function encryptSecret(plaintext: string, rawKey = process.env.ENCRYPTION_KEY ?? ""): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, rawKey = process.env.ENCRYPTION_KEY ?? ""): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Formato de secreto cifrado no válido");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
