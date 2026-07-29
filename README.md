# MailingAI

Stack local (lab) para analizar el buzón de correo real vía Microsoft Graph API usando n8n: revisar Enviados, recuperar series de correos parametrizadas, recuperar correos relacionados por hilo, generar histogramas/línea de tiempo de actividad, y trazabilidad de adjuntos "CR".

Definición completa del proyecto (alcance, decisiones de arquitectura, qué está implementado y qué falta): [`PROYECTO.md`](PROYECTO.md).

Las imágenes usan versiones específicas. No se usa `latest` salvo que se cambie manualmente en `.env`.

## Uso

```powershell
docker compose up -d
```

Luego abre n8n:

```text
http://localhost:5680
```

Backend FastAPI (generador de gráficos + trabajos de análisis):

```text
http://localhost:8001/health
```

Frontend (panel completo — Nueva consulta, Trabajos, Expedientes, Mensajes, Configuración):

```text
http://localhost:5173
```

## Servicios

```text
postgres  -> mailingai_postgres  (localhost:5433, interno postgres:5432)
backend   -> mailingai_backend   (localhost:8001, interno backend:8000)
frontend  -> mailingai_frontend  (localhost:5173, interno frontend:80)
n8n       -> mailingai_n8n       (localhost:5680, interno n8n:5678)
ollama    -> mailingai_ollama    (localhost:11435, interno ollama:11434)
```

`ollama` (Fase 6, IA) baja el modelo la primera vez que se le pide (no viene precargado en la imagen). Si es la primera vez que levantas el stack:

```powershell
docker compose exec ollama ollama pull qwen2.5:3b
```

Red interna compartida: `mailingai_internal`.

## Carpeta compartida

La carpeta local `share` queda montada dentro del contenedor n8n en `/files`. Los gráficos generados se guardan en:

```text
share/mailingai/out/            (host)
/files/mailingai/out/           (n8n)
```

## 1. Registro de app en Azure AD (paso manual, fuera de este repo)

n8n necesita una App Registration en tu tenant de Microsoft Entra ID (Azure AD) para poder autenticarse contra Graph API con OAuth2:

1. Portal Azure → **Microsoft Entra ID → App registrations → New registration**.
2. Tipo de cuenta: según si el buzón es solo de tu tenant (single-tenant) o quieres soportar varios. **Si es single-tenant** (lo más común), la credencial de n8n tiene que pegarle a un endpoint de OAuth2 específico de tu tenant (`/{tenantId}/oauth2/v2.0/authorize`), no al genérico `/common` — ver sección 2, la credencial ya viene armada así.
3. **Redirect URI** (tipo Web):
   ```text
   http://localhost:5680/rest/oauth2-credential/callback
   ```
   Si accedes a n8n desde otra URL/host, ajusta este valor y también `N8N_EDITOR_BASE_URL`/`WEBHOOK_URL` en `.env`.
4. **API permissions → Microsoft Graph → Delegated permissions**, agrega:
   ```text
   Mail.Read
   MailboxSettings.Read
   offline_access
   User.Read
   ```
   Si además de leer quieres que n8n envíe correos desde workflows futuros, agrega también `Mail.Send`.
5. **Certificates & secrets → New client secret**, guarda el valor (solo se muestra una vez).
6. Anota `Application (client) ID`, `Directory (tenant) ID` y el `Client secret` generado.

## 2. Cargar credenciales y workflows con el script

Toda la lógica de importación corre **dentro del contenedor** `mailingai_n8n`, en `n8n/import.sh` (montado en `/import/import.sh`): crea la carpeta `n8n/credentials` y las plantillas si faltan, valida que la de Graph ya no tenga placeholders, y llama a la CLI de n8n (`n8n import:credentials`, `n8n import:workflow`) contra las carpetas montadas en `/import/credentials` y `/import/workflows`. `scripts/import-n8n.sh` es solo un disparador desde shell (funciona igual en Linux que en Windows vía Git Bash/WSL): comprueba que el contenedor esté arriba y ejecuta `docker compose exec n8n sh /import/import.sh` — no contiene lógica propia. Si prefieres no usar el wrapper, puedes invocar el mismo script directamente:

