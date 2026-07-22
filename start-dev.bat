REM Start-dev.bat for store-dashboard
REM Double-click to restart the dev server on port 5000

@echo off
chcp 65001 >nul 2>&1
cd /d "C:\Users\LN\Desktop\Stuart\store-dashboard-extracted"

echo [1/2] Killing old process on port 5000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }"
timeout /t 1 >nul 2>&1

echo [2/2] Starting dev server at http://localhost:5000
echo       Close this window to stop the server.
set NODE_OPTIONS=
"C:\Users\LN\.workbuddy\binaries\node\versions\22.22.2\node.exe" node_modules/next/dist/bin/next dev --webpack --port 5000

pause
