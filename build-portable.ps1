# build-portable.ps1 — one-file portable Chest Counter.
#
#   .\build-portable.ps1
#
# Produces release\Chest-Counter-<version>-win-x64-portable.exe:
#   the compiled stub (portable-sfx.cs) with the release zip appended, plus an
#   8-byte little-endian footer holding the payload offset. Double-click it and
#   it unpacks once into %LOCALAPPDATA%\Chest Counter Portable, then launches.
#
# Run build-release.ps1 first: this only wraps an existing release zip.
param(
    [string]$Zip = ''
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$release = Join-Path $root 'release'
if (-not $Zip) { $Zip = Join-Path $release "Chest-Counter-$version-win-x64.zip" }
if (-not (Test-Path $Zip)) { throw "release zip not found: $Zip (run build-release.ps1 first)" }

$source = Join-Path $root 'portable-sfx.cs'
if (-not (Test-Path $source)) { throw "stub source missing: $source" }

# Windows PowerShell 5.1 ships the .NET Framework compiler; no SDK needed.
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) { throw 'csc.exe not found (needs .NET Framework 4.x)' }

$work    = Join-Path $env:TEMP ('cc-portable-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$stub    = Join-Path $work 'stub.exe'
$outExe  = Join-Path $release "Chest-Counter-$version-win-x64-portable.exe"

try {
    $icon = Join-Path $root 'build\icon.ico'
    $cscArgs = @(
        '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
        ('/out:"' + $stub + '"'),
        '/reference:System.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.IO.Compression.dll',
        '/reference:System.IO.Compression.FileSystem.dll'
    )
    if (Test-Path $icon) { $cscArgs += ('/win32icon:"' + $icon + '"') }
    $cscArgs += ('"' + $source + '"')

    & $csc @cscArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $stub)) { throw "csc failed with exit code $LASTEXITCODE" }

    # assemble: [stub][zip][int64 zip offset]
    if (Test-Path $outExe) { Remove-Item $outExe -Force }
    $out = [System.IO.File]::Open($outExe, [System.IO.FileMode]::CreateNew)
    try {
        $stubBytes = [System.IO.File]::ReadAllBytes($stub)
        $out.Write($stubBytes, 0, $stubBytes.Length)

        $zipBytes = [System.IO.File]::ReadAllBytes($Zip)
        $offset = [int64]$stubBytes.Length
        $out.Write($zipBytes, 0, $zipBytes.Length)

        $footer = [BitConverter]::GetBytes($offset)
        $out.Write($footer, 0, $footer.Length)
    } finally {
        $out.Dispose()
    }

    $mb = [math]::Round((Get-Item $outExe).Length / 1MB, 1)
    $hash = (Get-FileHash $outExe -Algorithm SHA256).Hash.ToLower()
    Write-Host "PORTABLE OK -> $outExe ($mb MB)"
    Write-Host "sha256 $hash"
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
