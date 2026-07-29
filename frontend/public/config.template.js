// Plantilla renderizada en tiempo de arranque del contenedor (no en build) por
// docker-entrypoint.d/40-render-runtime-config.sh, via envsubst. En dev local
// (npm run dev) este archivo se sirve tal cual, sin sustituir -- por eso
// index.html apunta a /config.js (que solo existe una vez renderizado), no a
// este archivo directamente.
window.__MAILINGAI_CONFIG__ = {
  apiUrl: "${API_URL}",
};