```sh
docker compose exec -T n8n sh /import/import.sh
```

Credenciales y workflows tienen un `id` fijo en su JSON, así que **volver a correr el import es seguro**: n8n actualiza el registro existente en vez de duplicarlo, y los nodos quedan pre-enlazados a la credencial correcta automáticamente (no hace falta reseleccionarla a mano en cada nodo).

Pasos:

1. Con el stack arriba (`docker compose up -d`), corre una vez:
   ```sh
   ./scripts/import-n8n.sh
   ```
   La primera vez el contenedor va a crear `n8n/credentials/mailingai-postgres.json` (ya listo, usa el password de `.env`) y `n8n/credentials/mailingai-graph-oauth2.json` (con placeholders) — como `n8n/credentials` está montado como bind mount, esos archivos aparecen también en el host. Luego el import se detiene, pidiéndote llenar los datos reales de Graph.
2. Edita `n8n/credentials/mailingai-graph-oauth2.json` con los datos de tu App Registration (sección 1). Usa el tipo genérico **`OAuth2 API`** de n8n, no el nativo "Microsoft OAuth2 API" — ese pega siempre contra el endpoint `/common`, que falla con `AADSTS50194` en apps single-tenant (el caso normal). La plantilla ya viene armada así, solo reemplaza `REEMPLAZA_CON_TU_TENANT_ID` (aparece dos veces, en las dos URLs) y `REEMPLAZA_CON_TU_CLIENT_ID`/`REEMPLAZA_CON_TU_CLIENT_SECRET`:
   ```json
   {
     "type": "oAuth2Api",
     "data": {
       "grantType": "authorizationCode",
       "authUrl": "https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/authorize",
       "accessTokenUrl": "https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token",
       "clientId": "...",
       "clientSecret": "...",
       "scope": "openid profile offline_access User.Read Mail.Read",
       "authentication": "body"
     }
   }
   ```
3. Corre el script de nuevo:
   ```sh
   ./scripts/import-n8n.sh
   ```
   Esta vez importa las 3 credenciales y los 8 workflows.
4. Entra a n8n (`http://localhost:5680`) → **Credentials → MailingAI Graph OAuth2 → Connect my account**. Este paso es manual sí o sí: OAuth2 necesita que completes el consentimiento en el navegador con tu cuenta real, no se puede automatizar desde un script.

Estas credenciales **no** se guardan en `.env`: los archivos en `n8n/credentials/*.json` quedan ignorados por git (`.gitignore`) y, una vez importados, el `clientSecret`/password quedan cifrados dentro de la base de datos de n8n.

Parámetros útiles del script:

```text
-Force              importa aunque el archivo de Graph todavia tenga placeholders (solo para probar el mecanismo)
-SkipCredentials     importa solo los workflows
-SkipWorkflows       importa solo las credenciales
```

### Carpeta "MailingAI" y orden de ejecución

Después de importar los workflows, `n8n/create-folder.sh` (invocado automáticamente por `import.sh`) crea una carpeta **MailingAI** dentro de tu proyecto personal de n8n y agrupa ahí los 8 workflows. Como la CLI de n8n no tiene un comando para esto, este paso instala el driver `pg` al vuelo dentro del contenedor (una vez, ~2s, sin credenciales nuevas: reusa las mismas variables `DB_POSTGRESDB_*` que ya usa n8n) y hace el `INSERT`/`UPDATE` directo — también reactiva el workflow `07` (el único con webhook; `import:workflow` deja todo `inactive` por defecto). Si falla (por ejemplo sin salida a internet para el `npm install`), solo se pierde el agrupamiento visual — las credenciales y workflows ya quedaron importados igual.

Los nombres de los workflows están numerados para que el orden de uso sea obvio en la lista de n8n:

