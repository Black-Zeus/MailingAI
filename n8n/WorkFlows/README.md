# Workflows de MailingAI — detalle por nodo

Documentación de los 10 workflows de esta carpeta: qué hace cada uno y, dentro de cada uno, qué hace cada nodo. Para instrucciones de instalación/importación ver el `README.md` de la raíz del proyecto.

Convención de nombres: el prefijo numérico indica el orden de uso, no de importación (todos se importan juntos). `00` es un subworkflow interno que llaman `01`, `02`, `03` y `09` — nunca se ejecuta solo. `05` no usa el subworkflow `00`: tiene su propia llamada a Graph porque necesita traer también los adjuntos de cada correo. `06` descubre la estructura de carpetas del buzón. `07` es el orquestador que dispara el backend FastAPI. `08` trae el contenido real de un adjunto puntual, a pedido directo del backend (no pasa por `07`). `09` busca adjuntos de cualquier formato en una o varias carpetas elegidas, con un patrón opcional (regex o texto libre).

```text
00 - Graph Fetch (subworkflow, uso interno)   <- llamado por 01, 02, 03, 09 (indirectamente via 07)
01 - Fetch Sent Items                         <- punto de entrada más común
02 - Fetch Message Series (parametrizado)     <- alternativa con filtros libres
03 - Fetch Related Thread                     <- requiere un conversation_id ya guardado
04 - Generate Activity Charts                 <- se corre después de tener datos (01/02/03)
05 - Fetch CR Attachments (Enviados)          <- trazabilidad de adjuntos PDF/Word/Excel/PowerPoint que mencionan CR
06 - Discover Mail Folders                    <- descubre carpetas/subcarpetas (hasta 3 niveles)
07 - Execute Analysis Job                     <- webhook interno, lo dispara el backend FastAPI
08 - Download Attachment                      <- webhook síncrono, trae el contenido real de un adjunto
09 - Search Attachments (carpetas + patrón)   <- busca adjuntos de cualquier formato por carpeta(s) + patrón opcional
```

Los workflows `01`, `02`, `03`, `04` y `05` se pueden seguir ejecutando manualmente igual que siempre (botón "Execute workflow", sin tocar nada) — sus parámetros por defecto no cambiaron. Desde la Fase 3, además, cada uno acepta que le pasen los mismos parámetros desde afuera (por eso `07` los puede invocar): cada campo de `Set: Parametros` quedó como `{{ $json.campo || <default de siempre> }}`, así que si no llega nada por fuera, el comportamiento es idéntico al de antes.

## Notas técnicas (encontradas probando contra la instancia real, no en la documentación de n8n)

### 1. Los nodos Postgres usan SQL crudo (`executeQuery`), no el mapeo visual

Todos los nodos que escriben en Postgres usan `"operation": "executeQuery"` con SQL explícito y parámetros `$1, $2, ...` (vía `options.queryReplacement`), en vez de las operaciones visuales `insert`/`upsert`/`update` del nodo Postgres. Se probaron ambas formas contra la instancia real y las operaciones visuales tenían dos bugs que rompían el proyecto (2026-07-16):

1. **`operation: insert`/`upsert` sin un `schema` (tal como queda un JSON armado a mano, sin haber pasado por el editor de n8n) hace que el nodo autocomplete en `0` cualquier columna numérica de la tabla que no esté en el mapeo** — por ejemplo `run_id` o `total_messages`, aunque el JSON nunca los mencione. La primera corrida "funciona" de casualidad (inserta con `run_id=0`); la segunda corrida choca contra esa fila y tira `duplicate key value violates unique constraint "fetch_runs_pkey"`. Es el error que vas a ver si reemplazas estos nodos por la versión visual del mapeo de columnas sin revisarla a fondo.
2. **Un nodo `Set` con `options.includeOtherFields: true` justo antes de un nodo Postgres con `queryReplacement` rompe el parseo de los parámetros** (el último `$N` queda sin resolver, error `there is no parameter $N`), aunque el mismo `queryReplacement` funcione perfecto en cualquier otro contexto. Por eso ningún nodo `Set` de este proyecto usa `includeOtherFields` justo antes de un Postgres parametrizado (sí se usa, con cuidado, antes de un `Execute Workflow` — ver nota 3).

Si en algún momento agregas un nodo Postgres nuevo o modificas uno existente: usa `executeQuery` + `$1,$2,...` + `options.queryReplacement` (nunca concatenación de texto para construir el SQL, porque estos nodos insertan contenido real de correos —asunto, adjuntos— que no es texto confiable), y evitá `includeOtherFields` en cualquier `Set` que alimente directamente a un nodo Postgres parametrizado.

### 2. Toda query final de un workflow necesita `RETURNING`, aunque no uses el resultado

Un `INSERT`/`UPDATE` de Postgres sin `RETURNING` produce **cero items de salida** en n8n. Y un nodo sin items de entrada simplemente no se ejecuta — sin error, sin aviso, la ejecución general igual queda marcada `success`. Esto no importaba mientras esas queries (`Update fetch_runs`, `Insert chart_runs`, `Upsert mailing.messages`, `Upsert mailing.message_attachments`) eran el último nodo del workflow — pero en cuanto el workflow `07` empezó a encadenar algo *después* de ellas (vía `Execute Workflow`), el encadenado dejaba de dispararse en silencio. Todas esas queries ahora terminan en `RETURNING <pk>` (`run_id`, `chart_id`, `message_id`, `attachment_row_id`) para garantizar al menos un item de salida, se use o no ese valor.

### 3. Publicar (`n8n publish:workflow`) y activar no toman efecto sin reiniciar n8n

`n8n execute` (CLI) y un nodo `Execute Workflow` que llama a otro workflow exigen que el workflow **llamado** esté "publicado" (`workflow_published_version`), no solo `active=true` — es un concepto nuevo de esta versión de n8n, distinto de simplemente activar. El propio CLI lo advierte: *"Note: Changes will not take effect if n8n is running. Please restart n8n..."*. Por eso `n8n/import.sh` publica los 7 workflows después de importarlos, y `scripts/import-n8n.sh` reinicia el contenedor `n8n` al final si se tocaron workflows. Si editas un workflow a mano desde la UI de n8n y necesitas que otro lo pueda invocar, recuerda publicarlo (botón de publicar en el editor) — la UI sí lo hace automáticamente al guardar, esto solo aplica a cambios hechos por script/CLI.

### 4. `import:workflow` siempre deja los workflows como `inactive`

Aunque el JSON traiga `"active": true`, `n8n import:workflow` los deja `inactive` salvo que uses `--activeState=fromJson` (no lo usamos, para no activar por accidente algo con trigger real). El único workflow de este proyecto que necesita estar activo es el `07` (tiene el webhook) — `n8n/create-folder.sh` lo reactiva por SQL después de agrupar la carpeta, ya que la CLI no tiene un comando directo para esto.

### 5. La credencial de Graph es OAuth2 genérica (`oAuth2Api`), no la "Microsoft OAuth2 API" nativa de n8n

Se probó primero con el tipo de credencial nativo `microsoftOAuth2Api`. Al hacer "Connect my account" con una App Registration **single-tenant** (el caso normal), Azure devuelve:

```text
AADSTS50194: Application '...' is not configured as a multi-tenant application.
Usage of the /common endpoint is not supported for such applications...
```

El tipo nativo de n8n arma la URL de autorización contra `/common` sin importar el `tenantId` que le pongas, y `/common` solo sirve para apps multi-tenant. La solución (y la que queda en `n8n/credentials/mailingai-graph-oauth2.json` y en los nodos `Graph: List Messages` / `Graph: List Sent With Attachments` / `Graph: List Message Attachments`) es usar el tipo **genérico `OAuth2 API`** (`oAuth2Api`), con `authUrl`/`accessTokenUrl` armadas a mano con el tenant real:

```text
https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/authorize
https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token
```

En el nodo `HTTP Request`, esto se ve como `"authentication": "genericCredentialType", "genericAuthType": "oAuth2Api"` (en vez de `"authentication": "predefinedCredentialType", "nodeCredentialType": "microsoftOAuth2Api"`). Si tu App Registration fuera multi-tenant, el tipo nativo probablemente funcionaría — no se probó ese caso.

### 6. `queryReplacement` con varios valores debe ser un único arreglo, no texto unido por comas

Los 17 nodos Postgres parametrizados del proyecto arrancaron con `options.queryReplacement` armado como texto plantilla, un `{{ expr }}` por parámetro separado por comas:

```text
={{ $json.a }}, {{ $json.b }}, {{ $json.c }}
```

Esto funciona mientras ningún valor tenga una coma literal adentro. En cuanto probamos con datos reales del buzón, `raw_record` (el JSON completo del mensaje de Graph, guardado tal cual para trazabilidad) traía decenas de comas — y n8n corta el texto por cada coma "top-level" para armar la lista de parámetros, así que un valor con comas se partía en varios parámetros de más, y sobraban `$N` sin resolver: `there is no parameter $18`. No se veía con datos de prueba porque ninguno tenía tantas comas.

La forma correcta es una única expresión que evalúa a un arreglo, no texto concatenado:

```text
={{ [$json.a, $json.b, $json.c] }}
```

Con esta sintaxis, n8n evalúa un solo array de JavaScript — el contenido de cada elemento (comas, comillas, lo que sea) no afecta cómo se separan los parámetros, porque no hay separación por texto involucrada. **Cualquier nodo Postgres nuevo que uses `queryReplacement` con más de un parámetro debe usar esta forma de arreglo**, nunca la de texto unido por comas, aunque tus datos de prueba actuales no tengan comas — es cuestión de tiempo hasta que un correo real las tenga (asuntos, nombres de adjuntos, y sobre todo `raw_record` casi siempre las tienen).

### 7. Paginación real de Graph (`@odata.nextLink`) vía la opción nativa del nodo HTTP Request

