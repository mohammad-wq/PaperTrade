@echo off
REM ==============================================================================
REM Paper Trade - Database Restore Script (Native Windows)
REM Restores a specified .sql file into the local PostgreSQL database.
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

REM Check if psql is in PATH; if not, check default PostgreSQL install location
where psql >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" (
        set PATH=C:\Program Files\PostgreSQL\16\bin;%PATH%
    )
)

echo Restoring database from %BACKUP_FILE%...
psql -U postgres -d paperbiz -f "%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Database restored successfully!
) else (
    echo [ERROR] Restore failed. Please ensure PostgreSQL service is running and credentials are set.
)

pause
