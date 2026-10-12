$ErrorActionPreference = 'Stop'
$bundleRoot = Split-Path -Parent $PSScriptRoot
$payloadRoot = Join-Path $bundleRoot 'payload'
$installRoot = Join-Path $env:LOCALAPPDATA 'CinePrompt'
$appRoot = Join-Path $installRoot 'app'
$pluginRoot = Join-Path $env:APPDATA 'Adobe\UXP\Plugins\External\com.local.lk888.psedit'
$startupFile = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\CinePrompt Connector.cmd'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\CinePrompt'

if (!(Test-Path -LiteralPath (Join-Path $payloadRoot 'app\node.exe'))) { throw 'The installer is incomplete: local runtime is missing.' }
if (!(Test-Path -LiteralPath (Join-Path $payloadRoot 'plugin\manifest.json'))) { throw 'The installer is incomplete: Photoshop plugin is missing.' }

New-Item -ItemType Directory -Force -Path $appRoot, $pluginRoot, (Join-Path $installRoot 'installer'), $startMenu | Out-Null
Get-ChildItem -LiteralPath (Join-Path $payloadRoot 'app') -Force | Copy-Item -Destination $appRoot -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $payloadRoot 'plugin') -Force | Copy-Item -Destination $pluginRoot -Recurse -Force
Get-ChildItem -LiteralPath $PSScriptRoot -Force | Copy-Item -Destination (Join-Path $installRoot 'installer') -Recurse -Force

$startScript = Join-Path $installRoot 'installer\start-cine-prompt.ps1'
$startupCommand = '@echo off' + [Environment]::NewLine + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '" -NoBrowser'
Set-Content -LiteralPath $startupFile -Value $startupCommand -Encoding ascii

$shell = New-Object -ComObject WScript.Shell
$openShortcut = $shell.CreateShortcut((Join-Path $startMenu 'Open CinePrompt.lnk'))
$openShortcut.TargetPath = 'powershell.exe'
$openShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $startScript + '"'
$openShortcut.WorkingDirectory = $installRoot
$openShortcut.Save()
$uninstallShortcut = $shell.CreateShortcut((Join-Path $startMenu 'Uninstall.lnk'))
$uninstallShortcut.TargetPath = 'powershell.exe'
$uninstallShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $installRoot 'installer\uninstall.ps1') + '"'
$uninstallShortcut.WorkingDirectory = $installRoot
$uninstallShortcut.Save()

& $startScript
Write-Host ''
Write-Host 'Installation complete. Restart Photoshop and open the Local Image Editor plugin.' -ForegroundColor Green
Write-Host 'On first use, open API Settings in CinePrompt and save your API configuration.'