Los nodos `HTTP Request` que listan mensajes o carpetas (`Graph: List Messages` en `00`, `Graph: List Sent With Attachments` en `05`, y los tres niveles de `Graph: List Level N Folders` en `06`) usan la paginación **incorporada** del nodo, no una reconstrucción manual del `@odata.nextLink`. La forma correcta de configurarla, verificada contra el código fuente del nodo (`HttpRequest/V3/Description.js`) porque la UI no deja copiar el JSON crudo fácilmente:

```json
"options": {
  "pagination": {
    "pagination": {
      "paginationMode": "responseContainsNextURL",
      "nextURL": "={{ $response.body[\"@odata.nextLink\"] }}",
      "paginationCompleteWhen": "other",
      "completeExpression": "={{ !$response.body[\"@odata.nextLink\"] }}",
      "limitPagesFetched": true,
      "maxRequests": 20,
      "requestInterval": 300
    }
  }
}
```

Notas sobre esta configuración:
- El objeto `pagination` está anidado dos veces (`options.pagination.pagination`) porque es un `fixedCollection` de n8n — ponerlo un solo nivel produce un nodo que "no pagina" sin ningún error visible.
- `paginationCompleteWhen: "responseIsEmpty"` (el default) **no sirve** para Graph: cuando no hay más páginas, el body no viene vacío, simplemente no trae `@odata.nextLink`. Hay que usar `"other"` con `completeExpression` verificando la ausencia del campo.
- `limitPagesFetched: true` + `maxRequests: 20` es un techo de seguridad (hasta 2000 items con `$top=100`, o más si el job pide un `$top` menor) para no encadenar peticiones indefinidamente ante un dato inesperado — no es un requisito de Graph, es una decisión de este proyecto.
- Cambio de comportamiento importante para quien use `top` como parámetro de un job: **antes de la Fase 4, `top` era un techo duro sobre el total de resultados. Ahora es el tamaño de página**, y la paginación sigue trayendo páginas siguientes hasta agotar los resultados o `maxRequests`. Verificado en vivo: un job `fetch_sent_items` con `top=5` y un rango de fechas amplio trajo **100 mensajes reales** (20 páginas de 5), no 5.
- Se agregó también `retryOnFail: true, maxTries: 3, waitBetweenTries: 2000` a estos mismos nodos (reintentos controlados ante error transitorio/429) — es una mitigación básica, no un manejo completo de rate limiting con backoff exponencial ni checkpoint de página.

### 8. `mailing.messages.folder_id` se resuelve con una subquery para no romper la FK si la carpeta no fue descubierta todavía

`mailing.messages.folder_id` referencia `mailing.mail_folders(folder_id)`. Los mensajes que trae Graph incluyen su `parentFolderId` nativo (se mapea directo, sin necesidad de resolverlo a mano), pero si el usuario nunca corrió `06 - Discover Mail Folders`, ese `folder_id` no existe todavía en `mailing.mail_folders` y un `INSERT` directo violaría la foreign key, rompiendo el fetch de mensajes en seco. Los nodos `Postgres: Upsert mailing.messages` de `00` y `05` resuelven esto con una subquery en el propio `INSERT`:

```sql
(SELECT folder_id FROM mailing.mail_folders WHERE folder_id = $18)
```

Esto evalúa a `NULL` (sin error) si la carpeta todavía no fue descubierta, y a la carpeta real una vez que sí lo fue — sin depender del orden en que el usuario corra los workflows. El `ON CONFLICT` además usa `COALESCE(EXCLUDED.folder_id, mailing.messages.folder_id)` para no pisar un `folder_id` ya resuelto con `NULL` si una corrida posterior no logra resolverlo.

### 9. Reimportar credenciales pisa el token OAuth2 ya conectado

`n8n import:credentials` sobrescribe el `data` completo de la credencial en disco — incluido el `oauthTokenData` que `Connect my account` completa del lado del servidor una vez que el usuario autoriza. Si corres el import completo (sin `-SkipCredentials`) después de haber conectado la cuenta real de Graph, la credencial vuelve a quedar sin token y el próximo job falla con `Unable to sign without access token`, aunque nada haya cambiado en el JSON de la credencial en disco. **Si solo cambiaste archivos de workflow, usa `./scripts/import-n8n.sh --skip-credentials`** para no perder el token ya conectado.

### 10. Microsoft Graph rechaza combinar `$search` con `$filter` en `/messages` ("Bad request")

Encontrado (2026-07-16) la primera vez que `05 - Fetch CR Attachments` corrió de punta a punta contra el buzón real con el token ya conectado — hasta ese momento nunca había llegado más allá del error esperable de "sin token". El nodo `Graph: List Sent With Attachments` mandaba `$filter` (fecha + `hasAttachments`) **y** `$search` (la palabra clave) al mismo tiempo. Graph responde `400`:

```text
The query parameter '$filter' is not supported with '$search'.
```

No es un caso límite raro: Graph **no permite combinar `$filter` y `$search` en `/messages`**, punto. La solución no es un parámetro mágico, es dejar de pedirle a Graph que haga las dos cosas a la vez:

- El nodo HTTP ahora solo manda `$filter` (fecha + `hasAttachments`) — sin `$search`.
- Se agregó un nodo nuevo, `Filter: Contiene Keyword` (justo después de `Split Out Messages`), que hace el match de la palabra clave contra `subject` + `bodyPreview` **del lado de n8n**, en JavaScript, después de traer los mensajes. Para el volumen de datos de este proyecto (buzón de un usuario, rango de fechas acotado) esto es perfectamente viable y más confiable que depender de la sintaxis de `$search` de Graph.

### 11. `hasAttachments` combinado con `$filter` + `$orderby` también es "demasiado complejo" para Graph, aunque saques el `$search`

Sacar `$search` no alcanzó: el mismo endpoint, ahora solo con `$filter=hasAttachments eq true and sentDateTime ge ... and sentDateTime le ...` **más** `$orderby=sentDateTime desc`, seguía devolviendo `400`:

```text
The restriction or sort order is too complex for this operation.
```

El workaround "oficial" de Microsoft para este mensaje es agregar `$count=true` como query param y el header `ConsistencyLevel: eventual` (las "advanced query capabilities" de Graph) — se probó explícitamente y **no resolvió el error** en este caso. Lo que sí funcionó fue sacar directamente el `$orderby`: filtrar por `hasAttachments` ya es lo bastante costoso para Graph como para que además le pidas ordenar el resultado. Como los mensajes igual se guardan con `sent_datetime` real en Postgres, el orden cronológico se recupera gratis en cualquier `SELECT ... ORDER BY sent_datetime` (ya lo hace `v_cr_attachment_traceability`) — no hace falta que Graph lo ordene.

**Regla práctica para cualquier query nueva contra `/me/messages` en este proyecto**: si el filtro incluye `hasAttachments`, no le agregues `$search` ni `$orderby` a la misma llamada. Si necesitas texto libre u orden, hacelo del lado de n8n/Postgres después de traer los datos con un `$filter` simple.

### 12. El nodo Merge: el parámetro es `combineBy`, no `combinationMode` — y n8n no avisa si le mandas uno inventado

El nodo `Merge` de `05` traía `"combinationMode": "mergeByPosition"` desde que se escribió el workflow a mano (sin pasar por la UI de n8n). Ese nombre de parámetro **no existe** en el nodo Merge v3 — el real es `"combineBy": "combineByPosition"` (confirmado leyendo el código fuente del nodo dentro del contenedor, `Merge/v3/actions/versionDescription.js` y `combineByPosition.js`). n8n **no rechaza el import ni marca el nodo como inválido** cuando un parámetro no existe: simplemente lo ignora y usa el default del nodo (`combineBy: "combineByFields"`, que exige configurar "Fields to Match"). El error solo apareció en runtime, la primera vez que el nodo corrió con datos reales:

```text
You need to define at least one pair of fields in "Fields to Match" to match on
```

Esto había pasado desapercibido porque ninguna corrida anterior de `05` había llegado tan lejos (siempre fallaba antes, por falta de token). **Lección para todo este proyecto**: un nombre de parámetro mal escrito en un nodo autoría-por-JSON (no exportado desde la UI) no se detecta al importar — solo al ejecutar, y solo si la ejecución llega hasta ese nodo. Si algo similar vuelve a pasar con otro nodo poco común, verificar el nombre real del parámetro leyendo el código fuente del nodo dentro del contenedor (`docker compose exec n8n sh -c "find / -iname '<Node>.node.js'"`), no asumirlo por la documentación pública o por analogía con otro nodo.

### 13. `responseMode` del Webhook: `"lastNode"` para respuesta síncrona, no el default

El nodo `Webhook` de n8n tiene 3 modos de respuesta reales (confirmado leyendo `Webhook/description.js` dentro del contenedor, no asumido): `"onReceived"` (default si no se especifica — responde apenas llega la request, sin esperar nada del workflow), `"lastNode"` ("When Last Node Finishes" — espera a que termine todo el workflow y devuelve la salida del último nodo) y `"responseNode"` (la respuesta la arma un nodo `Respond to Webhook` en cualquier punto del flujo, como usa el `07`). Para un webhook que el backend necesita esperar de verdad (como `08`, donde el usuario está esperando el archivo), hay que poner `"lastNode"` explícito — dejarlo sin especificar cae en `"onReceived"`, que respondería vacío antes de que Graph siquiera responda.

### 14. `Content-Disposition` con nombres de archivo reales rompe si no se codifica bien

Nombres reales de adjuntos casi siempre tienen tildes o guiones largos (ej. "Minuta de Reunión – Validación..."). El header HTTP `Content-Disposition` solo acepta Latin-1 en `filename="..."` — mandar el nombre real tal cual tira `UnicodeEncodeError` en el backend (Starlette/FastAPI) apenas se intenta armar la respuesta. Encontrado en la primera prueba de descarga real (nunca antes probada con un nombre de archivo con acentos). Corregido con el patrón estándar RFC 6266: `filename="<version ascii, con los caracteres no soportados reemplazados>"; filename*=UTF-8''<nombre real percent-encoded>` — los navegadores modernos prefieren la variante `filename*` cuando está presente.

