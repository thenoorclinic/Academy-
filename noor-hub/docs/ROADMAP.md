# Hoja de ruta y propuesta de automatización ampliada

## ✅ Fase 1 — Facturas de compra (construida)
Gmail → IA → Drive por trimestres → registro de gastos → banco → conciliación ("tienes X cargos sin factura", desalineamientos, duplicados) → reclamar factura con un clic. Botón + cron diario.

## ✅ Fase 2 — Gestoría (construida, desactivada)
Email trimestral con resumen de IVA por tipo, Excel adjunto y carpeta de Drive compartida en lectura. Activar con `FEATURE_GESTORIA_EMAIL=true` tras revisar un par de trimestres.

---

## Propuesta: ir más allá

Ordenado por **impacto / esfuerzo** para una clínica como NOOR.

### Fase 3 — Que no se escape ninguna factura (cierre automático del trimestre)
1. **Reclamación automática escalonada**: hoy crea un borrador; siguiente paso: recordatorio automático a los 7 y 14 días si la factura no llega, y aviso a ti si sigue faltando.
2. **Buzón dedicado `facturas@…`** (alias de Gmail) para dar a los proveedores: todo lo que llegue ahí se procesa con certeza 100 %.
3. **Proveedores que solo dan enlace o portal** (Meta Ads, Google Ads, Amazon Business, telefonía, luz): descarga automática vía sus APIs o automatización de navegador.
4. **Foto desde el iPhone**: Atajo de iOS "Enviar factura a NOOR" (cámara → subida directa). Para tickets de papel.
5. **Recordatorio de cierre**: el día 5 del mes siguiente al trimestre, aviso con lo que falta antes de enviar a la gestoría (plazo del 303: día 20 del mes siguiente; el T4, 30 de enero).

### Fase 4 — Fiscalidad inteligente (menos trabajo para la gestoría, menos errores)
1. **Pre-cálculo de modelos**: 303 (IVA soportado), 111 (retenciones a profesionales), 115 (retención alquiler), 347 (proveedores > 3.005,06 €/año), 349.
2. **Compras intracomunitarias / extranjero**: muchos proveedores de cosmética y aparatología facturan desde fuera de España sin IVA → detectarlo (VIES), aplicar inversión del sujeto pasivo y avisar. Error muy habitual.
3. **Validación de facturas**: NIF válido, datos obligatorios (RD 1619/2012), tipos de IVA coherentes (los tratamientos médicos están exentos, pero la estética no: afecta a la deducibilidad del IVA soportado → regla de **prorrata** si la clínica mezcla ambos).
4. **Factura electrónica B2B obligatoria** (Ley Crea y Crece) y **VeriFactu**: recepción de facturas estructuradas sin OCR.
5. **Acceso directo de la gestoría** con rol de solo lectura, en vez de emails.

### Fase 5 — Ingresos y cuadre completo (integración con flowww)
1. **Ventas de flowww ↔ datáfono ↔ banco**: que lo cobrado en la clínica coincide con lo que llega al banco (liquidaciones de TPV, comisiones, Bizum, financiación de pacientes).
2. **Panel de rentabilidad**: ingresos (flowww) − gastos (NOOR Hub) por mes, por categoría y por tratamiento.
3. **Coste real por protocolo**: cruzar los 12 protocolos faciales de este repositorio (productos AlumierMD, PRO XN, Celluma) con los precios de compra de las facturas → coste de producto por sesión y margen por tratamiento.

### Fase 6 — Operación de la clínica
1. **Stock y trazabilidad**: las facturas de producto dan de alta el inventario; el consumo por protocolo lo descuenta → alertas de reposición, caducidades y lotes (trazabilidad de productos sanitarios).
2. **Previsión de tesorería**: recibos recurrentes detectados del banco + vencimientos de facturas → saldo previsto a 30/60/90 días; alertas de subidas de precio y suscripciones olvidadas.
3. **Equipo**: registro de jornada (obligatorio), turnos, comisiones por profesional, accesos por rol.
4. **Academia**: los protocolos de este repo como formación interna con control de versiones.

### Fase 7 — Multi-clínica
Panel consolidado del grupo, comparativa entre clínicas, compras centralizadas. El modelo de datos ya lo soporta.

### Transversal — Asistente
- Resumen semanal automático (lunes): gasto, facturas pendientes, alertas.
- Preguntas en lenguaje natural: *"¿Cuánto llevamos gastado en Alumier este año?"*, *"¿Qué proveedores han subido precios?"*.
- Notificaciones push en el iPhone.

---

## Próximo paso recomendado
1. Desplegar la fase 1 y dejarla funcionando 1 trimestre completo (T4 2026), revisando las facturas marcadas como *Revisar* para afinar alias de proveedores.
2. Activar la fase 2 para el envío del T4 (enero 2027).
3. En paralelo: **Fase 3.1 + 3.5** (reclamación automática y aviso de cierre) y **4.2** (intracomunitarias), que son las de mayor ahorro de tiempo y riesgo fiscal.
