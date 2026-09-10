@echo off
REM ==============================================================================
REM Paper Trade - Automatic / Manual Database Backup Script (Native Windows)
REM Runs native pg_dump against local PostgreSQL and saves a timestamped .sql file.
REM ==============================================================================

cd /d "%~dp0\.."

if not exist backups mkdir backups

REM Format current date and time as YYYYMMDD_HHMMSS
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,8%_%datetime:~8,6%
set BACKUP_FILE=backups\papertrade_backup_%TIMESTAMP%.sql

echo ======================================================
echo Starting Paper Trade Database Backup...
echo Target file: %BACKUP_FILE%
echo ======================================================

REM Check if pg_dump is in PATH; if not, check default PostgreSQL install location
where pg_dump >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" (
        set PATH=C:\Program Files\PostgreSQL\16\bin;%PATH%
    )
)

pg_dump -U postgres -d paperbiz --no-owner --no-acl --clean --if-exists > "%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Backup completed successfully!
    echo File saved: %BACKUP_FILE%
) else (
    echo [ERROR] Backup failed. Please ensure PostgreSQL service is running and credentials are set.
)

pause