### 15. Un nodo Postgres sin filas detiene la rama en silencio — un job puede quedar en `running` para siempre

En `04` (Generate Activity Charts), si la consulta `SELECT ... FROM v_messages_by_day WHERE day BETWEEN $1 AND $2` no devuelve filas (por ejemplo, el rango por defecto es "últimos 30 días" y todos los mensajes reales del buzón son más viejos que eso), el nodo Postgres produce **0 items de salida**. n8n no ejecuta ningún nodo aguas abajo cuando no hay items — así que ni el nodo que arma el PNG ni, más importante, el `Postgres: Mark Success` del workflow `07` (que depende de que `Execute: 04 Generate Activity Charts` devuelva algo) llegan a correr. El resultado: el job queda en `running` para siempre, sin error, sin forma de que el usuario se entere desde la UI de que nunca va a terminar. Encontrado en vivo: 6 jobs de `generate_activity_charts` acumulados en `running` durante hasta 24 minutos. Corregido agregando `alwaysOutputData: true` a los nodos `Postgres: Query by_day` y `Postgres: Query by_sender` (fuerza un item placeholder `{}` aunque la consulta no traiga filas) y filtrando ese placeholder en los `Set: Build *Payload` (`.filter(r => r && r.day)` / `.filter(r => r && r.label)`) antes de armar el gráfico — un gráfico sin puntos es un resultado válido y honesto, no un error. Verificado en vivo: un job con el rango por defecto (sin mensajes) ahora cierra en `success` con un PNG vacío en vez de quedar colgado.

### 16. `MailboxConcurrency limit` de Graph: un nodo HTTP disparado por item necesita `batching`, no solo `retryOnFail`

En `05`, el nodo `Graph: List Message Attachments` llama a Graph una vez por cada mensaje encontrado (uno por item de entrada). Sin la opción `options.batching` configurada, n8n dispara esas llamadas una atrás de otra sin ninguna pausa, y Graph responde `429 - "Application is over its MailboxConcurrency limit"` (mensaje real, más específico que el genérico "too many requests" que se ve en la UI) apenas hay unos pocos mensajes con adjuntos. El propio error de Graph sugiere la solución (`"Try spacing your requests out using the batching settings under 'Options'"`). Parámetro real verificado leyendo `HttpRequestV3.node.js` dentro del contenedor: `options.batching.batch.batchSize` / `options.batching.batch.batchInterval` (ms) — no es un parámetro documentado de forma obvia en la UI de opciones. Corregido con `batchSize: 1, batchInterval: 1000` (una llamada por segundo) más `retryOnFail: true, maxTries: 3, waitBetweenTries: 2000` como defensa adicional ante un 429 puntual. Verificado en vivo: el mismo job que fallaba con 429 de forma repetible ahora cierra en `success`.

### 17. Si el POST al webhook de `07` falla, el job queda en `queued` para siempre — el backend ahora lo marca `failed`

`trigger_analysis_job` se dispara como `BackgroundTask` de FastAPI (fire-and-forget, para no bloquear la respuesta `202` del endpoint). Si esa llamada fallaba (n8n caído, o un 404 porque n8n todavía estaba terminando de re-registrar el webhook tras un reinicio — visto en vivo justo después de reimportar workflows), el error solo quedaba en el log del backend: el job se quedaba en `queued` sin ningún indicio en la UI de que nunca iba a avanzar. Corregido: `n8n_client.trigger_analysis_job` ahora propaga `JobTriggerError` en vez de solo loguear, y un wrapper nuevo (`jobs_service.trigger_job`, el que de verdad se pasa a `BackgroundTasks.add_task`) lo captura y marca el job como `failed` con el error real vía `jobs_repository.mark_job_failed_to_dispatch` (con guarda `WHERE status = 'queued'`, para no pisar un estado que n8n ya haya actualizado por su cuenta).

### 18. Mismo patrón que la nota 15, encontrado en `05`: 0 coincidencias del keyword también dejaba el job colgado

Al agregar el fetch del body completo en `05` se detectó, probando en vivo, que un job de `fetch_cr_attachments` sin ningún mensaje que contenga el `cr_keyword` también quedaba en `running` para siempre — el mismo mecanismo de la nota 15 (un nodo con 0 items de salida corta la rama, y todo lo que depende de esa rama para llegar al `Postgres: Update fetch_runs` final nunca corre), pero un escalón más temprano en la cadena: `Filter: Contiene Keyword` con 0 coincidencias detiene todo antes de llegar a `Postgres: Upsert mailing.messages` y al `Merge` que alimentaba `Update fetch_runs`. La diferencia con la nota 15 es que acá **no** alcanza con `alwaysOutputData` a secas: si se le pone directo al `Filter`, el item placeholder (`{}`) seguiría de largo hasta el `INSERT` de Postgres con `message_id = NULL`, violando la restricción NOT NULL/PK — cambiando un hang silencioso por un error de integridad de datos, peor que el problema original.

Corregido separando dos ramas desde `Filter: Contiene Keyword` (con `alwaysOutputData: true`, siempre entrega al menos 1 item — real o placeholder): una rama nueva, `Filter: Es Mensaje Real` (sin `alwaysOutputData`, descarta el placeholder por `$json.id` vacío) que sigue el camino de siempre hacia el upsert de Postgres; y otra rama nueva, `Aggregate: Matched Count`, conectada directo desde el `Filter: Contiene Keyword` (por eso siempre corre, sin depender de si hubo upsert o no), que alimenta directo a `Postgres: Update fetch_runs` — sin pasar por el viejo nodo `Merge` (que se eliminó, ya no hacía falta: la query final solo usaba el campo `.messages`, nunca `.attachments`). El conteo de mensajes se ajustó para filtrar el placeholder antes de contar (`(($json.messages || []).filter(m => m && m.id)).length`), así un resultado vacío queda registrado como `total_messages = 0`, no como `1` (el placeholder contado por error). Verificado en vivo: un job con 0 coincidencias reales cierra en `success` con `total_messages = 0`, en vez de quedar colgado.

### 19. `Split Out` no propaga los demás campos del item por defecto — hace falta `include: "allOtherFields"`

Al construir `09` (busca en varias carpetas a la vez) se necesitaba dividir un array de `folder_ids` en N items, cada uno conservando el `run_id` que venía calculado en un paso anterior. Con el nodo `Split Out` configurado solo con `fieldToSplitOut`, el `run_id` desaparecía silenciosamente en cada item resultante (quedaba `null`) — sin error, sin aviso, el workflow entero seguía en `success` pero los mensajes se guardaban con `run_id = NULL` en vez del real, y el job terminaba "exitoso" con 0 resultados vinculados. Causa raíz verificada leyendo `SplitOut.node.js` dentro del contenedor: el parámetro real es `"include"`, con 3 valores (`"noOtherFields"` — el default, descarta todo lo demás; `"allOtherFields"`; `"selectedOtherFields"`). Los demás usos de `Split Out` en este proyecto (`00`, `05`, `06`) dividen el campo `value` de una respuesta de Graph, donde cada elemento ya es un objeto autocontenido (no dependen de campos hermanos), por eso nunca habían necesitado esta opción. Corregido agregando `"include": "allOtherFields"` al nodo. Verificado en vivo: un job con 2 carpetas reales pasó de guardar 0 mensajes vinculados a guardar los 41 mensajes reales de ambas carpetas con el `run_id` correcto.

### 20. `$orderby` fijo en el subworkflow `00` rompía en silencio apenas se combinaba con `$filter` (rango de fechas)

Al agregar rango de fechas a `09`, el subworkflow `00` (compartido por `01`, `02`, `03` y `09`) tenía un `$orderby: "sentDateTime desc"` **fijo, sin condición**, en el nodo `Graph: List Messages`. Es la misma incompatibilidad de Graph ya documentada para `05` (`hasAttachments` + `$orderby`), pero acá con `$filter` + `$orderby`: `"The restriction or sort order is too complex for this operation."`. Como ningún llamador de `00` había combinado antes un `$filter` real con una fecha real en la misma corrida (`01`/`03` casi nunca mandan `filter`), este bug estaba agazapado desde la Fase 1 sin que nadie lo pisara — recién se manifestó al agregarle rango de fechas a `09`. Importa para `02` (Fetch Message Series) también: cualquier búsqueda con fecha ahí venía con el mismo riesgo, sin haber sido probada a fondo con fechas reales.

Corregido: `$orderby` ahora es condicional (`={{ $json.filter ? undefined : 'sentDateTime desc' }}`) — se aplica solo cuando no hay `$filter`, igual que se resolvió en `05` quitándolo directamente (acá no se puede quitar sin más porque `01`/`03` sí dependen del orden al no paginar explícitamente por fecha). Verificado en vivo: la misma búsqueda de adjuntos en "Elementos enviados" (mayo 2026) pasó de fallar con ese error a traer 77 mensajes reales, 16 con adjuntos, 40 adjuntos reales guardados.

### 21. Filtrar adjuntos por patrón *antes* de guardarlos los volvía indistinguibles de "nunca trazados"

En `09`, el nodo `Filter: Coincide Con Patrón` descartaba el adjunto (no lo insertaba en `message_attachments`) si no matcheaba el patrón de búsqueda del usuario. El problema: Graph ya había sido consultado, el nombre real del adjunto ya se conocía — pero al no guardarse, en la UI se veía exactamente igual que un mensaje cuyo adjunto nunca se llegó a mirar ("Adjunto no trazado" para ambos casos, con causas completamente distintas). Reportado en vivo por el usuario con un job real: mensajes con adjunto confirmado por Graph aparecían como "no trazado" solo porque el nombre del archivo no cumplía el patrón (ej. `PC_Laptop Exportar.xlsx` no empieza con fecha, o `Inventario_GF_20260505.xlsx` tiene la fecha pero no al inicio del nombre).