```text
00 - MailingAI - Graph Fetch (subworkflow, uso interno)   <- no se ejecuta directo, lo llaman los demás
01 - MailingAI - Fetch Sent Items                         <- punto de entrada más común
02 - MailingAI - Fetch Message Series (parametrizado)     <- alternativa con filtros libres
03 - MailingAI - Fetch Related Thread                     <- requiere un conversation_id ya guardado (de 01/02)
04 - MailingAI - Generate Activity Charts                 <- correr despues de tener datos (01/02/03)
05 - MailingAI - Fetch CR Attachments (Enviados)          <- trazabilidad de adjuntos PDF/Word que mencionan CR
06 - MailingAI - Discover Mail Folders                    <- descubre carpetas/subcarpetas (hasta 3 niveles)
07 - MailingAI - Execute Analysis Job                     <- webhook interno, lo dispara el backend (POST /api/jobs)
```

### Qué revisar después de importar

1. **typeVersion de nodos**: si n8n marca algún nodo como desactualizado (icono de advertencia), ábrelo y deja que n8n lo migre a la versión soportada por tu instalación (`n8n:2.31.1`).
2. Prueba primero `01 - MailingAI - Fetch Sent Items` con **Execute Workflow** manual y revisa cada nodo paso a paso (`Test step`) antes de dejarlo en producción.
3. `fetch_runs`/`analysis_jobs` sí quedan marcados `failed` con mensaje real cuando el workflow `07` orquesta la corrida (ver `n8n/WorkFlows/README.md`, workflow 07). Ejecutar `01`-`05` manualmente, en cambio, sigue sin marcar `failed` por sí solo si algo falla a mitad de camino.

### Alternativa manual (sin el script)

También puedes importar cada archivo de `n8n/WorkFlows/` a mano desde **Workflows → Import from File** (empezando por `00-mailingai-graph-fetch-subworkflow.json`) y crear las credenciales a mano desde **Credentials → New**. En ese caso sí vas a tener que reseleccionar la credencial en cada nodo y el subworkflow en el nodo "Execute: Graph Fetch", y agrupar los workflows en una carpeta a mano si quieres — el pre-enlace por `id` y el agrupamiento automático solo aplican cuando credenciales y workflows se importan juntos con `import.sh`.

### Qué hace cada workflow

- **`00-mailingai-graph-fetch-subworkflow`** — recibe `folder`/`filter`/`search`/`top`/`run_id`/`is_sent`, llama a Graph API (`/me/mailFolders/{folder}/messages` o `/me/messages`), mapea cada mensaje al esquema `mailing.messages` y hace upsert. Devuelve `fetched_count`. No se ejecuta directo: lo llaman los workflows 01-03.
- **`01-mailingai-fetch-sent-items`** — trae los últimos 30 días (parametrizable) de la carpeta **Enviados**.
- **`02-mailingai-fetch-message-series`** — versión libre: filtra por remitente, texto de asunto, rango de fechas y carpeta.
- **`03-mailingai-fetch-related-thread`** — dado un `conversation_id` (de una fila de `mailing.messages`), trae todos los mensajes de ese hilo.
- **`04-mailingai-generate-activity-charts`** — según `chart_type` (`timeline`/`histogram`), consulta las vistas agregadas en Postgres, llama al backend FastAPI y guarda el PNG resultante en `/files/mailingai/out/`.
- **`05-mailingai-fetch-cr-attachments`** — trazabilidad: busca en Enviados los correos con adjunto que mencionan `cr_keyword` (default `"CR"`) en un rango de fechas `yyyyMMdd` (cuando se corre manual — el camino automatizado vía `07` manda ISO y `07` lo convierte), y guarda los adjuntos PDF/Word cuyo nombre de archivo sigue el patrón `YYYYMMDD` en `mailing.message_attachments`. No usa el subworkflow 00 (necesita traer adjuntos, algo que el subworkflow no hace).
- **`06-mailingai-discover-mail-folders`** — descubre la estructura de carpetas/subcarpetas del buzón (hasta 3 niveles) y la guarda en `mailing.mail_folders`, con ruta lógica y `parent_folder_id`. Sin parámetros. Necesario para que `mailing.messages.folder_id`/`/api/mail-folders` tengan datos.
- **`07-mailingai-execute-analysis-job`** — webhook interno (`POST /webhook/execute-analysis-job`, protegido por header) que dispara el backend al crear un job. Marca el job `running`, responde de inmediato, despacha al workflow `01`-`06` que corresponda según `job_type`, y marca `success`/`failed` con el resultado.

