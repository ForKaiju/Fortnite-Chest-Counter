@echo off
REM One-command build: app + release zip.
REM Pass "full" to bundle cloudflared.exe so the TikTok bridge works offline.
setlocal
cd /d "%~dp0"

if /i "%~1"=="full" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "build-manual.ps1" -Full
  if errorlevel 1 goto :fail
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "build-manual.ps1"
  if errorlevel 1 goto :fail
)

powershell -NoProfile -ExecutionPolicy Bypass -File "build-release.ps1"
if errorlevel 1 goto :fail

echo.
echo Build complete. See release\ for the zip.
exit /b 0

:fail
echo.
echo Build failed.
exit /b 1
