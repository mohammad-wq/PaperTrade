@echo off
REM ==============================================================================
REM Paper Trade - One-Click Launcher (Windows)
REM Starts Docker containers, monitors health, and opens your default web browser.
REM ==============================================================================

cd /d "%~dp0"

echo ======================================================================
echo  Starting Paper Trade Management System...
echo ======================================================================
echo.

REM 1. Check if Docker Desktop is running
echo [1/3] Checking Docker Desktop status...
docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo ======================================================================
    echo  [ERROR] Docker Desktop is not running!
    echo ======================================================================
    echo.
    echo  Docker Desktop must be running before Paper Trade can start.
    echo.
    echo  Steps to fix:
    echo   1. Open "Docker Desktop" from your Start Menu or Desktop.
    echo   2. Wait 30-60 seconds until the whale icon in your taskbar system
    echo      tray (bottom-right corner) shows "Engine running".
    echo   3. Run this launcher again.
    echo.
    echo ======================================================================
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

REM 2. Start Docker containers in detached mode
echo [2/3] Starting database and application services...
docker compose up -d
if errorlevel 1 (
    echo.
    echo ======================================================================
    echo  [ERROR] Failed to start Docker containers!
    echo ======================================================================
    echo.
    echo  Possible causes:
    echo   1. Port 3000 or Port 5432 is already in use by another application.
    echo   2. Docker Desktop engine is still initializing. Please wait a moment.
    echo   3. The application image has not been built yet. Run: docker compose build
    echo.
    echo  Troubleshooting:
    echo   - Check container status: docker compose ps
    echo   - View diagnostic logs:   docker compose logs
    echo.
    echo ======================================================================
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

REM 3. Poll until application responds on http://localhost:3000
echo.
echo [3/3] Waiting for application to initialize...
set ATTEMPTS=0
set MAX_ATTEMPTS=30

:poll_loop
set /a ATTEMPTS+=1

REM Check if curl is available
where curl >nul 2>&1
if errorlevel 1 goto try_powershell

REM Use curl to test connection
curl -s -f -L -o nul http://localhost:3000
if not errorlevel 1 goto app_ready
goto check_timeout

:try_powershell
REM Fallback for systems without curl
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = [System.Net.WebRequest]::Create('http://localhost:3000'); $r.Timeout = 1500; $res = $r.GetResponse(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto app_ready

:check_timeout
if %ATTEMPTS% GEQ %MAX_ATTEMPTS% goto app_timeout

<nul set /p =.
timeout /t 2 /nobreak >nul
goto poll_loop

:app_ready
echo.
echo.
echo [OK] Application is online and ready!
echo Opening browser to http://localhost:3000...
start http://localhost:3000

echo.
echo ======================================================================
echo  Paper Trade Management System is running!
echo ======================================================================
echo  * Local Machine URL:   http://localhost:3000
echo  * LAN (Second PC) URL: http://^<YOUR-PC-IP-ADDRESS^>:3000
echo    (Run "ipconfig" in Command Prompt to find your IPv4 Address)
echo.
echo  To stop the application cleanly, double-click stop.bat
echo ======================================================================
echo.
echo This window will close in 8 seconds, or press any key to close now...
timeout /t 8
exit /b 0

:app_timeout
echo.
echo.
echo ======================================================================
echo  [WARNING] Application startup is taking longer than expected.
echo ======================================================================
echo.
echo  The background containers were started, but the web server has not
echo  responded on http://localhost:3000 yet.
echo.
echo  Likely causes:
echo   1. Database migrations or initial setup may still be finishing.
echo   2. Your computer may be experiencing heavy CPU/memory load.
echo   3. A container encountered an error during boot.
echo.
echo  What to do next:
echo   - Wait 15-30 seconds, then try opening http://localhost:3000 manually.
echo   - Open Command Prompt in this folder and check logs:
echo       docker compose logs app
echo.
echo ======================================================================
echo Press any key to exit...
pause >nul
exit /b 1
