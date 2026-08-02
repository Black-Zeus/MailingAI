# Instalación y despliegue

Guía end-to-end para levantar el stack desde cero. Para el detalle nodo por nodo de cada workflow de n8n: [`n8n/WorkFlows/README.md`](../n8n/WorkFlows/README.md). Para probar el backend directo con `curl` una vez levantado: [`API.md`](API.md).

> A lo largo de esta guía, `<host>` es la IP o el dominio donde corre el servidor de la aplicación (`localhost` solo si la abres desde la misma máquina donde corre Docker).

## 0. Prerrequisitos

- Docker + Docker Compose.
- En Windows: Git Bash o WSL (los scripts del proyecto son `sh`, no PowerShell nativo).
- `openssl` o `htpasswd` (paquete `apache2-utils`/`httpd-tools`) para generar la Basic Auth del editor de n8n.
- Una App Registration en Microsoft Entra ID ya creada — ver [`AZURE_SETUP.md`](AZURE_SETUP.md) (hace falta el `tenant id`, `client id` y `client secret` **antes** de este paso).

## 1. Configurar `.env`

Copia la plantilla y completa los valores reales:

```sh
cp .env.example .env
```

Como mínimo hay que reemplazar los placeholders de:

```env
MS_TENANT_ID=...
MS_CLIENT_ID=...
MS_CLIENT_SECRET=...
POSTGRES_PASSWORD=...
WEBHOOK_SHARED_SECRET=...
```

El resto de las variables (puertos, hosts, timezone, etc.) ya vienen con valores razonables para desarrollo local en `.env.example`. `WEBHOOK_SHARED_SECRET` (y cualquier otro secreto) se puede generar con:

