# Arquitectura de NOOR Hub

## Vista general

```
                ┌──────────── Usuario (Mac / iPhone, navegador o PWA) ────────────┐
                │                                                                 │
                ▼                                                                 │
   ┌───────────────────────────── NOOR Hub (Next.js, Vercel fra1) ──────────────────────────────┐
   │  UI (React Server Components)   Server Actions / API routes   Cron diario (/api/cron/sync)  │
   │                                                                                             │
   │  lib/  context.ts (sesión + clínica + rol) · rbac.ts · crypto.ts (AES-256-GCM) · audit.ts   │
   │                                                                                             │
   │  services/                                                                                  │
   │   pipeline.ts ── EL BOTÓN: gmail → banco → conciliación                                     │
   │   invoices/  ingest (Gmail→IA→Drive→BD) · extract (Claude) · register (Excel trimestral)    │
   │   bank/      enablebanking (PSD2) · norma43 · csv · sync                                     │
   │   reconcile/ engine (lógica pura, testeada) · service (BD) · claims (borradores Gmail)      │
   │   gestoria/  quarterly (fase 2)                                                             │
   └───────┬─────────────────┬───────────────────┬────────────────────┬──────────────────────────┘
           │                 │                   │                    │
     Postgres (UE)     Google APIs          Claude API          Enable Banking
     Neon/Supabase     Gmail · Drive        (lectura de         (PSD2, AISP,
     datos + auditoría (buzón de compras)    facturas)           solo lectura)
```

## Decisiones clave

| Decisión | Por qué |
|---|---|
| **Web app (Next.js + TypeScript)** en vez de app nativa | Un solo código para Mac y iPhone (PWA "Añadir a pantalla de inicio"). Si mañana se quiere app nativa (SwiftUI/Expo), consume la misma lógica de `services/`. |
| **Postgres + Drizzle ORM** | Datos relacionales (facturas ↔ pagos ↔ proveedores), transacciones, y preparado para Row-Level Security. Hosting en la UE. |
| **Multi-clínica desde el día 1** (`organizations → clinics → memberships`) | Toda tabla de negocio lleva `clinic_id`; todo acceso pasa por `requireContext()`, que resuelve la clínica activa y el rol. Añadir usuarios o clínicas no requiere migrar datos. |
| **Login separado del buzón** | Los usuarios entran con su cuenta (Better Auth + Google). El buzón de compras se conecta una vez por clínica (`integrations`), con tokens cifrados. |
| **IA solo para leer documentos** | La extracción usa Claude con salida estructurada validada (Zod). Las decisiones (conciliación, importes) son código determinista y testeado. |
| **Drive como archivo, BD como sistema de registro** | Drive es lo que ves y compartes con la gestoría; la BD permite cruzar con el banco, buscar, auditar. El Excel trimestral se regenera solo. |
| **Banco por PSD2 + Norma 43 de respaldo** | Enable Banking cubre la mayoría de bancos españoles. Si un banco falla o caduca el consentimiento, el extracto Norma 43 funciona siempre. |
| **Procesado por lotes e idempotente** | Cada email/archivo se procesa una sola vez (hash SHA-256). Si hay muchos, el botón procesa 25 y el siguiente clic (o el cron) continúa. |

## Flujo "Buscar facturas y conciliar"

1. **Gmail**: consulta `after:<última fecha> (factura OR invoice OR recibo …) OR from:<dominios de proveedores>`; excluye enviados y borradores.
2. Por cada adjunto candidato (PDF, JPG/PNG, XML Facturae): hash → si ya existe, duplicado; si no → **Claude** extrae los datos y decide si es factura (descarta proformas, presupuestos, albaranes).
3. Alta/actualización de **proveedor** (por NIF, nombre o dominio de email) con alias bancario inicial.
4. **Drive**: `NOOR Clinic - Facturas/2026/2026-T3 (Jul-Sep)/Compras/2026-08-14_Proveedor_Nº_Total.pdf`.
5. **BD**: factura + líneas + desglose IVA. Confianza < 85 % o faltan datos → estado *Revisar*.
6. Emails con la factura solo como **enlace** → se listan en el panel para descargarlas a mano.
7. **Banco**: descarga movimientos nuevos de cada cuenta conectada.
8. **Conciliación** del trimestre actual y el anterior (ver `services/reconcile/engine.ts`):
   - 1:1 por importe exacto + ventana de fechas (−20 / +60 días) + similitud de nombre/alias.
   - 1 cargo → N facturas (pago agrupado) y 1 factura → N cargos (fraccionado), por suma exacta.
   - Desalineamientos: mismo proveedor y fecha, importe distinto (diagnostica IVA, comisiones, pagos parciales).
   - Cargos sin factura (excluye los marcados "no requiere": impuestos, nóminas, traspasos, comisiones).
   - Duplicados de factura y de cargo.
9. **Excel** del trimestre regenerado en Drive.

## Modelo de datos (resumen)

`organizations` · `clinics` · `user/session/account` (Better Auth) · `memberships` (rol por clínica) · `invitations` · `integrations` (secretos cifrados) · `suppliers` · `invoices` · `invoice_lines` · `gmail_messages` (idempotencia) · `bank_accounts` · `bank_transactions` · `reconciliation_matches` (N:M, auto/manual) · `sync_runs` · `gestoria_submissions` · `audit_log`.

Detalle en `src/db/schema.ts`; migraciones en `drizzle/`.