Detalle nodo por nodo de cada workflow: [`n8n/WorkFlows/README.md`](n8n/WorkFlows/README.md).

## 4. Esquema de datos (`mailing`)

```text
mailing.fetch_runs             -- trazabilidad de cada corrida de fetch (filtros, estado, totales)
mailing.messages               -- correos normalizados (enviados y relacionados), upsert por message_id
mailing.chart_runs             -- corridas de generación de gráficos
mailing.message_attachments    -- adjuntos PDF/Word encontrados (workflow 05), upsert por (message_id, attachment_id)
mailing.analysis_jobs          -- trabajos creados desde /api/jobs (Fase 1), estado actualizado por el workflow 07 (Fase 3)
mailing.mail_folders           -- carpetas/subcarpetas descubiertas por el workflow 06 (Fase 4), con parent_folder_id y ruta lógica
mailing.cases                  -- expedientes armados por correlación (Fase 5)
mailing.case_messages          -- mensajes correlacionados a un caso, con confianza y origen
mailing.timeline_events        -- línea de tiempo por caso (hecho observado / regla / inferencia de IA / validación manual)
mailing.ai_runs                -- trazabilidad de cada corrida de IA (Fase 6): proveedor, modelo, política, hash de entrada

mailing.v_messages_by_day            -- conteo diario (línea de tiempo)
mailing.v_messages_by_sender         -- conteo por remitente (histograma)
mailing.v_conversation_summary       -- resumen por conversation_id (correos relacionados)
mailing.v_cr_attachment_traceability -- cada adjunto PDF/Word + los datos del correo que lo envió
mailing.v_mail_folders_tree          -- árbol de carpetas recalculado en SQL (respaldo/verificación de folder_path)
mailing.v_case_summary                -- conteos/fechas agregadas por caso
```

Consulta manual de ejemplo:

```powershell
docker compose exec -T postgres psql -U mailingai -d mailingai -c "SELECT * FROM mailing.v_messages_by_day;"
docker compose exec -T postgres psql -U mailingai -d mailingai -c "SELECT * FROM mailing.v_cr_attachment_traceability WHERE matches_naming_convention = true;"
```

### Migraciones aplicadas después del primer arranque

`config/postgres/init/*.sql` solo corre automáticamente la primera vez que se crea el volumen de Postgres. Si tu base ya existía cuando se agregó un script nuevo (como `20260716_0001_mailing_attachments.sql`, que agrega la tabla `mailing.message_attachments`), aplicalo a mano una vez:

```powershell
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260716_0001_mailing_attachments.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260716_0002_mailing_analysis_jobs.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260716_0003_mailing_mail_folders.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260716_0004_mailing_cases_timeline.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260716_0005_mailing_ai_runs.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260716_0006_mailing_jobs_retry.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260729_0001_identity_users_sessions.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260729_0002_mailing_case_ownership_sharing.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260729_0003_identity_mailbox_ownership_sharing.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260729_0004_mailing_case_summary_owner.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260729_0005_mailing_case_batch_runs_owner.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260729_0006_identity_notifications.sql
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/20260729_0007_identity_mailbox_notification_sender.sql
```

## 5. Trabajos de análisis (`/api/jobs`)

Desde las Fases 1 y 3 de [`PLAN.md`](PLAN.md), el backend expone trabajos asíncronos respaldados en `mailing.analysis_jobs`, y crearlos dispara automáticamente el workflow correspondiente en n8n (webhook interno, sin que el backend espere a que termine):

```powershell
curl -X POST http://localhost:8001/api/jobs `
  -H "Content-Type: application/json" `
  -d '{\"job_type\":\"fetch_sent_items\",\"parameters\":{\"date_from\":\"2026-06-01\",\"date_to\":\"2026-06-30\",\"top\":50}}'

curl http://localhost:8001/api/jobs/<job_id>
curl "http://localhost:8001/api/jobs?limit=10&status=queued"
curl -X POST http://localhost:8001/api/jobs/<job_id>/retry
curl http://localhost:8001/api/jobs/<job_id>/messages
```

