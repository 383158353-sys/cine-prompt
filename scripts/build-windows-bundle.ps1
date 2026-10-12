param(
    [string]$PluginSource = $env:PS_PLUGIN_SOURCE
)

$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = Join-Path $taskRoot 'release'
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'CinePrompt-Photoshop-Windows-stage'
$payloadRoot = Join-Path $stageRoot 'payload'
$appStage = Join-Path $payloadRoot 'app'
$pluginStage = Join-Path $payloadRoot 'plugin'
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (!$npmCmd -and (Test-Path -LiteralPath 'C:\Program Files\nodejs\npm.cmd')) { $npmCmd = 'C:\Program Files\nodejs\npm.cmd' }
if (!$nodeExe -and (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe')) { $nodeExe = 'C:\Program Files\nodejs\node.exe' }
if (!$npmCmd -or !$nodeExe) { throw 'Node.js/npm was not found. Install Node.js 22+ on the build machine.' }

if ([string]::IsNullOrWhiteSpace($PluginSource)) {
    $defaultPlugin = 'D:\PS2025\ps-local-edit\plugin'
    if (Test-Path -LiteralPath $defaultPlugin) { $PluginSource = $defaultPlugin }
}
if ([string]::IsNullOrWhiteSpace($PluginSource) -or !(Test-Path -LiteralPath $PluginSource)) {
    throw 'Photoshop plugin source was not found. Set PS_PLUGIN_SOURCE to ps-local-edit\plugin.'
}
$PluginSource = (Resolve-Path -LiteralPath $PluginSource).Path
if (!(Test-Path -LiteralPath (Join-Path $PluginSource 'manifest.json'))) {
    throw 'PS_PLUGIN_SOURCE is not a valid plugin directory.'
}
if (!$releaseRoot.StartsWith($taskRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The release directory must stay inside the project.'
}
if ($stageRoot -ne (Join-Path ([System.IO.Path]::GetTempPath()) 'CinePrompt-Photoshop-Windows-stage')) {
    throw 'Unexpected package staging directory.'
}

& $npmCmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $appStage, $pluginStage | Out-Null

Copy-Item -LiteralPath (Join-Path $taskRoot 'package.json') -Destination $appStage
Copy-Item -LiteralPath (Join-Path $taskRoot 'package-lock.json') -Destination $appStage
Copy-Item -LiteralPath (Join-Path $taskRoot '.env.example') -Destination $appStage
Copy-Item -LiteralPath (Join-Path $taskRoot 'dist') -Destination $appStage -Recurse
Copy-Item -LiteralPath (Join-Path $taskRoot 'server') -Destination $appStage -Recurse
Get-ChildItem -LiteralPath $PluginSource -Force | Copy-Item -Destination $pluginStage -Recurse -Force

& $npmCmd ci --omit=dev --no-audit --no-fund --prefix $appStage
if ($LASTEXITCODE -ne 0) { throw 'Portable runtime dependency install failed.' }

Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $appStage 'node.exe')
Get-ChildItem -LiteralPath (Join-Path $taskRoot 'installer\windows') -Force | Copy-Item -Destination $stageRoot -Recurse -Force

$archivePath = Join-Path $releaseRoot 'CinePrompt-Photoshop-Windows.zip'
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
& tar.exe -a -c -f $archivePath -C $stageRoot .
if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed.' }

$manifestText = [System.IO.File]::ReadAllText((Join-Path $pluginStage 'manifest.json'), [System.Text.Encoding]::UTF8)
$manifest = $manifestText | ConvertFrom-Json
$size = (Get-Item -LiteralPath $archivePath).Length
$result = [pscustomobject]@{
    Package = $archivePath
    Bytes = $size
    PluginVersion = $manifest.version
    NodeVersion = (& $nodeExe --version)
}
Remove-Item -LiteralPath $stageRoot -Recurse -Force
$result
