# Release build — portable ZIP for GitHub Releases
# Builds the app, then packs it as release/Chest-Counter-<version>-win-x64.zip
#
#   .\build-release.ps1           slim release (default)
#   .\build-release.ps1 -Full     also ships cloudflared.exe (offline tunnel)
#
# The archive is written entry by entry instead of via CreateFromDirectory:
#   * .NET Framework's CreateFromDirectory emits backslash separators, which the
#     Windows shell unzipper and several third-party tools read as one flat file
#     name. Entries here always use '/'.
#   * an explicit skip list guarantees no local data ever reaches a download.
param([switch]$Full)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

& (Join-Path $root 'build-manual.ps1') -Full:$Full

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$outExe  = Join-Path $root 'dist\Chest Counter-win32-x64'
$release = Join-Path $root 'release'
New-Item -ItemType Directory -Force $release | Out-Null
$zipPath = Join-Path $release "Chest-Counter-$version-win-x64.zip"
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

# Anything matching this never ships. The app writes all of it to
# %APPDATA%\Chest Counter at runtime; a copy here would be someone else's data.
$skipNames = @(
  'counts.json', 'treasure.json', 'config.json', 'replay-history.json',
  'DevToolsActivePort', 'debug.log'
)
$skipDirs  = @('images')

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# SmallestSize only exists on .NET Core (pwsh 7+). Windows PowerShell 5.1 runs on
# .NET Framework, where Optimal is the smallest level it offers.
$level = [System.IO.Compression.CompressionLevel]::Optimal
if ([Enum]::GetNames([System.IO.Compression.CompressionLevel]) -contains 'SmallestSize') {
  $level = [System.IO.Compression.CompressionLevel]::SmallestSize
}

$baseLen = $outExe.TrimEnd('\').Length + 1
$skipped = 0
$count   = 0
$fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
try {
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in Get-ChildItem $outExe -Recurse -File) {
      $rel = $file.FullName.Substring($baseLen)
      $segments = $rel.Split('\')
      if ($skipNames -contains $file.Name) { $skipped++; continue }
      if ($segments | Where-Object { $skipDirs -contains $_ }) { $skipped++; continue }
      $entryName = $segments -join '/'
      $entry = $zip.CreateEntry($entryName, $level)
      # fixed timestamp: reproducible archives, no build-time leakage
      $entry.LastWriteTime = [DateTimeOffset]::new(2026, 11, 16, 0, 0, 0, [TimeSpan]::Zero)
      $dst = $entry.Open()
      $src = [System.IO.File]::OpenRead($file.FullName)
      try { $src.CopyTo($dst) } finally { $src.Dispose(); $dst.Dispose() }
      $count++
    }
  } finally { $zip.Dispose() }
} finally { $fs.Dispose() }

# extra bits users want next to the app
foreach ($f in 'README.md', 'LICENSE', 'NOTICE.md', 'CHANGELOG.md', 'RELEASE_NOTES.md') {
  $p = Join-Path $root $f
  if (Test-Path $p) { Copy-Item $p $release -Force }
}

$zipMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
$dirMb = [math]::Round(((Get-ChildItem $outExe -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "RELEASE OK -> $zipPath ($zipMb MB zipped, $dirMb MB unzipped, $count entries, $skipped data files skipped)"
