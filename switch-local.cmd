@echo off
setlocal
cd /d "%~dp0"
copy /y "runtime-config.local.js" "runtime-config.js" >nul
echo Switched to LOCAL mode.
echo runtime-config.js now uses local JSON only.
endlocal
