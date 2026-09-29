
@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Paper Trade Launcher

REM ============================================================
REM PAPER TRADE - NATIVE WINDOWS LAUNCHER
REM ============================================================

cd /d "%~dp0"

set "APP_URL=http://localhost:3000"
set "APP_DIR=%CD%"
set "MAX_ATTEMPTS=30"
set "ATTEMPTS=0"
set "USED_NSSM=0"

echo ============================================================
echo   Starting Paper Trade Management System
echo ============================================================
echo.

REM ============================================================
REM STEP 1 - CHECK IF APPLICATION IS ALREADY RUNNING
REM ============================================================

echo [1/3] Checking application status...

call :check_health
if not errorlevel 1 goto app_ready

REM ============================================================
REM STEP 2 - VERIFY NODE.JS
REM ============================================================

where node >nul 2>&1
if errorlevel 1 goto node_missing

echo [OK] Node.js detected.
node --version

REM ============================================================
REM STEP 3 - CHECK POSTGRESQL SERVICES
REM ============================================================

echo.
echo Checking PostgreSQL...

set "PG_FOUND=0"

for %%S in (postgresql-x64-18 postgresql-x64-17 postgresql-x64-16 postgresql-x64-15 postgresql) do call :check_postgres %%S

if "!PG_FOUND!"=="0" echo [WARNING] No standard PostgreSQL service found.

REM ============================================================
REM STEP 4 - CHECK NSSM WINDOWS SERVICE
REM ============================================================

echo.
echo Checking PaperTrade Windows service...

where nssm >nul 2>&1
if errorlevel 1 goto prepare_node

nssm status PaperTrade >nul 2>&1
if errorlevel 1 goto prepare_node

echo PaperTrade service found.
echo Attempting to start service...

nssm start PaperTrade >nul 2>&1

REM The service may already be running.
call :check_health
if not errorlevel 1 goto app_ready

set "USED_NSSM=1"
goto poll_start

REM ============================================================
REM STEP 5 - PREPARE STANDALONE NODE SERVER
REM ============================================================

:prepare_node

echo.
echo [2/3] Preparing standalone Node.js server...

REM Prefer the Next.js standalone build.

if exist ".next\standalone\server.js" goto use_standalone

REM Fall back to root server.js if available.

if exist "server.js" goto use_root

goto server_missing

:use_standalone

echo [OK] Standalone build found.

REM Copy static assets when available.

if not exist ".next\static" goto check_public
if not exist ".next\standalone\.next\static" mkdir ".next\standalone\.next\static"

xcopy ".next\static\*" ".next\standalone\.next\static\" /E /I /Y /Q >nul
if errorlevel 1 echo [WARNING] Could not synchronize static assets.

:check_public

if not exist "public" goto check_env
if not exist ".next\standalone\public" mkdir ".next\standalone\public"

xcopy "public\*" ".next\standalone\public\" /E /I /Y /Q >nul
if errorlevel 1 echo [WARNING] Could not synchronize public assets.

:check_env

REM Make the environment file available to standalone server.

if not exist ".env" goto launch_standalone

copy /Y ".env" ".next\standalone\.env" >nul
if errorlevel 1 echo [WARNING] Could not copy .env file.

:launch_standalone

echo.
echo Starting standalone server...

start "Paper Trade Server" /D "%APP_DIR%\.next\standalone" cmd /k "node --max-old-space-size=1536 server.js"

goto poll_start

:use_root

echo [OK] Root server.js found.
echo Starting Node.js server...

start "Paper Trade Server" /D "%APP_DIR%" cmd /k "node --max-old-space-size=1536 server.js"

goto poll_start

REM ============================================================
REM STEP 6 - WAIT FOR SERVER
REM ============================================================

:poll_start

echo.
echo [3/3] Waiting for application to initialize...
echo URL: %APP_URL%
echo.

set "ATTEMPTS=0"

:poll_loop

set /a ATTEMPTS+=1

call :check_health
if not errorlevel 1 goto app_ready

if !ATTEMPTS! GEQ !MAX_ATTEMPTS! goto app_timeout

<nul set /p "=."
timeout /t 2 /nobreak >nul

goto poll_loop

REM ============================================================
REM HEALTH CHECK
REM ============================================================

:check_health

where curl >nul 2>&1
if errorlevel 1 goto health_powershell

curl --max-time 2 -s -f -o nul "%APP_URL%" >nul 2>&1
exit /b %errorlevel%

:health_powershell

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1

exit /b %errorlevel%

REM ============================================================
REM POSTGRESQL SERVICE CHECK
REM ============================================================

:check_postgres

sc query "%~1" >nul 2>&1
if errorlevel 1 exit /b 0

set "PG_FOUND=1"

sc query "%~1" | findstr /C:"RUNNING" >nul 2>&1
if not errorlevel 1 goto postgres_running

echo [WARNING] PostgreSQL service %~1 is stopped.
echo Attempting to start it...

net start "%~1" >nul 2>&1
if errorlevel 1 goto postgres_failed

echo [OK] PostgreSQL service started.
exit /b 0

:postgres_running

echo [OK] PostgreSQL service %~1 is running.
exit /b 0

:postgres_failed

echo [WARNING] Could not start PostgreSQL service.
echo Administrator privileges may be required.
exit /b 0

REM ============================================================
REM SUCCESS
REM ============================================================

:app_ready

echo.
echo.
echo ============================================================
echo   APPLICATION IS ONLINE
echo ============================================================
echo.
echo Local URL: %APP_URL%
echo.
echo For access from another PC on your network:
echo.
echo   1. Run ipconfig to find your IPv4 address.
echo   2. Open http://YOUR-PC-IP:3000 on the second PC.
echo   3. Ensure your firewall permits the connection.
echo.
echo To stop the application, use stop.bat.
echo ============================================================
echo.

echo Opening default browser...

start "" "%APP_URL%"

echo.
echo Launcher will close in 8 seconds.
timeout /t 8 /nobreak >nul

exit /b 0

REM ============================================================
REM ERROR - NODE.JS NOT FOUND
REM ============================================================

:node_missing

echo.
echo ============================================================
echo ERROR: Node.js was not found.
echo ============================================================
echo.
echo Install Node.js LTS from:
echo https://nodejs.org/
echo.
echo Restart Command Prompt after installation.
echo.
pause
exit /b 1

REM ============================================================
REM ERROR - SERVER NOT FOUND
REM ============================================================

:server_missing

echo.
echo ============================================================
echo ERROR: Standalone server.js was not found.
echo ============================================================
echo.
echo Expected location:
echo .next\standalone\server.js
echo.
echo Ensure the Next.js standalone build exists.
echo.
pause
exit /b 1

REM ============================================================
REM ERROR - STARTUP TIMEOUT
REM ============================================================

:app_timeout

echo.
echo.
echo ============================================================
echo WARNING: Application did not respond within 60 seconds.
echo ============================================================
echo.
echo Possible causes:
echo.
echo 1. PostgreSQL is stopped.
echo 2. Incorrect DATABASE_URL in .env.
echo 3. Port 3000 is occupied.
echo 4. Pending Prisma migrations.
echo 5. Node.js encountered a startup error.
echo.
echo Check the Paper Trade Server window for error messages.
echo.
echo Useful diagnostic commands:
echo.
echo netstat -ano ^| findstr :3000
echo npx prisma migrate deploy
echo.
echo ============================================================
echo.
pause
exit /b 1