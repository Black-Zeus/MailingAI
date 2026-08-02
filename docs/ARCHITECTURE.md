# Arquitectura

## Vista general

```text
                                   ┌────────────┐
                     único puerto  │   proxy    │  nginx, único servicio con
                     público (80)  │  (nginx)   │  puerto publicado al host
                                   └─────┬──────┘
                 ┌───────────┬───────────┼───────────┬─────────────┐
                 │           │           │            │             │
              /  → frontend  /api/ → backend   /identity/oauth/ →   /n8n/ →
                (SPA React)   (FastAPI)     identity-broker      n8n (editor,
                                                                  Basic Auth aparte)
```

Todos los servicios comparten la red interna de Docker `mailingai_internal`. Ninguno salvo `proxy` publica puerto al host — de dev local (`psql`, revisar Ollama) se accede con `docker compose exec`, no reabriendo puertos.

```text
postgres          -- una sola base (mailingai), dos schemas: mailing + identity
backend           -- FastAPI, API de negocio (expedientes, buzones, usuarios, IA)
identity-broker    -- microservicio aparte: OAuth2 con Microsoft Graph para conectar buzones
frontend           -- React + Vite + TypeScript, SPA servida por nginx, SIN router (una vista a la vez, por estado)
n8n                -- todo el trabajo periódico/programado y todas las llamadas a Microsoft Graph
ollama              -- IA local (resumen de expedientes), CPU-only
```

## Servicios y puertos

`proxy` (`nginx:1.27.3-alpine`, config en `proxy/nginx.conf`) es el único servicio con puerto publicado al host (`PROXY_PORT`, default `80`):

```text
http://<host>/                  -> frontend:80        (SPA)
http://<host>/api/*             -> backend:8000/api/*  (API + callback de login SSO)
http://<host>/identity/oauth/*  -> identity-broker:8000/oauth/*   (solo el flujo de conectar buzones)
http://<host>/n8n/*             -> n8n:5678/*          (editor de workflows, protegido con Basic Auth propia)
```

`identity-broker` solo expone públicamente `/oauth/microsoft/start` y `/oauth/microsoft/callback` — todo lo demás (`/internal/*`, sin autenticación propia) queda deliberadamente fuera del mapa de rutas del proxy, alcanzable solo desde la red interna de Docker. Ningún otro servicio (Postgres, backend, identity-broker, frontend, n8n, Ollama) publica puerto propio; para acceso puntual de desarrollo (`psql`, revisar Ollama) se usa `docker compose exec <servicio> ...` en vez de reabrir un puerto permanente. TLS/HTTPS no está configurado todavía — agregarlo es cuestión de terminar TLS en este mismo `proxy` sin tocar el resto de los servicios.

La carpeta local `share` queda montada dentro del contenedor n8n en `/files`; los gráficos generados se guardan en `share/mailingai/out/` (host) / `/files/mailingai/out/` (n8n).

## Por qué `identity-broker` es un servicio aparte

Conectar un buzón real requiere guardar tokens OAuth2 de larga duración (`offline_access`) de Microsoft Graph. Aislar ese flujo en un microservicio propio, con su propia base de credenciales, mantiene tanto al `backend` como a `n8n` sin tocar el `client secret` de Microsoft directamente. Los nodos `HTTP Request` de n8n que llaman a Graph (`Graph: List Messages` y equivalentes) piden primero un token vigente a `identity-broker` (`GET http://identity-broker:8000/internal/token/{mailbox_account_id}`) y lo usan como header `Authorization: Bearer ...` armado a mano — **no** usan ninguna credencial OAuth2 propia de n8n. La credencial `n8n/credentials/mailingai-graph-oauth2.json` que crea el script de import es una plantilla heredada de una versión anterior de la arquitectura (cuando n8n sí manejaba su propio token): hoy ningún nodo la referencia, no hace falta completarla con datos reales para que el fetch de correos funcione.