`POST /api/jobs/{id}/retry` crea un job **nuevo** con los mismos `job_type`/`parameters` que uno fallido (no edita el original) y dispara el webhook de nuevo. Solo funciona sobre un job en `failed` (`409` en cualquier otro estado). El nuevo job queda enlazado al original vía `retry_of_job_id`.

`GET /api/jobs/{id}/messages` devuelve los mensajes reales que ese job trajo (via `analysis_jobs.fetch_run_id` → `mailing.messages.run_id`) — lista vacía si el job no genera mensajes (`discover_mail_folders`, `generate_activity_charts`). En el frontend, la vista "Trabajos" lo usa para el botón "Ver resultados", y desde ahí se puede armar un expediente directo con "Crear expediente con estos resultados" / "Usar como semilla" por mensaje.

`DELETE /api/messages?scope=` (`all` | `date_range` | `folder` | `unlinked`) borra del **índice local** (`mailing.messages`) — nunca toca Microsoft Graph ni el buzón real, se puede volver a traer todo corriendo los jobs de nuevo. `date_range` necesita `date_from`+`date_to`; `folder` necesita `folder_id`; `unlinked` borra solo mensajes que no están correlacionados a ningún expediente (conserva la evidencia usada en casos). Si un mensaje borrado sí estaba correlacionado, esa correlación se pierde (el expediente no se borra). En el frontend, botón "Limpiar mensajes" en la vista "Mensajes".

`job_type` acepta: `fetch_sent_items`, `fetch_message_series`, `fetch_related_thread`, `fetch_cr_attachments`, `generate_activity_charts`, `discover_mail_folders`. Las fechas en `parameters` van siempre en formato ISO (`yyyy-MM-dd` o completo) para los tipos que las usan — el workflow `05` internamente las necesita en `yyyyMMdd`, pero esa conversión ya la hace el workflow `07` (ver `n8n/WorkFlows/README.md`). `discover_mail_folders` no recibe parámetros.

El job pasa por `queued` → `running` → `success`/`failed`. Si n8n no responde (webhook caído, `WEBHOOK_SHARED_SECRET` mal configurado, etc.), el job queda en `queued` y el error se loguea en el backend — todavía no hay reintento automático.

**Requisito**: `.env` debe tener `WEBHOOK_SHARED_SECRET` (ya viene generado) y `n8n/credentials/mailingai-webhook-secret.json` con el mismo valor, importado a n8n (lo hace `scripts/import-n8n.sh` como cualquier otra credencial).

### Pruebas del backend

`backend/tests/` no se copia a la imagen de producción (a propósito). Para correrlas contra el stack levantado:

```powershell
docker cp backend/pyproject.toml mailingai_backend:/app/pyproject.toml
docker cp backend/tests mailingai_backend:/app/tests
docker compose exec -T backend pytest -q
```

## 6. Mensajes y carpetas (`/api/messages`, `/api/mail-folders`, `/api/conversations`)

Desde la Fase 4 de [`PLAN.md`](PLAN.md), el backend expone lectura directa de lo que ya trajeron los workflows (no dispara nada nuevo contra Graph, solo consulta Postgres):

```powershell
curl "http://localhost:8001/api/messages?limit=20&subject_contains=CR"
curl "http://localhost:8001/api/messages/<message_id>"
curl "http://localhost:8001/api/conversations/<conversation_id>"
curl "http://localhost:8001/api/mail-folders"
```

`/api/messages` filtra por `folder_id`, `date_from`/`date_to`, `from_address` (contiene), `subject_contains` (contiene), `conversation_id`, `is_sent`, con `limit`/`offset`. `/api/mail-folders` devuelve el árbol completo (carpetas anidadas con `children`); requiere haber corrido el job `discover_mail_folders` al menos una vez — si no, devuelve una lista vacía. El frontend (`http://localhost:5173`) ya incluye una vista de resultados con estos filtros y detalle expandible por mensaje (participantes, adjuntos, ubicación).

