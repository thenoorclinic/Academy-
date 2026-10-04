/**
 * Control de acceso basado en roles (RBAC).
 * Hoy solo hay un usuario (owner), pero la matriz ya está preparada para
 * recepción, profesionales sanitarios, gestoría con acceso de lectura, etc.
 * Regla: denegar por defecto; cada acción debe estar explícitamente permitida.
 */
export const ROLES = ["owner", "admin", "finance", "staff", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "invoices:read",
  "invoices:write",
  "bank:read",
  "bank:write",
  "reconcile:run",
  "suppliers:write",
  "integrations:manage",
  "gestoria:send",
  "members:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== "members:manage"),
  finance: [
    "invoices:read",
    "invoices:write",
    "bank:read",
    "bank:write",
    "reconcile:run",
    "suppliers:write",
    "gestoria:send",
  ],
  staff: ["invoices:read", "invoices:write"],
  viewer: ["invoices:read", "bank:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
