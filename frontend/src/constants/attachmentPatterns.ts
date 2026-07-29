// Fragmentos con lookahead (?=...): se pueden combinar varios en la misma
// expresión sin que se "consuman" el texto entre sí, así se pueden activar
// más de uno a la vez (ej. fecha al inicio + extensión Office al final).
// Verificado que Postgres (~* con Advanced Regular Expressions) interpreta
// estos mismos fragmentos igual que el motor de regex de n8n/JavaScript.
export const ATTACHMENT_PATTERN_PRESETS: { label: string; fragment: string }[] = [
  { label: 'Fecha YYYYMMDD al inicio', fragment: '(?=^\\d{8})' },
  { label: 'Código CR/RFC (letras+números)', fragment: '(?=.*[A-Za-z]{2,6}-?\\d{3,6})' },
  { label: 'Extensión Office/PDF', fragment: '(?=.*\\.(pdf|docx?|xlsx?|pptx?)$)' },
]