Corregido: se eliminó el nodo `Filter` y en su lugar `Set: Parse Attachment Name` calcula `matches_search_pattern` como un campo más — el adjunto se guarda siempre, matcheado o no. Columna nueva `mailing.message_attachments.matches_search_pattern` (NULL para workflows sin concepto de patrón). En el frontend, `AttachmentItem` muestra el adjunto igual pero atenuado con "no coincide con la búsqueda" cuando corresponde, en vez de ocultarlo. Verificado en vivo: el mismo job real pasó de guardar 2 adjuntos (los que matcheaban) a guardar los 40 reales, con el flag correcto en cada uno.

### 22. `generate_activity_charts` y `discover_mail_folders` completaban el job pero la UI no mostraba nada (dos gaps distintos, mismo síntoma reportado)

Usuario reportó, sobre un job real ya `success`: al abrir "Ver resultados" en Trabajos, tanto un job de `discover_mail_folders` como uno de `generate_activity_charts` mostraban el mismo mensaje genérico ("este tipo de trabajo no genera una lista de mensajes"), sin mostrar el árbol de carpetas ni el gráfico generado. Causas reales, distintas para cada tipo:

- **`discover_mail_folders`**: no hay bug de fondo — `mailing.mail_folders` se actualiza igual, pero no está pensado como una lista scoped por job (no tiene FK a `analysis_jobs`, cada corrida resincroniza el árbol completo). Solución: cuando el job es de este tipo, el panel de resultados directamente pide `GET /api/mail-folders` (el mismo endpoint que ya usa "Nuevo trabajo" para el selector de carpetas) y renderiza el árbol con `FolderTree` en un nuevo modo `readOnly` (sin checkboxes, ya que no hay ninguna acción que tomar sobre el resultado).
- **`generate_activity_charts`**: acá sí había un gap real de arquitectura. El backend genera el PNG al vuelo (`POST /charts/timeline` o `/histogram`, sin persistir nada — ver sección "04 — Generate Activity Charts" más abajo), y es **workflow `04`** el que escribe el archivo a disco (`Write Binary File` a `/files/mailingai/out/...`, dentro del volumen `./share` montado solo en el contenedor de n8n) y guarda esa ruta en `mailing.chart_runs.output_file`. Pero `mailing.analysis_jobs` nunca guardaba *qué* `chart_id` había producido cada job, y el backend no tenía forma de leer ese archivo (el volumen `./share` no estaba montado en el contenedor del backend). Dos correcciones:
  1. Columna nueva `mailing.analysis_jobs.chart_id` (migración `20260717_0010`). `04` genera **un solo** gráfico por corrida (el `IF` por `chart_type` hace que solo uno de los dos branches — timeline o histograma — corra en cada ejecución, nunca ambos), así que su único nodo terminal (`Postgres: Insert chart_runs (timeline|histogram)`, con `RETURNING chart_id`) le llega tal cual a `Postgres: Mark Success` del `07` — mismo patrón ya usado para `fetch_run_id` con `run_id`, solo que con `chart_id`.
  2. `docker-compose.yml`: se agregó `./share:/files:ro` al servicio `backend` (antes solo lo tenía `n8n`) — mismo host path, mismo punto de montaje `/files`, así que `chart_runs.output_file` resuelve al mismo archivo real desde ambos contenedores. Nuevo endpoint `GET /api/jobs/{job_id}/chart` lee el PNG del disco y lo devuelve como `image/png`; el frontend lo muestra con un `<img src=...>` directo (no hace falta blob/fetch manual, es una URL pública sin auth).

Verificado en vivo: job real de `discover_mail_folders` (83 carpetas reales resincronizadas) y job real de `generate_activity_charts` (`chart_id=62` quedó vinculado automáticamente, `GET /api/jobs/{id}/chart` devolvió un PNG real de 92 KB, verificado visualmente). 21/21 tests de backend siguen pasando.

### 23. Un corte de red transitorio en un solo adjunto tiraba abajo todo el job de `search_attachments`

Usuario reportó un job real de `search_attachments` fallido con `execute_workflow_error` / "The service refused the connection - perhaps it is offline", preguntando si podía ser un problema de paginación. Decodificando la ejecución real (misma técnica de `flatted` ya establecida) se confirmó que **no era paginación** — el subworkflow `00` (que trae la lista de mensajes, paginada) había terminado bien en 38 segundos. El error real estaba en `Graph: List Message Attachments` (el nodo que trae los adjuntos de cada mensaje encontrado, uno por uno, a 1 req/seg): en el ítem #20, la conexión TCP hacia Graph fue rechazada (`connect ECONNREFUSED 40.126.45.28:443`), agotó los 3 reintentos ya configurados (`retryOnFail`, 2s entre intentos) y, al no tener `onError` seteado, **abortó todo el workflow** — se perdía el trabajo ya hecho para los 19 mensajes anteriores, aunque el corte haya sido pasajero.

Corregido: agregado `"onError": "continueRegularOutput"` a `Graph: List Message Attachments`. Verificado leyendo el código real de n8n (no asumido) que esto es seguro en este caso puntual: con `continueOnFail()` en `true`, un ítem fallido produce `{ json: { error: mensaje }, pairedItem: { item: N } }` (sin los campos originales) — pero el nodo siguiente, `Split Out Attachments` (`fieldToSplitOut: "value"`), ya maneja un campo ausente como array vacío (`entityToSplit = []` cuando `entryExists` es `false`, confirmado en `SplitOut.node.js`), así que un ítem fallido simplemente no genera adjuntos para ese mensaje puntual — el mismo resultado que ya existía para "adjunto no trazado" — en vez de tirar abajo el resto de mensajes que sí se pudieron procesar.

Verificado en vivo: job real de `search_attachments` corrido después del cambio completó normal en 5 segundos con 15 adjuntos reales trazados (mismo resultado que antes del cambio) — confirma que el camino sin fallos no se rompió. No se pudo forzar un corte de red real para probar el camino de falla en vivo; la corrección se apoya en la lectura directa del código fuente de n8n, no en una simulación.

### 24. `date_from`/`date_to` en formato `yyyyMMdd` rompían el filtro de Graph en `01`/`02` — Graph los interpretaba como enteros, no como fechas

Usuario reportó otro job fallido, `execute_workflow_error` / "Bad request - please check your parameters", y volvió a fallar igual al reintentarlo. Decodificando la ejecución real: el nodo `Graph: List Messages` (llamado desde `fetch_sent_items`) mandó `$filter=sentDateTime ge 20260601 and sentDateTime le 20260630` — Graph devolvió el error real y explícito: *"Invalid filter clause: A binary operator with incompatible types was detected. Found operand types 'Edm.DateTimeOffset' and 'Edm.Int32'"* — es decir, Graph interpretó `20260601` como un número entero, no como una fecha, porque no es ISO 8601 válido. `01`/`02` (`Set: Parametros`) nunca validan el formato de `date_from`/`date_to`, solo concatenan el string tal cual llega en el `$filter`. Reintentar el job no ayuda porque reintentar reproduce los mismos parámetros defectuosos — el problema no era transitorio como el de la nota 23, era un dato de entrada con formato equivocado (probablemente un job creado a mano vía API con el formato `yyyyMMdd` que sí espera `05`/`fetch_cr_attachments`, en vez del ISO que espera todo el resto).

Corregido: `Set: Parametros` de `01` y `02` ahora normalizan `date_from`/`date_to` antes de usarlos — si el valor es un string de 8 dígitos (`/^\d{8}$/`, patrón `yyyyMMdd`), se convierte con `DateTime.fromFormat(v, 'yyyyMMdd').toISO()` (Luxon, expuesto como global `DateTime` en las expresiones de n8n — confirmado leyendo `workflow-data-proxy.js`, no asumido); cualquier otro valor (ISO real, que es el caso normal desde el frontend) pasa sin tocar. Defensivo por diseño: no importa de dónde venga el dato mal formateado (API manual, un futuro bug de UI, etc.), el workflow ya no se rompe con eso.

Verificado en vivo: job real de `fetch_sent_items` con `date_from=20260601, date_to=20260630` a propósito → `success`, `fetch_runs.date_from`/`date_to` quedaron en `2026-06-01 00:00:00-04`/`2026-06-30 00:00:00-04` (convertidos correctamente), 62 mensajes reales de junio 2026 recuperados. Job de control con fechas ISO reales (el formato que ya manda el frontend) → también `success`, sin cambios de comportamiento.

---

## 00 — Graph Fetch (subworkflow, uso interno)

Archivo: `00-mailingai-graph-fetch-subworkflow.json`

No se ejecuta manualmente. Recibe parámetros de otro workflow vía el nodo `Execute Workflow`, llama a Microsoft Graph, normaliza cada mensaje al esquema `mailing.messages` y hace upsert. Es el único lugar del proyecto donde se llama a Graph API — así los workflows 01/02/03 no repiten esa lógica.

**Parámetros de entrada** (definidos en el trigger, ver nodo 1):

| Parámetro | Tipo | Uso |
|---|---|---|
| `folder` | string | Nombre de carpeta de Graph (`SentItems`, etc.) o vacío para buscar en `/me/messages` sin restringir carpeta |
| `filter` | string | Expresión OData `$filter` (ej: `sentDateTime ge ... and sentDateTime le ...`) |
| `search` | string | Expresión `$search` (ej: `"subject:factura"`) |
| `top` | number | Máximo de mensajes a traer (`$top`) |
| `run_id` | number | FK hacia `mailing.fetch_runs`, para trazabilidad |
| `is_sent` | boolean | Si `true`, los mensajes se guardan marcados como enviados (`mailing.messages.is_sent`) |

**Nodos, en orden:**

1. **`When Executed by Another Workflow`** — `n8n-nodes-base.executeWorkflowTrigger`
   Trigger del subworkflow. Declara los 6 parámetros de entrada de la tabla de arriba (`workflowInputs`). No hace nada más; solo expone `$json.folder`, `$json.filter`, etc. al resto del workflow.

