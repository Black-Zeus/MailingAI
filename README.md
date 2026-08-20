# MailingAI

**De bandeja de entrada saturada a expedientes trazables — con el índice, los expedientes y el análisis de IA bajo control de tu propia infraestructura.**

MailingAI indexa localmente el contenido de tus buzones de Microsoft 365 (vía Microsoft Graph, con acceso delegado a los buzones que autorices explícitamente) y correlaciona los correos que pertenecen a un mismo caso en un expediente único con línea de tiempo, evidencia, notas y un resumen de IA — autoalojado, con IA local por defecto.

## El problema

Los correos importantes de un equipo (reclamos, incidentes, solicitudes con seguimiento) quedan dispersos entre hilos, reenvíos y bandejas personales. Reconstruir "qué pasó con esto" implica buscar a mano en Outlook, sin trazabilidad de quién concluyó qué ni cuándo, y sin ninguna vista agregada de qué está pendiente.

## Qué resuelve

- **Expedientes con correlación automática** — a partir de un correo semilla (un hilo, un código de caso, un mensaje puntual), el sistema arma solo el resto del expediente: correos del mismo hilo, con el mismo código, o con asunto/participantes en común dentro de una ventana de tiempo — línea de tiempo unificada, sin armar el caso mensaje por mensaje a mano.
- **Resumen con IA, local** — un modelo corriendo en tu propia infraestructura (Ollama, sin salir a internet salvo que lo habilites a propósito) resume el expediente, sugiere prioridad, próxima acción y conclusión — el auditor siempre confirma antes de aplicar.
- **Trazabilidad real** — log de auditoría por expediente (quién cambió qué y cuándo), edición optimista que avisa si alguien más modificó el caso mientras lo tenías abierto, y exportación a PDF lista para archivar o compartir.
- **Multiusuario con permisos reales** — login por SSO de Microsoft o cuentas locales, cada expediente y cada buzón con dueño y compartición explícita (solo lectura o edición), rol de administrador para soporte/auditoría.
- **Se mantiene solo** — sincronización diaria incremental de los buzones conectados (solo lo nuevo, nunca reindexa todo desde cero), recordatorios de revisiones vencidas, notificaciones in-app y por correo (HTML) cuando algo relevante termina.
- **Dashboard ejecutivo** — conteos reales de expedientes abiertos, vencidos, sin analizar y por conclusión, sin depender de exportar nada a mano.

## Por qué esta arquitectura

- **Self-hosted de punta a punta** — corre entero con Docker Compose en tu propia infraestructura; el índice, los expedientes y sus adjuntos nunca se suben a un SaaS de terceros (la única comunicación externa es con los buzones de Microsoft 365 que autorices explícitamente, vía Microsoft Graph).
- **IA sin fuga de datos por defecto** — política `local_only`: el resumen lo genera un modelo local, nunca un proveedor externo, salvo que un administrador lo habilite explícitamente.
- **Superficie de ataque mínima** — un único punto de entrada público (proxy nginx); Postgres, el backend, n8n y el resto de servicios internos nunca quedan expuestos directamente.
- **Sin vendor lock-in** — construido sobre piezas estándar y reemplazables: FastAPI, PostgreSQL, React, n8n para la orquestación con Microsoft Graph, y cualquier proveedor de IA compatible (local o externo) detrás de un mismo gateway.

## Empezar

Guía completa de instalación (Docker Compose, `.env`, primer administrador): [`docs/INSTALL.md`](docs/INSTALL.md).

> El despliegue de referencia corre sobre HTTP plano (sin TLS todavía, ver [`docs/INSTALL.md`](docs/INSTALL.md#antes-de-exponer-esto-a-una-red-real)) — pensado para laboratorio o red interna controlada. No lo expongas a Internet tal cual.

## Documentación

| Documento | Para qué sirve |
|---|---|
| [`docs/INSTALL.md`](docs/INSTALL.md) | Levantar el stack completo desde cero. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Cómo están armados los servicios, el modelo de datos y el modelo de seguridad. |
| [`docs/AZURE_SETUP.md`](docs/AZURE_SETUP.md) | Registro de la app en Microsoft Entra ID (Azure AD). |
| [`docs/API.md`](docs/API.md) | Referencia de endpoints con ejemplos, para integrar o probar el backend directo. |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Modelo de amenazas, autenticación y limitaciones de seguridad conocidas. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Runbook operacional del día a día. |
| [`docs/STATUS.md`](docs/STATUS.md) | Qué está implementado, qué es parcial y qué falta todavía. |
| [`docs/HELP.md`](docs/HELP.md) | Qué es MailingAI y cómo se usa día a día, para el usuario final. |
| [`docs/AUDIT_2026-08-19.md`](docs/AUDIT_2026-08-19.md) · [`docs/AUDIT_2026-08-20.md`](docs/AUDIT_2026-08-20.md) | Hallazgos de las dos rondas de auditoría (seguridad, arquitectura, calidad, rendimiento). |
| [`docs/TASKLIST.md`](docs/TASKLIST.md) | Seguimiento de la resolución de esos hallazgos — qué está corregido y qué queda pendiente. |
| [`n8n/WorkFlows/README.md`](n8n/WorkFlows/README.md) | Detalle nodo por nodo de cada workflow de n8n. |
