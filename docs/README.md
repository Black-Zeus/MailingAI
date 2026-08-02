# Documentación de MailingAI

Índice de referencia rápida. El [`README.md`](../README.md) de la raíz es la presentación del producto; toda la documentación técnica (instalación, arquitectura, API) vive acá. Ver también [`n8n/WorkFlows/README.md`](../n8n/WorkFlows/README.md) para el detalle nodo por nodo de cada workflow.

| Documento | Para qué sirve |
|---|---|
| [`INSTALL.md`](INSTALL.md) | Levantar el stack completo desde cero (Docker Compose, `.env`, migraciones, primer admin). |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Cómo están armados los servicios, las capas del backend, el modelo de datos y el modelo de seguridad. |
| [`AZURE_SETUP.md`](AZURE_SETUP.md) | Registro de la app en Microsoft Entra ID (Azure AD): permisos de Graph, Redirect URIs, client secret. |
| [`API.md`](API.md) | Referencia de endpoints con ejemplos `curl`, para probar o integrar el backend directo. |
| [`SECURITY.md`](SECURITY.md) | Modelo de amenazas, autenticación, CSRF, secretos y limitaciones de seguridad conocidas. |
| [`OPERATIONS.md`](OPERATIONS.md) | Runbook del día a día: logs, jobs atascados, rotación de secretos, sincronización fallida. |
| [`STATUS.md`](STATUS.md) | Qué está implementado, qué es parcial y qué todavía no existe — matriz honesta por área. |
| [`HELP.md`](HELP.md) | Qué es MailingAI, para qué sirve y cómo se usa día a día (pensado para un usuario final, no para quien lo despliega). |

## ¿Qué es MailingAI, en una frase?

Un panel que indexa localmente el contenido de uno o varios buzones de Microsoft 365 (vía Graph API, orquestado por n8n), arma "expedientes" correlacionando correos relacionados, y ayuda a un equipo a darles seguimiento — con IA local opcional para resumir cada expediente y sugerir una conclusión.
