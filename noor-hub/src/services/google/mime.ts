import type { gmail_v1 } from "googleapis";

export type AttachmentRef = { filename: string; mimeType: string; attachmentId?: string; inlineData?: string; size: number };

/** Recorre recursivamente las partes MIME de un mensaje de Gmail. */
export function collectParts(payload: gmail_v1.Schema$MessagePart | undefined) {
  const attachments: AttachmentRef[] = [];
  const texts: string[] = [];
  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;
    const filename = part.filename ?? "";
    const mimeType = part.mimeType ?? "";
    if (filename) {
      attachments.push({
        filename,
        mimeType,
        attachmentId: part.body?.attachmentId ?? undefined,
        inlineData: part.body?.data ?? undefined,
        size: part.body?.size ?? 0,
      });
    } else if ((mimeType === "text/plain" || mimeType === "text/html") && part.body?.data) {
      texts.push(decodeBase64Url(part.body.data).toString("utf8"));
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return { attachments, text: texts.join("\n").replace(/<[^>]+>/g, " ") };
}

export function header(msg: gmail_v1.Schema$Message, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

export function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** "Proveedor SL <facturas@proveedor.es>" → "proveedor.es" */
export function senderDomain(from: string | undefined): string | null {
  const m = /@([\w.-]+)/.exec(from ?? "");
  return m?.[1]?.toLowerCase() ?? null;
}

const PUBLIC_DOMAINS = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.es", "yahoo.com", "icloud.com", "me.com", "live.com"]);
export function isPublicDomain(domain: string | null) {
  return !domain || PUBLIC_DOMAINS.has(domain);
}

/** Construye un email RFC 2822 (con adjuntos opcionales) en base64url para la API de Gmail. */
export function buildMime(opts: {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; mimeType: string; data: Buffer }[];
}): string {
  const boundary = `noor_${Math.random().toString(36).slice(2)}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(opts.subject).toString("base64")}?=`;
  const lines = [
    `To: ${opts.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.text).toString("base64"),
  ];
  for (const a of opts.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      a.data.toString("base64").replace(/.{76}/g, "$&\r\n"),
    );
  }
  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}