2. **`Graph: List Messages`** — `n8n-nodes-base.httpRequest`
   `GET` contra Microsoft Graph, usando la credencial `MailingAI Graph OAuth2` (`oAuth2Api`, genérica — ver nota técnica 5).
   - URL: si `folder` viene con valor, pega contra `https://graph.microsoft.com/v1.0/me/mailFolders/{folder}/messages`; si viene vacío, pega contra `https://graph.microsoft.com/v1.0/me/messages` (todas las carpetas).
   - Query params: `$filter`, `$search`, `$top` (default 50 si no viene), `$orderby=sentDateTime desc`.
   - Devuelve el objeto crudo de Graph, con el array de mensajes en `value`.

3. **`Split Out Messages`** — `n8n-nodes-base.splitOut`
   Separa el array `value` de la respuesta de Graph en un item de n8n por mensaje (de "1 item con un array" pasa a "N items", uno por correo).

4. **`Map To mailing.messages`** — `n8n-nodes-base.set`
   Traduce cada mensaje de Graph al esquema de la tabla `mailing.messages`: `message_id` (`id` de Graph), `conversation_id`, `internet_message_id`, `subject`, `from_address`/`from_name` (desde `from.emailAddress`), `to_addresses`/`cc_addresses` (arrays de direcciones, serializados a JSON string), `sent_datetime`, `received_datetime`, `has_attachments`, `importance`, `categories`, `body_preview`, `web_link`, y `raw_record` (el mensaje completo de Graph, como JSON string, para no perder nada). También toma `run_id` e `is_sent` del trigger original (nodo 1), no del mensaje de Graph.

5. **`Upsert mailing.messages`** — `n8n-nodes-base.postgres`
   `INSERT ... ON CONFLICT (message_id) DO UPDATE` contra `mailing.messages`, usando la credencial `MailingAI Postgres`. Si el mismo correo ya existía (mismo `message_id`), lo actualiza en vez de duplicarlo — por eso volver a traer el mismo rango de fechas no genera filas repetidas.

6. **`Aggregate Results`** — `n8n-nodes-base.aggregate`
   Junta todos los items (uno por mensaje procesado) de vuelta en un solo item, metiendo el array completo en el campo `messages`. Es el paso previo para poder contar cuántos mensajes se procesaron.

7. **`Return Summary`** — `n8n-nodes-base.set`
   Calcula `fetched_count = messages.length` y lo deja como única salida del subworkflow. Es lo que reciben los workflows 01/02/03 en `$json.fetched_count` cuando llaman a este subworkflow con `Execute Workflow`.

---

## 01 — Fetch Sent Items

Archivo: `01-mailingai-fetch-sent-items.json`

Caso de uso más simple: traer los correos de la carpeta **Enviados** de los últimos 30 días (parametrizable). Es el workflow recomendado para probar la conexión con Graph por primera vez.

**Nodos, en orden:**

1. **`Manual Trigger`** — `n8n-nodes-base.manualTrigger`
   Arranque manual (botón "Execute Workflow" en el editor).

2. **`Set: Parametros`** — `n8n-nodes-base.set`
   Define los 3 parámetros editables del workflow: `date_from` (default: hoy − 30 días, ISO), `date_to` (default: ahora, ISO), `top` (default: 50). Para cambiar el rango o el límite de mensajes, se edita este nodo.

3. **`Postgres: Insert fetch_runs`** — `n8n-nodes-base.postgres`
   Inserta una fila en `mailing.fetch_runs` con `folder='sentitems'`, las fechas y el `top` elegidos, y `status='started'`. Devuelve el `run_id` generado (columna de salida configurada en `options.outputColumns`), que se usa para todo el resto del workflow.

4. **`Execute: Graph Fetch`** — `n8n-nodes-base.executeWorkflow`
   Llama al subworkflow **00** con `folder="SentItems"`, `filter` construido como `sentDateTime ge {date_from} and sentDateTime le {date_to}`, `search=""`, `top` y `run_id` tomados de los nodos anteriores, `is_sent=true`. Esto ejecuta todo el flujo de Graph → normalización → upsert descrito arriba.

5. **`Postgres: Update fetch_runs`** — `n8n-nodes-base.postgres`
   Actualiza la fila de `fetch_runs` creada en el paso 3: `status='success'`, `finished_at=ahora`, `total_messages` = el `fetched_count` que devolvió el subworkflow.

---

## 02 — Fetch Message Series (parametrizado)

Archivo: `02-mailingai-fetch-message-series.json`

Igual que 01, pero con filtros libres: remitente, texto en el asunto, carpeta y rango de fechas, en vez de un flujo fijo para Enviados.

**Nodos, en orden:**

1. **`Manual Trigger`** — `n8n-nodes-base.manualTrigger`

2. **`Set: Parametros`** — `n8n-nodes-base.set`
   Define 6 parámetros editables: `folder` (vacío = todas las carpetas), `from_address` (vacío = cualquier remitente), `subject_contains` (vacío = sin filtro de texto), `date_from`, `date_to` (defaults: últimos 30 días), `top` (default 50).

3. **`Set: Build Graph Query`** — `n8n-nodes-base.set`
   Arma la query de Graph a partir de los parámetros:
   - `graph_filter`: junta con `and` las condiciones que tengan valor (`from/emailAddress/address eq '...'`, `sentDateTime ge ...`, `sentDateTime le ...`), descartando las vacías.
   - `graph_search`: si `subject_contains` tiene valor, arma `"subject:{texto}"`; si no, queda vacío.
   - Usa `options.includeOtherFields: true` para no perder los parámetros del nodo anterior.

4. **`Postgres: Insert fetch_runs`** — `n8n-nodes-base.postgres`
   Inserta en `mailing.fetch_runs` con `folder` (o `'messages'` si vino vacío), fechas, `search_query`, `filter_description` y `top_requested`, `status='started'`. Devuelve `run_id`.

5. **`Execute: Graph Fetch`** — `n8n-nodes-base.executeWorkflow`
   Llama al subworkflow **00** con `folder`, `filter` y `search` calculados en el paso 3, más `top` y `run_id`. `is_sent` se calcula solo: `true` únicamente si `folder` (en minúsculas) es `sentitems`.

6. **`Postgres: Update fetch_runs`** — `n8n-nodes-base.postgres`
   Igual que en el workflow 01: marca `status='success'`, `finished_at`, `total_messages`.

---

## 03 — Fetch Related Thread

Archivo: `03-mailingai-fetch-related-thread.json`

Dado el `conversation_id` de un correo ya guardado en `mailing.messages` (columna que identifica el hilo/thread en Graph), trae **todos** los mensajes de esa conversación, estén en la carpeta que estén.

**Nodos, en orden:**

1. **`Manual Trigger`** — `n8n-nodes-base.manualTrigger`

2. **`Set: Parametros`** — `n8n-nodes-base.set`
   Define `conversation_id` (sin default real — trae el placeholder `REEMPLAZA_CON_UN_CONVERSATION_ID_DE_mailing.messages`, hay que pegar un valor real antes de ejecutar, por ejemplo con `SELECT DISTINCT conversation_id FROM mailing.messages;`) y `top` (default 100).

3. **`Postgres: Insert fetch_runs`** — `n8n-nodes-base.postgres`
   Inserta en `mailing.fetch_runs` con `folder='related'`, `filter_description` = `conversationId eq '{conversation_id}'`, `top_requested`, `status='started'`. Devuelve `run_id`.

4. **`Execute: Graph Fetch`** — `n8n-nodes-base.executeWorkflow`
   Llama al subworkflow **00** con `folder=""` (busca en `/me/messages`, sin restringir carpeta), `filter=conversationId eq '{conversation_id}'`, `search=""`, `top`, `run_id`, `is_sent=false` (los mensajes de un hilo pueden venir de cualquier carpeta, no se asume que son enviados).

5. **`Postgres: Update fetch_runs`** — `n8n-nodes-base.postgres`
   Igual que en 01/02: marca `status='success'`, `finished_at`, `total_messages`.

---

## 04 — Generate Activity Charts

Archivo: `04-mailingai-generate-activity-charts.json`

Genera un PNG (línea de tiempo o histograma) a partir de lo que ya haya en `mailing.messages`, llamando al backend FastAPI (`/charts/timeline` o `/charts/histogram`). Tiene dos ramas paralelas — una por tipo de gráfico — que un nodo `IF` decide cuál ejecutar.

**Nodos, en orden:**

1. **`Manual Trigger`** — `n8n-nodes-base.manualTrigger`

2. **`Set: Parametros`** — `n8n-nodes-base.set`
   Define `chart_type` (`"timeline"` o `"histogram"`, default `"timeline"`), `date_from` y `date_to` (default: últimos 30 días, formato `yyyy-LL-dd`, usados solo por la rama de línea de tiempo).

3. **`IF: Chart Type`** — `n8n-nodes-base.if`
   Evalúa `chart_type === "timeline"`. Salida `true` (índice 0) → rama de línea de tiempo. Salida `false` (índice 1) → rama de histograma.

### Rama línea de tiempo (`chart_type = "timeline"`)

4. **`Postgres: Query by_day`** — `n8n-nodes-base.postgres`
   `SELECT day, message_count FROM mailing.v_messages_by_day WHERE day BETWEEN {date_from} AND {date_to} ORDER BY day;` — una fila por día con actividad.

5. **`Aggregate: Timeline Rows`** — `n8n-nodes-base.aggregate`
   Junta todas las filas en un solo item, en el campo `rows`.

6. **`Set: Build Timeline Payload`** — `n8n-nodes-base.set`
   Arma el body para el backend: `title` fijo (`"Actividad de correo por dia"`) y `points` = `rows` mapeado a `{date, count}` (serializado a JSON string).

7. **`Backend: POST /charts/timeline`** — `n8n-nodes-base.httpRequest`
   `POST http://backend:8000/charts/timeline` con `{title, points}` como body JSON. La respuesta se pide como archivo binario (`responseFormat: "file"`, queda en la propiedad `data` del item) — es el PNG generado por matplotlib.

