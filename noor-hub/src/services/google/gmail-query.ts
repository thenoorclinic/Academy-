/**
 * Construye la búsqueda de Gmail para localizar facturas de compra.
 * Se combina: (a) palabras clave típicas en castellano/inglés con adjunto,
 * (b) remitentes conocidos de proveedores, (c) consulta extra del usuario.
 */
const KEYWORDS = [
  "factura",
  "facturas",
  "invoice",
  "receipt",
  "recibo",
  "\"nº factura\"",
  "\"número de factura\"",
  "\"factura electrónica\"",
  "facturae",
  "abono",
  "rectificativa",
];

export function buildInvoiceQuery(opts: { after: string; supplierDomains?: string[]; extra?: string }): string {
  const after = opts.after.replaceAll("-", "/");
  const keywordClause = `(${KEYWORDS.join(" OR ")})`;
  const domains = (opts.supplierDomains ?? []).filter(Boolean).map((d) => `from:${d}`);
  const senderClause = domains.length ? ` OR (${domains.join(" OR ")})` : "";
  const extra = opts.extra?.trim() ? ` OR (${opts.extra.trim()})` : "";
  // Excluimos lo que nosotros mismos enviamos (p. ej. el email a la gestoría).
  return `after:${after} -in:chats -in:sent -in:drafts (${keywordClause}${senderClause}${extra})`;
}

/** Adjuntos que pueden ser una factura. */
export function isCandidateAttachment(filename: string, mimeType: string): boolean {
  const name = filename.toLowerCase();
  if (/\.(pdf|xml|xsig|jpg|jpeg|png|heic)$/.test(name)) return !/(logo|firma|signature|banner|image0\d)/.test(name);
  return mimeType === "application/pdf";
}

/** Señales de que el email contiene una factura solo como enlace de descarga. */
export function looksLikeInvoiceLink(text: string): boolean {
  return /(descarga|descargar|download|ver|view|consulta)[^.\n]{0,40}(factura|invoice|recibo|receipt)/i.test(text);
}
