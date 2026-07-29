<#
.SYNOPSIS
  Dispara la importacion de credenciales y workflows de MailingAI DENTRO del
  contenedor mailingai_n8n.

.DESCRIPTION
  Este script no hace ninguna logica propia de importacion: solo verifica que
  el contenedor n8n este corriendo y ejecuta n8n/import.sh dentro de el
  (via "docker compose exec"). Toda la logica real (crear la carpeta de
  credenciales, generar plantillas, validar placeholders, importar y publicar
  con la CLI de n8n) vive en n8n/import.sh y corre en el contenedor.

  Una unica accion sí ocurre en el host: si se importaron workflows, este
  script reinicia el contenedor n8n al final (`docker compose restart n8n`).
  Es necesario porque `n8n publish:workflow` no toma efecto en una instancia
  que ya esta corriendo hasta que se reinicia (asi lo indica la propia CLI).

.PARAMETER Force
  Importa la credencial de Graph aunque todavia tenga valores de ejemplo.

.PARAMETER SkipCredentials
  No importa credenciales, solo workflows.

.PARAMETER SkipWorkflows
  No importa workflows, solo credenciales.

.EXAMPLE
  .\scripts\import-n8n.ps1
#>

param(
    [switch]$Force,
    [switch]$SkipCredentials,
    [switch]$SkipWorkflows
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
    $running = docker compose ps --status running --services 2>$null
    if (-not ($running -contains "n8n")) {
        Write-Error "El contenedor n8n no esta corriendo. Ejecuta 'docker compose up -d' primero."
        exit 1
    }

    $containerArgs = @()
    if ($Force) { $containerArgs += "--force" }
    if ($SkipCredentials) { $containerArgs += "--skip-credentials" }
    if ($SkipWorkflows) { $containerArgs += "--skip-workflows" }

    docker compose exec -T n8n sh /import/import.sh @containerArgs
    $importExitCode = $LASTEXITCODE

    if ($importExitCode -eq 0 -and -not $SkipWorkflows) {
        Write-Host "`nReiniciando n8n para que los workflows publicados (Execute Workflow entre ellos, webhooks) queden activos ..."
        docker compose restart n8n
        Write-Host "n8n reiniciado."
    }

    exit $importExitCode
}
finally {
    Pop-Location
}
