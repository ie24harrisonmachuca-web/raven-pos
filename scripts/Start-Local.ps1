param([ValidateRange(1024,65535)][int]$Port=4180)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$nodeCommand=Get-Command node -ErrorAction Stop
$versionText=& $nodeCommand.Source --version
$version=[version]($versionText.TrimStart('v'))
if($version -lt [version]'24.14.0'){ throw 'Instala Node.js 24.14 o superior antes de ejecutar Raven POS.' }
Push-Location -LiteralPath $projectRoot
try {
  $env:PORT=[string]$Port
  $env:HOST='127.0.0.1'
  $env:PUBLIC_ORIGIN='http://127.0.0.1:'+ $Port
  $dataRoot=if($env:DATA_DIR){$env:DATA_DIR}else{Join-Path $projectRoot '.data'}
  if(-not (Test-Path -LiteralPath (Join-Path $dataRoot 'registry.sqlite'))) {
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'setup.mjs')
    if($LASTEXITCODE -ne 0){throw 'No se pudo preparar la instalación local.'}
  }
  Write-Host ('Raven POS local: '+$env:PUBLIC_ORIGIN)
  Write-Host 'Deja esta consola abierta. Pulsa Ctrl+C para detener el servidor.'
  & $nodeCommand.Source (Join-Path $projectRoot 'server/index.mjs')
} finally { Pop-Location }
