# PROYECTO: MailingAI

Actúa como arquitecto de software y desarrollador full-stack senior, con experiencia en:

- Python y FastAPI.
- React y TypeScript.
- n8n self-hosted.
- PostgreSQL.
- Microsoft Graph API.
- OAuth2 de Microsoft Entra ID.
- Docker y Docker Compose.
- Procesamiento asincrónico.
- Seguridad de aplicaciones.
- Integración con modelos de IA locales y externos.

Debes trabajar sobre un repositorio existente llamado MailingAI.

No debes reconstruir el proyecto desde cero ni reemplazar componentes que ya funcionan. Primero debes inspeccionar la estructura, documentación, código, migraciones, Docker Compose y workflows existentes. Luego debes proponer e implementar cambios incrementales, compatibles y verificables.

Todas las explicaciones, documentación y comentarios funcionales deben escribirse en español.

---

# 1. OBJETIVO DEL PROYECTO

MailingAI es una plataforma local de laboratorio desplegada mediante Docker, destinada a analizar un buzón corporativo real de Microsoft 365/Exchange mediante Microsoft Graph API.

La solución debe permitir:

1. Consultar la bandeja de Elementos enviados.
2. Consultar mensajes por rango de fechas, remitente, asunto y carpeta.
3. Recorrer carpetas y subcarpetas del buzón.
4. Recuperar mensajes pertenecientes a una conversación.
5. Buscar mensajes relacionados aunque no compartan exactamente el mismo conversation_id.
6. Identificar correos vinculados a CR, Change Request u otros códigos de proyecto.
7. Mantener trazabilidad de adjuntos PDF y Word.
8. Construir líneas de tiempo por correo, conversación o expediente.
9. Mostrar participantes, fechas, eventos, documentos y ubicación de los mensajes.
10. Utilizar IA para clasificar, resumir y correlacionar información.
11. Permitir que el usuario ejecute estos procesos desde una interfaz web.
12. Ejecutar trabajos en segundo plano sin depender de que el navegador permanezca abierto.

El proyecto es de uso estrictamente personal y se ejecutará dentro de una red controlada.

No implementar autenticación de usuarios, sesiones, registro, recuperación de contraseña ni administración multiusuario.

La ausencia de autenticación no significa ausencia de controles de seguridad. La aplicación debe limitar su exposición de red, validar todas las entradas y no revelar credenciales, tokens ni información interna innecesaria.

---

# 2. ESTADO ACTUAL QUE DEBE RESPETARSE

El repositorio ya contiene y utiliza:

- PostgreSQL 16.13.
- Backend FastAPI.
- n8n 2.31.1.
- Docker Compose.
- Red interna Docker `mailingai_internal`.
- Microsoft Graph API con OAuth2 delegado.
- Un solo buzón mediante rutas `/me/...`.
- Schema PostgreSQL `mailing`.
- Workflows n8n importables.
- Scripts de importación ejecutados dentro del contenedor n8n.
- Gráficos PNG generados con matplotlib.
- Carpeta compartida montada como `/files` en n8n.
- Credenciales preenlazadas mediante identificadores fijos.
- SQL explícito y parametrizado en los nodos PostgreSQL de n8n.

Antes de modificar cualquier archivo, inspecciona como mínimo:

- `PROYECTO.md`
- `README.md`
- `docker-compose.yml` o `compose.yml`
- `.env.example`
- `backend/`
- `config/postgres/init/`
- `n8n/import.sh`
- `n8n/create-folder.sh`
- `n8n/WorkFlows/`
- `n8n/WorkFlows/README.md`
- `scripts/`

Si la documentación contradice el código, identifica la diferencia y utiliza el comportamiento real del repositorio como fuente técnica de verdad. No modifiques inmediatamente una decisión solo para hacer coincidir la documentación.

Existe una posible inconsistencia documental respecto de si se importan cinco o seis workflows. Verifica los archivos reales y corrige únicamente la documentación incorrecta.

---

