# MailingAI — Definición del proyecto

## Objetivo

Plataforma de laboratorio (Docker + n8n) para analizar e interactuar con un buzón de correo real (Microsoft 365 / Exchange) vía Microsoft Graph API: revisar la bandeja de Enviados, recuperar series de correos según parametrización, recuperar correos relacionados (hilos), generar histogramas/línea de tiempo de actividad, y llevar trazabilidad de adjuntos vinculados a "CR" (Change Request u otro código de proyecto).

Para instrucciones de instalación y uso ver [`README.md`](README.md). Para el detalle nodo por nodo de cada workflow ver [`n8n/WorkFlows/README.md`](n8n/WorkFlows/README.md).

## Alcance contemplado

Lo que este proyecto busca cubrir, tal como fue pedido a lo largo de su construcción:

1. **Revisión de la bandeja de Enviados** del buzón.
2. **Recuperar una serie de correos según parametrización** (rango de fechas, remitente, texto de asunto, carpeta).
3. **Recuperar correos relacionados** (mismo hilo/conversación de Graph).
4. **Generar histograma o línea de tiempo** de la actividad de correo (gráficos PNG).
5. **Trazabilidad de adjuntos "CR"**: ubicar en Enviados los correos con adjunto que mencionan un código/keyword, y de esos adjuntos quedarse con los PDF/Word cuyo nombre de archivo sigue el patrón `YYYYMMDD`, registrando qué documento se envió, en qué correo y cuándo.
6. **Carga de credenciales y workflows automatizada**, ejecutada dentro del contenedor de n8n (no en el host), reproducible y sin duplicar al reimportar.
7. **Organización dentro de n8n**: los workflows agrupados en una carpeta, numerados según el orden en que se usan normalmente.

## Decisiones de arquitectura (ya tomadas, no reabrir sin motivo)

| Decisión | Elegido | Por qué |
|---|---|---|
| Autenticación al buzón | Microsoft Graph API OAuth2 | Buzón corporativo M365/Exchange real, no Gmail/IMAP genérico |
| Alcance del buzón | Un solo buzón (`/me/...`) | Confirmado explícitamente con el usuario; multi-buzón requeriría permisos de aplicación + consentimiento de administrador del tenant, no implementado |
| Motor de gráficos | Backend FastAPI propio + matplotlib | Sin Grafana ni QuickChart, stateless, n8n le pasa el JSON ya agregado |
| Entorno | Directo contra el buzón real desde el inicio | Sin Mailpit ni entorno de pruebas intermedio |
| Persistencia | Schema `mailing` en Postgres dedicado (mismo patrón que `TC_N8N`) | Trazabilidad completa de cada corrida (`fetch_runs`) y de los datos traídos |
| Credenciales | Nunca en `.env`; viven en `n8n/credentials/*.json` (git-ignored) | Buzón real, no un lab de prueba con secretos descartables |
| Import de credenciales/workflows | Corre **dentro del contenedor** n8n (`n8n/import.sh`), no en el host | Pedido explícito del usuario |
| Escritura a Postgres desde n8n | SQL explícito (`executeQuery` + parámetros `$1,$2,...`), nunca el mapeo visual `insert`/`upsert` del nodo | Bugs reales encontrados en el nodo Postgres de n8n (ver `n8n/WorkFlows/README.md`, sección "Nota técnica") |
| Versión de n8n | `2.31.1` (no `2.21.7`) | `2.21.7` tenía un issue reportado de validaciones |

## Estado de implementación

### Implementado y probado contra la instancia real

