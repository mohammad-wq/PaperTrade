@echo off
REM ==============================================================================
REM Paper Trade - Automated Weekly Cloud Backup (Native Windows via Rclone)
REM 
REM - Takes most recent local backup from today (or creates one if needed)
REM - Syncs to Google Drive remote (papertrade_backup:PaperTradeBackup/)
REM - Maintains papertrade_latest.dump and rolling 3-week archive:
REM   papertrade_weekly_1.dump, papertrade_weekly_2.dump, papertrade_weekly_3.dump
REM - Logs outcome with [CLOUD] tag to C:\PaperTradeBackups\backup-log.txt
REM ==============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0\.."

REM 1. Find Node.js
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set NODE_BIN=node
) else if exist "C:\Program Files\nodejs\node.exe" (
    set NODE_BIN="C:\Program Files\nodejs\node.exe"
) else (
    echo [ERROR] Node.js is not found in PATH or at C:\Program Files\nodejs\node.exe.
    echo Please ensure Node.js is installed on this system.
    exit /b 1
)

REM 2. Run the shared backup runner
echo =====================================================================
echo  Paper Trade - Weekly Cloud Backup (Google Drive via Rclone)
echo  Time: %DATE% %TIME%
echo =====================================================================

%NODE_BIN% "%~dp0backup-runner.js" --type=cloud %*
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% EQU 0 (
    echo [SUCCESS] Cloud backup completed and logged to C:\PaperTradeBackups\backup-log.txt
) else (
    echo [FAILURE] Cloud backup failed with exit code %EXIT_CODE%. Check C:\PaperTradeBackups\backup-log.txt
)

REM Pause only if double-clicked from Windows Explorer
echo %cmdcmdline% | find /i "%~0" >nul
if not errorlevel 1 (
    if "%1"=="" pause
)

exit /b %EXIT_CODE%

