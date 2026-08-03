# ¿Qué es MailingAI?

MailingAI es un panel para dar seguimiento a correos importantes de uno o varios buzones de trabajo (Outlook/Microsoft 365) sin tener que buscarlos manualmente cada vez. Trae localmente los correos de los buzones conectados, agrupa los que están relacionados en **expedientes**, y ayuda a un equipo a hacerles seguimiento hasta cerrarlos — con un resumen generado por IA como apoyo, no como reemplazo del criterio de quien revisa.

## ¿Para qué sirve?

- Evitar perder de vista correos que requieren respuesta o acción, agrupándolos por caso en vez de por bandeja de entrada.
- Dejar un registro (línea de tiempo, notas, evidencia, quién cambió qué) de cómo se resolvió cada caso.
- Repartir el trabajo: un expediente se puede compartir con otra persona del equipo, con permiso de solo ver o de editar.
- Avisar automáticamente cuando algo necesita atención: un análisis de IA que terminó, un expediente cuya fecha de revisión venció, un buzón que sincronizó correos nuevos.

## Ingresar

Dos formas de entrar, según cómo te dio de alta el administrador:

- **Con tu cuenta de Microsoft** ("Ingresar con Microsoft") — si tu cuenta está en el mismo tenant/organización que ya usa el sistema.
- **Con usuario y contraseña** (cuenta local) — el administrador te da un usuario y una contraseña temporal por fuera del sistema (nunca por correo automático); en tu primer ingreso el sistema te va a pedir cambiarla.

No hay registro por tu cuenta — si no puedes entrar, pídele a un administrador que te dé de alta.

## Las secciones del panel

- **Dashboard** — lo primero que ves al entrar: un resumen con conteos (expedientes abiertos, vencidos, sin analizar, etc.), para tener una foto general antes de entrar al detalle.
- **Expedientes** — la lista de casos armados a partir de correos relacionados. Desde acá se abre el detalle de cada uno: correos que lo componen, línea de tiempo, notas, evidencia adjunta, resumen de IA, y las acciones (cambiar conclusión, marcar seguimiento, compartir, reasignar dueño).
- **Mensajes** — los correos ya indexados, con filtros (remitente, asunto, fecha, carpeta). Desde acá también se puede armar un expediente nuevo a partir de un correo o hilo puntual.
- **Adjuntos** — trazabilidad de archivos adjuntos ya indexados (documentos, planillas, presentaciones, PDF, texto), con búsqueda por carpeta, texto o patrón de nombre — por ejemplo, los que siguen una convención relacionada a un código de caso.
- **Trabajos** — historial de las tareas que trajeron datos desde el buzón (cuándo corrieron, si fallaron, qué trajeron).
- **Configuración** *(solo administradores)* — buzones conectados, usuarios del sistema, remitente usado para notificaciones por correo. Oculto por completo para quien no es administrador.

## Expedientes: lo básico

- **Conclusión**: el estado final que un auditor le da al caso, elegido de una lista fija (pendiente, resuelto, escalado, etc.). La IA puede *sugerir* una, pero siempre hay que confirmarla a mano — nunca se guarda sola.
- **Próxima revisión**: una fecha opcional para "recordame revisar esto de nuevo". Si se vence estando el expediente abierto, te llega una notificación.
- **Compartir**: el dueño de un expediente (o un admin) puede darle acceso a otra persona, de solo lectura o de edición. Quien recibe acceso de edición no puede, a su vez, volver a compartirlo con alguien más — solo el dueño controla eso.
- **Edición simultánea**: si dos personas tienen abierto el mismo expediente y ambas guardan un cambio, a quien guarda segundo el sistema le avisa que el expediente cambió mientras tanto, para que recargue antes de perder o pisar el trabajo de la otra persona.
- **Notas y evidencia**: texto libre (con formato Markdown, ver más abajo) y archivos/enlaces adjuntos al caso, aparte de los correos que lo componen.

## Notificaciones

La campanita del panel lateral avisa de eventos como: te compartieron un expediente o un buzón, un análisis de IA terminó, un expediente tuyo tiene la revisión vencida, o una sincronización de buzones trajo correos nuevos. Si hay un remitente de notificaciones configurado (Configuración, solo admin), algunos de esos avisos también llegan por correo real: expedientes o buzones compartidos, cuentas creadas, análisis de IA terminados y sincronizaciones de buzones. Los recordatorios de revisión vencida, por ahora, se muestran solo dentro de la aplicación.

Al hacer clic en una notificación del listado se abre en un panel más grande, con el mensaje completo y la fecha exacta, y de paso queda marcada como leída. El botón "Limpiar notificaciones" (con confirmación previa) borra todo el historial de una vez, leídas y no leídas — no hay forma de recuperarlas después.

## Formato de texto (Markdown)

Los campos de texto largo (notas, seguimiento, cuerpo de correo al enviar un expediente) aceptan Markdown — junto a cada uno de esos campos hay un botón de ayuda (ícono "?") con una chuleta rápida: títulos, **negrita**, *cursiva*, listas, citas, bloques de código, enlaces y tablas simples.

## ¿Quién puede hacer qué?

| Acción | Usuario normal | Administrador |
|---|---|---|
| Ver/editar sus propios expedientes y los que le compartieron | Sí | Sí (además ve todos, de cualquier usuario) |
| Compartir un expediente propio | Sí | Sí |
| Conectar un buzón nuevo | No | Sí |
| Ver el módulo Configuración | No | Sí |
| Crear/desactivar/eliminar usuarios | No | Sí |
| Desconectar un buzón | No (ni siquiera el dueño) | Sí, con confirmación explícita |
| Reasignar el dueño de un expediente | No | Sí |

Si algo del panel no aparece o un botón está deshabilitado, en general es por permisos — consulta con tu administrador.
