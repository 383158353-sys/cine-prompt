$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'CinePrompt'
$pluginRoot = Join-Path $env:APPDATA 'Adobe\UXP\Plugins\External\com.local.lk888.psedit'
$startupFile = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\CinePrompt Connector.cmd'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\CinePrompt'
$pidFile = Join-Path $installRoot 'cine-prompt.pid'

if (Test-Path -LiteralPath $pidFile) {
    $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq 'node' -and $process.Path.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $processId -Force
    }
}

$backupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('CinePrompt-Backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$dataRoot = Join-Path $installRoot 'app\local-data'
$envFile = Join-Path $installRoot 'app\.env.local'
if ((Test-Path -LiteralPath $dataRoot) -or (Test-Path -LiteralPath $envFile)) {
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    if (Test-Path -LiteralPath $dataRoot) { Copy-Item -LiteralPath $dataRoot -Destination $backupRoot -Recurse -Force }
    if (Test-Path -LiteralPath $envFile) { Copy-Item -LiteralPath $envFile -Destination $backupRoot -Force }
    Write-Host "User data was backed up to: $backupRoot"
}

if (Test-Path -LiteralPath $startupFile) { Remove-Item -LiteralPath $startupFile -Force }
if (Test-Path -LiteralPath $pluginRoot) { Remove-Item -LiteralPath $pluginRoot -Recurse -Force }
if (Test-Path -LiteralPath $startMenu) { Remove-Item -LiteralPath $startMenu -Recurse -Force }
if (Test-Path -LiteralPath $installRoot) { Remove-Item -LiteralPath $installRoot -Recurse -Force }
Write-Host 'CinePrompt connector and Photoshop plugin were uninstalled.' -ForegroundColor Green
