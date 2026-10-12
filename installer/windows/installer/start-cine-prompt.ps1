param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$installRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $installRoot 'app'
$nodeExe = Join-Path $appRoot 'node.exe'
$healthUrl = 'http://127.0.0.1:5173/api/bridge/health'
$headers = @{'X-Cine-Bridge'='1'; 'Origin'='uxp://com.local.lk888.psedit'}

function Test-CinePrompt {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -Headers $headers -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}

if (!(Test-CinePrompt)) {
    if (!(Test-Path -LiteralPath $nodeExe)) { throw 'CinePrompt runtime is incomplete. Reinstall the connector.' }
    $logDir = Join-Path $installRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $process = Start-Process -FilePath $nodeExe -ArgumentList 'server/index.mjs' -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log')
    Set-Content -LiteralPath (Join-Path $installRoot 'cine-prompt.pid') -Value $process.Id -Encoding ascii
    foreach ($attempt in 1..30) {
        Start-Sleep -Milliseconds 500
        if (Test-CinePrompt) { break }
        if ($process.HasExited) { throw 'CinePrompt failed to start. Check logs\server-error.log.' }
    }
    if (!(Test-CinePrompt)) { throw 'CinePrompt startup timed out. Restart or reinstall the connector.' }
}

if (!$NoBrowser) { Start-Process 'http://127.0.0.1:5173' }