`GET /api/messages/{message_id}/attachments/{attachment_id}/download` trae el **contenido real** del adjunto (no solo el nombre/tamaño ya indexado) — llama de forma síncrona al workflow `08` de n8n, que a su vez llama a Graph. Formatos rastreados: `pdf`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`, `csv`, `txt`. En el frontend, cada adjunto tiene un botón "Descargar" que pasa a "Abrir" una vez descargado (PDF se ve en un modal in-app, el resto usa la descarga normal del navegador).

## 7. Casos y línea de tiempo (`/api/cases`)

Desde la Fase 5 de [`PLAN.md`](PLAN.md), el backend arma "expedientes" correlacionando mensajes ya guardados en Postgres — no llama a Graph ni pasa por n8n (es lógica pura sobre datos, ver justificación de arquitectura en `PLAN.md` sección 5). Es sincrónico: `POST /api/cases` responde con el caso ya armado, no crea un job.

```powershell
curl -X POST http://localhost:8001/api/cases `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Mi caso\",\"seed_type\":\"conversation_id\",\"seed_value\":\"<conversation_id de un mensaje ya guardado>\",\"case_type\":\"conversation\"}'

curl http://localhost:8001/api/cases
curl http://localhost:8001/api/cases/<case_id>
curl -X PATCH http://localhost:8001/api/timeline-events/<event_id> -H "Content-Type: application/json" -d '{\"determination_type\":\"validacion_manual\"}'
```

`seed_type` acepta `conversation_id` (todos los mensajes del hilo, confianza 1.0), `cr_keyword` (asunto o nombre de adjunto que contiene la palabra/código, confianza 0.7) o `message_id` (un mensaje puntual como semilla). Además de la correlación exacta, siempre corre una heurística secundaria: mensajes con el mismo asunto normalizado (sin `RE:`/`FWD:`) y al menos un participante en común, dentro de ±30 días del mensaje semilla (confianza 0.4) — así aparecen mensajes relacionados aunque no compartan `conversation_id`. La línea de tiempo resultante distingue `hecho_observado` (siempre, por ahora), `regla`, `inferencia_ia` (Fase 6) y `validacion_manual` (vía el `PATCH`).

## 8. Probar el backend de gráficos de forma aislada

```powershell
curl -X POST http://localhost:8001/charts/timeline `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Prueba\",\"points\":[{\"date\":\"2026-07-01\",\"count\":3},{\"date\":\"2026-07-02\",\"count\":7}]}' `
  --output prueba-timeline.png

curl -X POST http://localhost:8001/charts/histogram `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Prueba\",\"buckets\":[{\"label\":\"alice@example.com\",\"count\":5},{\"label\":\"bob@example.com\",\"count\":2}]}' `
  --output prueba-histograma.png