8. **`Write: Timeline PNG`** — `n8n-nodes-base.writeBinaryFile`
   Escribe el binario recibido en `/files/mailingai/out/timeline-{fecha-hora}.png` (visible en el host en `share/mailingai/out/`).

9. **`Postgres: Insert chart_runs (timeline)`** — `n8n-nodes-base.postgres`
   Inserta en `mailing.chart_runs`: `chart_type='timeline'`, `params` (rango de fechas usado, como JSON), `output_file` (la ruta del PNG escrito en el paso anterior).

### Rama histograma (`chart_type = "histogram"`)

4′. **`Postgres: Query by_sender`** — `n8n-nodes-base.postgres`
   `SELECT from_address AS label, message_count FROM mailing.v_messages_by_sender ORDER BY message_count DESC LIMIT 20;` — top 20 remitentes por cantidad de correos.

5′. **`Aggregate: Histogram Rows`** — `n8n-nodes-base.aggregate`
   Igual que en la otra rama: junta las filas en un item, campo `rows`.

6′. **`Set: Build Histogram Payload`** — `n8n-nodes-base.set`
   Arma el body: `title` fijo (`"Correos enviados por remitente"`) y `buckets` = `rows` mapeado a `{label, count}`.

7′. **`Backend: POST /charts/histogram`** — `n8n-nodes-base.httpRequest`
   `POST http://backend:8000/charts/histogram` con `{title, buckets}`. Misma configuración de respuesta binaria que la rama de línea de tiempo.

8′. **`Write: Histogram PNG`** — `n8n-nodes-base.writeBinaryFile`
   Escribe en `/files/mailingai/out/histogram-{fecha-hora}.png`.

9′. **`Postgres: Insert chart_runs (histogram)`** — `n8n-nodes-base.postgres`
   Inserta en `mailing.chart_runs` con `chart_type='histogram'`, mismos `params`, `output_file` del histograma.

---

## 05 — Fetch CR Attachments (Enviados)

Archivo: `05-mailingai-fetch-cr-attachments.json`

Trazabilidad: busca en **Enviados** todos los correos que **tengan adjunto** y **mencionen "CR"**, y para cada uno revisa sus adjuntos PDF/Word cuyo nombre de archivo sigue el patrón `YYYYMMDD` (por ejemplo `20260715_informe.pdf`). Guarda tanto el correo como cada adjunto encontrado, para poder rastrear qué documento se envió, en qué correo y cuándo. A diferencia de 01/02/03, este workflow **no** usa el subworkflow 00: tiene su propia llamada a Graph porque además necesita traer los adjuntos de cada mensaje (algo que el subworkflow no hace).

**Parámetros editables** (nodo `Set: Parametros`):

| Parámetro | Tipo | Default | Uso |
|---|---|---|---|
| `date_from` | string, formato `yyyyMMdd` | hoy − 30 días | Inicio del rango de `sentDateTime` |
| `date_to` | string, formato `yyyyMMdd` | hoy | Fin del rango de `sentDateTime` |
| `cr_keyword` | string | `"CR"` | Texto que debe contener el asunto o la vista previa del correo (match de subcadena, sin distinguir mayúsculas — ver nodo 6 y Nota técnica 10) |
| `top` | number | 50 | Máximo de correos a traer |

**Nodos, en orden:**

1. **`Manual Trigger`** — `n8n-nodes-base.manualTrigger`

2. **`Set: Parametros`** — `n8n-nodes-base.set`
   Define los 4 parámetros de la tabla de arriba. Notar que las fechas se piden en formato `yyyyMMdd` (ej. `20260615`), no ISO — es el siguiente nodo el que las convierte.

3. **`Set: Build Graph Query`** — `n8n-nodes-base.set`
   Convierte `date_from`/`date_to` de `yyyyMMdd` a datetime ISO en UTC usando Luxon (`DateTime.fromFormat(..., 'yyyyMMdd')`), tomando el inicio del día para `date_from` y el fin del día para `date_to`. Arma:
   - `graph_filter` = `hasAttachments eq true and sentDateTime ge {date_from_iso} and sentDateTime le {date_to_iso}`
   - `graph_search` = `"{cr_keyword}"` (entre comillas, formato esperado por `$search` de Graph)
   Usa `options.includeOtherFields: true` para no perder `top` ni los parámetros originales.

4. **`Postgres: Insert fetch_runs`** — `n8n-nodes-base.postgres`
   Inserta en `mailing.fetch_runs` con `folder='sentitems'`, `date_from`/`date_to` (ya en ISO), `search_query`, `filter_description`, `top_requested`, `status='started'`. Devuelve `run_id`.

5. **`Graph: List Sent With Attachments`** — `n8n-nodes-base.httpRequest`
   `GET /me/mailFolders/SentItems/messages` con **solo** `$filter=graph_filter` (`hasAttachments eq true and sentDateTime ge ... and sentDateTime le ...`) y `$top`, con paginación real activada. **No manda `$search` ni `$orderby`** — Graph rechaza ambas combinaciones junto con este `$filter` (ver Notas técnicas 10 y 11). Usa la credencial `MailingAI Graph OAuth2`. Devuelve todos los correos de Enviados con adjunto en el rango de fechas, sin filtrar todavía por palabra clave.

6. **`Split Out Messages`** — `n8n-nodes-base.splitOut`
   Separa el array `value` en un item por correo.

6′. **`Filter: Contiene Keyword`** — `n8n-nodes-base.filter`
   Se queda solo con los correos cuyo `subject` + `bodyPreview` (concatenados) contienen `cr_keyword`, sin distinguir mayúsculas/minúsculas. Reemplaza al `$search` de Graph (ver Nota técnica 10) — el match se hace del lado de n8n, después de traer los correos con `$filter`.

7. **`Set: Map To mailing.messages`** — `n8n-nodes-base.set`
   Mismo mapeo de campos que el subworkflow 00 (`message_id`, `conversation_id`, `subject`, `from_address`/`from_name`, `to_addresses`/`cc_addresses`, fechas, `has_attachments`, `importance`, `categories`, `body_preview`, `web_link`, `raw_record`). `is_sent` queda fijo en `true` (viene de Enviados) y `run_id` sale del nodo 4.

8. **`Postgres: Upsert mailing.messages`** — `n8n-nodes-base.postgres`
   `INSERT ... ON CONFLICT (message_id) DO UPDATE` contra `mailing.messages`, igual que en el subworkflow 00. **Recién acá el workflow se divide en dos ramas** (9 y 7′): a propósito, la rama de adjuntos no arranca antes de este paso, porque `mailing.message_attachments.message_id` tiene una FK contra `mailing.messages` — si se intentara insertar un adjunto de un correo que todavía no se guardó, la FK lo rechaza. Por eso la rama B depende de que este upsert ya haya terminado para todos los correos, no de `Split Out Messages` directamente.

### Rama A — contar los correos guardados

9. **`Aggregate: Messages`** — `n8n-nodes-base.aggregate`
   Junta todos los correos procesados en un solo item (`messages`), para poder contar cuántos se procesaron al final.

### Rama B — traer y filtrar los adjuntos de cada correo

7′. **`Graph: List Message Attachments`** — `n8n-nodes-base.httpRequest`
   `GET /me/messages/{id}/attachments` (un llamado por cada correo ya guardado, `id` sale de `Set: Map To mailing.messages`), con `$select=id,name,contentType,size` para no traer el contenido binario del archivo, solo sus metadatos.

8′. **`Split Out Attachments`** — `n8n-nodes-base.splitOut`
   Separa el array `value` (adjuntos de ese correo) en un item por adjunto.

9′. **`Set: Parse Attachment Name`** — `n8n-nodes-base.set`
   Por cada adjunto calcula:
   - `message_id` — tomado de `Split Out Messages` (no del adjunto, que tiene su propio `id` distinto), vía `$('Split Out Messages').item.json.id`.
   - `attachment_id`, `file_name`, `content_type`, `size_bytes` — directo del adjunto.
   - `extension` — la extensión del archivo en minúsculas (`nombre.split('.').pop()`).
   - `matches_naming_convention` — `true` si el nombre del archivo contiene 8 dígitos con el patrón `20YYMMDD` (regex `/20\d{6}/`), es decir, si sigue la convención de nombre pedida.
   - `file_date` — si el nombre matchea el patrón, la fecha extraída y parseada a `YYYY-MM-DD`; si no, `null`.
   - `run_id` — del nodo 4.

10′. **`Filter: Solo PDF/Word`** — `n8n-nodes-base.filter`
    Descarta cualquier adjunto cuya `extension` no sea `pdf`, `doc` o `docx`. Solo estos siguen al siguiente paso.

11′. **`Postgres: Upsert mailing.message_attachments`** — `n8n-nodes-base.postgres`
    `INSERT ... ON CONFLICT (message_id, attachment_id) DO UPDATE` contra `mailing.message_attachments` (tabla nueva, ver `config/postgres/init/20260716_0001_mailing_attachments.sql`).

12′. **`Aggregate: Attachments`** — `n8n-nodes-base.aggregate`
    Junta todos los adjuntos procesados en un solo item (`attachments`).

### Cierre (las dos ramas se juntan)

13. **`Merge`** — `n8n-nodes-base.merge` (modo `combine`, `combineBy: combineByPosition` — ver Nota técnica 12, el nombre real del parámetro no es `combinationMode`)
    Espera a que terminen las dos ramas (9 y 12′) y las junta en un solo item con los campos `messages` y `attachments` juntos.

14. **`Postgres: Update fetch_runs`** — `n8n-nodes-base.postgres`
    Marca `status='success'`, `finished_at=ahora`, `total_messages = messages.length` (del item combinado por el `Merge`).

**Para consultar el resultado**, la vista `mailing.v_cr_attachment_traceability` junta cada adjunto con los datos del correo que lo envió (asunto, remitente, destinatarios, fecha):

```sql
SELECT * FROM mailing.v_cr_attachment_traceability WHERE matches_naming_convention = true ORDER BY sent_datetime DESC;
```

