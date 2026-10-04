import type { drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import { quarterLabel } from "@/lib/quarter";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Estructura en Drive:
 *   NOOR Clinic - Facturas/
 *     2026/
 *       2026-T3 (Jul-Sep)/
 *         Compras/  ← PDFs renombrados: 2026-08-14_Alumier_F-2026-118_1.234,56€.pdf
 *         Registro facturas recibidas 2026-T3.xlsx
 */
export class DriveStore {
  private cache = new Map<string, string>();

  constructor(
    private drive: drive_v3.Drive,
    private rootName = "NOOR Clinic - Facturas",
    private rootId?: string,
  ) {}

  private async findOrCreateFolder(name: string, parentId?: string): Promise<string> {
    const key = `${parentId ?? "root"}/${name}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const escaped = name.replace(/'/g, "\\'");
    const q = [`mimeType='${FOLDER_MIME}'`, `name='${escaped}'`, "trashed=false", parentId ? `'${parentId}' in parents` : null]
      .filter(Boolean)
      .join(" and ");
    const { data } = await this.drive.files.list({ q, fields: "files(id,name)", spaces: "drive", pageSize: 1 });
    let id = data.files?.[0]?.id ?? undefined;
    if (!id) {
      const res = await this.drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined },
        fields: "id",
      });
      id = res.data.id!;
    }
    this.cache.set(key, id);
    return id;
  }

  async root(): Promise<string> {
    if (!this.rootId) this.rootId = await this.findOrCreateFolder(this.rootName);
    return this.rootId;
  }

  async quarterFolder(quarter: string): Promise<string> {
    const year = await this.findOrCreateFolder(quarter.slice(0, 4), await this.root());
    return this.findOrCreateFolder(quarterLabel(quarter), year);
  }

  async purchasesFolder(quarter: string): Promise<string> {
    return this.findOrCreateFolder("Compras", await this.quarterFolder(quarter));
  }

  async upload(opts: { folderId: string; name: string; mimeType: string; data: Buffer; replaceExisting?: boolean }) {
    if (opts.replaceExisting) {
      const escaped = opts.name.replace(/'/g, "\\'");
      const { data } = await this.drive.files.list({
        q: `name='${escaped}' and '${opts.folderId}' in parents and trashed=false`,
        fields: "files(id)",
      });
      const existing = data.files?.[0]?.id;
      if (existing) {
        const res = await this.drive.files.update({
          fileId: existing,
          media: { mimeType: opts.mimeType, body: Readable.from(opts.data) },
          fields: "id,webViewLink",
        });
        return { id: res.data.id!, webViewLink: res.data.webViewLink ?? undefined };
      }
    }
    const res = await this.drive.files.create({
      requestBody: { name: opts.name, parents: [opts.folderId] },
      media: { mimeType: opts.mimeType, body: Readable.from(opts.data) },
      fields: "id,webViewLink",
    });
    return { id: res.data.id!, webViewLink: res.data.webViewLink ?? undefined };
  }

  async move(fileId: string, toFolderId: string) {
    const { data } = await this.drive.files.get({ fileId, fields: "parents" });
    await this.drive.files.update({
      fileId,
      addParents: toFolderId,
      removeParents: (data.parents ?? []).join(","),
      fields: "id",
    });
  }

  async rename(fileId: string, name: string) {
    await this.drive.files.update({ fileId, requestBody: { name }, fields: "id" });
  }
}

/** Nombre de archivo normalizado y seguro para Drive. */
export function invoiceFileName(i: {
  issueDate: string;
  supplierName: string;
  invoiceNumber?: string | null;
  totalCents: number;
  ext: string;
}): string {
  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w.\- ]+/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
  const total = (i.totalCents / 100).toFixed(2).replace(".", ",");
  const parts = [i.issueDate, clean(i.supplierName) || "Proveedor", i.invoiceNumber ? clean(i.invoiceNumber) : null, `${total}EUR`];
  return `${parts.filter(Boolean).join("_")}.${i.ext.replace(/^\./, "")}`;
}
