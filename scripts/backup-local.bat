@echo off
REM ==============================================================================
REM Paper Trade - Automated Local Database Backup (Native Windows)
REM 
REM - Runs pg_dump with custom compressed format (-F c)
REM - Credentials dynamically parsed from .env (via PGPASSWORD)
REM - Saves timestamped dump to C:\PaperTradeBackups\local\papertrade_YYYY-MM-DD_HHMM.dump
REM - Enforces 30-day automatic retention cleanup
REM - Logs timestamp, file size, and status to C:\PaperTradeBackups\backup-log.txt
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
echo  Paper Trade - Daily Local Database Backup
echo  Time: %DATE% %TIME%
echo =====================================================================

%NODE_BIN% "%~dp0backup-runner.js" --type=local %*
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% EQU 0 (
    echo [SUCCESS] Local backup completed and logged to C:\PaperTradeBackups\backup-log.txt
) else (
    echo [FAILURE] Local backup failed with exit code %EXIT_CODE%. Check C:\PaperTradeBackups\backup-log.txt
)

REM Pause only if double-clicked from Windows Explorer
echo %cmdcmdline% | find /i "%~0" >nul
if not errorlevel 1 (
    if "%1"=="" pause
)

exit /b %EXIT_CODE%

