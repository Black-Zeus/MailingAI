# Runbook operacional

Tareas del día a día una vez que el stack ya está instalado. Para la instalación inicial, ver [`INSTALL.md`](INSTALL.md); para el modelo de seguridad detrás de varias de estas decisiones, ver [`SECURITY.md`](SECURITY.md).

## Arranque, detención y actualización

Ver [`INSTALL.md`](INSTALL.md#detener) — `docker compose up -d` / `docker compose down` (sin `-v`, conserva los volúmenes) / rebuild por servicio tras un cambio de código.

Reinicio seguro de un servicio puntual, sin bajar el resto del stack:

```sh
docker compose restart backend
```

## Comprobación de salud

```sh
docker compose ps
curl http://<host>/api/system/status
```

`docker compose ps` muestra el `healthcheck` de cada contenedor (`postgres`, `backend`, `identity-broker`, `frontend`, `ollama` lo tienen definido en `docker-compose.yml`; `n8n`/`proxy` no). `GET /api/system/status` es el que usa el panel lateral del frontend — agrega en un solo llamado si backend/Postgres/n8n (`/healthz`)/Ollama responden.

## Logs

```sh
docker compose logs -f backend
docker compose logs -f n8n
docker compose logs --tail 100 postgres
```

Para una corrida de n8n puntual (útil para depurar un job fallido), desde el editor: **Executions** → abrir la ejecución → cada nodo muestra su input/output real. También se puede consultar directo:

```sh
docker compose exec -T postgres psql -U mailingai -d mailingai -c "SELECT id, \"workflowId\", status, \"startedAt\", \"stoppedAt\" FROM execution_entity ORDER BY \"startedAt\" DESC LIMIT 20;"
```

## Jobs atascados (`mailing.analysis_jobs`)

Un job puede quedar en `queued` (n8n no respondió al webhook) o `running` (n8n lo tomó pero nunca marcó el resultado final — ver casos reales documentados en [`n8n/WorkFlows/README.md`](../n8n/WorkFlows/README.md), notas técnicas 15/17/18). **A diferencia de otras corridas del sistema** (lotes de IA, lotes de creación de expedientes, reindexación de buzón, corridas de IA individuales — las cuatro se auto-recuperan al reiniciar el backend, marcándose `failed`), `mailing.analysis_jobs` **no tiene ese mismo mecanismo de recuperación al arrancar** — un job atascado ahí se queda atascado hasta que alguien actúa.

Para destrabarlo:

```sh
curl -X POST http://<host>/api/jobs/<job_id>/cancel --cookie "mailingai_session=<...>"
```

Funciona sobre `queued`/`running` (`409` si el job ya terminó de cualquier forma). Es una cancelación "suave": no mata una ejecución de n8n que ya esté en curso, solo evita que su resultado final pise el estado `cancelled` una vez que termine.

Para reintentar un job que sí llegó a `failed` (crea uno nuevo con los mismos parámetros, enlazado al original vía `retry_of_job_id`):

```sh
curl -X POST http://<host>/api/jobs/<job_id>/retry --cookie "mailingai_session=<...>"
```

Limpieza masiva de historial de jobs (irreversible, ver tabla de [`API.md`](API.md#qué-borra-cada-operación-destructiva)):

```sh
curl -X DELETE "http://<host>/api/jobs?scope=failed" --cookie "mailingai_session=<...>"
```

## Rotar secretos

**`WEBHOOK_SHARED_SECRET`** (backend ↔ n8n):

```sh
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

1. Poner el valor nuevo en `.env` (`WEBHOOK_SHARED_SECRET`).
2. Poner el mismo valor en `n8n/credentials/mailingai-webhook-secret.json`.
3. `docker compose up -d backend` (toma el nuevo valor de `.env`) y `./scripts/import-n8n.sh --skip-workflows` (reimporta solo la credencial).

**`MS_CLIENT_SECRET`** (Microsoft Entra ID):

1. Azure Portal → la App Registration → **Certificates & secrets** → generar uno nuevo (el viejo se puede dejar activo un tiempo para no cortar sesiones OAuth2 en curso, o revocarlo de una si es por un incidente).
2. Actualizar `.env` (`MS_CLIENT_SECRET`) y `docker compose up -d backend identity-broker`.
3. `n8n` no necesita nada — no usa esa credencial (ver [`ARCHITECTURE.md`](ARCHITECTURE.md)).

**`POSTGRES_PASSWORD`**: cambiarlo implica actualizar `.env`, la credencial `n8n/credentials/mailingai-postgres.json`, y reiniciar todos los servicios que hablan con Postgres directo (`backend`, `identity-broker`, `n8n`) — no hay un procedimiento con cero downtime documentado para esto hoy.

## Sincronización de buzón fallida

```sh
curl -X POST "http://<host>/api/admin/mailbox-index/delta-sync?mailbox_account_id=<id>" --cookie "mailingai_session=<admin>"
```

(o el botón "Sincronizar" en Configuración → Buzones, fila del buzón). Si sigue sin traer nada nuevo: revisar que el token del buzón siga vigente (`identity-broker` lo refresca solo mientras el `refresh_token` de Graph sea válido — si el usuario revocó el consentimiento desde el lado de Microsoft, o pasó demasiado tiempo, hay que reconectar el buzón desde cero, Configuración → Buzones → Conectar buzón). El delta sync automático diario no queda registrado en ninguna tabla de corridas visibles en la UI — el log de esa corrida vive solo en **Executions** de n8n (workflow `15`).

## Crecimiento de PostgreSQL

```sh
docker compose exec -T postgres psql -U mailingai -d mailingai -c "SELECT pg_size_pretty(pg_database_size('mailingai'));"
docker compose exec -T postgres psql -U mailingai -d mailingai -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;"
```

No hay una política de retención/purga automática — `mailing.messages`/`message_attachments` crecen indefinidamente salvo que se use `DELETE /api/messages?scope=...` a mano (ver [`API.md`](API.md)).

## Limpieza de archivos generados

Los PNG de gráficos (`share/mailingai/out/`) se limpian solos: workflow `13` (cron diario) borra los que ya no tienen una fila viva en `mailing.chart_runs`. No requiere intervención manual salvo que el workflow esté desactivado — verificar en n8n → Executions que corrió recientemente.

## Cambiar el proveedor/modelo de IA activo

Se administra desde Configuración (solo admin) — ver [`API.md`](API.md#inteligencia-artificial-apiai). Cambiar a un modelo de Ollama más grande requiere descargarlo primero: `docker compose exec ollama ollama pull <modelo>`.
