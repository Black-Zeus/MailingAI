/** Convierte un valor de <input type="date"> ("YYYY-MM-DD") al instante ISO
 * real del inicio de ese día en la zona horaria local del navegador.
 *
 * OJO: `new Date("YYYY-MM-DD")` interpreta la fecha como medianoche UTC, no
 * medianoche local -- para alguien en Chile eso corre el día completo (queda
 * la tarde/noche del día anterior según la hora del año). Por eso se arma la
 * fecha con año/mes/día explícitos (interpretación local) antes de convertir. */
export function toStartOfDayISO(value: string): string {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}

/** Igual que toStartOfDayISO pero al final del día (23:59:59.999 local) --
 * sin esto, un rango "hasta el 30" excluye todos los mensajes del día 30
 * salvo los de exactamente medianoche. */
export function toEndOfDayISO(value: string): string {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}
