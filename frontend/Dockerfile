FROM node:22.13.1-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG VITE_API_URL=http://localhost:8001
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# Variante no-root de la imagen oficial: corre nginx con el usuario "nginx"
# desde el arranque (la imagen nginx:*-alpine normal arranca como root para
# poder bindear el puerto 80, y recien baja privilegios para los workers) --
# bindea 8080 en vez de 80, por eso el proxy la referencia en ese puerto.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# La imagen base ya deja USER nginx seteado -- para poder copiar/ajustar
# permisos hace falta volver a root un momento (COPY/RUN corren como el
# usuario activo en ese punto del Dockerfile, no como root por defecto).
USER root

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.d/40-render-runtime-config.sh /docker-entrypoint.d/40-render-runtime-config.sh
# El entrypoint (corriendo como el usuario no-root de esta imagen) escribe
# config.js en este directorio en cada arranque -- sin este chown, COPY deja
# los archivos con el dueño del build stage y esa escritura falla en runtime.
RUN chmod +x /docker-entrypoint.d/40-render-runtime-config.sh \
    && chown -R nginx:nginx /usr/share/nginx/html

USER nginx

EXPOSE 8080
