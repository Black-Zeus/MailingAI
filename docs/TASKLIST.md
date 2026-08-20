# Tasklist — resolución de auditorías

Seguimiento de la resolución de los hallazgos de [`AUDIT_2026-08-19.md`](AUDIT_2026-08-19.md) (sección "Auditoría 2026-08-19", completa) y de [`AUDIT_2026-08-20.md`](AUDIT_2026-08-20.md) (sección "Auditoría 2026-08-20", pendiente). Orden de trabajo dentro de cada sección: críticos primero, después altos, medios y mejoras. Marcar `[x]` solo cuando el fix esté aplicado y verificado (rebuild + prueba real, no solo el diff).

## Auditoría 2026-08-19

## Críticos

- [x] **C1** — Escapar `error`/`error_description`/`label` en el callback de SSO de buzones (`identity-broker/app/main.py:134-138,173-183`), o migrar esas respuestas a un template con autoescape. _(resuelto: `html.escape()` en las 4 interpolaciones — error/error_description, exc de intercambio de código, email_address y label de la respuesta de éxito)_
- [x] **C2** — Agregar `sandbox="allow-same-origin"` al `<iframe>` de `AttachmentItem.tsx`; evaluar validar por Content-Type real en vez de extensión. _(resuelto: sandbox agregado, mismo patrón que `MessageBodyModal.tsx`. Validar por Content-Type real queda como mejora futura, no bloqueante — el sandbox ya neutraliza la ejecución de script)_

## Altos

- [x] **H1** — Exigir sesión de admin en `/oauth/microsoft/start` (`identity-broker/app/main.py:103-123`); validar `event.origin` en el listener `onMessage` de `SettingsView.tsx:530`. _(resuelto: `require_admin_session` valida la cookie `mailingai_session` contra `identity.user_sessions` directo — mismo Postgres que el backend, sin llamada extra. Verificado: `GET /oauth/microsoft/start` sin cookie → 401)_
- [x] **H2** — Cifrar `access_token`/`refresh_token` de buzones at-rest (`identity-broker/app/repository.py`). _(resuelto: Fernet vía `app/crypto.py`, clave `MAILBOX_TOKEN_ENCRYPTION_KEY` obligatoria en `.env`/`docker-compose.yml`. Migró el buzón real existente con un script único, verificado con `/internal/token/1` devolviendo un access_token válido tras descifrar)_
- [x] **H3** — Rate-limit propio (no delegado a infra externa) en `POST /api/auth/local-login`. _(resuelto: contador en memoria por IP, 5 intentos fallidos / 5 min → 429, mismo criterio que `_PENDING_STATES`. Verificado con 6 intentos seguidos: 401×5, luego 429)_

## Medios

- [x] **M1** — Confirmar si `jobs.py` debe filtrar por `user_id` (owner/admin) y aplicarlo si corresponde. _(resuelto: se decidió con el usuario restringir a dueño+admin, igual criterio que `mailing.cases`. Se agregó `created_by_user_id` a `mailing.analysis_jobs` (migración `20260820_0001`), se filtra en `jobs_repository`/`jobs_service`/`jobs.py`, y se hilvanó el usuario a través de `case_batch_service`/`mailbox_index_service`. Jobs previos a la columna quedan huérfanos, visibles solo para admin. Verificado con SQL directo: usuario no-admin ve 0 jobs huérfanos, admin ve los 3 existentes)_
- [x] **M2** — Límite de tamaño en `/charts/*` (`points`/`buckets`); evaluar sacarlo del mapeo público de nginx. _(resuelto: `Field(max_length=500)` en `points`/`buckets`, más límites en `title`/`label`/`date`. Se dejó mapeado en nginx tal como está — sigue siendo el mismo uso server-to-server documentado, ahora acotado. Verificado: 501 puntos → 422, payload normal → 200)_
- [x] **M3** — Quitar el default débil de `POSTGRES_PASSWORD` en `docker-compose.yml`, hacerlo obligatorio. _(resuelto: las 4 ocurrencias ahora usan `${POSTGRES_PASSWORD:?...}`, mismo patrón que `WEBHOOK_SHARED_SECRET`. Verificado con `docker compose config`. Pendiente, a decisión del usuario: el `.env` real sigue con el valor débil — rotar la contraseña real de Postgres es una operación aparte, con más riesgo por tocar la base y todos los servicios que dependen de ella, se dejó fuera de este pase)_

## Deuda de arquitectura

