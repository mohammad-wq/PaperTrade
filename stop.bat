@echo off
REM ==============================================================================
REM Paper Trade - One-Click Shutdown (Windows)
REM Stops and cleans up Docker containers cleanly.
REM ==============================================================================

cd /d "%~dp0"

echo ======================================================================
echo  Stopping Paper Trade Management System...
echo ======================================================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo [!] Docker Desktop is not running or already stopped.
    echo Containers are already offline.
    timeout /t 3 /nobreak >nul
    exit /b 0
)

echo Stopping containers and releasing resources...
docker compose down

if errorlevel 1 (
    echo.
    echo ======================================================================
    echo  [WARNING] Encountered an issue while stopping containers.
    echo ======================================================================
    echo  Check container status with: docker compose ps
    echo.
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo  Application stopped cleanly. All data is safely preserved.
echo ======================================================================
echo.
echo This window will close in 4 seconds...
timeout /t 4
exit /b 0