## Por qué n8n concentra todo lo periódico y todo Graph

Regla de diseño mantenida en todo el proyecto: **ninguna llamada a Microsoft Graph ni ningún trabajo programado vive en el backend FastAPI.** El backend es sincrónico y responde rápido a la UI; todo lo que puede tardar (indexar un buzón completo, generar gráficos, enviar un correo real) se dispara como webhook hacia n8n y el backend sigue sin bloquearse.

n8n tiene ~16 workflows, agrupados por función:

```text
00                    Subworkflow interno de fetch a Graph (lo llaman 01-03)
01, 02, 03            Traer correos: enviados / serie parametrizada / hilo relacionado
04                    Generar gráficos de actividad (llama al backend, guarda PNG en /files)
05                    Trazabilidad de adjuntos "CR" en Enviados
06                    Descubrir carpetas/subcarpetas del buzón
07                    Webhook interno que orquesta 01-06 según el job creado en /api/jobs
08, 09, 10            Descargar adjunto / buscar adjuntos / retrazar adjuntos de un mensaje puntual
11                    Manejador de errores compartido (marca fetch_runs como failed)
12                    Enviar expediente por correo + notificaciones por email (Graph Send Mail, HTML)
13 (cron)             Limpieza de gráficos huérfanos en /files
14 (cron)             Recordatorios de expedientes con revisión vencida
15 (cron + webhook)   Sincronización delta de buzones (diaria, o forzada manualmente por buzón)
```

Detalle nodo por nodo: [`n8n/WorkFlows/README.md`](../n8n/WorkFlows/README.md).

La comunicación backend→n8n es por webhooks HTTP internos (`http://n8n:5678/webhook/...`), protegidos con un secreto compartido (`WEBHOOK_SHARED_SECRET`) enviado como header y validado por una credencial `httpHeaderAuth` en n8n. La comunicación inversa (n8n→backend, para notificar que algo terminó o pedir que se genere un gráfico) usa rutas `/internal/*` y `/charts/*` del backend que **no requieren sesión**. Son casos distintos: `/internal/*` deliberadamente NO está mapeada en `proxy/nginx.conf`, así que solo es alcanzable desde la red interna de Docker, nunca desde internet. `/charts/*` sí está mapeada públicamente a propósito (para poder probarla a mano, ver [`API.md`](API.md)) — no expone datos sensibles ni acceso a la base, solo genera una imagen a partir de los puntos que se le mandan en el body.

## Capas del backend (FastAPI)

Sin ORM — SQL crudo vía `asyncpg`, con una separación estricta de tres capas:

```text
app/api/*.py           -- rutas HTTP, validación de payload (Pydantic), control de acceso
app/services/*.py       -- reglas de negocio, orquestación entre repositorios, llamadas a n8n/identity-broker
app/repositories/*.py   -- SQL puro contra Postgres, sin lógica de negocio
```

Una ruta nunca ejecuta SQL directo, y un repositorio nunca decide reglas de negocio (permisos, validaciones cruzadas) — eso vive en `services`. `app/schemas/` tiene los modelos Pydantic de entrada/salida, separados de las filas crudas que devuelven los repositorios.

## Modelo de datos (dos schemas en la misma base)

```text
identity.*   -- usuarios, sesiones, buzones conectados (mailbox_accounts), notificaciones,
                permisos de acceso a buzones (mailbox_shares)
mailing.*    -- correos indexados, expedientes (cases), mensajes por expediente,
                línea de tiempo, notas/evidencia, log de auditoría, corridas de IA,
                trabajos de análisis (jobs), vistas agregadas (v_case_summary, etc.)
```

`identity` modela "quién puede entrar y a qué buzón tiene acceso"; `mailing` modela "qué se indexó y qué expedientes se armaron con eso". Un expediente puede tener mensajes de varios buzones a la vez (se correlacionan por asunto/hilo/participantes), por eso ambos schemas conviven en la misma base en vez de separarse por servicio.

