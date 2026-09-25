@echo off
REM ==============================================================================
REM Paper Trade - Register Daily Automated Backup in Windows Task Scheduler
REM Schedules backup-local.bat to run every day at 4:00 PM (16:00)
REM ==============================================================================

setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "BACKUP_BAT=%SCRIPT_DIR%backup-local.bat"

echo =====================================================================
echo  Registering Paper Trade Daily Database Backup (4:00 PM Everyday)
echo =====================================================================

schtasks.exe /create /tn "PaperTrade_Daily_Local_Backup" /tr "\"%BACKUP_BAT%\"" /sc daily /st 16:00 /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Daily backup scheduled successfully for 4:00 PM everyday!
    echo Task name: PaperTrade_Daily_Local_Backup
) else (
    echo.
    echo [ERROR] Failed to register scheduled task. Try running as Administrator.
)

echo.
pause
