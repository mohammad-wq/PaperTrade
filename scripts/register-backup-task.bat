@echo off
REM ==============================================================================
REM Paper Trade - Register Daily Automated Backup in Windows Task Scheduler
REM Schedules backup-local.bat to run every day at 4:00 PM (16:00)
REM ==============================================================================

setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "BACKUP_BAT=%SCRIPT_DIR%run_backup.bat"

echo =====================================================================
echo  Registering Paper Trade Daily Database Backup (4:00 PM Everyday)
echo =====================================================================

schtasks.exe /create /tn "PaperTrade_Daily_Backup" /tr "\"%~dp0run_backup.bat\"" /sc daily /st 16:00 /f /rl HIGHEST

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Daily backup scheduled successfully for 4:00 PM everyday!
    echo Task name: PaperTrade_Daily_Backup
) else (
    echo.
    echo [ERROR] Failed to register scheduled task. Try running as Administrator.
)

echo.
pause
