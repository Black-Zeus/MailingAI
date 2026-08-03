# Estado: implementado vs. planificado

Matriz honesta de qué funciona hoy, qué es una versión intermedia (funciona pero con un alcance más chico del ideal) y qué todavía no existe. Objetivo: que ninguna afirmación de otro documento se lea como "esto ya está resuelto del todo" cuando en realidad es parcial.

## Autenticación y acceso

| Capacidad | Estado | Detalle / limitación |
|---|---|---|
| SSO Microsoft/Entra ID | Implementado | Probado contra tenant single-tenant; multi-tenant (`/common`) no se probó |
| Cuentas locales usuario/contraseña | Implementado | Sin recuperación por email — si se olvida, un admin resetea manualmente |
| Roles admin / usuario | Implementado | Solo dos niveles, sin roles intermedios (ej. "solo lectura global") |
| Dueño + compartición de expedientes/buzones | Implementado | Compartir buzón solo admite `read`, no `edit` |
| Edición optimista (`412` en conflicto) | Implementado | Detecta el conflicto; no hay merge automático, el usuario recarga y reaplica a mano |
| Log de auditoría por expediente | Implementado | Cubre ediciones directas (estado, conclusión, notas, evidencia, resumen IA); no cubre fusiones de casos ni marcado automático de `ai_stale` |
| TLS/HTTPS | **Pendiente** | Ver [`INSTALL.md`](INSTALL.md#antes-de-exponer-esto-a-una-red-real) — el despliegue de referencia es HTTP plano |
| Protección CSRF con token | **No implementado** | Mitigación actual es `SameSite=Lax` en la cookie de sesión, sin token CSRF explícito — ver [`SECURITY.md`](SECURITY.md) |
| Autenticación de rutas internas (`/internal/*`) | Implementado | Secreto compartido (`WEBHOOK_SHARED_SECRET`) además del aislamiento de red — ver [`SECURITY.md`](SECURITY.md) |
| Rate limiting en login/API | Delegado a infraestructura externa | Se configura en el Nginx Proxy Manager que termina el TLS, no en el stack — ver [`OPERATIONS.md`](OPERATIONS.md#rate-limiting) |

## Indexación de buzones (Microsoft Graph / n8n)

| Capacidad | Estado | Detalle / limitación |
|---|---|---|
| Fetch manual (enviados / serie / hilo) | Implementado | — |
| Reindexación completa con progreso visible | Implementado | — |
| Sincronización delta diaria | Implementado | Ventana de fecha simple (`last_synced_at` → ahora), **no** usa `/messages/delta` real de Graph — ver decisión de diseño en el historial del proyecto |
| Descubrimiento de carpetas | Implementado | Profundidad fija de 3 niveles, sin recursión real |
| Trazabilidad de adjuntos por patrón CR | Implementado | — |
| Búsqueda de adjuntos por carpeta(s) + patrón libre | Implementado | — |
| Reintento de un job fallido | Implementado, manual | `POST /api/jobs/{id}/retry` — no hay reintento automático |
| Manejo de rate limiting de Graph (429) | Parcial | `retryOnFail` + `batching` básicos; sin backoff exponencial completo ni checkpoint de página |

## Expedientes

| Capacidad | Estado | Detalle / limitación |
|---|---|---|
| Correlación automática de correos relacionados | Implementado | Requiere un correo semilla — no hay un proceso que cree casos sin intervención humana |
| Línea de tiempo, notas, evidencia | Implementado | — |
| Exportación a PDF | Implementado | WeasyPrint + Jinja2, con hash SHA-256 del archivo generado (auditoría + header `X-Content-SHA256`); sin firma digital ni sello de tiempo |
| Dashboard ejecutivo | Implementado | Conteos reales por outcome/status |
| Recordatorio de revisión vencida | Implementado, parcial | Solo notificación in-app — **no envía email** |
| Reasignación manual de dueño | Implementado | — |
| Gobierno formal del caso (reglas de cierre, retención, disposición, reapertura) | **No implementado / no decidido** | El sistema permite cerrar/reabrir un expediente sin ninguna política formal detrás — ver hallazgo en la revisión de documentación |
| Cadena de custodia forense del PDF exportado | Parcial | Hay hash SHA-256 verificable (ver arriba), pero sin sello de tiempo ni firma digital — sigue siendo un documento de trabajo, no un artefacto forense completo |

## Inteligencia artificial

| Capacidad | Estado | Detalle / limitación |
|---|---|---|
| Resumen de expediente con IA local (Ollama) | Implementado | Modelo por defecto `qwen2.5:3b` |
| Conclusión / prioridad / próxima acción sugerida | Implementado | Siempre requiere confirmación manual del auditor |
| Análisis en background + notificación | Implementado | — |
| Análisis en lote (todos los expedientes pendientes) | Implementado | Solo admin |
| Modo de análisis "extenso" (todos los correos, cuerpo completo, con vista previa de qué se envía) | **Evaluado, no implementado** | Diseño aprobado en una sesión de planificación; el usuario pidió pausar la implementación — no hay código de esto todavía |
| Enmascarado de remitentes en lo que se manda al modelo | **No implementado** | El prompt manda nombre/correo reales — cualquier documentación que diga "remitente enmascarado" está desactualizada |
| Soporte de proveedores externos (OpenAI/Anthropic) | Implementado como opción | Deshabilitado por política `local_only` salvo que un admin lo habilite explícitamente |

## Notificaciones

| Capacidad | Estado | Detalle / limitación |
|---|---|---|
| Notificaciones in-app | Implementado | Compartir, IA lista, revisión vencida, sincronización delta |
| Notificaciones por email (HTML) | Implementado, parcial | Cubre compartir expediente/buzón, cuenta creada, IA lista, sync delta — **no** cubre el recordatorio de revisión vencida |

## Infraestructura y operación

| Capacidad | Estado | Detalle / limitación |
|---|---|---|
| Punto de entrada único (proxy) | Implementado | — |
| TLS en el proxy | **Pendiente** | Ver [`INSTALL.md`](INSTALL.md#antes-de-exponer-esto-a-una-red-real) |
| Migraciones de base de datos versionadas con runner | **No implementado** | Lista manual de archivos a aplicar en orden (ver [`INSTALL.md`](INSTALL.md)) — sin tabla de control de versión, sin comando de rollback |
| Backup y restauración documentados/automatizados | **No implementado / no documentado** | No hay procedimiento de respaldo de Postgres, credenciales de n8n ni `share/` |
| Hardening de contenedores (usuario no-root) | Implementado | `backend`/`identity-broker` corren como `appuser`; `frontend` usa `nginxinc/nginx-unprivileged`. Sin límites de recursos (`cpus`/`mem_limit`) todavía |
| Runbook operacional (jobs atascados, rotación de secretos, etc.) | Implementado | Ver [`OPERATIONS.md`](OPERATIONS.md) |