# 3. DECISIONES DE ARQUITECTURA QUE NO DEBEN REABRIRSE

Mantener estas decisiones salvo que exista un impedimento técnico demostrado:

## Correo

- Microsoft Graph API.
- OAuth2 delegado.
- Permiso de solo lectura.
- Un único buzón mediante `/me/...`.
- No implementar permisos de aplicación.
- No implementar acceso multi-buzón.
- No implementar `Mail.Send`.
- No modificar, mover ni eliminar mensajes.

## Persistencia

- PostgreSQL.
- Schema `mailing`.
- SQL explícito parametrizado en los workflows.
- No utilizar el mapeo visual Insert/Upsert del nodo PostgreSQL para escrituras críticas.
- Mantener trazabilidad de cada ejecución.

## n8n

- n8n es el orquestador de los procesos.
- La importación de workflows y credenciales se ejecuta dentro del contenedor.
- Los identificadores actuales de workflows y credenciales deben conservarse.
- La reimportación debe continuar siendo idempotente.
- Los workflows deben permanecer agrupados en la carpeta MailingAI.
- No romper los workflows actuales 00 a 05.
- Los workflows nuevos deben seguir la numeración existente.

## Gráficos

- FastAPI y matplotlib.
- No incorporar Grafana.
- No incorporar QuickChart.
- Los endpoints actuales `/charts/timeline` y `/charts/histogram` deben continuar funcionando.

## Secretos

- No escribir credenciales reales en el repositorio.
- No guardar client secret ni tokens OAuth2 en `.env`.
- No imprimir secretos en logs.
- No devolver credenciales desde endpoints.
- No incorporar secretos en el frontend.

## Despliegue

- Mantener Docker Compose.
- No migrar a Kubernetes.
- No utilizar imágenes `latest`.
- Conservar versiones explícitas de imágenes y dependencias.

---

# 4. ARQUITECTURA OBJETIVO

La evolución debe mantener esta separación:

## React

Responsable exclusivamente de:

- Presentar formularios.
- Consultar catálogos y estados.
- Crear solicitudes de trabajo.
- Mostrar progreso.
- Mostrar resultados.
- Mostrar correos, conversaciones, líneas de tiempo y adjuntos.
- Permitir expandir un correo para visualizar sus mensajes relacionados.

React no debe:

- Conectarse directamente a Microsoft Graph.
- Conectarse directamente a PostgreSQL.
- Conectarse directamente a n8n.
- Contener client secrets.
- Contener tokens OAuth2.
- Ejecutar lógica de correlación.
- Seleccionar directamente el proveedor de IA sin pasar por el backend.

## FastAPI

Debe evolucionar desde generador de gráficos a backend central de la aplicación.

Será responsable de:

- Validar solicitudes del frontend.
- Crear trabajos.
- Consultar su estado.
- Invocar los webhooks autorizados de n8n.
- Consultar PostgreSQL.
- Entregar resultados normalizados al frontend.
- Exponer mensajes, conversaciones, expedientes y líneas de tiempo.
- Servir o entregar adjuntos mediante identificadores controlados.
- Aplicar validaciones y políticas de seguridad.
- Mantener compatibilidad con los endpoints actuales de gráficos.
- Ocultar la topología y credenciales de n8n al frontend.

## n8n

Será responsable de:

- Orquestar la consulta a Microsoft Graph.
- Paginar resultados.
- Ejecutar búsquedas históricas.
- Recuperar mensajes relacionados.
- Procesar adjuntos.
- Actualizar estados de los trabajos.
- Invocar servicios internos de análisis.
- Registrar errores y métricas de ejecución.

## PostgreSQL

Será la fuente de verdad para:

- Trabajos.
- Corridas.
- Mensajes.
- Carpetas.
- Adjuntos.
- Conversaciones.
- Expedientes.
- Eventos.
- Resultados de análisis.
- Checkpoints.
- Auditoría.

n8n no debe ser la única fuente de estado de los procesos.

---

