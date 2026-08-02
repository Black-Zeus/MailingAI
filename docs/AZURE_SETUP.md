# Configuración de la cuenta en Azure (Microsoft Entra ID)

MailingAI necesita **una sola** App Registration en tu tenant de Microsoft Entra ID (Azure AD). La usan tres servicios distintos del stack, cada uno con su propio Redirect URI pero compartiendo `client id` / `client secret` / `tenant id`:

| Servicio | Para qué la usa | Redirect URI |
|---|---|---|
| `identity-broker` | Conectar un buzón real (OAuth2 delegado, guarda tokens de larga duración) | `http://<host>/identity/oauth/microsoft/callback` |
| `backend` | Login SSO de usuarios de la app (no guarda tokens de Graph, solo identifica a la persona) | `http://<host>/api/auth/microsoft/callback` |
| `n8n` | Ya no arma su propio token: le pide uno vigente a `identity-broker`. Este Redirect URI solo hace falta si en algún momento se vuelve a usar la credencial OAuth2 nativa del editor de n8n | `http://<host>/n8n/rest/oauth2-credential/callback` |

Sustituye `<host>` por el dominio/puerto público real (en desarrollo local, `localhost`).

## 1. Crear la App Registration

1. Portal de Azure → **Microsoft Entra ID → App registrations → New registration**.
2. Nombre libre (ej. `MailingAI`).
3. Tipo de cuenta: **Accounts in this organizational directory only** (single-tenant) — es el caso normal para un buzón corporativo. Si eliges soportar varios tenants, la configuración de la credencial de OAuth2 en n8n (más abajo) tiene que apuntar al endpoint `/common` en vez de al de tu tenant específico.
4. **Authentication → Add a platform → Web** y agrega los tres Redirect URIs de la tabla de arriba. Se pueden agregar todos de una vez, y no hace falta borrar ninguno si más adelante cambias de dominio — simplemente agrega el nuevo.

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

**Certificates & secrets → New client secret.** El valor solo se muestra una vez al crearlo — cópialo de inmediato. No hay forma de recuperarlo después; si se pierde, hay que generar uno nuevo y actualizar `.env` (y el archivo de credenciales de n8n, ver abajo).

## 4. Datos que necesitas anotar

Al terminar tienes tres valores. Van al `.env` del proyecto (nunca se commitean — `.env` está en `.gitignore`):

```env
MS_TENANT_ID=<Directory (tenant) ID>
MS_CLIENT_ID=<Application (client) ID>
MS_CLIENT_SECRET=<el client secret generado en el paso 3>
```

`identity-broker` y el `backend` los toman directo de estas variables. **n8n es distinto**: no lee `.env` para esto — usa una credencial propia (`n8n/credentials/mailingai-graph-oauth2.json`, ignorada por git) donde estos mismos tres valores se pegan a mano una vez, más el tipo de credencial genérico `OAuth2 API` (no el nativo "Microsoft OAuth2 API" de n8n, que fuerza el endpoint `/common` y falla con `AADSTS50194` en apps single-tenant):

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

Ver [`INSTALL.md`](INSTALL.md) para el flujo completo de import (`scripts/import-n8n.sh`) que crea esta plantilla automáticamente la primera vez.

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
