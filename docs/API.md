# Referencia de API y operación

Ejemplos de uso directo del backend (`curl`, PowerShell) para probar o integrar sin pasar por el frontend. Todos los endpoints de negocio exigen sesión iniciada (cookie `mailingai_session`) salvo donde se indique lo contrario — ver el modelo de autenticación en [`ARCHITECTURE.md`](ARCHITECTURE.md#modelo-de-seguridad-y-acceso).

`<host>` es la IP o el dominio donde corre el stack (`localhost` si accedes desde la misma máquina).

## Autenticación

Los endpoints de negocio (`/api/jobs`, `/api/messages`, `/api/cases`, `/api/ai/*` salvo casos puntuales, `/api/admin/*`, `/api/notifications`) devuelven `401` sin la cookie `mailingai_session`. No exigen sesión: `/api/auth/*` (login), `/health`, `/charts/*` y `/internal/*`. De estas, **solo `/api/auth/*`, `/health` y `/charts/*` están publicadas por el proxy** y alcanzables desde el navegador — `/internal/*` no tiene autenticación propia pero tampoco está mapeada en `proxy/nginx.conf`, así que solo es alcanzable desde la red interna de Docker (ver [`ARCHITECTURE.md`](ARCHITECTURE.md) y [`SECURITY.md`](SECURITY.md)), nunca "pública" en el sentido de accesible desde afuera.

El login SSO de Microsoft es un flujo de redirects de navegador (`/api/auth/microsoft/*`), no se puede probar con `curl` de forma directa. El login **local** sí es un POST simple — es la forma más rápida de conseguir una cookie de sesión para probar el resto de la API:

```powershell
curl -c cookies.txt -X POST http://<host>/api/auth/local-login `
  -H "Content-Type: application/json" -d '{\"username\":\"tu_usuario\",\"password\":\"tu_clave\"}'

curl -b cookies.txt http://<host>/api/cases
curl -b cookies.txt http://<host>/api/admin/users
```

`-c cookies.txt` guarda la cookie que devuelve el login; `-b cookies.txt` la reenvía en cada llamada siguiente. Todos los ejemplos de `curl` de este documento que no muestran `--cookie`/`-b` explícito asumen que ya tenés una sesión guardada así.

## Trabajos de análisis (`/api/jobs`)

El backend expone trabajos asíncronos respaldados en `mailing.analysis_jobs`; crearlos dispara automáticamente el workflow correspondiente en n8n (webhook interno, sin que el backend espere a que termine):

```powershell
curl -X POST http://<host>/api/jobs `
  -H "Content-Type: application/json" `
  -d '{\"job_type\":\"fetch_sent_items\",\"parameters\":{\"date_from\":\"2026-06-01\",\"date_to\":\"2026-06-30\",\"top\":50}}'

curl http://<host>/api/jobs/<job_id>
curl "http://<host>/api/jobs?limit=10&status=queued"
curl -X POST http://<host>/api/jobs/<job_id>/retry
curl http://<host>/api/jobs/<job_id>/messages
```

`POST /api/jobs/{id}/retry` crea un job **nuevo** con los mismos `job_type`/`parameters` que uno fallido (no edita el original) y dispara el webhook de nuevo. Solo funciona sobre un job en `failed` (`409` en cualquier otro estado). El nuevo job queda enlazado al original vía `retry_of_job_id`.

`GET /api/jobs/{id}/messages` devuelve los mensajes reales que ese job trajo (vía `analysis_jobs.fetch_run_id` → `mailing.messages.run_id`) — lista vacía si el job no genera mensajes (`discover_mail_folders`, `generate_activity_charts`). En el frontend, la vista "Trabajos" lo usa para el botón "Ver resultados", y desde ahí se puede armar un expediente directo con "Crear expediente con estos resultados" / "Usar como semilla" por mensaje.

`DELETE /api/messages?scope=` (`all` | `date_range` | `folder` | `unlinked`) borra del **índice local** (`mailing.messages`) — nunca toca Microsoft Graph ni el buzón real, se puede volver a traer todo corriendo los jobs de nuevo. `date_range` necesita `date_from`+`date_to`; `folder` necesita `folder_id`; `unlinked` borra solo mensajes que no están correlacionados a ningún expediente (conserva la evidencia usada en casos). Si un mensaje borrado sí estaba correlacionado, esa correlación se pierde (el expediente no se borra). En el frontend, botón "Limpiar mensajes" en la vista "Mensajes".

`job_type` acepta: `fetch_sent_items`, `fetch_message_series`, `fetch_related_thread`, `fetch_cr_attachments`, `generate_activity_charts`, `discover_mail_folders`. Las fechas en `parameters` van siempre en formato ISO (`yyyy-MM-dd` o completo) para los tipos que las usan — el workflow `05` internamente las necesita en `yyyyMMdd`, pero esa conversión ya la hace el workflow `07` (ver [`n8n/WorkFlows/README.md`](../n8n/WorkFlows/README.md)). `discover_mail_folders` no recibe parámetros.

El job pasa por `queued` → `running` → `success`/`failed`. Si n8n no responde (webhook caído, `WEBHOOK_SHARED_SECRET` mal configurado, etc.), el job queda en `queued` y el error se loguea en el backend — todavía no hay reintento automático.

**Requisito**: `.env` debe tener `WEBHOOK_SHARED_SECRET` (ya viene generado) y `n8n/credentials/mailingai-webhook-secret.json` con el mismo valor, importado a n8n (lo hace `scripts/import-n8n.sh` como cualquier otra credencial).

### Pruebas del backend

`backend/tests/` no se copia a la imagen de producción (a propósito). Para correrlas contra el stack levantado:

```powershell
docker cp backend/pyproject.toml mailingai_backend:/app/pyproject.toml
docker cp backend/tests mailingai_backend:/app/tests
docker compose exec -T backend pytest -q
```

## Mensajes y carpetas (`/api/messages`, `/api/mail-folders`, `/api/conversations`)

El backend expone lectura directa de lo que ya trajeron los workflows (no dispara nada nuevo contra Graph, solo consulta Postgres):

```powershell
curl "http://<host>/api/messages?limit=20&subject_contains=CR"
curl "http://<host>/api/messages/<message_id>"
curl "http://<host>/api/conversations/<conversation_id>"
curl "http://<host>/api/mail-folders"
```

`/api/messages` filtra por `folder_id`, `date_from`/`date_to`, `from_address` (contiene), `subject_contains` (contiene), `conversation_id`, `is_sent`, con `limit`/`offset`. `/api/mail-folders` devuelve el árbol completo (carpetas anidadas con `children`); requiere haber corrido el job `discover_mail_folders` al menos una vez — si no, devuelve una lista vacía.

`GET /api/messages/{message_id}/attachments/{attachment_id}/download` trae el **contenido real** del adjunto (no solo el nombre/tamaño ya indexado) — llama de forma síncrona al workflow `08` de n8n, que a su vez llama a Graph. Formatos rastreados: `pdf`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`, `csv`, `txt`.

`DELETE /api/messages/{message_id}/attachments/{attachment_id}` borra solo el registro indexado localmente (nunca el buzón real); si el mensaje se vuelve a indexar, el adjunto puede reaparecer.

## Casos y línea de tiempo (`/api/cases`)

El backend arma "expedientes" correlacionando mensajes ya guardados en Postgres — no llama a Graph ni pasa por n8n (es lógica pura sobre datos). Es sincrónico: `POST /api/cases` responde con el caso ya armado, no crea un job.

```powershell
curl -X POST http://<host>/api/cases `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Mi caso\",\"seed_type\":\"conversation_id\",\"seed_value\":\"<conversation_id de un mensaje ya guardado>\",\"case_type\":\"conversation\"}'

curl http://<host>/api/cases
curl http://<host>/api/cases/<case_id>
curl http://<host>/api/cases/dashboard/stats
curl http://<host>/api/cases/<case_id>/audit-log
curl -X PATCH http://<host>/api/timeline-events/<event_id> -H "Content-Type: application/json" -d '{\"determination_type\":\"validacion_manual\"}'
```

`seed_type` acepta `conversation_id` (todos los mensajes del hilo, confianza 1.0), `cr_keyword` (asunto o nombre de adjunto que contiene la palabra/código, confianza 0.7) o `message_id` (un mensaje puntual como semilla). Además de la correlación exacta, siempre corre una heurística secundaria: mensajes con el mismo asunto normalizado (sin `RE:`/`FWD:`) y al menos un participante en común, dentro de ±30 días del mensaje semilla (confianza 0.4). La línea de tiempo resultante distingue `hecho_observado`, `regla`, `inferencia_ia` y `validacion_manual` (vía el `PATCH`).

`GET /api/cases/dashboard/stats` devuelve conteos agregados reales (no limitados al batch ya cargado en el frontend) — un usuario no-admin solo ve el conteo de sus propios expedientes.

Guardar cambios sobre un expediente ya abierto (`PATCH /api/cases/{id}`, `PATCH /api/cases/{id}/ai-summary`) acepta `expected_updated_at`: si no coincide con el valor real (alguien más lo modificó mientras tanto), el backend responde `412 Precondition Failed` en vez de aplicar el cambio.

### Expedientes y buzones: dueño y compartición

Cada expediente (`mailing.cases`) y cada buzón (`identity.mailbox_accounts`) tiene un `owner_user_id`: quien crea el expediente, o quien completa el consentimiento OAuth2 de un buzón nuevo (se reclama automáticamente vía `POST /api/mailboxes/{id}/claim`). Nadie más ve ese expediente/buzón salvo que:

- El dueño lo comparta explícitamente: `POST /api/cases/{id}/shares` / `POST /api/mailboxes/{id}/shares` con `{"user_id": ..., "permission": "read"|"edit"}` (buzones solo admiten `"read"`).
- El usuario tenga rol `admin` (ve y gestiona todo, sin excepción).

```powershell
curl -X PATCH http://<host>/api/cases/<case_id>/owner --cookie "mailingai_session=<...>" `
  -H "Content-Type: application/json" -d '{\"new_owner_user_id\":<user_id>}'
```

Al revocar el acceso de un usuario a un buzón (`DELETE /api/mailboxes/{id}/shares/{user_id}`, o `DELETE /api/mailboxes/{id}/owner` — solo admin, libera el buzón por completo) se le quita en cascada el acceso a cualquier expediente que tenga al menos un mensaje de ese buzón: si era dueño, el expediente queda sin dueño (nunca se borra); si lo tenía compartido, se le borra esa fila de `case_shares`. Ambos endpoints devuelven `{"revoked": true, "cases_affected": N}`.

Compartir un expediente o un buzón genera una notificación in-app (`GET /api/notifications`) y, si hay un buzón configurado como remitente de notificaciones (Configuración, solo admin), también un correo real con plantilla HTML. Revocar un acceso no genera notificación, solo compartirlo.

## Notificaciones (`/api/notifications`)

```powershell
curl http://<host>/api/notifications
curl http://<host>/api/notifications/unread-count
curl -X POST http://<host>/api/notifications/<notification_id>/read
curl -X POST http://<host>/api/notifications/read-all
curl -X DELETE http://<host>/api/notifications
```

`GET /api/notifications` devuelve hasta 50 notificaciones del usuario autenticado (leídas y no leídas, más recientes primero) — nunca las de otro usuario. `GET /api/notifications/unread-count` es el número que muestra la campanita del frontend, con polling propio (no depende de tener el listado abierto). `kind` es uno de `case_shared`, `mailbox_shared`, `mailbox_delta_sync_done`, `ai_analysis_done` — cualquier valor fuera de esa lista rompe la validación de `GET /api/notifications` (ver [`STATUS.md`](STATUS.md) si se agrega un tipo nuevo: hay que sumarlo tanto al `CHECK` de la tabla como al `Literal` de `NotificationRead`, quedaron desincronizados una vez).

`POST /api/notifications/{id}/read` marca una notificación puntual como leída (`204`, idempotente — repetirlo sobre una ya leída no falla, simplemente no vuelve a tocar `read_at`). `POST /api/notifications/read-all` marca todas las del usuario. `DELETE /api/notifications` borra **todas** las notificaciones del usuario autenticado, leídas y no leídas — no hay borrado selectivo por `id` ni por rango de fecha. Devuelve `{"deleted": N}`. En el frontend, botón "Limpiar notificaciones" (con confirmación) en el desplegable de la campanita.

## Probar el backend de gráficos de forma aislada

```powershell
curl -X POST http://<host>/charts/timeline `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Prueba\",\"points\":[{\"date\":\"2026-07-01\",\"count\":3},{\"date\":\"2026-07-02\",\"count\":7}]}' `
  --output prueba-timeline.png

curl -X POST http://<host>/charts/histogram `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Prueba\",\"buckets\":[{\"label\":\"alice@example.com\",\"count\":5},{\"label\":\"bob@example.com\",\"count\":2}]}' `
  --output prueba-histograma.png
```

Ambos endpoints responden `image/png` directamente (sin acceso a base de datos ni estado propio) — no requieren sesión, están pensados para ser llamados por n8n.

## Inteligencia artificial (`/api/ai`)

El backend puede pedirle a un modelo de IA que resuma un caso ya armado. Política `local_only` por defecto: solo corren proveedores locales (Ollama), nunca uno externo, salvo que un administrador lo cambie explícitamente desde Configuración.

```powershell
curl http://<host>/api/ai/health
curl -X POST http://<host>/api/ai/cases/<case_id>/analyze
curl -X POST http://<host>/api/ai/batch-analyze --cookie "mailingai_session=<cookie de sesion admin>"
```

`GET /api/ai/health` muestra la política activa y si el proveedor activo responde. `POST /api/ai/cases/{id}/analyze` corre en background (responde de inmediato con `status=running`): arma el resumen a partir de los mensajes correlacionados del caso (asunto, nombre y dirección real del remitente, fecha, vista previa acotada — nunca el cuerpo completo ni adjuntos, y **sin anonimizar la identidad de los participantes**, ver [`STATUS.md`](STATUS.md)), lo valida contra un esquema fijo, lo guarda en `mailing.ai_runs` (con `input_hash`, nunca el contenido real), agrega un evento a la línea de tiempo con `determination_type='inferencia_ia'`, y notifica (in-app + email) cuando termina. `POST /api/ai/batch-analyze` (solo admin) repite el análisis sobre todos los expedientes pendientes del sistema.

El modelo por defecto es `qwen2.5:3b` (~1.9GB, CPU-only, tarda unos 20-40 segundos por análisis). **Limitación conocida, no oculta**: aunque el contexto que se envía al modelo está acotado (sin cuerpo completo ni adjuntos), no hay garantía de que el modelo no "recuerde"/reconstruya algo parecido en la salida. Para más calidad (con más tiempo de respuesta y uso de disco), un admin puede cambiar el modelo activo desde Configuración y descargarlo con `docker compose exec ollama ollama pull <modelo>`.

## Estado del sistema y limpieza de historial

```powershell
curl http://<host>/api/system/status
curl http://<host>/api/system/stats
curl -X DELETE "http://<host>/api/jobs?scope=failed"
curl -X DELETE "http://<host>/api/cases?scope=closed"
```

`GET /api/system/status` verifica backend/Postgres/n8n (`/healthz`)/Ollama en un solo llamado — lo usa el panel lateral del frontend. `GET /api/system/stats` devuelve conteos reales (mensajes, adjuntos, conversaciones, casos) — lo usa la vista "Nueva consulta".

`DELETE /api/jobs?scope=` (`failed` | `finished` | `all-inactive`) y `DELETE /api/cases?scope=` (`all` | `open` | `closed`) borran registros reales — nunca tocan jobs `queued`/`running`. El frontend pide confirmación explícita (modal) antes de llamarlos; si los usas directo por `curl`, no hay vuelta atrás.

### Qué borra cada operación destructiva

Ninguna operación de borrado del sistema toca el buzón real en Microsoft — todo lo que sigue es **local**, sobre el índice propio:

| Operación | Alcance | ¿Se puede recuperar? | ¿Afecta expedientes existentes? |
|---|---|---|---|
| `DELETE /api/messages?scope=...` | Borra mensajes indexados | Sí, reindexando (corriendo el job de nuevo) | Si el mensaje estaba correlacionado, se pierde esa correlación puntual — el expediente no se borra |
| `DELETE /api/messages/{id}/attachments/{id}` | Borra el registro de un adjunto puntual | Sí, si el mensaje se reindexa | No |
| `DELETE /api/jobs?scope=...` | Borra el historial de trabajos (`failed`/`finished`/`all-inactive`) | No | No — los jobs no tienen relación directa con expedientes |
| `DELETE /api/cases?scope=...` | Borra expedientes completos (`all`/`open`/`closed`) | No, salvo restaurar un backup de Postgres | Sí — borra el expediente entero, línea de tiempo, notas, evidencia y auditoría incluidas |
| `DELETE /api/mailboxes/{id}/owner` (admin) | Desconecta un buzón: borra en cascada sus mensajes/adjuntos locales | No para lo borrado; el buzón se puede reconectar pero sin el histórico | Expedientes que dependían solo de ese buzón se borran; expedientes con mensajes de otros buzones también sobreviven marcados `ai_stale` |
| `DELETE /api/admin/users/{id}` (admin) | Borra la cuenta de usuario | No la cuenta; sus expedientes tampoco se pierden | No borra expedientes — se reasignan al admin que ejecuta el borrado, con `previous_owner_label` como rastro |

En general: borrar **mensajes/adjuntos/jobs** es reversible reindexando; borrar **expedientes** o **buzones** no lo es (salvo restaurar un backup de la base); borrar **usuarios** nunca borra expedientes, siempre los reasigna.

## Tenants de Microsoft (`/api/admin/tenants`, solo admin)

```powershell
curl -X POST http://<host>/api/admin/tenants --cookie "mailingai_session=<tu cookie de sesion admin>" `
  -H "Content-Type: application/json" `
  -d '{\"label\":\"Cliente XYZ\",\"ms_tenant_id\":\"<tenant id de Azure>\",\"ms_client_id\":\"<client id>\",\"ms_client_secret\":\"<client secret>\"}'
curl http://<host>/api/admin/tenants --cookie "mailingai_session=<...>"
curl -X PATCH http://<host>/api/admin/tenants/<tenant_config_id> --cookie "mailingai_session=<...>" -H "Content-Type: application/json" -d '{\"is_active\":false}'
curl -X DELETE http://<host>/api/admin/tenants/<tenant_config_id> --cookie "mailingai_session=<...>"
```

Cada tenant registrado es una App Registration de Microsoft Entra ID distinta (ver [`AZURE_SETUP.md`](AZURE_SETUP.md#registrar-un-tenant-adicional-para-buzones-de-otra-organización)) — `ms_client_secret` nunca se devuelve por API (`GET`/`PATCH` solo exponen `has_client_secret: boolean`), y en un `PATCH` omitirlo (o mandar `null`) mantiene el secret existente en vez de borrarlo. Borrar un tenant no desconecta los buzones que ya se conectaron con él (cada buzón guarda su propio tenant/client id/secret en `identity.mailbox_accounts`), solo deja de aparecer como opción para conectar cuentas nuevas.

`GET /api/mailboxes/connect-url` (usado por el botón "Conectar cuenta nueva" del frontend) ahora exige `tenant_config_id` además de `label` — elige contra qué tenant registrado se hace el consentimiento OAuth2. El resto del flujo (popup + `postMessage` + `POST /api/mailboxes/{id}/claim`) no cambió, ver [`ARCHITECTURE.md`](ARCHITECTURE.md#multi-tenant-de-microsoft-entra-id-buzones-no-login-de-usuarios).

## Administración de usuarios (`/api/admin/users`, solo admin)

```powershell
curl -X POST http://<host>/api/admin/users --cookie "mailingai_session=<tu cookie de sesion admin>" `
  -H "Content-Type: application/json" -d '{\"email_address\":\"colega@empresa.com\",\"display_name\":\"Colega\"}'
curl http://<host>/api/admin/users --cookie "mailingai_session=<...>"
curl -X PATCH http://<host>/api/admin/users/<user_id> --cookie "mailingai_session=<...>" -H "Content-Type: application/json" -d '{\"enabled\":false}'
```

La cuenta SSO queda "pendiente de primer login" (`ms_object_id` nulo) hasta que la persona entra por primera vez con Microsoft — recién ahí se vincula. Desactivar (`enabled:false`) revoca todas sus sesiones activas de inmediato.

Para dar de alta una cuenta **local** en vez de SSO, se manda `auth_method`, `username` y `password` (mínimo 8 caracteres):

```powershell
curl -X POST http://<host>/api/admin/users --cookie "mailingai_session=<tu cookie de sesion admin>" `
  -H "Content-Type: application/json" -d '{\"email_address\":\"colega@empresa.com\",\"display_name\":\"Colega\",\"auth_method\":\"local\",\"username\":\"colega\",\"password\":\"unaClaveTemporal123\"}'
```

Esa contraseña es temporal: la persona la va a tener que cambiar (`POST /api/auth/change-password`) apenas entre con `POST /api/auth/local-login`. No hay recuperación de contraseña por email — si la olvida, un admin la resetea (`POST /api/admin/users/{id}/reset-password`, fuerza el cambio de nuevo y cierra las sesiones activas).

```powershell
curl http://<host>/api/admin/users/<user_id>/deletion-impact --cookie "mailingai_session=<...>"
curl -X DELETE http://<host>/api/admin/users/<user_id> --cookie "mailingai_session=<...>"
```

Borrar un usuario reasigna todos sus expedientes al admin que ejecuta el borrado, dejando `previous_owner_label` como rastro del dueño original (para poder reasignarlo a mano después con `PATCH /api/cases/{id}/owner`). Un admin no puede borrarse a sí mismo ni borrar al único admin habilitado que quede.