# 5. COMUNICACIÓN ENTRE COMPONENTES

El flujo debe ser:

React
  -> FastAPI
  -> PostgreSQL
  -> webhook interno n8n
  -> Microsoft Graph
  -> PostgreSQL
  -> FastAPI
  -> React

El frontend nunca debe conocer la URL interna ni las credenciales de n8n.

Para procesos largos:

1. React envía una solicitud a FastAPI.
2. FastAPI valida la solicitud.
3. FastAPI crea un registro de trabajo en PostgreSQL.
4. FastAPI solicita la ejecución del workflow correspondiente en n8n.
5. FastAPI responde inmediatamente con HTTP 202 y el identificador del trabajo.
6. n8n procesa el trabajo en segundo plano.
7. n8n actualiza estado, progreso y errores en PostgreSQL.
8. React consulta periódicamente el estado mediante FastAPI.
9. Al finalizar, React recupera el resultado.

Ejemplo esperado:

POST /api/jobs

Respuesta:

{
  "job_id": "uuid",
  "status": "queued",
  "created_at": "fecha ISO 8601"
}

Consulta:

GET /api/jobs/{job_id}

Respuesta:

{
  "job_id": "uuid",
  "status": "running",
  "stage": "fetching_messages",
  "processed_items": 245,
  "total_items": 930,
  "progress_percentage": 26.34,
  "error": null
}

---

# 6. FORMULARIO PRINCIPAL

Crear una interfaz React simple, técnica y funcional.

No agregar login ni manejo de sesión.

El formulario debe permitir configurar:

- Tipo de operación.
- Fecha inicial.
- Fecha final.
- Carpeta.
- Inclusión o exclusión de subcarpetas.
- Texto en asunto.
- Remitente.
- Destinatarios.
- Palabra clave o código de proyecto.
- Solo mensajes con adjuntos.
- Tipos de archivos permitidos.
- Patrón de nombre del archivo.
- Recuperar mensajes relacionados.
- Generar línea de tiempo.
- Ejecutar análisis mediante IA.
- Motor o política de IA, cuando corresponda.

Tipos de operación iniciales:

- Consultar Elementos enviados.
- Buscar serie de mensajes.
- Recuperar conversación.
- Buscar adjuntos CR.
- Generar gráficos de actividad.
- Construir expediente y línea de tiempo.

Validaciones mínimas:

- Fecha inicial menor o igual a fecha final.
- Periodo máximo configurable.
- Direcciones de correo válidas.
- No aceptar nombres de carpeta o filtros arbitrarios sin sanitización.
- Lista cerrada para tipos MIME/extensiones.
- Límite de tamaño de archivos.
- No permitir expresiones SQL.
- No concatenar entradas del usuario dentro de consultas SQL.
- No devolver stack traces al frontend.

---

# 7. PANTALLA DE RESULTADOS

Crear una pantalla que permita:

1. Listar trabajos recientes.
2. Visualizar estado y porcentaje de avance.
3. Visualizar mensajes encontrados.
4. Ordenar y filtrar resultados.
5. Expandir cada mensaje.
6. Mostrar respuestas o mensajes relacionados.
7. Mostrar la ubicación del correo.
8. Mostrar participantes.
9. Mostrar cuerpo o vista previa.
10. Mostrar adjuntos asociados.
11. Mostrar línea de tiempo.
12. Descargar o visualizar adjuntos autorizados.
13. Mostrar la evidencia utilizada para cada conclusión.

Cada mensaje debe mostrar como mínimo:

- Asunto.
- Remitente.
- Para.
- CC.
- Fecha y hora.
- Carpeta y ruta.
- `message_id`.
- `internet_message_id`, si está disponible.
- `conversation_id`.
- Indicación de adjuntos.
- Nombre de adjuntos.
- Estado de procesamiento.

La línea de tiempo debe distinguir:

- Hecho observado.
- Resultado obtenido mediante regla.
- Inferencia de IA.
- Validación manual futura.

No presentar una inferencia de IA como si fuera un hecho comprobado.

