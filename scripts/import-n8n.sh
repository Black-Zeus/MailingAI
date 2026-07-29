#!/bin/sh
# Dispara la importacion de credenciales y workflows de MailingAI DENTRO del
# contenedor mailingai_n8n.
#
# Este script no hace ninguna logica propia de importacion: solo verifica que
# el contenedor n8n este corriendo y ejecuta n8n/import.sh dentro de el
# (via "docker compose exec"). Toda la logica real (crear la carpeta de
# credenciales, generar plantillas, validar placeholders, importar y publicar
# con la CLI de n8n) vive en n8n/import.sh y corre en el contenedor.
#
# Una unica accion si ocurre en el host: si se importaron workflows, este
# script reinicia el contenedor n8n al final (`docker compose restart n8n`).
# Es necesario porque `n8n publish:workflow` no toma efecto en una instancia
# que ya esta corriendo hasta que se reinicia (asi lo indica la propia CLI).
#
# Uso:
#   ./scripts/import-n8n.sh [--force] [--skip-credentials] [--skip-workflows]

set -e

FORCE=0
SKIP_CREDENTIALS=0
SKIP_WORKFLOWS=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --skip-credentials) SKIP_CREDENTIALS=1 ;;
    --skip-workflows) SKIP_WORKFLOWS=1 ;;
    *)
      echo "Argumento desconocido: $arg" >&2
      exit 1
      ;;
  esac
done

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

running=$(docker compose ps --status running --services 2>/dev/null || true)
if ! printf '%s\n' "$running" | grep -qx "n8n"; then
  echo "El contenedor n8n no esta corriendo. Ejecuta 'docker compose up -d' primero." >&2
  exit 1
fi

container_args=""
[ "$FORCE" -eq 1 ] && container_args="$container_args --force"
[ "$SKIP_CREDENTIALS" -eq 1 ] && container_args="$container_args --skip-credentials"
[ "$SKIP_WORKFLOWS" -eq 1 ] && container_args="$container_args --skip-workflows"

set +e
docker compose exec -T n8n sh /import/import.sh $container_args
import_exit_code=$?
set -e

if [ "$import_exit_code" -eq 0 ] && [ "$SKIP_WORKFLOWS" -eq 0 ]; then
  echo ""
  echo "Reiniciando n8n para que los workflows publicados (Execute Workflow entre ellos, webhooks) queden activos ..."
  docker compose restart n8n
  echo "n8n reiniciado."
fi

exit "$import_exit_code"
