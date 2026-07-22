REM refresh-deploy.bat - fetch latest Feishu data and build static export (out/)
REM Deploy out/ to EdgeOne via the WorkBuddy EdgeOne connector (separate step).
@echo off
chcp 65001 >nul 2>&1
cd /d "C:\Users\LN\Desktop\Stuart\store-dashboard-extracted"

set NODE_EXE=C:\Users\LN\.workbuddy\binaries\node\versions\22.22.2\node.exe

echo [1/6] Stopping dev server on port 5000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }"
timeout /t 1 >nul 2>&1

echo [2/6] Disabling dev-only config (API route + .babelrc) for static export...
if exist "src\app\api\feishu\route.ts" ( rename "src\app\api\feishu\route.ts" "route.ts.disabled" )
if exist ".babelrc" ( rename ".babelrc" ".babelrc.disabled" )

echo [3/6] Fetching latest Feishu data into public/data/*.json...
set NEXT_STATIC_EXPORT=true
set NEXT_PUBLIC_STATIC_MODE=true
set NODE_OPTIONS=
"%NODE_EXE%" node_modules\tsx\dist\cli.mjs scripts/fetch-data.ts
if errorlevel 1 ( echo fetch-data failed & goto restore )

echo [4/6] Building static export (output: export -> out/)...
"%NODE_EXE%" node_modules\next\dist\bin\next build --webpack
if errorlevel 1 ( echo next build failed & goto restore )

echo [5/6] Static build complete. out/ is ready for EdgeOne deploy.
goto restore

:restore
if exist "src\app\api\feishu\route.ts.disabled" ( rename "src\app\api\feishu\route.ts.disabled" "route.ts" )
if exist ".babelrc.disabled" ( rename ".babelrc.disabled" ".babelrc" )
echo Dev config restored. Done.
pause