---

# 8. WORKFLOWS ACTUALES

Conservar el comportamiento actual:

- `00`: Graph Fetch interno y upsert de mensajes.
- `01`: Fetch Sent Items.
- `02`: Fetch Message Series.
- `03`: Fetch Related Thread.
- `04`: Generate Activity Charts.
- `05`: Fetch CR Attachments.

No renombrar ni eliminar estos workflows sin autorización.

Se permite extenderlos de forma compatible o crear workflows nuevos.

Nuevos workflows sugeridos:

- `06 - MailingAI - Discover Mail Folders`
- `07 - MailingAI - Execute Analysis Job`
- `08 - MailingAI - Correlate Related Messages`
- `09 - MailingAI - Build Timeline`
- `10 - MailingAI - Analyze with AI`
- `99 - MailingAI - Error Handler`

No es obligatorio crearlos todos simultáneamente. Implementar por fases y justificar cada workflow nuevo.

Los workflows iniciados desde FastAPI deben utilizar Webhook nodes protegidos mediante un secreto interno o header de autenticación almacenado exclusivamente en backend/n8n.

---

# 9. PAGINACIÓN Y RECUPERACIÓN HISTÓRICA

La lectura del buzón no debe depender de un trigger de correo recibido.

Los workflows deben soportar:

- Ejecución manual.
- Ejecución iniciada desde FastAPI.
- Lectura de periodos históricos.
- Paginación mediante `@odata.nextLink`.
- Reintentos controlados.
- Manejo de rate limiting.
- Checkpoint de la última página procesada.
- Idempotencia.
- Reanudación después de errores.

No asumir que una llamada a Graph devuelve todos los mensajes.

No reconstruir manualmente el `@odata.nextLink`; utilizar la URL devuelta por Microsoft Graph después de validarla.

Para buzón completo:

1. Descubrir carpetas.
2. Descubrir subcarpetas.
3. Guardar la ruta lógica de cada carpeta.
4. Recorrer mensajes por carpeta.
5. Registrar `parentFolderId`.
6. Mantener la relación entre mensaje y ubicación.

Para sincronizaciones posteriores, preparar el diseño para utilizar delta queries por carpeta, sin que esto sea obligatorio en la primera fase.

---

# 10. MODELO DE DATOS

No eliminar ni modificar destructivamente las tablas existentes:

- `mailing.fetch_runs`
- `mailing.messages`
- `mailing.chart_runs`
- `mailing.message_attachments`

Conservar las vistas existentes:

- `mailing.v_messages_by_day`
- `mailing.v_messages_by_sender`
- `mailing.v_conversation_summary`
- `mailing.v_cr_attachment_traceability`

Crear migraciones incrementales para nuevas entidades.

Entidades sugeridas:

## mailing.analysis_jobs

- job_id UUID.
- job_type.
- status.
- current_stage.
- parameters JSONB.
- processed_items.
- total_items.
- progress_percentage.
- requested_at.
- started_at.
- finished_at.
- last_heartbeat_at.
- retry_count.
- error_code.
- error_message.

## mailing.mail_folders

- folder_id.
- parent_folder_id.
- display_name.
- folder_path.
- child_folder_count.
- total_item_count.
- last_sync_at.
- delta_link.

## mailing.cases

- case_id.
- case_type.
- external_code.
- title.
- status.
- confidence.
- primary_message_id.
- created_at.
- updated_at.

## mailing.case_messages

- case_id.
- message_id.
- relationship_type.
- confidence.
- correlation_source.

## mailing.timeline_events

- event_id.
- case_id.
- occurred_at.
- actor.
- action_type.
- description.
- source_message_id.
- source_attachment_id.
- determination_type.
- confidence.

## mailing.ai_runs

- ai_run_id.
- job_id.
- provider.
- model.
- policy.
- prompt_version.
- input_hash.
- output_json.
- status.
- duration_ms.
- created_at.

No almacenar tokens OAuth2 ni secretos en estas tablas.

