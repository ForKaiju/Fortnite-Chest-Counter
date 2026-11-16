# Manual build (electron-packager's zip extraction dies silently on this machine,
# so the same layout is produced by hand: electron runtime + app.asar + resources)
#
#   .\build-manual.ps1            slim build (default) — en-US only, no tunnel binary
#   .\build-manual.ps1 -Full      ships cloudflared.exe so the tunnel works offline
param([switch]$Full)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out  = Join-Path $root 'dist\Chest Counter-win32-x64'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version

# 1. electron runtime -> dist
# No user data is carried through the build. Counters, settings and replay
# history live in %APPDATA%\Chest Counter (main.js dataDir()); the old
# resources\*.json copies were legacy-migration leftovers and shipping them in a
# release would hand every download the builder's own stats.
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force (Join-Path $root 'dist') | Out-Null
robocopy (Join-Path $root 'node_modules\electron\dist') $out /E /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }

# 1b. trim the runtime
# 55 locale packs (~37MB) for one English UI: keep en-US, drop the rest. A
# missing pack falls back to en-US, so nothing renders wrong.
Get-ChildItem (Join-Path $out 'locales') -File | Where-Object { $_.Name -ne 'en-US.pak' } | Remove-Item -Force
# default_app.asar is the stock Electron starter app — never loaded here
Remove-Item (Join-Path $out 'resources\default_app.asar') -ErrorAction SilentlyContinue

# 2. stage the app and pack to app.asar
$stage = Join-Path $env:TEMP 'chest-app-stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory $stage | Out-Null
Copy-Item (Join-Path $root 'package.json') $stage
Copy-Item (Join-Path $root 'main.js')     $stage
Copy-Item (Join-Path $root 'server.js')   $stage
Copy-Item (Join-Path $root 'replay.js')   $stage
Copy-Item (Join-Path $root 'bridge.js')   $stage
Copy-Item (Join-Path $root 'preload.js')  $stage
Copy-Item (Join-Path $root 'treasure-weeks.js')    $stage
Copy-Item (Join-Path $root 'treasure-schedule.js') $stage
cmd /c "npm.cmd i express --omit=dev --prefix `"$stage`"" | Out-Null
node (Join-Path $root 'node_modules\@electron\asar\bin\asar.js') pack $stage (Join-Path $out 'resources\app.asar')

# 3. extra resources (layout matches getResourcePath / server.js expectations)
$res = Join-Path $out 'resources'
Copy-Item -Recurse (Join-Path $root 'public') (Join-Path $res 'public')
New-Item -ItemType Directory -Force (Join-Path $res 'build') | Out-Null
Copy-Item (Join-Path $root 'build\icon.ico') (Join-Path $res 'build\icon.ico')
Copy-Item (Join-Path $root 'hook.ps1') (Join-Path $res 'hook.ps1')
Copy-Item (Join-Path $root 'chest-probe.ps1') (Join-Path $res 'chest-probe.ps1')
Copy-Item -Recurse (Join-Path $root 'replay-reader') (Join-Path $res 'replay-reader')
Copy-Item -Recurse (Join-Path $root 'oodle-ooz') (Join-Path $res 'oodle-ooz')
# the tunnel helper is optional at build time — the app downloads it on first
# use, so the default build leaves the 55MB binary out and stays small
if ($Full) {
  $cf = Join-Path $root 'cloudflared.exe'
  if (Test-Path $cf) { Copy-Item $cf (Join-Path $res 'cloudflared.exe') }
}
# license compliance ships with the app
Copy-Item (Join-Path $root 'LICENSE')   (Join-Path $res 'LICENSE')
Copy-Item (Join-Path $root 'NOTICE.md') (Join-Path $res 'NOTICE.md')

# 4. exe name + icon + version info
$exe = Join-Path $out 'electron.exe'
Rename-Item $exe 'Chest Counter.exe'
$exe = Join-Path $out 'Chest Counter.exe'
$rcedit = Get-ChildItem (Join-Path $root 'node_modules\rcedit') -Recurse -Filter 'rcedit-x64.exe' | Select-Object -First 1 -ExpandProperty FullName
& $rcedit $exe --set-icon (Join-Path $root 'build\icon.ico') `
  --set-version-string 'FileDescription' 'Chest Counter' `
  --set-version-string 'ProductName' 'Chest Counter' `
  --set-version-string 'CompanyName' 'ChestCounter' `
  --set-file-version $version `
  --set-product-version $version
if ($LASTEXITCODE -ne 0) { throw "rcedit failed with code $LASTEXITCODE" }

$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "BUILD OK ($version, $size MB) -> $exe"
