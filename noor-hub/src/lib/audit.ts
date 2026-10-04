import { db, schema } from "@/db";

export type AuditEntry = {
  clinicId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Registro de auditoría append-only. Nunca guardar aquí datos sensibles
 * (tokens, contenido de facturas, datos de pacientes): solo qué, quién y cuándo.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      clinicId: entry.clinicId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
    });
  } catch (err) {
    // La auditoría no debe tumbar la operación principal, pero sí dejar rastro.
    console.error("[audit] no se pudo registrar", entry.action, err);
  }
}