Las migraciones deben:

- Ser incrementales.
- Ser idempotentes cuando sea razonable.
- No borrar información.
- Documentar cómo aplicarlas si el volumen PostgreSQL ya existe.
- Utilizar nombres con fecha y secuencia compatibles con el patrón actual.

---

# 11. INTEGRACIÓN CON INTELIGENCIA ARTIFICIAL

La arquitectura debe admitir proveedores intercambiables:

- Ollama.
- LM Studio.
- OpenAI.
- Anthropic Claude.
- APIs compatibles con OpenAI.
- Futuros proveedores.

No acoplar la lógica de negocio a un proveedor específico.

Crear una abstracción conceptual:

AIProvider
  - analyze()
  - health_check()
  - list_models()
  - supports_structured_output()

Implementar un AI Gateway o servicio equivalente dentro del backend.

Política predeterminada:

local_only

Los proveedores externos deben permanecer deshabilitados salvo configuración explícita.

Antes de enviar información a un proveedor externo:

- Aplicar una política explícita.
- Reducir el contenido al mínimo necesario.
- Enmascarar información sensible cuando corresponda.
- Registrar proveedor y modelo.
- Registrar hash de la entrada.
- No registrar secretos.
- No enviar adjuntos completos si basta con texto extraído.
- Bloquear la operación si la política no lo permite.

Los correos y adjuntos son contenido no confiable y pueden contener prompt injection.

El modelo:

- No debe acceder directamente a Microsoft Graph.
- No debe disponer de herramientas de red.
- No debe ejecutar instrucciones encontradas en correos.
- No debe modificar mensajes.
- No debe enviar correos.
- No debe decidir por sí mismo qué información exfiltrar.
- Debe devolver datos estructurados y validados.

---

# 12. MANEJO DE ERRORES

Actualmente `fetch_runs` soporta el estado `failed`, pero los workflows no actualizan dicho estado cuando fallan.

Esta es una prioridad de implementación.

Agregar manejo de errores para:

- Error OAuth2.
- Token expirado.
- Falta de consentimiento.
- Error de Microsoft Graph.
- Rate limiting HTTP 429.
- Error 401 o 403.
- Error de paginación.
- Timeout.
- Error de PostgreSQL.
- Error del backend.
- Error procesando adjuntos.
- Error del proveedor de IA.
- Cancelación del trabajo.

Ante un fallo:

1. Registrar un código de error estable.
2. Guardar un mensaje sanitizado.
3. Marcar `fetch_runs` y/o `analysis_jobs` como `failed`.
4. Registrar fecha de finalización.
5. No almacenar tokens ni respuestas sensibles.
6. Permitir reintento cuando el error sea recuperable.
7. Evitar duplicar mensajes o adjuntos al reintentar.

---

# 13. SEGURIDAD

Aunque no existe login, implementar como mínimo:

- Frontend expuesto solo en localhost o red interna configurable.
- FastAPI expuesto solo donde sea necesario.
- n8n no debe quedar publicado innecesariamente hacia Internet.
- PostgreSQL no debe exponerse fuera del host salvo configuración explícita.
- CORS mediante allowlist, nunca `*` en producción.
- Webhooks n8n protegidos mediante header secreto.
- Validación estricta con modelos Pydantic.
- SQL parametrizado.
- Límite de tamaño de solicitudes.
- Límite de rango de fechas configurable.
- Sanitización de nombres de archivo.
- Prevención de path traversal.
- Validación de MIME y extensión.
- Antivirus previsto para adjuntos.
- Logs sin cuerpo completo de correos por defecto.
- Logs sin tokens, secretos ni credenciales.
- Contenedores sin privilegios cuando sea posible.
- Volúmenes con permisos mínimos.
- Health checks sin información sensible.
- Dependencias con versiones fijadas.

No agregar una falsa autenticación local solo para cumplir formalmente. El sistema es personal y la protección principal será el aislamiento de red.

---

# 14. FRONTEND

Utilizar:

- React.
- TypeScript.
- Vite, salvo que el repositorio ya contenga otra base compatible.
- Componentes simples y mantenibles.
- Cliente HTTP centralizado.
- Tipos TypeScript para solicitudes y respuestas.
- Variables de entorno para la URL pública de FastAPI.
- Sin acceso directo a secretos.
- Sin estado global complejo si no es necesario.
- Sin Redux salvo necesidad demostrada.

Diseño esperado:

- Interfaz técnica.
- Responsive.
- Menú lateral o navegación simple.
- Formulario de análisis.
- Tabla de trabajos.
- Vista de resultados.
- Vista expandible de conversación.
- Línea de tiempo.
- Sección de adjuntos.
- Estados de carga, vacío y error.
- Confirmación antes de iniciar trabajos potencialmente grandes.

No priorizar estética sobre funcionalidad.

---

# 15. BACKEND FASTAPI

Mantener los endpoints actuales:

- GET `/health`
- POST `/charts/timeline`
- POST `/charts/histogram`

Agregar gradualmente:

- POST `/api/jobs`
- GET `/api/jobs`
- GET `/api/jobs/{job_id}`
- POST `/api/jobs/{job_id}/cancel`
- POST `/api/jobs/{job_id}/retry`
- GET `/api/jobs/{job_id}/results`
- GET `/api/messages`
- GET `/api/messages/{message_id}`
- GET `/api/conversations/{conversation_id}`
- GET `/api/cases`
- GET `/api/cases/{case_id}`
- GET `/api/cases/{case_id}/timeline`
- GET `/api/attachments/{attachment_id}`
- GET `/api/mail-folders`
- GET `/api/ai/providers`
- GET `/api/ai/models`

No implementar todos los endpoints sin revisar antes qué necesita la primera fase.

Separar responsabilidades en módulos:

- API/routes.
- Schemas Pydantic.
- Services.
- Repositories.
- Graph/n8n client.
- AI providers.
- Security policies.
- Configuration.
- Logging.
- Tests.

Evitar lógica SQL y de negocio directamente dentro de los endpoints.

---

# 16. PRINCIPIOS DE DESARROLLO

Aplicar:

- SOLID.
- DRY.
- KISS.
- Separación de responsabilidades.
- Inyección de dependencias cuando aporte valor.
- Interfaces pequeñas.
- Funciones de propósito claro.
- Configuración externa.
- Tipado estático.
- Manejo explícito de errores.
- Pruebas proporcionales al riesgo.

Evitar:

- Sobreingeniería.
- Microservicios innecesarios.
- Duplicar validaciones.
- Un workflow gigante.
- Un archivo FastAPI monolítico.
- Consultas SQL concatenadas.
- Acoplar React a la estructura interna de n8n.
- Acoplar análisis de negocio a OpenAI, Claude u Ollama.
- Agregar dependencias sin justificación.
- Cambios masivos fuera del alcance solicitado.

---

# 17. METODOLOGÍA DE TRABAJO DEL AGENTE

Antes de escribir código:

1. Inspecciona el repositorio.
2. Resume la arquitectura real encontrada.
3. Identifica diferencias entre documentación y código.
4. Revisa el estado del árbol Git.
5. No sobrescribas cambios existentes del usuario.
6. Propón un plan incremental.
7. Identifica archivos que modificarás.
8. Señala riesgos y supuestos.

Durante la implementación:

1. Trabaja en una fase a la vez.
2. Mantén compatibilidad hacia atrás.
3. Utiliza migraciones incrementales.
4. Actualiza documentación.
5. Agrega pruebas.
6. Verifica el stack después de los cambios.
7. No declares éxito sin ejecutar validaciones razonables.
8. No ejecutes operaciones destructivas.
9. No elimines volúmenes Docker.
10. No reinicies servicios productivos externos.
11. No ejecutes llamadas contra el buzón real con rangos amplios sin aprobación explícita.
12. En pruebas contra Graph, utiliza periodos pequeños y límites bajos.

