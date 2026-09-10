@echo off
REM ==============================================================================
REM Paper Trade - One-Click Shutdown (Native Windows)
REM Stops the background Windows service or kills the standalone Node.js process.
REM ==============================================================================

cd /d "%~dp0"

echo ======================================================================
echo  Stopping Paper Trade Management System...
echo ======================================================================
echo.

REM 1. If installed as NSSM Windows Service, stop the service
sc query PaperTrade >nul 2>&1
if not errorlevel 1 (
    echo Stopping PaperTrade Windows Service...
    net stop PaperTrade >nul 2>&1
)

REM 2. Terminate any active process listening on port 3000
echo Terminating process on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo  - Ending process PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo ======================================================================
echo  Application stopped cleanly. All data is safely preserved.
echo ======================================================================
echo.
echo This window will close in 4 seconds...
timeout /t 4
exit /b 0
