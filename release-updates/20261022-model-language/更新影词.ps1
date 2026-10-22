$ErrorActionPreference='Stop'
$bundleRoot=$PSScriptRoot
$installRoot=Join-Path $env:LOCALAPPDATA 'Programs\cine-prompt-local'
$appRoot=Join-Path $installRoot 'resources\app'
$appExe=Join-Path $installRoot '影词魔方.exe'
if (!(Test-Path -LiteralPath $appExe)) { throw '未找到已安装的影词魔方，请先安装桌面版。' }
$manifest=Get-Content -LiteralPath (Join-Path $bundleRoot 'manifest.json') -Raw | ConvertFrom-Json
foreach($entry in $manifest){
  $source=Join-Path $bundleRoot $entry.path
  if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256){throw ('更新包校验失败：'+$entry.path)}
}
$backup=Join-Path $installRoot ('update-backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path (Join-Path $backup 'server\functions') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $appRoot 'dist') -Destination $backup -Recurse
foreach($relative in @('server\ai.mjs','server\functions\enhancePrompt.ts')){Copy-Item -LiteralPath (Join-Path $appRoot $relative) -Destination (Join-Path $backup $relative)}
Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $appExe} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
Start-Sleep -Milliseconds 700
Copy-Item -LiteralPath (Join-Path $bundleRoot 'payload\dist') -Destination $appRoot -Recurse -Force
foreach($relative in @('server\ai.mjs','server\functions\enhancePrompt.ts')){Copy-Item -LiteralPath (Join-Path $bundleRoot ('payload\'+$relative)) -Destination (Join-Path $appRoot $relative) -Force}
Start-Process -FilePath $appExe -WindowStyle Hidden
$healthy=$false
for($attempt=0;$attempt -lt 40;$attempt++){
  Start-Sleep -Milliseconds 500
  try {$health=Invoke-RestMethod -Uri 'http://127.0.0.1:5173/api/bridge/health' -Headers @{'X-Cine-Bridge'='1'};if($health.ok){$healthy=$true;break}}catch{}
}
if(!$healthy){throw ('程序已更新，但服务启动检查未通过。旧文件备份在 '+$backup)}
foreach($entry in $manifest){$relative=$entry.path -replace '^payload/','';$target=Join-Path $appRoot $relative;if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $entry.sha256){throw ('已安装文件校验失败：'+$relative)}}
[PSCustomObject]@{updated=$true;healthy=$healthy;model=$health.model;backup=$backup} | ConvertTo-Json | Tee-Object -FilePath (Join-Path $bundleRoot 'update-report.json')
