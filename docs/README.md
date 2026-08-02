# Documentación de MailingAI

Índice de referencia rápida. La documentación exhaustiva y siempre actualizada del proyecto sigue viviendo en la raíz del repo ([`README.md`](../README.md), [`n8n/WorkFlows/README.md`](../n8n/WorkFlows/README.md)) — estos documentos son una puerta de entrada curada, no un reemplazo.

| Documento | Para qué sirve |
|---|---|
| [`INSTALL.md`](INSTALL.md) | Levantar el stack completo desde cero (Docker Compose, `.env`, migraciones, primer admin). |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Cómo están armados los servicios, las capas del backend, el modelo de datos y el modelo de seguridad. |
| [`AZURE_SETUP.md`](AZURE_SETUP.md) | Registro de la app en Microsoft Entra ID (Azure AD): permisos de Graph, Redirect URIs, client secret. |
| [`HELP.md`](HELP.md) | Qué es MailingAI, para qué sirve y cómo se usa día a día (pensado para un usuario final, no para quien lo despliega). |

## ¿Qué es MailingAI, en una frase?

Un panel que indexa localmente el contenido de uno o varios buzones de Microsoft 365 (vía Graph API, orquestado por n8n), arma "expedientes" correlacionando correos relacionados, y ayuda a un equipo a darles seguimiento — con IA local opcional para resumir cada expediente y sugerir una conclusión.