```sh
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## 2. Basic Auth del editor de n8n

`n8n` queda detrás del proxy en `/n8n/` con una segunda capa de autenticación (aparte del login propio de n8n):

```sh
# con htpasswd
htpasswd -c proxy/.htpasswd admin
# sin htpasswd (Git Bash/WSL, requiere openssl)
printf "admin:$(openssl passwd -apr1 TU_CLAVE)\n" > proxy/.htpasswd
```

## 3. Levantar el stack

```sh
docker compose up -d
```

Servicios y a qué puerto quedan (todos internos salvo `proxy`, único puerto publicado al host):

```text
proxy             http://<host>/            (único punto de entrada público)
postgres          interno, sin puerto público
backend           interno, sin puerto público
identity-broker   interno, sin puerto público
frontend          interno, sin puerto público
n8n               interno, sin puerto público (accesible vía /n8n/)
ollama            interno, sin puerto público
```

Primera vez: baja el modelo de IA local (no viene precargado en la imagen de Ollama):

```sh
docker compose exec ollama ollama pull qwen2.5:3b
```

## 4. Migraciones de base de datos

`config/postgres/init/*.sql` corre automáticamente **solo la primera vez** que se crea el volumen de Postgres (`postgres_data`). Si el volumen ya existía cuando se agregó un script nuevo, hay que aplicarlo a mano una vez, en orden:

```sh
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/<archivo>.sql
```

Lista completa, en el orden en que deben aplicarse (archivos ya presentes en `config/postgres/init/`, se van sumando ahí a medida que se agregan features nuevas — un volumen nuevo no necesita correr nada de esto a mano, ya lo aplica solo):

```text
20260716_0001_mailing_attachments.sql
20260716_0002_mailing_analysis_jobs.sql
20260716_0003_mailing_mail_folders.sql
20260716_0004_mailing_cases_timeline.sql
20260716_0005_mailing_ai_runs.sql
20260716_0006_mailing_jobs_retry.sql
20260716_0007_mailing_message_body.sql
20260729_0001_identity_users_sessions.sql
20260729_0002_mailing_case_ownership_sharing.sql
20260729_0003_identity_mailbox_ownership_sharing.sql
20260729_0004_mailing_case_summary_owner.sql
20260729_0005_mailing_case_batch_runs_owner.sql
20260729_0006_identity_notifications.sql
20260729_0007_identity_mailbox_notification_sender.sql
20260729_0008_mailing_mailbox_index_runs.sql
20260731_0001_mailing_case_summary_created_at.sql
20260731_0002_mailing_case_evidence_author.sql
20260801_0001_mailing_cases_outcome_more_states.sql
20260801_0002_mailing_cases_outcome_sin_recepcion.sql
20260801_0003_mailing_ai_runs_running_status.sql
20260801_0004_mailing_cases_pending_action_review.sql
20260801_0005_identity_notifications_kinds.sql
20260801_0006_mailing_case_audit_log.sql
20260801_0007_identity_mailbox_accounts_last_synced.sql
20260801_0008_identity_notifications_delta_sync_kind.sql
20260801_0009_identity_users_local_login.sql
20260801_0010_mailing_cases_previous_owner_label.sql
20260801_0011_mailing_case_summary_previous_owner.sql
20260801_0012_mailing_case_summary_updated_at.sql
```

Consulta manual de ejemplo contra las tablas/vistas ya pobladas:

```powershell
docker compose exec -T postgres psql -U mailingai -d mailingai -c "SELECT * FROM mailing.v_messages_by_day;"
docker compose exec -T postgres psql -U mailingai -d mailingai -c "SELECT * FROM mailing.v_cr_attachment_traceability WHERE matches_naming_convention = true;"
```

## 5. Importar credenciales y workflows en n8n

Toda la lógica de importación corre **dentro del contenedor** `mailingai_n8n`, en `n8n/import.sh`: crea la carpeta `n8n/credentials` y las plantillas si faltan, valida que la de Graph ya no tenga placeholders, y llama a la CLI de n8n (`n8n import:credentials`, `n8n import:workflow`). `scripts/import-n8n.sh` es solo un disparador desde shell (igual en Linux y en Windows vía Git Bash/WSL). Credenciales y workflows tienen un `id` fijo en su JSON, así que **volver a correr el import es seguro**: n8n actualiza el registro existente en vez de duplicarlo.

```sh
./scripts/import-n8n.sh
```

1. La primera corrida crea las plantillas de credenciales en `n8n/credentials/` (bind-mounted, quedan visibles en el host): `mailingai-postgres.json` (ya listo, usa el password de `.env`) y `mailingai-graph-oauth2.json` (con placeholders). El import se detiene ahí, pidiendo llenar los datos reales de Graph.
2. Edita `n8n/credentials/mailingai-graph-oauth2.json` con los datos de tu App Registration (ver [`AZURE_SETUP.md`](AZURE_SETUP.md)). Usa el tipo genérico **`OAuth2 API`** de n8n, no el nativo "Microsoft OAuth2 API" — ese pega siempre contra el endpoint `/common`, que falla con `AADSTS50194` en apps single-tenant (el caso normal). La plantilla ya viene armada así, solo reemplaza `REEMPLAZA_CON_TU_TENANT_ID` (aparece dos veces), `REEMPLAZA_CON_TU_CLIENT_ID` y `REEMPLAZA_CON_TU_CLIENT_SECRET`.
3. Corre el script de nuevo — esta vez importa las 3 credenciales y los ~16 workflows, agrupados en una carpeta **MailingAI** dentro de tu proyecto personal de n8n (lo hace `n8n/create-folder.sh`, invocado automáticamente; también reactiva los workflows con webhook/schedule, que `import:workflow` deja `inactive` por defecto).
4. Entra a `http://<host>/n8n/` (pide la Basic Auth del paso 2) → **Credentials → MailingAI Graph OAuth2 → Connect my account** y completa el consentimiento OAuth2 con tu cuenta real — este paso siempre es manual, no se puede automatizar desde un script.

Estas credenciales **no** se guardan en `.env`: los archivos en `n8n/credentials/*.json` quedan ignorados por git y, una vez importados, el `clientSecret`/password quedan cifrados dentro de la base de datos de n8n.

Parámetros del script: `--force` (importa aunque el archivo de Graph todavía tenga placeholders, solo para probar el mecanismo), `--skip-credentials` (importa solo los workflows), `--skip-workflows` (importa solo las credenciales).

Qué revisar después de importar:

1. **typeVersion de nodos**: si n8n marca algún nodo como desactualizado, ábrelo y deja que n8n lo migre a la versión soportada por tu instalación.
2. Prueba primero `01 - MailingAI - Fetch Sent Items` con **Execute Workflow** manual y revisa cada nodo paso a paso (`Test step`) antes de dejarlo en producción.

Alternativa manual (sin el script): importar cada archivo de `n8n/WorkFlows/` desde **Workflows → Import from File** (empezando por `00-mailingai-graph-fetch-subworkflow.json`) y crear las credenciales a mano desde **Credentials → New** — en ese caso hay que reseleccionar la credencial en cada nodo y agrupar los workflows a mano si se quiere.

Detalle nodo por nodo de cada workflow: [`n8n/WorkFlows/README.md`](../n8n/WorkFlows/README.md).

## 6. Crear el primer administrador

`identity.users` empieza vacía — sin al menos un admin, nadie puede loguearse:

```sh
docker exec mailingai_backend python -m app.scripts.bootstrap_admin --email tu-email@empresa.com --name "Tu Nombre"
```

El email **debe** corresponder a una cuenta real de Microsoft dentro del tenant configurado en `MS_TENANT_ID` — el login es SSO contra Azure AD para esta primera cuenta (no hay recuperación por email ni auto-registro: `identity.users` nunca crea filas por sí sola). Nunca escala privilegios de un usuario ya existente. Después de correrlo, entra a `http://<host>/` y usa "Ingresar con Microsoft" con esa misma cuenta.

### Migrar a un entorno nuevo (otro host, otro ambiente)

Cada entorno con una base de datos nueva (volumen de Postgres recién creado, o `identity.users` vacía por cualquier motivo) necesita repetir estos pasos — son independientes del código, que no cambia entre entornos:

1. **Redirect URI en Azure AD**: agregar `http://<host-nuevo>/api/auth/microsoft/callback` (y los otros dos de [`AZURE_SETUP.md`](AZURE_SETUP.md) si cambia todo el dominio) a la misma App Registration — no hace falta borrar los anteriores.
2. **Variables de entorno**: `BACKEND_PUBLIC_URL`, `IDENTITY_BROKER_PUBLIC_URL` y `FRONTEND_URL` en `.env` deben apuntar a las URLs públicas reales del entorno nuevo; `MS_TENANT_ID`/`MS_CLIENT_ID`/`MS_CLIENT_SECRET` normalmente son los mismos (misma App Registration), salvo que el entorno nuevo use un tenant distinto.
3. **Bootstrap del admin**: correr `bootstrap_admin.py` (arriba) con el email real de quien va a administrar ese entorno.
4. **Login**: entrar con esa cuenta desde el frontend del entorno nuevo para activarla.

Un volumen de Postgres existente que se copia/restaura entre entornos (backup real, no un volumen nuevo) sí conserva `identity.users` tal cual — en ese caso no hace falta repetir el bootstrap, solo el paso 1 y 2 si cambió el host.

## 7. Conectar el primer buzón

Solo un administrador puede registrar buzones nuevos (Configuración → Buzones → Conectar buzón). El flujo abre el consentimiento OAuth2 de Microsoft (vía `identity-broker`) y, al volver, el buzón queda reclamado automáticamente por quien lo conectó.

## 8. Verificar

```text
http://<host>/api/system/status   -> estado de backend/Postgres/n8n/Ollama
```

En el frontend, el panel lateral muestra el mismo estado. Con el primer buzón conectado, dispara una sincronización manual desde Configuración → Buzones → botón "Sincronizar" en la fila del buzón para traer el historial inicial.

## Detener

```sh
docker compose down
```

(No usa `-v` — los volúmenes de Postgres/n8n/Ollama se conservan entre reinicios.)

## Actualizar código (rebuild)

Después de un cambio en `backend/`, `frontend/` o `identity-broker/`, la imagen hay que reconstruirla explícitamente (no hay hot-reload en el despliegue vía Docker Compose):

```sh
docker compose build backend
docker compose up -d backend
```

Mismo patrón para `frontend` e `identity-broker`. Cambios en workflows de n8n (`n8n/WorkFlows/*.json`) se aplican reimportando (`./scripts/import-n8n.sh --skip-credentials`), no con un rebuild.