**Advertencias específicas de este workflow:**

- `cr_keyword="CR"` hace un match de subcadena contra `subject` + `bodyPreview` (no contra el cuerpo completo del correo, que no se trae); si trae demasiados falsos positivos, ajustar `cr_keyword` a algo más específico (ej. un código de proyecto tipo `"CR-1234"`).
- Por cada correo encontrado se hace **un llamado adicional a Graph** (`Graph: List Message Attachments`) para traer sus adjuntos — con `top` alto esto puede ser lento o pegar contra límites de throttling de Graph API. Si eso pasa, bajar `top` o correr por rangos de fecha más chicos.
- El nodo `Merge` necesita que **ambas ramas devuelvan al menos un item** para completar (por eso `Aggregate: Messages` y `Aggregate: Attachments` usan `aggregateAllItemData`, que siempre produce un item aunque el array quede vacío).

**Verificado en vivo, de punta a punta, contra el buzón real (2026-07-16)** — la primera vez que este workflow corrió más allá del error esperable de "sin token". Encontró y corrigió 3 bugs reales que solo aparecen ejecutando contra Graph/n8n de verdad, nunca se hubieran visto por inspección de código (ver Notas técnicas 10, 11 y 12): Graph rechaza `$search`+`$filter` juntos, Graph rechaza `hasAttachments`+`$orderby` juntos (incluso con `ConsistencyLevel: eventual`), y el nodo `Merge` tenía un nombre de parámetro inventado (`combinationMode` en vez de `combineBy`) que n8n ignoraba en silencio. Resultado real: `run_id` con `status='success'`, 5 correos reales con "CR" en el asunto, 4 adjuntos reales trazados, 2 de ellos coincidiendo correctamente con el patrón `YYYYMMDD`.

---

## 06 — Discover Mail Folders

Archivo: `06-mailingai-discover-mail-folders.json`

Descubre la estructura de carpetas/subcarpetas del buzón y la guarda en `mailing.mail_folders`, con `parent_folder_id` y ruta lógica (`folder_path`, ej. `Bandeja de entrada / Clientes / GoldFields`). Sin este workflow, `mailing.messages.folder_id` nunca se resuelve a nada útil (ver Nota técnica 8) y el endpoint `/api/mail-folders` devuelve una lista vacía.

No tiene parámetros — a diferencia de `01`-`05`, descubrir carpetas no depende de fechas ni filtros, siempre recorre todo el árbol.

1. **Manual Trigger** — sin parámetros de entrada.
2. **Postgres: Insert fetch_runs** — crea la fila de trazabilidad (`folder='mailfolders'`), sin parámetros dinámicos.
3. **Graph: List Level 0 Folders** (`GET /me/mailFolders`) — carpetas de primer nivel (Bandeja de entrada, Elementos enviados, etc.), con paginación real y `includeHiddenFolders=true` (trae también "Fuentes RSS", "Historial de conversaciones", que Graph oculta por default).
4. **Split Out Level 0 Folders** — una carpeta por item.
5. **Set: Map Level 0 Folder** — `parent_folder_id` se fija en `null` a propósito (aunque Graph devuelve un `parentFolderId` real para estas carpetas, apunta a la carpeta raíz oculta `msgfolderroot`, que este workflow nunca inserta — insertarlo tal cual violaría la foreign key).
6. **Postgres: Upsert Level 0 Folders** — `folder_path` se calcula en la propia query (`CASE WHEN parent IS NULL THEN nombre ELSE (ruta del padre) || ' / ' || nombre END`), no en JavaScript — así queda correcto sin importar el orden de ejecución.
7. **Graph: List Level 1 Folders** (`GET /me/mailFolders/{folder_id}/childFolders`) — se llama **una vez por cada carpeta de nivel 0**, incluidas las que no tienen hijos (devuelven `value: []`, sin error). Deliberadamente no se filtra con un IF antes de llamar — ver más abajo.
8. **Split Out Level 1 Folders** → 9. **Set: Map Level 1 Folder** (acá `parent_folder_id` sí viene de `$json.parentFolderId`, el campo nativo de Graph) → 10. **Postgres: Upsert Level 1 Folders**.
11. **Graph: List Level 2 Folders** / 12. **Split Out** / 13. **Set: Map Level 2 Folder** / 14. **Postgres: Upsert Level 2 Folders** — mismo patrón, un nivel más abajo.
15. **Postgres: Update fetch_runs** — marca `success` y cuenta cuántas carpetas se tocaron (`WHERE last_sync_at >= <started_at de este run>`), `executeOnce: true` para no repetir el UPDATE una vez por cada carpeta de nivel 2 que llegue.

**Decisiones de diseño (a propósito, no descuido):**

- **Profundidad fija de 3 niveles (0, 1, 2), sin recursión real.** Un diseño verdaderamente recursivo (el workflow invocándose a sí mismo por cada subcarpeta) es posible en n8n, pero mucho más difícil de verificar a ciegas sin poder iterar en la UI — y de sincronizar de forma confiable cuando ramas paralelas pueden tener cero items (ver Nota técnica 2). Se optó por una cadena lineal de 3 niveles fijos, suficiente para prácticamente cualquier estructura real de un buzón M365 (verificado: el buzón real de prueba tiene carpetas hasta el nivel 2, ej. `Bandeja de entrada / Clientes / GoldFields`, y ninguna más profunda). Si en algún momento hace falta un nivel 3, el patrón de los nodos 11-14 se puede duplicar tal cual.
- **No se filtra con un IF antes de pedir `childFolders`.** Se llama a `childFolders` para *todas* las carpetas del nivel anterior, tengan o no hijos (`child_folder_count` en 0 simplemente devuelve `value: []`). Es menos eficiente que filtrar primero, pero mantiene el workflow completamente lineal (sin ramas), evitando el riesgo de que una rama con cero items nunca dispare el nodo final `Update fetch_runs` (ver Nota técnica 2 — un nodo con cero items de entrada no se ejecuta).
- Verificado en vivo contra el buzón real: **83 carpetas descubiertas**, jerarquía de 3 niveles correcta (`Bandeja de entrada` con 7 hijos directos incluyendo `Clientes`, que a su vez tiene `GoldFields`, `AES`, etc.), `fetch_runs.total_messages = 83`, `status = success`.

---

## 07 — Execute Analysis Job

Archivo: `07-mailingai-execute-analysis-job.json`

Orquestador de la Fase 3: recibe un job creado por el backend (`POST /api/jobs`), lo marca `running`, responde de inmediato, y despacha la ejecución real al workflow `01`-`05` que corresponda según `job_type`. Es el único workflow de este proyecto con webhook — por eso es el único que queda `active` después de importar.

**Nodos, en orden:**

1. **`Webhook`** — `n8n-nodes-base.webhook`
   `POST /webhook/execute-analysis-job`. Autenticación `headerAuth` con la credencial `MailingAI Webhook Secret` (n8n valida el header `X-MailingAI-Secret` automáticamente — sin header o con el valor equivocado, responde `403` sin ejecutar nada). `responseMode: responseNode`: la respuesta HTTP la manda un nodo más adelante (nodo 3), no el webhook mismo — así el workflow puede seguir corriendo después de responder.

2. **`Postgres: Mark Running`** — `n8n-nodes-base.postgres`
   `UPDATE mailing.analysis_jobs SET status='running', started_at=now(), last_heartbeat_at=now() WHERE job_id=$1::uuid RETURNING job_id, job_type;`, con `job_id` tomado de `$json.body.job_id` (el body que mandó el backend).

3. **`Respond to Webhook`** — `n8n-nodes-base.respondToWebhook`
   Responde `{"accepted": true, "job_id": ...}` al backend. A partir de acá el backend ya recibió su `202`/confirmación — todo lo que sigue corre en segundo plano, el backend no espera.

4. **`Set: Flatten Parameters`** — `n8n-nodes-base.set`
   Arma un objeto plano con `job_id`, `job_type` y los 9 parámetros posibles (`date_from`, `date_to`, `folder`, `from_address`, `subject_contains`, `conversation_id`, `cr_keyword`, `chart_type`, `top`), todos leídos de `$('Webhook').item.json.body...` (no de `$json`, porque el nodo 2 ya reemplazó `$json` con el resultado de la query). Cada workflow de destino solo lee los campos que le importan e ignora el resto. `discover_mail_folders` (Fase 4) no usa ninguno de estos campos — `06` no tiene parámetros.

5. **Cadena de `IF` por `job_type`** (`IF: Is Fetch Sent Items` → `IF: Is Fetch Message Series` → `IF: Is Fetch Related Thread` → `IF: Is Fetch CR Attachments` → `IF: Is Generate Activity Charts` → `IF: Is Discover Mail Folders`) — cada uno compara `$json.job_type` contra un valor fijo; si matchea, va al `Execute Workflow` correspondiente; si no, sigue al siguiente `IF`. El `false` del último (`Discover Mail Folders`) cae directo en `Postgres: Mark Failed` (job_type desconocido — no debería pasar nunca, Pydantic ya lo valida en el backend, pero queda cubierto).

6. **`Set: Convert Dates For CR Attachments`** — solo en la rama de `fetch_cr_attachments`, entre el `IF` y su `Execute Workflow`. El workflow `05` espera fechas en formato `yyyyMMdd` (así se pidió originalmente para ese workflow, para uso manual), pero el resto de los workflows usa ISO y el frontend manda ISO para todos. Este nodo convierte `date_from`/`date_to` de ISO a `yyyyMMdd` **solo en este camino automatizado** — ejecutar `05` manualmente sigue pidiendo `yyyyMMdd` como siempre.

7. **`Execute: 01/02/03/04/05/06 ...`** (uno por rama) — `n8n-nodes-base.executeWorkflow`, `onError: "continueErrorOutput"`. Llama al workflow correspondiente pasándole el item actual tal cual (los workflows `01`-`06` empiezan con `Manual Trigger`, no con `Execute Workflow Trigger`, pero igual reciben los datos del llamador — confirmado probando en vivo). Salida normal (índice 0) → `Postgres: Mark Success`. Salida de error (índice 1) → `Postgres: Mark Failed`.

