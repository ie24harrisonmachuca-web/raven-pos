param([string]$Node=(Get-Command node -ErrorAction Stop).Source)
$project=Split-Path $PSScriptRoot -Parent
$action=New-ScheduledTaskAction -Execute $Node -Argument ('"'+(Join-Path $PSScriptRoot 'backup-daily.mjs')+'"') -WorkingDirectory $project
$trigger=New-ScheduledTaskTrigger -Daily -At '23:00'
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'RavenPOS-RespaldoDiario' -Action $action -Trigger $trigger -Settings $settings -Description 'Raven POS: respaldo remoto privado con SHA256 y retencion 30 copias' -Force
# La hora utiliza la zona horaria del equipo; configurarla a America/Lima (UTC-5).
