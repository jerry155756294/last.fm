@echo off
setlocal

cd /d "%~dp0"

for /f %%P in ('powershell -NoProfile -Command "$ports = 8080..8099 + 5500..5599; foreach ($p in $ports) { try { $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p); $listener.Start(); $listener.Stop(); Write-Output $p; break } catch {} }"') do set PORT=%%P

if not defined PORT (
  echo Could not find an available local port.
  pause
  exit /b 1
)

echo Starting static server in:
echo %CD%
echo.
echo Dashboard URL: http://localhost:%PORT%
echo Press Ctrl+C to stop.
echo.

set MODE=cloud
findstr /c:"mode: 'local'" "runtime-config.js" >nul && set MODE=local

if /I "%MODE%"=="local" (
  echo Starting local recent.json sync loop...
  start "Last.fm live sync" cmd /c "cd /d "%~dp0" && npm run sync:live"
  echo.
)

start "" cmd /c "timeout /t 2 >nul && start http://localhost:%PORT%"
python -m http.server %PORT%

endlocal