```

Ambos endpoints responden `image/png` directamente (sin acceso a base de datos ni estado propio).

## 9. Inteligencia artificial (`/api/ai`)

Desde la Fase 6 de [`PLAN.md`](PLAN.md), el backend puede pedirle a un modelo de IA local (Ollama) que resuma un caso ya armado (Fase 5). Política `local_only` por defecto: solo corren proveedores locales, nunca uno externo, salvo que cambies `AI_DEFAULT_POLICY`/`AI_ENABLED_PROVIDERS` en `.env` a propósito.

```powershell
curl http://localhost:8001/api/ai/health
curl -X POST http://localhost:8001/api/ai/cases/<case_id>/analyze
```

`GET /api/ai/health` muestra la política activa y si cada proveedor habilitado responde. `POST /api/ai/cases/{id}/analyze` arma el resumen a partir de los mensajes correlacionados del caso (asunto, remitente enmascarado, fecha, vista previa acotada — nunca el cuerpo completo ni adjuntos), lo valida contra un esquema fijo, lo guarda en `mailing.ai_runs` (con `input_hash`, nunca el contenido real), y si sale bien agrega un evento a la línea de tiempo del caso con `determination_type='inferencia_ia'`.

El modelo por defecto es `qwen2.5:3b` (~1.9GB, CPU-only, tarda unos 20-40 segundos por análisis). El modelo original de esta fase, `qwen2.5:0.5b`, resultó demasiado genérico en resúmenes reales (repetía la misma idea con otras palabras, sin citar datos concretos) — se subió de tamaño tras verificarlo en vivo contra un caso real. **Limitación conocida, no oculta**: incluso con `qwen2.5:3b`, el enmascarado de direcciones de correo protege lo que se *envía* al modelo, pero no garantiza que el modelo no "recuerde"/reconstruya algo parecido en la salida. Para más calidad todavía (con más tiempo de respuesta y uso de disco), cambia `AI_OLLAMA_MODEL` en `.env` a un modelo mayor (ej. `qwen2.5:7b`) y vuelve a descargarlo con `docker compose exec ollama ollama pull <modelo>`.

## 10. Estado del sistema y limpieza de historial

```powershell
curl http://localhost:8001/api/system/status
curl http://localhost:8001/api/system/stats
curl -X DELETE "http://localhost:8001/api/jobs?scope=failed"
curl -X DELETE "http://localhost:8001/api/cases?scope=closed"
```

`GET /api/system/status` verifica backend/Postgres/n8n (`/healthz`)/Ollama en un solo llamado — lo usa el panel lateral del frontend. `GET /api/system/stats` devuelve conteos reales (mensajes, adjuntos, conversaciones, casos) — lo usa la vista "Nueva consulta".

`DELETE /api/jobs?scope=` (`failed` | `finished` | `all-inactive`) y `DELETE /api/cases?scope=` (`all` | `open` | `closed`) borran registros reales — nunca tocan jobs `queued`/`running`. El frontend pide confirmación explícita (modal) antes de llamarlos; si los usas directo por `curl`, no hay vuelta atrás.

## 11. Seguridad y acceso multiusuario (login, sesiones, expedientes/buzones compartidos)

El sistema exige sesión iniciada para usar cualquier endpoint de negocio. Login vía SSO Microsoft/Entra ID (mismo tenant que ya usa `identity-broker` para conectar buzones, sección 1) — sin usuario/contraseña local, sin auto-registro: un admin tiene que dar de alta el email de cada persona antes de que pueda entrar.

### Azure AD: segundo Redirect URI

Además del Redirect URI de n8n (sección 1), agrega uno nuevo a la misma App Registration para el login de usuarios del backend:

```text
http://localhost:8001/api/auth/microsoft/callback
```

Scope delegado usado por este flujo: `openid profile email User.Read` (sin `offline_access` ni `Mail.*` — a diferencia del flujo de buzones, aquí no se guarda ningún token de Microsoft a largo plazo).

### Primer acceso: crear el admin inicial

`identity.users` empieza vacía — sin al menos un admin, nadie puede loguearse (ver `find_or_link_by_oauth`, que nunca crea cuentas nuevas). Con el stack arriba y las migraciones de la sección 4 aplicadas:

```powershell
docker exec mailingai_backend python -m app.scripts.bootstrap_admin --email tu-email@empresa.com --name "Tu Nombre"
```

**El email tiene que ser el de una cuenta real de Microsoft/Entra ID dentro del tenant configurado en `MS_TENANT_ID`** — el login es exclusivamente SSO contra Azure AD, así que una cuenta personal (Gmail, Outlook.com sin relación con el tenant, etc.) nunca va a poder completar el login aunque el registro exista en `identity.users`. Si el bootstrap se corre con un email que luego no corresponde a ninguna cuenta del tenant, simplemente queda una fila sin usar (inofensiva, pero conviene evitarlo).

Nunca escala privilegios de un usuario ya existente (si el email ya está en `identity.users`, no toca esa fila). Después de correrlo, entra a `http://localhost:5173` y usa "Ingresar con Microsoft" con esa misma cuenta.

### Migrar a un entorno nuevo (otro host, otro ambiente)

Cada entorno con una base de datos nueva (volumen de Postgres recién creado, o `identity.users` vacía por cualquier motivo) necesita repetir estos pasos — son independientes del código, que no cambia entre entornos:

1. **Redirect URI en Azure AD**: agregar `http://<host-del-backend>/api/auth/microsoft/callback` a la misma App Registration (sección "Azure AD: segundo Redirect URI" arriba). Si cambia el dominio/puerto público del backend, el Redirect URI viejo no sirve — hay que agregar el nuevo (se puede dejar el anterior también, no hace falta borrarlo).
2. **Variables de entorno**: `BACKEND_PUBLIC_URL` y `FRONTEND_URL` en `.env` deben apuntar a las URLs públicas reales del entorno nuevo; `MS_TENANT_ID`/`MS_CLIENT_ID`/`MS_CLIENT_SECRET` normalmente son los mismos (mismo tenant/App Registration), salvo que el entorno nuevo use un tenant distinto.
3. **Bootstrap del admin**: correr `bootstrap_admin.py` (arriba) con el email real de quien va a administrar ese entorno — `identity.users` arranca vacía en cada base de datos nueva, no se migra sola.
4. **Login**: entrar con esa cuenta desde el frontend del entorno nuevo para activarla.

Un volumen de Postgres existente que se copia/restaura entre entornos (backup real, no un volumen nuevo) sí conserva `identity.users` tal cual — en ese caso no hace falta repetir el bootstrap, solo el paso 1 y 2 si cambió el host.

### Alta de usuarios (solo admin)

```powershell
curl -X POST http://localhost:8001/api/admin/users --cookie "mailingai_session=<tu cookie de sesion admin>" `
  -H "Content-Type: application/json" -d '{\"email_address\":\"colega@empresa.com\",\"display_name\":\"Colega\"}'
curl http://localhost:8001/api/admin/users --cookie "mailingai_session=<...>"
curl -X PATCH http://localhost:8001/api/admin/users/<user_id> --cookie "mailingai_session=<...>" -H "Content-Type: application/json" -d '{\"enabled\":false}'
```

La cuenta queda "pendiente de primer login" (`ms_object_id` nulo) hasta que la persona entra por primera vez con SSO — recién ahí se vincula. Desactivar (`enabled:false`) revoca todas sus sesiones activas de inmediato.

### Expedientes y buzones: dueño + compartición

Cada expediente (`mailing.cases`) y cada buzón (`identity.mailbox_accounts`) tiene un `owner_user_id`: quien crea el expediente, o quien completa el consentimiento OAuth2 de un buzón nuevo (se reclama automáticamente vía `POST /api/mailboxes/{id}/claim` tras el flujo de conexión de la sección 1). Nadie más ve ese expediente/buzón salvo que:

- El dueño lo comparta explícitamente: `POST /api/cases/{id}/shares` / `POST /api/mailboxes/{id}/shares` con `{"user_id": ..., "permission": "read"|"edit"}` (buzones solo admiten `"read"`).
- El usuario tenga rol `admin` (ve y gestiona todo, sin excepción, para soporte/auditoría).

Expedientes y buzones que ya existían antes de aplicar esta capa de seguridad quedan con `owner_user_id` nulo — visibles solo para un admin hasta que se les asigne dueño a mano (`PATCH /api/cases/{id}` / reclamo manual del buzón).

### Cascada: quitar un buzón también quita expedientes relacionados

Al revocar el acceso de un usuario a un buzón (`DELETE /api/mailboxes/{id}/shares/{user_id}`, o `DELETE /api/mailboxes/{id}/owner` — este último solo admin, libera el buzón por completo) se le quita en cascada el acceso a cualquier expediente que tenga al menos un mensaje de ese buzón: si era dueño del expediente, queda sin dueño (nunca se borra); si lo tenía compartido, se le borra esa fila de `case_shares`. Ambos endpoints devuelven `{"revoked": true, "cases_affected": N}` para poder avisar cuántos expedientes se vieron afectados. La ficha de cada usuario (panel Usuarios → "Ver ficha", solo admin) muestra sus buzones y permite compartir/quitar desde ahí.

### Notificaciones in-app al compartir

No existe una cuenta de correo de "sistema" separada de los buzones reales de Microsoft, así que compartir un expediente o un buzón no envía un email real — genera una notificación visible dentro de la app (campanita en la barra lateral, `GET /api/notifications`). Revocar un acceso no genera notificación, solo compartirlo.

## Detener

```powershell
docker compose down
```
