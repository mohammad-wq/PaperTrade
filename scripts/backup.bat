@echo off
REM ==============================================================================
REM Paper Trade - Automatic / Manual Database Backup Script (Windows)
REM Runs pg_dump inside the docker db container and saves a timestamped .sql file.
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

docker compose exec -T db pg_dump -U postgres papertrade --no-owner --no-acl --clean --if-exists > "%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Backup completed successfully!
    echo File saved: %BACKUP_FILE%
) else (
    echo [ERROR] Backup failed. Please ensure Docker Desktop is running.
)

pause