- **Stack Docker completo**: `postgres` (16.13), `backend` (FastAPI), `frontend` (React + Vite + nginx), `n8n` (2.31.1) — los cuatro contenedores levantan y quedan healthy.
- **Frontend** (`frontend/`, React 19 + TypeScript + Vite), rediseñado (2026-07-16) con navegación lateral y tema oscuro (a partir de `ui_idea.html`, mockup provisto por el usuario): 5 vistas — **Nueva consulta** (formulario de jobs + resumen del entorno con datos reales), **Trabajos** (cola con búsqueda/filtro, error expandible, reintento, "Limpiar historial"), **Expedientes** (KPIs, casos con línea de tiempo expandible, "Analizar con IA", "Limpiar expedientes"), **Mensajes** (búsqueda de mensajes/carpetas), **Configuración** (política/proveedor/modelo de IA reales, solo lectura, "Probar conexión" real). Todo en `http://localhost:5173`. Habla solo con el backend (CORS con allowlist, sin `*`), sin secretos ni conexión directa a Postgres/n8n. Los botones "Limpiar historial"/"Limpiar expedientes" ejecutan borrado real y con alcance acotado (`DELETE /api/jobs?scope=`, `DELETE /api/cases?scope=`) — nunca tocan jobs `queued`/`running` ni expedientes fuera del alcance elegido, con modal de confirmación explícita antes de cada borrado.
- **Backend de gráficos** (`backend/app/charts.py`): `/health`, `/charts/timeline`, `/charts/histogram` — probados con `curl`, devuelven PNG válido.
- **Esquema de datos `mailing`** en Postgres: tablas `fetch_runs`, `messages`, `chart_runs`, `message_attachments`, y las vistas `v_messages_by_day`, `v_messages_by_sender`, `v_conversation_summary`, `v_cr_attachment_traceability`.
- **10 workflows de n8n** (`n8n/WorkFlows/00` a `09`), documentados nodo por nodo, importados y verificados en la base:
  - `00` — subworkflow interno que llama a Graph y hace upsert en `mailing.messages`.
  - `01` — Fetch Sent Items (últimos 30 días, parametrizable).
  - `02` — Fetch Message Series (filtros libres: remitente, asunto, fechas, carpeta).
  - `03` — Fetch Related Thread (por `conversation_id`).
  - `04` — Generate Activity Charts (timeline/histograma, vía el backend).
  - `05` — Fetch CR Attachments (Enviados con adjunto que mencionan un keyword, adjuntos PDF/Word con nombre `YYYYMMDD`).
  - `06` — Discover Mail Folders: descubre carpetas/subcarpetas del buzón (hasta 3 niveles), con ruta lógica.
  - `07` — Execute Analysis Job: webhook interno que recibe un job del backend, lo despacha al workflow `01`-`06` que corresponda, y marca el resultado en `mailing.analysis_jobs`.
  - `08` — Download Attachment: webhook síncrono (`responseMode: "lastNode"`) que trae el contenido real (`contentBytes` base64) de un adjunto puntual desde Graph, para descarga bajo demanda desde el frontend.
  - `09` — Search Attachments: busca adjuntos de cualquier formato en una o varias carpetas elegidas (árbol multi-selección en el frontend), con patrón opcional (regex o texto libre) contra el nombre del archivo.