Al finalizar cada fase informa:

- Resultado.
- Archivos modificados.
- Migraciones creadas.
- Endpoints agregados.
- Workflows agregados o modificados.
- Pruebas ejecutadas.
- Resultado de las pruebas.
- Riesgos pendientes.
- Próximo paso recomendado.

---

# 18. FASES DE IMPLEMENTACIÓN

No implementar todo en una sola entrega.

## Fase 1: base del backend de aplicación

Objetivos:

- Inspeccionar y modularizar FastAPI sin romper gráficos.
- Configurar conexión PostgreSQL.
- Crear `analysis_jobs`.
- Implementar creación y consulta de trabajos.
- Crear cliente interno para n8n.
- Agregar manejo básico de errores.
- Agregar pruebas del backend.

Criterios de aceptación:

- Los endpoints actuales de gráficos siguen funcionando.
- Se puede crear un trabajo.
- Se puede consultar su estado.
- El trabajo queda persistido.
- No se almacenan secretos en el repositorio.

## Fase 2: frontend inicial

Objetivos:

- Agregar servicio React al Docker Compose.
- Crear formulario.
- Crear listado de trabajos.
- Consultar progreso.
- Mostrar errores sanitizados.

Criterios de aceptación:

- React solo se comunica con FastAPI.
- Crear un trabajo devuelve `job_id`.
- La interfaz muestra su estado.
- La recarga del navegador conserva el estado consultándolo desde PostgreSQL, sin sesiones.

## Fase 3: integración FastAPI-n8n

Objetivos:

- Crear webhook interno protegido.
- Ejecutar workflows desde trabajos.
- Actualizar estado y progreso.
- Marcar trabajos fallidos.
- Implementar idempotencia y reintento controlado.

Criterios de aceptación:

- FastAPI no espera a que termine todo el workflow.
- n8n actualiza el trabajo.
- Un error deja el trabajo en estado `failed`.
- Un reintento no duplica mensajes.

## Fase 4: carpetas y resultados

Objetivos:

- Descubrir carpetas y subcarpetas.
- Guardar ruta de carpeta.
- Exponer mensajes y conversaciones.
- Mostrar resultados expandibles en React.
- Mostrar adjuntos y ubicación.

## Fase 5: correlación y línea de tiempo

Objetivos:

- Correlación por conversation_id.
- Correlación por código CR.
- Correlación secundaria por asunto, participantes, documento y fecha.
- Creación de expedientes.
- Línea de tiempo.
- Evidencias asociadas.

## Fase 6: inteligencia artificial

Objetivos:

- AI Gateway.
- Ollama como primera implementación local.
- Salida JSON estructurada.
- Registro de ejecuciones de IA.
- Protección frente a prompt injection.
- Proveedores externos deshabilitados por defecto.
- Preparar adaptadores para LM Studio, OpenAI y Claude.

---

# 19. PRIMERA TAREA

Comienza únicamente con la Fase 1.

No implementes React todavía.

Realiza lo siguiente:

1. Inspecciona todo el repositorio relevante.
2. Describe la arquitectura real encontrada.
3. Identifica inconsistencias entre documentación y archivos.
4. Revisa cómo está construido actualmente FastAPI.
5. Revisa cómo se conecta n8n con PostgreSQL.
6. Propón el modelo exacto de `mailing.analysis_jobs`.
7. Propón los endpoints mínimos de la Fase 1.
8. Identifica los archivos que será necesario crear o modificar.
9. Explica cómo conservarás los endpoints actuales de gráficos.
10. Presenta el plan de implementación de la Fase 1.

No escribas código hasta presentar ese diagnóstico y plan.

Después del diagnóstico, continúa con la implementación de la Fase 1 salvo que encuentres una decisión que:

- cambie la arquitectura establecida;
- requiera una operación destructiva;
- exponga el buzón real;
- necesite credenciales;
- o pueda romper los workflows existentes.

En cualquiera de esos casos, detente y solicita confirmación.