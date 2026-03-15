@echo off
setlocal
cd /d "%~dp0"
copy /y "runtime-config.cloud.js" "runtime-config.js" >nul
echo Switched to GIT+CLOUDFLARE mode.
echo Please make sure runtime-config.cloud.js has your real Worker URL.
endlocal
