@echo off
REM ==============================================================================
REM Paper Trade - Database Restore Script (Windows)
REM Restores a specified .sql file into the Docker PostgreSQL container.
REM Usage: Drag and drop a .sql file onto this script, or run:
REM scripts\restore.bat backups\papertrade_backup_YYYYMMDD_HHMMSS.sql
REM ==============================================================================

cd /d "%~dp0\.."

set BACKUP_FILE=%~1

if "%BACKUP_FILE%"=="" (
    echo Usage: %0 ^<path-to-sql-file^>
    echo You can also drag and drop a .sql backup file directly onto this icon.
    pause
    exit /b 1
)

if not exist "%BACKUP_FILE%" (
    echo Error: File "%BACKUP_FILE%" does not exist.
    pause
    exit /b 1
)

echo ==========================================================
echo WARNING: Restoring will overwrite existing database data.
echo Selected file: %BACKUP_FILE%
echo ==========================================================
set /p CONFIRM="Are you sure you want to proceed? Type YES to continue: "

if /i not "%CONFIRM%"=="YES" (
    echo Restore cancelled.
    pause
    exit /b 0
)

echo Restoring database from %BACKUP_FILE%...
type "%BACKUP_FILE%" | docker compose exec -T db psql -U postgres papertrade

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Database restored successfully!
) else (
    echo [ERROR] Restore failed. Please ensure Docker Desktop is running.
)

pause
