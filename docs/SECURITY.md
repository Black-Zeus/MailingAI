# Seguridad

Modelo de amenazas, límites de confianza y limitaciones conocidas — verificado contra el código real, no una descripción aspiracional. Para el estado implementado/pendiente de cada punto, ver también [`STATUS.md`](STATUS.md).

## Modelo de amenazas

MailingAI está pensado para correr en una red controlada (VPN, red corporativa cerrada) con un grupo acotado de usuarios autorizados por un administrador — **no** está diseñado hoy para exponerse directo a Internet (ver [`INSTALL.md`](INSTALL.md#antes-de-exponer-esto-a-una-red-real)). El activo más sensible es el contenido de los correos indexados (asunto, cuerpo, adjuntos, participantes) y las credenciales OAuth2 de los buzones conectados.

Actores considerados:

- **Usuario autenticado sin privilegios de admin** — debe poder ver/editar solo sus expedientes/buzones propios y los compartidos con él, nunca los de otros.
- **Administrador** — acceso total por diseño (soporte/auditoría); el modelo no protege contra un admin malicioso.
- **n8n / identity-broker** (red interna) — se confía en que solo el backend y n8n pueden alcanzar sus rutas internas, porque no están expuestas por el proxy.
- **Atacante externo (sin cuenta)** — no debería poder autenticarse (no hay auto-registro) ni alcanzar ninguna ruta interna.

**Fuera del modelo de amenazas actual**: un atacante con acceso a la máquina/host de Docker (puede leer `.env`, volúmenes, la base directamente); un admin que abusa de su propio acceso; ataques de red activos si no hay TLS (ver más abajo).

## Autenticación y sesiones

- Cookie de sesión (`mailingai_session`): `HttpOnly=true` (no accesible desde JavaScript), `SameSite=Lax`, `Secure` **configurable** vía `SESSION_COOKIE_SECURE` (`false` por defecto en desarrollo — **debe** ponerse en `true` detrás de TLS real, ver [`INSTALL.md`](INSTALL.md#antes-de-exponer-esto-a-una-red-real)).
- El token de sesión se guarda **hasheado** en `identity.sessions` (`session_token_hash`), nunca en texto plano — un dump de la base no expone tokens de sesión utilizables directamente.
- TTL deslizante de 12 horas (`session_ttl_seconds`, se renueva con cada request) con un techo absoluto de 7 días (`session_absolute_ttl_seconds`) — una sesión nunca se extiende indefinidamente aunque el usuario siga activo.
- Login local: contraseñas con Argon2id (`argon2-cffi`), nunca en texto plano ni siquiera en memoria más de lo necesario. `must_change_password` fuerza el cambio en el primer login de una cuenta creada por un admin.
- Login SSO: flujo OAuth2 Authorization Code con validación de `state` (mitiga CSRF sobre el propio flujo de login) contra Microsoft Entra ID.
- **No hay recuperación de contraseña por email** para cuentas locales — es una decisión deliberada (no existe una cuenta de correo de "sistema" separada de los buzones reales); el admin resetea manualmente.

## CSRF

La mitigación principal es `SameSite=Lax` en la cookie de sesión: un request de otro origen (ej. un sitio malicioso que intenta un `POST` contra la API) no adjunta la cookie, así que llega sin sesión y el backend lo rechaza. **No hay un token CSRF explícito** (patrón doble-submit o similar) — es una superficie que vale la pena endurecer si en algún momento se soporta un cliente que no sea el propio frontend SPA (ej. una integración desde otro dominio) o si se relaja `SameSite`.

## Rutas sin autenticación de sesión (y por qué)

Tres grupos de rutas no exigen `mailingai_session`, cada uno por una razón distinta:

- **`/api/auth/*`** — obvio, es el propio login (no puede exigir la sesión que todavía no existe).
- **`/charts/*`** (backend) — no expone datos sensibles ni acceso a la base; solo genera una imagen a partir de los puntos que se le mandan en el body. Está **mapeada públicamente a propósito** en `proxy/nginx.conf`, pensada para ser llamada por n8n server-to-server pero también probable a mano.
- **`/internal/*`** (backend) y `/internal/token/*` (`identity-broker`) — estas sí son sensibles (la segunda entrega un token de Graph vigente para un buzón). Su única protección es que **no están mapeadas en `proxy/nginx.conf`**, así que no son alcanzables desde fuera del stack — dependen enteramente del aislamiento de red de Docker (`mailingai_internal`), no tienen autenticación propia. **Esto no es una autenticación por sí sola**: cualquier proceso que logre correr dentro de esa red (un contenedor comprometido, por ejemplo) puede llamarlas sin credenciales. Es una limitación conocida, no un descuido — endurecerla (ej. un secreto compartido también para estas rutas, como ya existe para los webhooks que dispara el backend hacia n8n) es una mejora pendiente, no algo resuelto hoy.

`/webhook/*` de n8n (workflows `07`, `08`, `10`, `12`, `15`) sí valida un header (`X-MailingAI-Secret`) contra `WEBHOOK_SHARED_SECRET` vía credencial `httpHeaderAuth` — estas rutas están pensadas para ser alcanzadas desde el backend, y la validación del secreto es la barrera real (no solo el aislamiento de red).

## Gestión de secretos

- Viven exclusivamente en `.env` (fuera de git, ver `.env.example` para la plantilla sin valores reales) y en `n8n/credentials/*.json` (también fuera de git).
- `MS_CLIENT_SECRET`, `WEBHOOK_SHARED_SECRET`, `POSTGRES_PASSWORD`: sin rotación automatizada. Rotar cualquiera de los tres hoy es un procedimiento manual (ver [`OPERATIONS.md`](OPERATIONS.md#rotar-secretos)).
- La credencial `n8n/credentials/mailingai-graph-oauth2.json` es un resabio sin uso real (ver [`ARCHITECTURE.md`](ARCHITECTURE.md)) — no guarda ningún secreto vigente aunque tenga esa forma.
- No se encontró ningún punto del código que loguee contraseñas o secretos en texto plano (verificado con búsqueda dirigida, no una auditoría exhaustiva de todo el árbol). El contenido de correos que se manda a la IA se resume por hash (`ai_runs.input_hash`) en vez de guardarse tal cual, específicamente para no acumular una copia adicional del contenido sensible fuera de `mailing.messages`.

## Editor de n8n

`/n8n/` queda detrás de una segunda capa de autenticación (Basic Auth propia de `proxy/nginx.conf`, separada del login de la app) además del login nativo de n8n — pensado para limitar quién puede editar workflows (acceso equivalente a poder ejecutar código arbitrario contra Postgres y Graph), no para usuarios finales.

## Permisos administrativos

Sin roles intermedios: un usuario es `admin` o no. Un admin ve y gestiona todo el sistema sin excepción (expedientes, buzones, usuarios de cualquier otro). Esto es una decisión de diseño para soporte/auditoría, no un descuido — pero significa que el modelo de amenazas no protege contra un admin que abusa de su propio acceso, y que dar de alta un admin nuevo es una decisión de alto impacto.

## Hardening de contenedores

Ningún `Dockerfile` propio del proyecto (`backend/`, `frontend/`, `identity-broker/`) declara `USER` — corren con el usuario por defecto de su imagen base (típicamente root en las imágenes `python:slim`/`node`/`nginx` sin configuración adicional). No hay límites de recursos (`cpus`/`mem_limit`) declarados en `docker-compose.yml`. Ninguno de los dos es un incidente, pero son mejoras de hardening pendientes, no resueltas hoy.

## Reporte de vulnerabilidades

No existe hoy un canal formal de reporte responsable (sin `SECURITY.md` de contacto, sin bug bounty). Si encontrás un problema de seguridad, coordinalo directamente con quien administre tu despliegue — este documento no debe interpretarse como una promesa de proceso de triage.

## Resumen de limitaciones conocidas (no ocultas)

- HTTP plano por defecto — sin TLS, ver [`INSTALL.md`](INSTALL.md#antes-de-exponer-esto-a-una-red-real).
- Sin token CSRF explícito (solo `SameSite=Lax`).
- `/internal/*` depende solo de aislamiento de red, no de un secreto propio.
- Sin rate limiting en login ni en el resto de la API.
- Sin rotación automatizada de secretos.
- Contenedores sin usuario no-root declarado.
- Sin recuperación de contraseña por email para cuentas locales.