- **Importación automatizada dentro del contenedor**: `n8n/import.sh` + `n8n/create-folder.sh`, disparados por `scripts/import-n8n.ps1`. Crea la carpeta `n8n/credentials/` y sus plantillas si faltan, valida placeholders, importa credenciales, publica los 7 workflows (necesario para `Execute Workflow` y para el webhook), reactiva el `07` (el único con trigger propio), agrupa todo en la carpeta **MailingAI**, y reinicia n8n al final para que la publicación tome efecto. Confirmado idempotente.
- **Credenciales pre-enlazadas**: los nodos ya apuntan a `MailingAI Postgres` / `MailingAI Graph OAuth2` / `MailingAI Webhook Secret` por `id` al importar, sin reselección manual.
- **Fix de bugs reales del nodo Postgres de n8n**: (1) los nodos de escritura usan SQL parametrizado explícito en vez del mapeo visual, que producía inserts corruptos (`run_id=0` fijo); (2) toda query final de un workflow (`Update fetch_runs`, `Insert chart_runs`, `Upsert messages`, `Upsert message_attachments`) termina en `RETURNING <pk>` porque un `INSERT`/`UPDATE` sin `RETURNING` no genera items de salida en n8n, y sin items nada corre después.
- **Trabajos de análisis (`mailing.analysis_jobs` + `/api/jobs` + integración con n8n)**: Fases 1 y 3 de `PLAN.md`. `POST /api/jobs` crea el job, dispara el webhook de n8n en segundo plano (sin bloquear la respuesta `202`), y n8n marca `running`/`success`/`failed` con mensaje de error real y sanitizado. Verificado en vivo para los 6 `job_type` contra el buzón real ya conectado — `fetch_sent_items`, `discover_mail_folders` y `fetch_cr_attachments` llegaron a `success` con datos reales (este último tras corregir 3 bugs reales de Graph/n8n encontrados en su primera corrida real, ver `n8n/WorkFlows/README.md`); `generate_activity_charts` llega a `success` con datos de prueba (PNG + fila en `chart_runs`).
- **OAuth2 de Graph conectado**: la credencial `MailingAI Graph OAuth2` (tipo genérico `oAuth2Api`, endpoints single-tenant) tiene el consentimiento completado (`Connect my account`) y token activo.
- **Carpetas del buzón y paginación real (Fase 4)**: `mailing.mail_folders` con 83 carpetas reales descubiertas (hasta 3 niveles, ruta lógica), `mailing.messages.folder_id` conectado de punta a punta, paginación real de Graph (`@odata.nextLink`, no reconstruida a mano) en los listados de mensajes y carpetas — verificado trayendo 100 mensajes reales con `top=5` (antes hubiera traído solo 5). Endpoints `GET /api/messages`, `/api/messages/{id}`, `/api/conversations/{id}`, `/api/mail-folders`, y vista de resultados expandible en el frontend.
- **Correlación de casos y línea de tiempo (Fase 5)**: `mailing.cases`/`case_messages`/`timeline_events`, correlación en 3 niveles de confianza (mismo hilo, palabra clave CR, heurística por tema+participante+fecha), endpoints `/api/cases` y `/api/timeline-events/{id}` (validación manual), panel `CasesPanel` en el frontend. Verificado con datos reales: la heurística encontró mensajes genuinamente relacionados que no comparten `conversation_id`.
- **Resultados de un job y su expediente (2026-07-17)**: `analysis_jobs.fetch_run_id` (columna prevista desde la Fase 1, sin conectar hasta ahora) queda seteado por el workflow `07` al terminar cada corrida. Nuevo endpoint `GET /api/jobs/{id}/messages` y sección "Ver resultados" en **Trabajos**, con acciones "Crear expediente con estos resultados" / "Usar como semilla" que llevan directo a **Expedientes** con los mensajes precargados.
- **Adjuntos reales por mensaje (2026-07-17)**: el detalle de un expediente y la vista **Mensajes** muestran, por cada correo, si tiene adjunto y de qué tipo (ícono por extensión: PDF, Word, Excel, PowerPoint, CSV, TXT — antes solo se trazaban PDF/Word). El botón "Descargar" trae el archivo real desde Graph vía el workflow `08` (antes solo había metadata, nunca el contenido); una vez descargado, "Abrir" lo muestra en un modal (PDF/TXT/CSV) o dispara la descarga del navegador (Word/Excel/PowerPoint). Bug real encontrado y corregido en la primera prueba: nombres de archivo con tildes o guión largo rompían el header `Content-Disposition` (HTTP solo acepta Latin-1 ahí) — solucionado con el patrón RFC 6266 (`filename` ASCII + `filename*=UTF-8''...`).
- **AI Gateway con Ollama local (Fase 6)**: `mailing.ai_runs`, interfaz `AIProvider` (`analyze`/`health_check`/`list_models`/`supports_structured_output`), adaptador Ollama real (servicio nuevo en `docker-compose.yml`, modelo `qwen2.5:3b`), política `local_only` por defecto (bloquea proveedores externos antes de cualquier llamado de red), protecciones básicas contra prompt injection, salida validada con Pydantic. Endpoints `GET /api/ai/health` (incluye modelo por proveedor), `POST /api/ai/cases/{id}/analyze`. Verificado en vivo: análisis real de un caso real, resumen coherente en español guardado en `mailing.ai_runs` y en la línea de tiempo del caso. Adaptadores LM Studio/OpenAI/Claude: arquitectura lista, sin clases concretas (no hay credenciales para probarlos de verdad).
- **Calidad del análisis de IA (2026-07-17)**: el resumen inicial resultaba genérico/repetitivo. Se subió el modelo a `qwen2.5:3b` (antes `qwen2.5:0.5b`), se amplió el recorte de cada correo en el contexto de 200 a 600 caracteres (el recorte corto cortaba a mitad de frase justo el dato específico), y se reescribió el prompt (`case-summary-v2`) para exigir datos concretos (servidores, tickets, fechas) y prohibir repetir la misma idea. Verificado en vivo sobre el mismo caso real que había dado el resumen flojo: el nuevo resumen cita el servidor y la carpeta reales, sin repetición.
- **Endpoints de sistema** (`GET /api/system/status`, `GET /api/system/stats`): agregados para el panel lateral del frontend rediseñado — verifican backend/Postgres/n8n (`/healthz`)/Ollama en un solo llamado, y devuelven conteos reales (mensajes, adjuntos, conversaciones, casos).

### Pendiente

Nada a cargo del usuario: Azure AD, OAuth2, y las 6 fases del roadmap de `master.md` (incluida IA) están completas — ver [`PLAN.md`](PLAN.md). Lo único pendiente es una decisión del usuario, no una tarea técnica: cuándo destruir y recrear las persistencias (volúmenes) del stack, explícitamente diferido hasta que él lo pida.

### Gotcha operativo a tener en cuenta

Reimportar credenciales (`.\scripts\import-n8n.ps1` sin `-SkipCredentials`) sobrescribe el token OAuth2 ya conectado de `MailingAI Graph OAuth2` y obliga a repetir "Connect my account". Si solo cambiaron archivos de workflow, usar `-SkipCredentials`.

### Fuera de alcance (por decisión, no por olvido)

- **Multi-buzón** / tenant completo — requeriría permisos de aplicación Graph API con consentimiento de administrador; explícitamente descartado por ahora.
- **Envío de correos** (`Mail.Send`) — el proyecto es de solo lectura/análisis, no genera ni responde correos.
- **Grafana / dashboards interactivos** — se optó por gráficos PNG generados on-demand vía el backend, no un dashboard persistente.
- **Entorno de pruebas (Mailpit)** — se decidió ir directo contra el buzón real desde el arranque del proyecto.
