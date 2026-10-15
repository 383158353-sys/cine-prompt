param([switch]$CheckOnly, [switch]$SkipLaunch)
$ErrorActionPreference = 'Stop'
$kitRoot = $PSScriptRoot
$report = [ordered]@{ time=(Get-Date).ToString('o'); integrity=$false; desktopInstalled=$false; pluginVersion=$null; photoshopFound=$false; serviceHealthy=$false; apiConfigured='not inspected'; notes=@() }
function Copy-KitDirectory([string]$From,[string]$To) {
    if (!(Test-Path -LiteralPath $From -PathType Container)) { throw "Missing payload: $From" }
    New-Item -ItemType Directory -Path $To -Force | Out-Null
    Get-ChildItem -LiteralPath $From -Force | Copy-Item -Destination $To -Recurse -Force
}
try {
    if (![Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
    $manifest=Get-Content -LiteralPath (Join-Path $kitRoot 'manifest.json') -Raw | ConvertFrom-Json
    foreach($entry in $manifest.files) {
        $file=Join-Path $kitRoot $entry.path
        $resolved=[IO.Path]::GetFullPath($file)
        if (!$resolved.StartsWith(([IO.Path]::GetFullPath($kitRoot).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path.' }
        if (!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Integrity check failed: $($entry.path)" }
    }
    $report.integrity=$true
    Write-Host 'All payload hashes verified.'
    $psRoots=@((Join-Path $env:ProgramFiles 'Adobe'),(Join-Path ${env:ProgramFiles(x86)} 'Adobe'))
    $report.photoshopFound=@($psRoots | Where-Object {Test-Path -LiteralPath $_} | ForEach-Object {Get-ChildItem -LiteralPath $_ -Directory -Filter 'Adobe Photoshop*' -ErrorAction SilentlyContinue} | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'Photoshop.exe')}).Count -gt 0
    if ($CheckOnly) { Write-Host "Integrity OK; Photoshop found: $($report.photoshopFound)"; return }
    $appRoot=Join-Path $env:LOCALAPPDATA 'Programs\cine-prompt-local'
    $exe=Join-Path $appRoot '影词魔方.exe'
    $running=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $exe})
    if ($running.Count) { throw 'Exit CinePrompt using its tray Exit menu, then rerun this script. Existing unsaved input will not be terminated automatically.' }
    $installer=Join-Path $kitRoot 'installer\CinePrompt-Photoshop-Windows.exe'
    Write-Host 'Installing desktop runtime. This may take 15-25 minutes; do not start another installer.'
    $process=Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Desktop installer failed: $($process.ExitCode)" }
    if (!(Test-Path -LiteralPath $exe)) { throw 'Installer finished but the desktop executable was not found.' }
    $resources=Join-Path $appRoot 'resources'
    $app=Join-Path $resources 'app'
    Copy-KitDirectory (Join-Path $kitRoot 'patch\app') $app
    Copy-KitDirectory (Join-Path $kitRoot 'patch\ps-plugin') (Join-Path $resources 'ps-plugin')
    Copy-KitDirectory (Join-Path $kitRoot 'patch\ps-companion') (Join-Path $resources 'ps-companion')
    $pluginTarget=Join-Path $env:APPDATA 'Adobe\UXP\Plugins\External\com.local.lk888.psedit'
    Copy-KitDirectory (Join-Path $kitRoot 'patch\ps-plugin') $pluginTarget
    $report.pluginVersion=(Get-Content -LiteralPath (Join-Path $pluginTarget 'manifest.json') -Raw | ConvertFrom-Json).version
    $shell=New-Object -ComObject WScript.Shell
    $shortcut=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '影词魔方.lnk'))
    $shortcut.TargetPath=$exe; $shortcut.WorkingDirectory=$appRoot; $shortcut.Save()
    $report.desktopInstalled=$true
    if (!$report.photoshopFound) { $report.notes+='Photoshop not found in standard Adobe locations. Install Photoshop 25+ separately, or verify a custom installation.' }
    if (!$SkipLaunch) {
        $existing=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
        if ($existing) { $report.notes+='Port 5173 is in use; app launch skipped to avoid disrupting another service.' }
        else {
            Start-Process -FilePath $exe -WorkingDirectory $appRoot -WindowStyle Hidden
            for($attempt=0;$attempt -lt 40;$attempt++) {
                Start-Sleep -Milliseconds 500
                try { $health=Invoke-WebRequest -Uri 'http://127.0.0.1:5173/api/bridge/health' -Headers @{'X-Cine-Bridge'='1'} -UseBasicParsing -TimeoutSec 2; if($health.StatusCode -eq 200){$report.serviceHealthy=$true;break} } catch {}
            }
        }
    }
    $report.notes+='Enter your own API Key in the app and PS panel. Restart Photoshop if it was open. Actual AI generation has not been tested.'
    Write-Host 'Files installed. See installation-report.json for actual verification results.'
} catch {
    $report.notes+=$_.Exception.Message
    throw
} finally {
    if (!$CheckOnly) { $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $kitRoot 'installation-report.json') -Encoding UTF8 }
}
