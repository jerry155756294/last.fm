@echo off
setlocal
cd /d "%~dp0"
npm run sync:recent
endlocal
