# Configuración de la cuenta en Azure (Microsoft Entra ID)

MailingAI necesita **al menos una** App Registration en un tenant de Microsoft Entra ID (Azure AD) — la del `.env`, usada tanto para el login SSO de usuarios de la app como, por defecto, para conectar buzones. Si además querés cargar buzones de **otras organizaciones** (otros tenants de Microsoft, cada uno con su propia App Registration), ver la sección [Registrar un tenant adicional](#registrar-un-tenant-adicional-para-buzones-de-otra-organización) al final — el login SSO de usuarios sigue atado exclusivamente al tenant del `.env` en cualquier caso.

La App Registration del `.env` la usan dos servicios del stack, cada uno con su propio Redirect URI pero compartiendo `client id` / `client secret` / `tenant id` (los mismos tres valores, solo en `.env`):

| Servicio | Para qué la usa | Redirect URI |
|---|---|---|
| `identity-broker` | Conectar un buzón real (OAuth2 delegado, guarda tokens de larga duración) — n8n le pide el token vigente a este servicio, no maneja OAuth2 propio | `http://<host>/identity/oauth/microsoft/callback` |
| `backend` | Login SSO de usuarios de la app (no guarda tokens de Graph, solo identifica a la persona) | `http://<host>/api/auth/microsoft/callback` |

`n8n` **no** necesita Redirect URI propio ni una credencial OAuth2 completa: los nodos que llaman a Graph piden el token a `identity-broker` por la red interna (ver [`ARCHITECTURE.md`](ARCHITECTURE.md)). Solo haría falta el Redirect URI `http://<host>/n8n/rest/oauth2-credential/callback` si en algún momento se vuelve a usar la credencial OAuth2 nativa del editor de n8n — no es el caso hoy.

Sustituye `<host>` por el dominio/puerto público real (en desarrollo local, `localhost`).

## 1. Crear la App Registration

1. Portal de Azure → **Microsoft Entra ID → App registrations → New registration**.
2. Nombre libre (ej. `MailingAI`).
3. Tipo de cuenta: **Accounts in this organizational directory only** (single-tenant) — es el caso normal para un buzón corporativo.
4. **Authentication → Add a platform → Web** y agrega los dos Redirect URIs de la tabla de arriba. No hace falta borrar ninguno si más adelante cambias de dominio — simplemente agrega el nuevo.

## 2. Permisos de Microsoft Graph

**API permissions → Add a permission → Microsoft Graph → Delegated permissions**:

```text
Mail.Read              -- leer los mensajes del buzón conectado (indexación)
Mail.Send               -- enviar expedientes por correo y las notificaciones por email
                           (compartir expediente/buzón, alta de cuenta) -- ya no es opcional,
                           el sistema las usa activamente
MailboxSettings.Read    -- resolver zona horaria / configuración del buzón
offline_access           -- refresh token, para no pedir login de nuevo cada hora
openid profile email     -- identidad básica, usado por el login SSO de usuarios
User.Read                -- perfil básico de la cuenta conectada
```

Si tu tenant requiere consentimiento de administrador para alguno de estos permisos delegados, un admin del tenant tiene que aprobarlo una vez desde **Grant admin consent**.

## 3. Client secret

**Certificates & secrets → New client secret.** El valor solo se muestra una vez al crearlo — cópialo de inmediato. No hay forma de recuperarlo después; si se pierde, hay que generar uno nuevo y actualizar `.env`.

## 4. Datos que necesitas anotar

Al terminar tienes tres valores. Van **solo** al `.env` del proyecto (nunca se commitean — `.env` está en `.gitignore`):

```env
MS_TENANT_ID=<Directory (tenant) ID>
MS_CLIENT_ID=<Application (client) ID>
MS_CLIENT_SECRET=<el client secret generado en el paso 3>
```

`identity-broker` y el `backend` los toman directo de estas variables — no hay que configurar nada más en ningún otro lugar. El script de import de n8n (`scripts/import-n8n.sh`, ver [`INSTALL.md`](INSTALL.md)) crea de paso una plantilla `n8n/credentials/mailingai-graph-oauth2.json` con datos de ejemplo: es un resabio de una versión anterior de la arquitectura, ningún workflow la usa hoy, y se importa igual sin necesidad de completarla con datos reales.

Al arrancar por primera vez, `identity-broker` siembra automáticamente estos tres valores como el primer "tenant registrado" (`identity.tenant_configs`, etiquetado "Tenant principal (.env)") — es el mismo mecanismo que usan los tenants adicionales (ver abajo), así que un deploy existente no pierde la capacidad de conectar buzones nuevos al agregar esta tabla.

## 5. Migrar a otro entorno (otro host/dominio)

La App Registration es una sola y se reutiliza entre entornos — no hay que crear una nueva por cada despliegue. Lo único que cambia por entorno:

1. Agregar el/los Redirect URI nuevo(s) (con el host nuevo) en **Authentication**, sin borrar los anteriores.
2. Actualizar `BACKEND_PUBLIC_URL`, `IDENTITY_BROKER_PUBLIC_URL`, `FRONTEND_URL` en el `.env` de ese entorno.
3. `MS_TENANT_ID`/`MS_CLIENT_ID`/`MS_CLIENT_SECRET` normalmente son los mismos (mismo tenant), salvo que el entorno nuevo deba usar un tenant de Microsoft distinto.

## Alcance de cada permiso (por qué se pide)

- **`Mail.Read`**: es lo único que usa la indexación de buzones (workflows n8n 00-06, 15) — nunca escribe ni borra nada en el buzón real, solo lee.
- **`Mail.Send`**: usado por el workflow 12 (`Send Case Email`) para dos cosas: el botón "Enviar expediente por correo" del frontend, y los avisos automáticos por email (compartir expediente, compartir buzón, cuenta creada) que dispara el backend vía `notification_email_service`.
- **`offline_access`**: sin este scope, `identity-broker` tendría que repetir el consentimiento OAuth2 completo cada vez que expira el token de acceso (~1 hora) — con `offline_access` se refresca solo.
- **`openid profile email` / `User.Read`**: exclusivos del login SSO de usuarios de la app (backend) — no tocan el buzón, solo confirman "esta persona es quien dice ser" contra el tenant.

No se pide ningún permiso de **aplicación** (application permissions) — todo el acceso es delegado, atado a la sesión de quien hizo el consentimiento (el buzón conectado desde Configuración → Buzones, o la persona que hace login SSO). MailingAI nunca tiene acceso "de fondo" a buzones que nadie conectó explícitamente.

## Registrar un tenant adicional (para buzones de otra organización)

Cada tenant de Microsoft (organización) que vaya a tener buzones conectados necesita **su propia** App Registration en **su propio** Entra ID — no se puede reutilizar la App Registration de otro tenant, aunque sea del mismo proyecto MailingAI. Esto es una limitación real de Azure AD (una App Registration vive en un tenant específico), no una decisión del proyecto.

1. En el tenant de esa organización: **Microsoft Entra ID → App registrations → New registration**, tipo de cuenta **single-tenant** (igual que el paso 1 de arriba).
2. **Authentication → Add a platform → Web** y agrega **un solo** Redirect URI: `http://<host>/identity/oauth/microsoft/callback` (el mismo path que la App Registration principal — es el callback fijo de `identity-broker`, no cambia entre tenants; lo único que varía por tenant es el `tenant id`/`client id`/`client secret`). **No** hace falta el Redirect URI del `backend` (`/api/auth/microsoft/callback`) — el login SSO de usuarios de la app no usa tenants adicionales, solo el del `.env`.
3. **API permissions**: los mismos permisos delegados de Graph de la sección 2 de arriba, **salvo** `openid profile email` (no aplica — este tenant no se usa para login de usuarios). Un admin de esa organización tiene que dar `Grant admin consent` si el tenant lo requiere.
4. **Certificates & secrets → New client secret**, copiarlo de inmediato (igual que el paso 3 de arriba).
5. En MailingAI: **Configuración → Buzones → Tenants de Microsoft → ＋ Agregar tenant** (solo admin) y completar nombre/tenant id/client id/client secret. Queda disponible de inmediato como opción al conectar una cuenta nueva — no hace falta editar `.env` ni reiniciar ningún contenedor.

Un tenant se puede marcar inactivo (o eliminar) desde esa misma pantalla sin afectar los buzones que ya se conectaron con él — cada buzón guarda su propio `tenant_id`/`client_id`/`client_secret` al momento de conectarse (`identity.mailbox_accounts`), independiente de si el tenant sigue registrado o no.
