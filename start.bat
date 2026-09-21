@echo off
REM ==============================================================================
REM Paper Trade - Native Windows Launcher
REM Starts the standalone Node.js server, monitors health, and opens default browser.
REM 100% Native Windows - Zero Docker / Virtualization overhead.
REM ==============================================================================

cd /d "%~dp0"

echo ======================================================================
echo  Starting Paper Trade Management System (Native Windows)...
echo ======================================================================
echo.

REM 1. Quick check: is the application ALREADY running?
echo [1/3] Checking application status...
where curl >nul 2>&1
if not errorlevel 1 (
    curl -s -f -L -o nul http://localhost:3000 >nul 2>&1
    if not errorlevel 1 (
        echo Application is already running and responsive!
        goto app_ready
    )
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = [System.Net.WebRequest]::Create('http://localhost:3000'); $r.Timeout = 1000; $res = $r.GetResponse(); exit 0 } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        echo Application is already running and responsive!
        goto app_ready
    )
)

REM 2. Verify Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo ======================================================================
    echo  [ERROR] Node.js is not installed or not in system PATH!
    echo ======================================================================
    echo.
    echo  Node.js LTS (v20 or newer) is required to run Paper Trade natively.
    echo.
    echo  Steps to fix:
    echo   1. Download and install Node.js LTS from: https://nodejs.org/
    echo   2. Restart Command Prompt after installation.
    echo.
    echo ======================================================================
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

REM 3. Verify PostgreSQL service is running (optional check)
sc query postgresql-x64-16 >nul 2>&1
if not errorlevel 1 (
    sc query postgresql-x64-16 | findstr /i "RUNNING" >nul 2>&1
    if errorlevel 1 (
        echo [!] PostgreSQL service (postgresql-x64-16) is stopped. Attempting to start...
        net start postgresql-x64-16 >nul 2>&1
    )
)

REM 4. Locate server.js
set SERVER_JS=server.js
if not exist "%SERVER_JS%" (
    if exist ".next\standalone\server.js" (
        set SERVER_JS=.next\standalone\server.js
    ) else (
        echo.
        echo ======================================================================
        echo  [ERROR] server.js not found in current directory or .next\standalone!
        echo ======================================================================
        echo.
        echo  Please ensure the standalone build files are located in this folder.
        echo.
        pause
        exit /b 1
    )
)

REM 5. Ensure static and public assets exist in standalone directory
if exist ".next\static" if exist ".next\standalone" (
    if not exist ".next\standalone\.next\static" (
        echo [!] Syncing static assets to standalone directory...
        xcopy /E /I /Y /Q ".next\static" ".next\standalone\.next\static" >nul 2>&1
    )
    if exist "public" if not exist ".next\standalone\public" (
        xcopy /E /I /Y /Q "public" ".next\standalone\public" >nul 2>&1
    )
)

REM 6. Start server.js in background window (capped at 1536MB to prevent OOM / swap thrashing)
echo [2/3] Launching Node.js standalone server (memory-capped)...
start "Paper Trade Server" /min cmd /c "node --max-old-space-size=1536 %SERVER_JS%"

REM 6. Poll until application responds on http://localhost:3000
echo.
echo [3/3] Waiting for application to initialize on http://localhost:3000...
set ATTEMPTS=0
set MAX_ATTEMPTS=30

:poll_loop
set /a ATTEMPTS+=1

where curl >nul 2>&1
if errorlevel 1 goto try_powershell

curl -s -f -L -o nul http://localhost:3000 >nul 2>&1
if not errorlevel 1 goto app_ready
goto check_timeout

:try_powershell
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
echo  The web server has not responded on http://localhost:3000 yet.
echo.
echo  Likely causes:
echo   1. PostgreSQL service is not running.
echo      - Open Services (services.msc) and ensure "postgresql-x64-16" is Running.
echo      - Or run in Admin CMD: sc query postgresql-x64-16
echo   2. Database credentials in .env are incorrect.
echo      - Check DATABASE_URL in .env (e.g. postgresql://user:password@localhost:5432/paperbiz)
echo   3. Port 3000 is occupied by another application.
echo      - Run: netstat -ano | findstr :3000
echo   4. Pending database migrations.
echo      - Run: npx prisma migrate deploy
echo.
echo ======================================================================
echo Press any key to exit...
pause >nul
exit /b 1
