# Instalación y despliegue

Guía end-to-end para levantar el stack desde cero. Para el detalle exhaustivo de cada paso (parámetros del script de n8n, qué hace cada workflow, etc.) el [`README.md`](../README.md) de la raíz sigue siendo la referencia completa — esta guía es el camino feliz resumido.

> A lo largo de esta guía, `<host>` es la IP o el dominio donde corre el servidor de la aplicación (`localhost` solo si la abres desde la misma máquina donde corre Docker).

## 0. Prerrequisitos

- Docker + Docker Compose.
- En Windows: Git Bash o WSL (los scripts del proyecto son `sh`, no PowerShell nativo — aunque el propio `README.md` también documenta el equivalente PowerShell donde aplica).
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

`config/postgres/init/*.sql` corre automáticamente **solo la primera vez** que se crea el volumen de Postgres (`postgres_data`). Si el volumen ya existía cuando se agregó un script nuevo, hay que aplicarlo a mano una vez:

```sh
docker compose exec -T postgres psql -U mailingai -d mailingai -f /docker-entrypoint-initdb.d/<archivo>.sql
```

La lista completa y actualizada de migraciones pendientes de aplicar a mano vive en [`README.md`](../README.md#4-esquema-de-datos-mailing) (sección "Migraciones aplicadas después del primer arranque") — se agregan ahí a medida que se suman features nuevas, por eso no se duplica una copia estática acá.

## 5. Importar credenciales y workflows en n8n

```sh
./scripts/import-n8n.sh
```

La primera corrida crea las plantillas de credenciales en `n8n/credentials/` (bind-mounted, quedan visibles en el host) y se detiene pidiendo completar la de Graph con los datos reales de la App Registration (ver [`AZURE_SETUP.md`](AZURE_SETUP.md)). Edita `n8n/credentials/mailingai-graph-oauth2.json` y corre el script de nuevo — esta vez importa las credenciales y los ~16 workflows, agrupados en una carpeta **MailingAI** dentro de n8n.

Después de importar, entra a `http://<host>/n8n/` (pide la Basic Auth del paso 2) → **Credentials → MailingAI Graph OAuth2 → Connect my account** y completa el consentimiento OAuth2 con tu cuenta real — este paso siempre es manual, no se puede automatizar desde un script.

Detalle completo del script, parámetros (`--force`, `--skip-credentials`, `--skip-workflows`) y qué hace cada workflow: [`README.md`](../README.md#2-cargar-credenciales-y-workflows-con-el-script) y [`n8n/WorkFlows/README.md`](../n8n/WorkFlows/README.md).

## 6. Crear el primer administrador

`identity.users` empieza vacía — sin al menos un admin, nadie puede loguearse:

```sh
docker exec mailingai_backend python -m app.scripts.bootstrap_admin --email tu-email@empresa.com --name "Tu Nombre"
```

El email **debe** corresponder a una cuenta real de Microsoft dentro del tenant configurado en `MS_TENANT_ID` — el login sigue siendo SSO contra Azure AD para esta primera cuenta. Después de correrlo, entra a `http://<host>/` y usa "Ingresar con Microsoft" con esa misma cuenta.

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

