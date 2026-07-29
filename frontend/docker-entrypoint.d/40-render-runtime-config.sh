#!/bin/sh
# Renderiza config.template.js -> config.js con el API_URL real de este contenedor,
# en tiempo de arranque (no en build) -- para poder cambiar a que backend apunta el
# frontend sin reconstruir la imagen, solo cambiando la variable de entorno API_URL
# y reiniciando el contenedor (docker compose up -d frontend).
#
# La imagen oficial de nginx corre automaticamente todo *.sh ejecutable en
# /docker-entrypoint.d/ (orden alfabetico) antes de arrancar nginx -- este script
# sigue esa convencion en vez de sobreescribir el ENTRYPOINT de la imagen.
set -e

: "${API_URL:=http://localhost:8001}"

envsubst '${API_URL}' \
  < /usr/share/nginx/html/config.template.js \
  > /usr/share/nginx/html/config.js
