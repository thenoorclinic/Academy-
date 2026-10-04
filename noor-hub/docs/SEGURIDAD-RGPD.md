# Seguridad y protección de datos

Hoy la app trata **datos de proveedores y bancarios** (no de pacientes). Pero está pensada para convertirse en la plataforma de la clínica, donde habrá **datos de salud** (categoría especial, art. 9 RGPD). Por eso las bases ya están puestas.

## Lo que ya está implementado

| Área | Medida |
|---|---|
| **Autenticación** | Login con Google (Better Auth), sesiones de 7 días en cookie `httpOnly`/`Secure`, rate limiting. Registro cerrado: solo `ALLOWED_EMAILS` o invitación. |
| **Autorización** | RBAC por clínica (`owner`, `admin`, `finance`, `staff`, `viewer`) con denegación por defecto (`src/lib/rbac.ts`). Cada página/acción declara el permiso que necesita. |
| **Aislamiento multi-clínica** | Todo dato lleva `clinic_id`; las consultas filtran siempre por la clínica del contexto, y las acciones verifican que el recurso pertenece a ella. |
| **Secretos de terceros** | Refresh token de Google y sesión bancaria cifrados con **AES-256-GCM** (clave fuera de la BD, versionada para rotación). |
| **Mínimo privilegio en APIs** | Gmail solo lectura + borradores; Drive `drive.file` (solo ve lo que crea la app, no el resto de tu Drive); banco solo lectura (AISP). IBAN completo nunca se guarda. |
| **OAuth seguro** | `state` firmado con caducidad y ligado a usuario+clínica (anti-CSRF). |
| **Auditoría** | `audit_log` de conexiones, importaciones, cambios de estado, exportaciones y envíos (sin datos sensibles en el log). |
| **Cabeceras HTTP** | HSTS, CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; `noindex`. |
| **Validación de entradas** | Zod en todas las server actions; límites de tamaño y tipo de archivo. |
| **Cron protegido** | Secreto comparado en tiempo constante. |
| **Residencia de datos** | Servidor y BD en la UE (Frankfurt). |

## Encargados del tratamiento (firmar/aceptar DPA)
Google (Gmail/Drive), Anthropic (Claude API: no entrena con datos de la API), Vercel, Neon/Supabase, Enable Banking. Registrar en el **Registro de Actividades de Tratamiento** (RAT).

## Conservación
Facturas y registros contables: **6 años** (art. 30 Código de Comercio; 4 años a efectos fiscales, LGT). No borrar antes.

## Antes de añadir datos de pacientes (fase "clínica")
1. **Evaluación de impacto (EIPD/DPIA)** — obligatoria para datos de salud a escala.
2. Valorar **Delegado de Protección de Datos**.
3. **MFA obligatorio / passkeys** (Face ID/Touch ID) — Better Auth tiene plugins `twoFactor` y `passkey`.
4. **Row-Level Security** en Postgres como segunda barrera del aislamiento por clínica.
5. Cifrado a nivel de campo para datos clínicos y BD separada para historia clínica (Ley 41/2002: conservación mínima 5 años desde el alta).
6. Copias de seguridad cifradas con prueba de restauración, registro de accesos a historias clínicas, revisión periódica de permisos, pentest antes de abrirlo a más usuarios.
7. Formación del personal y procedimiento de notificación de brechas (72 h a la AEPD).