- [x] Extraer de `CasesView.tsx`: sección "Correos enviados". _(resuelto: nuevos componentes `SentEmailsSection.tsx` (lista colapsable, ahora con estado local propio en vez de un `Set<number>` global en el padre) y `SentEmailPreviewModal.tsx`. Se eliminaron `sentEmailsOpenIds`/`toggleSentEmails` de `CasesView.tsx`. Verificado en navegador: caso sin correos muestra el mensaje vacío, caso con un correo real muestra la tabla y el modal completo (datos, adjuntos, cuerpo HTML) — sin errores de consola)_
- [x] Extraer de `CasesView.tsx`: "Frases predefinidas" (hook + componente). _(resuelto: hook `utils/usePendingActionPresets.ts` (CRUD, un solo llamado compartido — no uno por expediente abierto) + componente `PendingActionPresetsPanel.tsx` (solo el panel; el botón trigger queda en `CasesView.tsx` para no romper el layout flex del label). Verificado en navegador reabriendo un expediente real: panel abre con las 14 frases, insertar agrega con salto de línea correcto — probado y revertido sin persistir cambios ni borrar frases reales; expediente devuelto a `closed` con su `pending_action` original, verificado por SQL)_
- [x] Extraer de `CasesView.tsx`: modal de "Enviar correo". _(resuelto: componente presentacional `SendEmailModal.tsx` (~200 líneas de JSX movidas). Deliberadamente sin estado propio: `sendEmailForm`/`sendEmailTarget` siguen en `CasesView.tsx` porque el flujo de "Generar reporte" también los escribe antes de abrir este modal. Verificado en navegador: datos precargados correctos (para/CC/asunto/cuerpo/buzón), "Vista previa" renderiza bien el PDF y el cuerpo — cerrado sin enviar el correo real, sin errores de consola)_
- [x] Extraer de `CasesView.tsx`: panel de "Seguimiento del expediente". _(resuelto: componente `FollowUpPanel.tsx` (pending_action/next_review/closing_glosa + frases predefinidas + resumen IA). Alcance ajustado respecto al hallazgo original: NO incluye "Conclusión de la revisión" (outcome/alert_type) porque en el DOM real quedan separados por el bloque de "Agregar correo puntual" — juntarlos hubiera arrastrado esa tercera funcionalidad sin relación. Verificado con inspección directa del DOM (no vía screenshot, CDP con problemas intermitentes esta sesión): valores precargados correctos, los 3 controles quedan disabled en expediente cerrado, sin errores de consola)_
- [x] Extraer el template de respaldo del prompt de `summarize_text` (`backend/app/services/ai/gateway.py`) a una constante separada. _(resuelto: el bloque fijo del CASO B ahora vive en `_SUMMARIZE_FALLBACK_TEMPLATE`, interpolado por `_SUMMARIZE_SYSTEM_PROMPT` (convertido a f-string). Verificado: el prompt final resultante es carácter por carácter el mismo texto que antes, solo cambió dónde vive el template)_
- [x] Confirmar si `CaseDetailModal.tsx` sigue en uso; borrar si es código muerto. _(confirmado en uso: `DashboardView.tsx` lo usa como vista previa rápida de solo lectura, distinta de la edición completa de `CasesView.tsx`. No es código muerto, no se toca)_
- [x] Agregar headers de seguridad básicos (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`) en nginx/backend. _(resuelto: CSP + X-Content-Type-Options + X-Frame-Options + Referrer-Policy en `proxy/nginx.conf`. Para que `script-src 'self'` sea viable sin `unsafe-inline`, se reescribió la página de éxito del callback SSO en `identity-broker` (antes tenía un `<script>` inline con el resultado interpolado): ahora el resultado va en un bloque `application/json` no ejecutable y un JS estático separado (`/oauth/callback.js`) lo lee en runtime; de paso el `postMessage` pasó de `'*'` a `window.location.origin`. Verificado en navegador real: dashboard y detalle de expediente cargan con estilos completos, sin violaciones de CSP en consola)_

## Auditoría 2026-08-20

Detalle completo de cada hallazgo (evidencia, escenario, recomendación): [`AUDIT_2026-08-20.md`](AUDIT_2026-08-20.md).

### Críticos

- [ ] **SEC-004** — Validar `mailbox_account_id` contra `access_repository.resolve_accessible_mailbox_ids(pool, user)` en `POST /api/cases/{case_id}/send-email` (`backend/app/case_export.py:348-439`) antes de llamar a `n8n_client.send_case_email`. Cualquier usuario autenticado puede hoy enviar correo real como cualquier buzón del sistema.
- [ ] Arreglar los 6 tests rotos de `backend/tests/test_jobs_api.py` (401 en vez de los códigos esperados — el `TestClient` no autentica, y `/api/jobs` ahora exige sesión desde la auditoría del 19).

### Altos

- [ ] **PERF-001** — Envolver `build_case_pdf(...)` con `await asyncio.to_thread(...)` en `export_case_pdf` y `send_case_email` (`backend/app/case_export.py:309,380`) — hoy bloquea el backend entero mientras genera un PDF.

### Medios

- [ ] **QA-001** — Idempotency key en el envío de correo (`n8n_client.py`/`case_export.py`), dedupe contra `mailing.case_sent_emails` antes de llamar a Graph.
- [ ] **SEC-002** — Validar magic bytes reales de evidencia (no solo el `Content-Type` declarado) en `cases_service.py:1322`.
- [ ] Bump `python-multipart` a `>=0.0.31` (6 CVEs de DoS de parsing).
- [ ] Bump `markdown` a `>=3.8.1` (DoS por excepción no capturada).
- [ ] Investigar matriz de compatibilidad FastAPI/starlette y planificar upgrade coordinado (9 CVEs en starlette transitiva).
- [ ] Planificar upgrade de `weasyprint` a 68.0 (salto de versión mayor, requiere regresión del export de PDF).
- [ ] **DEVOPS-004** — Definir `mem_limit`/`cpus` al menos para `postgres`, `backend`, `ollama` en `docker-compose.yml`.
- [ ] **DEVOPS-007** — Pipeline CI mínimo: `pytest` (backend) + `tsc -b`/`oxlint` (frontend) en cada push/PR.
- [ ] **OBS-001** — Middleware de `X-Request-Id` propagado y logueado en backend + identity-broker.
- [ ] **OBS-002** — Logging INFO/WARNING en transiciones clave de `mailbox_index_service.py` (429 líneas sin un solo log hoy).

### Mejoras (bajos)

- [ ] Bump `bleach` a `>=6.4.0` (higiene, no explotable hoy — ver SEC-001 en el informe).
- [ ] Bump `jinja2` a 3.1.6 (higiene, no explotable hoy — ver DEVOPS-001 en el informe).
- [ ] **QA-002** — Incluir la lista de `case_id` que fallaron en la respuesta de `refresh_all_cases`.
- [ ] **QA-003** — Confirmar tipo de columna `sent_datetime` (`timestamptz` vs naive) y consistencia de timezone en todo el pipeline.
- [ ] **PERF-002** — Actualizar comentario desactualizado sobre el índice trigram en `cases_service.py`; batchear si el volumen de casos cerrados crece.
- [ ] **PERF-003** — Migrar descarga de adjuntos a `StreamingResponse` si se vuelve un problema real medido.
- [ ] **PERF-004** — Validar bajo carga real si el pool de conexiones (`max_size=5`) genera contención; ajustar si se confirma.
- [ ] **DEVOPS-005** — Healthcheck para el servicio `n8n`; cambiar dependencia del proxy a `service_healthy`.
- [ ] **DEVOPS-006** — Agregar `server_tokens off;` en `proxy/nginx.conf`.
- [ ] **OBS-003** — Healthcheck de Docker del backend debe validar conexión real a Postgres.
- [ ] **DEBT-004** — Extraer hook `useToggleSet<T>()` en frontend, reemplazar los 9 pares `useState<Set<number>>`+handler duplicados en `CasesView.tsx`.
- [ ] **DEBT-005** — Constante `_DEFAULT_TIMEOUT` en `identity_broker_client.py`, reemplazar las 12 ocurrencias hardcodeadas.
- [ ] **DEBT-003** — Extraer las ramas de `seed_type` de `create_case` a funciones privadas.
- [ ] Tests de integración para `_access_clause`, flujo de cierre de expediente, `merge_cases`, `send_case_email` (incluir caso de rechazo por buzón ajeno una vez resuelto SEC-004), `cascade_revoke_user_mailbox_access`.
- [ ] Instalar vitest en frontend y empezar a cubrir los componentes ya extraídos de `CasesView.tsx` (`SentEmailsSection`, `PendingActionPresetsPanel`, `SendEmailModal`, `FollowUpPanel`).
