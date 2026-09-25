@echo off
REM ==============================================================================
REM Paper Trade - Database Restore Script (Native Windows)
REM Restores a specified .dump file (custom format -F c) using pg_restore.
REM Usage: Drag and drop a .dump file onto this script, or run:
REM scripts\restore.bat backups\local\papertrade_YYYY-MM-DD_HHMM.dump
REM ==============================================================================

cd /d "%~dp0\.."

set BACKUP_FILE=%~1

if "%BACKUP_FILE%"=="" (
    echo Usage: %0 ^<path-to-dump-file^>
    echo You can also drag and drop a .dump backup file directly onto this icon.
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

REM Check if pg_restore is in PATH; if not, check default PostgreSQL install locations
where pg_restore >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" (
        set PATH=C:\Program Files\PostgreSQL\18\bin;%PATH%
    ) else if exist "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" (
        set PATH=C:\Program Files\PostgreSQL\17\bin;%PATH%
    ) else if exist "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" (
        set PATH=C:\Program Files\PostgreSQL\16\bin;%PATH%
    ) else if exist "C:\Program Files\PostgreSQL\15\bin\pg_restore.exe" (
        set PATH=C:\Program Files\PostgreSQL\15\bin;%PATH%
    )
)

echo Restoring database from %BACKUP_FILE% using pg_restore...
pg_restore -U postgres -d papertrade --clean --if-exists -v -F c "%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Database restored successfully!
) else (
    echo [ERROR] Restore failed. Please ensure PostgreSQL service is running and credentials are set.
)

pause