8. **`Postgres: Mark Success`** — `UPDATE mailing.analysis_jobs SET status='success', finished_at=now(), current_stage=NULL, fetch_run_id=$2::bigint, chart_id=$3::bigint WHERE job_id=$1::uuid;`, con `job_id` tomado de `$('Set: Flatten Parameters').item.json.job_id` (la referencia cruzada atraviesa el `Execute Workflow` sin problema, confirmado probando en vivo). `fetch_run_id` sale de `$json.run_id || null` (el `RETURNING run_id` del último nodo Postgres de `01`/`02`/`03`/`05`/`09`) y `chart_id` de `$json.chart_id || null` (el `RETURNING chart_id` del único branch de `04` que corrió — timeline o histograma, son mutuamente excluyentes dentro de una misma ejecución). Para cualquier `job_type` que no produzca ese campo, queda `null` — mismo patrón para ambos, agregado 2026-07-17 para que el job de `generate_activity_charts` sepa qué gráfico generó y el backend pueda servirlo (ver nota técnica 22). **No propaga `processed_items`/`total_items` reales todavía** — los workflows `01`-`05` no devuelven ese dato de forma fácil de leer desde acá (su último nodo es un `UPDATE` sin `SELECT` de vuelta); queda como mejora futura, no bloqueante para esta fase.

9. **`Postgres: Mark Failed`** — `UPDATE mailing.analysis_jobs SET status='failed', finished_at=now(), error_code='execute_workflow_error', error_message=$1 WHERE job_id=$2::uuid;`. `error_message` sale de `$json.error` — así es como n8n entrega el mensaje de error en la salida de error de `Execute Workflow` (un string plano, no un objeto `.message`; confirmado probando en vivo). Se trunca a 2000 caracteres por las dudas.

**Verificado en vivo, extremo a extremo, contra la instancia real:** los 6 `job_type` fueron creados vía `POST /api/jobs` real (sin tocar el webhook a mano). `fetch_sent_items`, `discover_mail_folders` y `fetch_cr_attachments` llegaron a `success` con datos **reales** del buzón conectado (100 mensajes reales, 83 carpetas reales, 5 correos + 4 adjuntos reales con trazabilidad CR, respectivamente); `generate_activity_charts` llegó a `success` con datos de prueba (PNG real generado, fila en `mailing.chart_runs`).

---

## 08 — Download Attachment

Archivo: `08-mailingai-download-attachment.json`

Trae el **contenido real** (no solo metadatos) de un adjunto puntual, a pedido directo del backend cuando el usuario hace clic en "Descargar" en el frontend. A diferencia del `07`, este webhook es **síncrono**: el backend espera la respuesta completa antes de devolverle algo al navegador — no hay patrón de "responder ya y seguir en segundo plano" acá, porque el usuario está esperando el archivo.

1. **`Webhook`** — `POST /webhook/download-attachment`, misma credencial `MailingAI Webhook Secret` que el `07`. `responseMode: "lastNode"` (no `"responseNode"` como en `07`) — significa "esperá a que termine todo el workflow y devolvé lo que haya dejado el último nodo", el modo síncrono nativo de n8n para este caso. Body esperado: `{"message_id": "...", "attachment_id": "..."}`.

2. **`Graph: Get Attachment Content`** — `GET /me/messages/{message_id}/attachments/{attachment_id}`. A diferencia de `Graph: List Message Attachments` (workflow 05, que solo trae metadatos con `$select=id,name,contentType,size`), acá no se restringe el `$select` — Graph devuelve el objeto completo del adjunto, incluido `contentBytes` (el archivo real, en base64).

3. **`Set: Shape Response`** — deja solo `{content_base64, content_type, file_name}` como salida final, que es literalmente lo que el backend recibe como cuerpo de la respuesta HTTP (por el `responseMode: "lastNode"` del paso 1).

El backend (`GET /api/messages/{message_id}/attachments/{attachment_id}/download`) decodifica el base64 y devuelve el archivo real al navegador, con `Content-Type` correcto y `Content-Disposition` armado con el patrón RFC 6266 (nombre en Latin-1 como respaldo + variante UTF-8 percent-encoded) — necesario porque los nombres reales de adjuntos suelen tener tildes/guiones largos, que rompen el header si se mandan tal cual (ver bug real documentado abajo).

**Verificado en vivo:** descarga real de un PDF real de 77.277 bytes (`%PDF-1.4` válido), con nombre de archivo real con tilde y guión largo.

---

## 09 — Search Attachments (carpetas + patrón)

Archivo: `09-mailingai-search-attachments.json`

A pedido del usuario: "buscar adjuntos sin importar el formato, eligiendo una o varias carpetas (árbol) y con un patrón opcional (regex o texto libre)". A diferencia de `05` (fijo a Enviados + keyword + un allow-list de formatos), este workflow recibe `folder_ids` (array), `pattern` (opcional), `pattern_is_regex` (booleano) y, desde el ajuste posterior, `date_from`/`date_to` opcionales — y no filtra por extensión en absoluto.

1. **`Manual Trigger` → `Set: Parametros`** — normaliza `folder_ids` (default `[]`), `pattern` (default vacío = sin filtro), `pattern_is_regex` (default `false`), `top` (default 200 por carpeta), `date_from`/`date_to` (default vacío = sin límite de fechas).
2. **`Postgres: Insert fetch_runs`** — un solo registro de corrida para todas las carpetas juntas (`folder` = la lista de ids separada por comas, `filter_description` describe el patrón usado).
3. **`Set: Merge run_id` → `Split Out Folders`** — separa el array `folder_ids` en N items, uno por carpeta, cada uno conservando el `run_id` (necesita `include: "allOtherFields"`, ver nota técnica 19 — sin eso el `run_id` se pierde en silencio).
4. **`Set: Build Subworkflow Input` → `Execute: 00 Graph Fetch (por carpeta)`** — reutiliza el subworkflow `00` (el mismo que usan `01`/`02`/`03`) una vez por carpeta seleccionada. Si hay `date_from`/`date_to`, arma `filter: 'receivedDateTime ge ... and receivedDateTime le ...'` (sin `$search`, así que no choca con la incompatibilidad `$filter`+`$search` de Graph). `alwaysOutputData: true` para que el resto del workflow corra aunque alguna carpeta (o todas) no tenga mensajes nuevos.
5. **`Postgres: Query Mensajes Con Adjuntos`** — en vez de encadenar la cuenta de resultados a través de todo el fan-out por carpeta (frágil, ver nota 15/18), se re-consulta directo a Postgres por `run_id` los mensajes con `has_attachments = true` — así el resultado final no depende de cuántas carpetas tuvieron mensajes nuevos. `alwaysOutputData: true` también acá.
6. **`Filter: Es Mensaje Real` + `Aggregate: Matched Count`** — mismo patrón de dos ramas que la nota 18: una rama real (sigue a listar adjuntos) y una rama de conteo que siempre corre y alimenta `Postgres: Update fetch_runs`.
7. **`Graph: List Message Attachments`** (por mensaje, con `batching` 1/seg + `retryOnFail`, igual que `05` tras la nota 16) **→ `Set: Parse Attachment Name`** — a diferencia de `05`, **no hay allow-list de extensiones**: cualquier formato pasa.
8. **`matches_search_pattern`** (calculado dentro de `Set: Parse Attachment Name`) — si `pattern` está vacío, siempre `true`. Si `pattern_is_regex`, evalúa `new RegExp(pattern, 'i').test(file_name)` (con `try/catch` — un regex inválido no rompe el workflow, simplemente no matchea nada). Si no es regex, es un `includes` case-insensitive. **No filtra**: el adjunto se guarda igual, matcheado o no (ver nota técnica 21) — antes había un `Filter: Coincide Con Patrón` acá que descartaba los que no matcheaban, quedando indistinguibles de un adjunto nunca trazado.
9. **`Postgres: Upsert mailing.message_attachments`** — igual que `05`, mismo esquema (incluye `matches_naming_convention` calculado con el mismo heurístico `YYYYMMDD`, independiente del patrón de búsqueda del usuario).

**Verificado en vivo** contra 2 carpetas reales del buzón ("Cristian Henriquez", "Kevin", 41 mensajes combinados): sin patrón encontró 31 adjuntos de 6 formatos distintos (jpg, csv, xlsx, png, pdf, pptx) sin filtrar ninguno por extensión; con patrón regex `\.xlsx$` encontró exactamente los 3 `.xlsx` reales; con patrón de texto libre `checklist` (sin regex) encontró exactamente el único archivo cuyo nombre lo contiene. `GET /api/jobs/{id}/messages` devuelve los adjuntos agrupados correctamente por mensaje (no una lista plana sin contexto). Con rango de fechas real (mayo 2026) sobre "Elementos enviados": 77 mensajes reales, 16 con adjuntos, 40 adjuntos guardados — ver nota técnica 20 sobre el bug de `$orderby` que hubo que resolver primero en el subworkflow `00`.

---

## Credenciales que usan estos workflows

- **`MailingAI Graph OAuth2`** (`oAuth2Api`) — usada por `Graph: List Messages` (subworkflow 00), en el workflow 05 por `Graph: List Sent With Attachments` y `Graph: List Message Attachments`, en el workflow 06 por los tres nodos `Graph: List Level N Folders`, y en el workflow 09 por `Graph: List Message Attachments`.
- **`MailingAI Postgres`** (`postgres`) — usada por todos los nodos `Postgres: *` en los 10 workflows.
- **`MailingAI Webhook Secret`** (`httpHeaderAuth`) — usada por el nodo `Webhook` del workflow 07, para validar el header `X-MailingAI-Secret` que manda el backend.

Las tres quedan pre-enlazadas por `id` cuando se importan con `scripts/import-n8n.sh` / `n8n/import.sh` (ver README de la raíz del proyecto).