Tablas principales de `mailing`:

```text
mailing.fetch_runs             -- trazabilidad de cada corrida de fetch (filtros, estado, totales)
mailing.messages               -- correos normalizados (enviados y relacionados), upsert por message_id
mailing.message_attachments    -- adjuntos PDF/Word encontrados, upsert por (message_id, attachment_id)
mailing.mail_folders           -- carpetas/subcarpetas descubiertas, con parent_folder_id y ruta lógica
mailing.analysis_jobs          -- trabajos creados desde /api/jobs, estado actualizado por n8n
mailing.cases                  -- expedientes armados por correlación
mailing.case_messages          -- mensajes correlacionados a un caso, con confianza y origen
mailing.timeline_events        -- línea de tiempo por caso (hecho observado / regla / inferencia de IA / validación manual)
mailing.case_audit_log         -- auditoría de ediciones directas del expediente (quién, cuándo, valor viejo/nuevo)
mailing.ai_runs                -- trazabilidad de cada corrida de IA: proveedor, modelo, política, hash de entrada
mailing.chart_runs             -- corridas de generación de gráficos
mailing.mailbox_index_runs     -- progreso de cada reindexación manual completa de un buzón

mailing.v_messages_by_day, v_messages_by_sender, v_conversation_summary,
mailing.v_cr_attachment_traceability, v_mail_folders_tree, v_case_summary   -- vistas agregadas de lectura
```

## Modelo de seguridad y acceso

- **Autenticación**: cookie de sesión (`identity.sessions`), dos formas de login — SSO Microsoft/Entra ID (mismo tenant que conecta buzones) y cuentas locales usuario/contraseña (Argon2id, solo las crea un admin, fuerzan cambio de contraseña en el primer login). Nunca hay auto-registro: un admin siempre da de alta la cuenta antes.
- **Autorización**: cada expediente y cada buzón tiene un `owner_user_id`. El dueño puede compartirlo (`case_shares`/`mailbox_shares`, permisos `read`/`edit`); un usuario `admin` ve y gestiona todo sin excepción. No hay roles intermedios.
- **Concurrencia**: edición optimista por `updated_at` — si dos personas editan el mismo expediente, quien guarda segundo recibe `412 Precondition Failed` con quién lo modificó (best-effort, vía `case_audit_log`) en vez de pisar el cambio silenciosamente.
- **Auditoría**: `mailing.case_audit_log` registra cada edición directa de un expediente (cambios de estado/conclusión/seguimiento, notas, evidencia, resumen de IA) — quién, cuándo, valor viejo/nuevo. Separado a propósito de `timeline_events` (que es narrativa del caso, no auditoría del sistema).
- **Borrado de buzón**: solo un admin puede desconectar un buzón, con un modal previo que explica el impacto real (cuántos expedientes se van a ver afectados). Es un borrado **local**: nunca toca el buzón real de Microsoft, solo el índice propio.

## Frontend

React + TypeScript + Vite, sin librería de routing — la vista activa es estado de React (`Sidebar` + `App.tsx`), no hay deep-linking por URL. Se sirve como archivos estáticos vía nginx en el contenedor `frontend`, detrás del mismo proxy único. `VITE_API_URL` se hornea en build time (cambiarla exige reconstruir la imagen).

## IA (Ollama, local por defecto)

`app/services/ai/` implementa un gateway con proveedores intercambiables (hoy: Ollama local). Política `local_only` por defecto — nunca sale a un proveedor externo salvo cambio explícito de configuración. El modelo (`qwen2.5:3b` por defecto) recibe solo metadatos enmascarados del expediente (asunto, remitente enmascarado, fecha, vista previa acotada) — nunca el cuerpo completo ni adjuntos — y devuelve un resumen validado contra un esquema fijo, incluida una conclusión sugerida que el auditor siempre confirma a mano.
