#!/bin/sh
# Corre DENTRO del contenedor mailingai_n8n (montado en /import/create-folder.sh).
# Crea (o reutiliza) una carpeta "MailingAI" en el proyecto personal de n8n y
# mueve ahi los workflows importados por import.sh.
#
# La CLI de n8n no tiene un comando para crear/asignar carpetas, asi que este
# script instala el driver "pg" al vuelo (una vez por contenedor, en /tmp) y
# se conecta directo a Postgres reusando las mismas variables de entorno que
# ya usa n8n para su propia base de datos (DB_POSTGRESDB_*). No agrega ni
# necesita ningun secreto nuevo.

set -e

PG_CLIENT_DIR=/tmp/mailingai-pg-client

if [ ! -d "$PG_CLIENT_DIR/node_modules/pg" ]; then
  npm install pg --no-save --prefix "$PG_CLIENT_DIR" --silent
fi

NODE_PATH="$PG_CLIENT_DIR/node_modules" node << 'JS'
const { Client } = require('pg');

const FOLDER_ID = 'mailingaifolder0000';
const FOLDER_NAME = 'MailingAI';
const WORKFLOW_IDS = [
  'maiw0001subworkflow',
  'maiw0002sentitems00',
  'maiw0003msgseries00',
  'maiw0004related0000',
  'maiw0005charts00000',
  'maiw0006crattach000',
  'maiw0007executejob00',
  'maiw0008folders000',
  'maiw0009download00',
  'maiw0010search000',
  'maiw0011retrace000',
  'maiw0012errorhandl0',
  'maiw0013sendemail00',
];

// Los workflows 07, 08, 10 y 12 son los unicos con webhook propio del proyecto:
// import:workflow siempre deja los workflows importados como inactive (salvo
// --activeState=fromJson, que no usamos), asi que hay que reactivarlos a mano
// para que sus webhooks queden registrados. El 11 (Error Trigger, sin webhook)
// tambien se activa por las dudas -- no hay confirmacion documentada de que
// n8n dispare un errorWorkflow inactivo, y activarlo de mas no tiene costo.
// Los demas (00-06, 09) se mantienen inactive a proposito: se disparan a mano
// o via Execute Workflow, no tienen trigger propio.
const WORKFLOW_IDS_TO_ACTIVATE = [
  'maiw0007executejob00',
  'maiw0009download00',
  'maiw0011retrace000',
  'maiw0012errorhandl0',
  'maiw0013sendemail00',
];

async function main() {
  const client = new Client({
    host: process.env.DB_POSTGRESDB_HOST,
    port: Number(process.env.DB_POSTGRESDB_PORT || 5432),
    database: process.env.DB_POSTGRESDB_DATABASE,
    user: process.env.DB_POSTGRESDB_USER,
    password: process.env.DB_POSTGRESDB_PASSWORD,
  });
  await client.connect();

  try {
    const { rows: projects } = await client.query(
      `SELECT id FROM project WHERE type = 'personal' ORDER BY "createdAt" ASC LIMIT 1`
    );
    if (projects.length === 0) {
      throw new Error('No se encontro un project personal en n8n (completa el asistente de owner primero).');
    }
    const projectId = projects[0].id;

    await client.query(
      `INSERT INTO folder (id, name, "parentFolderId", "projectId", "createdAt", "updatedAt")
       VALUES ($1, $2, NULL, $3, now(), now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "projectId" = EXCLUDED."projectId", "updatedAt" = now()`,
      [FOLDER_ID, FOLDER_NAME, projectId],
    );

    const result = await client.query(
      `UPDATE workflow_entity SET "parentFolderId" = $1 WHERE id = ANY($2::varchar[])`,
      [FOLDER_ID, WORKFLOW_IDS],
    );

    await client.query(
      `UPDATE workflow_entity SET active = true WHERE id = ANY($1::varchar[])`,
      [WORKFLOW_IDS_TO_ACTIVATE],
    );

    console.log(`Carpeta "${FOLDER_NAME}" lista (proyecto ${projectId}). Workflows agrupados: ${result.rowCount}.`);
    console.log(`Workflows reactivados (webhooks): ${WORKFLOW_IDS_TO_ACTIVATE.join(', ')}. Recuerda que import.sh reinicia n8n despues para que tome efecto.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error creando/asignando la carpeta MailingAI:', err.message);
  process.exit(1);
});
JS
