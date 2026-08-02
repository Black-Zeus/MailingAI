#!/bin/sh
# Corre DENTRO del contenedor mailingai_n8n (montado en /import/import.sh).
# Crea las plantillas de credencial si faltan, valida que la de Graph ya no
# tenga placeholders, e importa credenciales + workflows con la CLI de n8n.
#
# Uso (desde el host):
#   docker compose exec -T n8n sh /import/import.sh [--force] [--skip-credentials] [--skip-workflows]

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

CRED_DIR=/import/credentials
WF_DIR=/import/workflows
POSTGRES_CRED="$CRED_DIR/mailingai-postgres.json"
GRAPH_CRED="$CRED_DIR/mailingai-graph-oauth2.json"

mkdir -p "$CRED_DIR"

if [ ! -f "$POSTGRES_CRED" ]; then
  cat > "$POSTGRES_CRED" << 'JSON'
{
  "id": "cred0001postgres000",
  "name": "MailingAI Postgres",
  "type": "postgres",
  "data": {
    "host": "postgres",
    "port": 5432,
    "database": "mailingai",
    "user": "mailingai",
    "password": "mailingai_password_change_me",
    "allowUnauthorizedCerts": false,
    "ssl": "disable"
  }
}
JSON
  echo "Plantilla creada: n8n/credentials/mailingai-postgres.json"
  echo "  -> si cambiaste POSTGRES_PASSWORD en .env, actualiza 'password' ahi tambien."
fi

if [ ! -f "$GRAPH_CRED" ]; then
  cat > "$GRAPH_CRED" << 'JSON'
{
  "id": "cred0002graphoauth2",
  "name": "MailingAI Graph OAuth2",
  "type": "oAuth2Api",
  "data": {
    "grantType": "authorizationCode",
    "authUrl": "https://login.microsoftonline.com/REEMPLAZA_CON_TU_TENANT_ID/oauth2/v2.0/authorize",
    "accessTokenUrl": "https://login.microsoftonline.com/REEMPLAZA_CON_TU_TENANT_ID/oauth2/v2.0/token",
    "clientId": "REEMPLAZA_CON_TU_CLIENT_ID",
    "clientSecret": "REEMPLAZA_CON_TU_CLIENT_SECRET",
    "scope": "openid profile offline_access User.Read Mail.Read",
    "authQueryParameters": "",
    "authentication": "body"
  }
}
JSON
  echo "Plantilla creada: n8n/credentials/mailingai-graph-oauth2.json"
  echo "  -> editala desde el host (ver README.md) con los datos reales de tu App Registration."
  echo "  -> usa el tipo generico 'OAuth2 API' (no el 'Microsoft OAuth2 API' nativo de n8n): ese"
  echo "     pega siempre contra /common, que falla con AADSTS50194 en apps single-tenant."
fi

if [ "$SKIP_CREDENTIALS" -eq 0 ]; then
  if grep -q "REEMPLAZA_CON_TU_" "$GRAPH_CRED" && [ "$FORCE" -eq 0 ]; then
    echo "AVISO: n8n/credentials/mailingai-graph-oauth2.json todavia tiene valores de ejemplo (REEMPLAZA_CON_TU_...)." >&2
    echo "Editala desde el host y vuelve a correr el import. (--force para importar igual, solo para probar el mecanismo)" >&2
    exit 1
  fi

  echo ""
  echo "Importando credenciales desde $CRED_DIR ..."
  n8n import:credentials --separate --input="$CRED_DIR"
fi

if [ "$SKIP_WORKFLOWS" -eq 0 ]; then
  echo ""
  echo "Importando workflows desde $WF_DIR ..."
  n8n import:workflow --separate --input="$WF_DIR"

  echo ""
  echo "Publicando workflows (necesario para que se puedan invocar entre si via Execute Workflow y para que los webhooks queden activos) ..."
  for id in maiw0001subworkflow maiw0002sentitems00 maiw0003msgseries00 maiw0004related0000 maiw0005charts00000 maiw0006crattach000 maiw0007executejob00 maiw0008folders000 maiw0009download00 maiw0010search000 maiw0011retrace000 maiw0012errorhandl0 maiw0013sendemail00 maiw0014cleancharts maiw0015reviewremind maiw0016mailboxdelta; do
    if ! n8n publish:workflow --id="$id"; then
      echo "AVISO: no se pudo publicar $id (¿se importo correctamente?)" >&2
    fi
  done

  echo ""
  echo "Organizando los workflows dentro de la carpeta 'MailingAI' en n8n ..."
  if ! sh /import/create-folder.sh; then
    echo "AVISO: no se pudo crear/asignar la carpeta 'MailingAI'. Los workflows quedaron importados igual, solo sin agrupar en la carpeta." >&2
  fi
fi

echo ""
echo "Listo. Abre n8n (http://localhost:5680) y revisa:"
echo "  1. Credentials -> 'MailingAI Graph OAuth2' -> Connect my account (una vez, para completar el consentimiento OAuth2 con tu cuenta real)."
echo "  2. Que los nodos Postgres / HTTP Request de los workflows importados ya muestren la credencial correcta (quedan pre-enlazadas por id)."
echo "  3. Los workflows quedan agrupados en la carpeta 'MailingAI', numerados en el orden en que se usan normalmente (00 es el subworkflow interno, no se ejecuta directo)."
echo "  4. Prueba primero '01 - MailingAI - Fetch Sent Items' paso a paso (Test step) antes de dejarlo en produccion."
echo ""
echo "Volver a correr este import es seguro: credenciales y workflows tienen id fijo, se actualizan en vez de duplicarse."
