param([string]$PluginSource = $env:PS_PLUGIN_SOURCE)
$ErrorActionPreference = 'Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$npm=(Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if(!$npm -and (Test-Path -LiteralPath 'C:\Program Files\nodejs\npm.cmd')){$npm='C:\Program Files\nodejs\npm.cmd'}
if(!$npm){throw 'Node.js/npm was not found.'}
$nodeBin=Split-Path -Parent $npm
if(($env:Path -split ';') -notcontains $nodeBin){$env:Path=$nodeBin+';'+$env:Path}
if([string]::IsNullOrWhiteSpace($PluginSource)){$PluginSource='D:\PS2025\ps-local-edit\plugin'}
if(!(Test-Path -LiteralPath (Join-Path $PluginSource 'manifest.json'))){throw 'Photoshop plugin source was not found.'}
$stage=Join-Path $root 'desktop\package\ps-plugin'
if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Get-ChildItem -LiteralPath $PluginSource -Force | Copy-Item -Destination $stage -Recurse -Force
& $npm run build
if($LASTEXITCODE -ne 0){throw 'Frontend build failed.'}
& (Join-Path $root 'node_modules\.bin\electron-builder.cmd') --win nsis
if($LASTEXITCODE -ne 0){throw 'Desktop installer build failed.'}
Remove-Item -LiteralPath (Join-Path $root 'desktop\package') -Recurse -Force
