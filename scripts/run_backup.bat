@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: 1. ENVIRONMENT & PATH SETUP
:: ============================================================================
cd /d "%~dp0.."

:: Default local backup on C drive
set "LOCAL_BACKUP_DIR=C:\PaperTradeBackups\local"
set "LOG_FILE=C:\PaperTradeBackups\backup_execution.log"

:: Dynamic pg_dump detection across standard PostgreSQL install directories
where pg_dump >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" (
        set "PATH=C:\Program Files\PostgreSQL\18\bin;!PATH!"
    ) else if exist "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" (
        set "PATH=C:\Program Files\PostgreSQL\17\bin;!PATH!"
    ) else if exist "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" (
        set "PATH=C:\Program Files\PostgreSQL\16\bin;!PATH!"
    ) else if exist "C:\Program Files\PostgreSQL\15\bin\pg_dump.exe" (
        set "PATH=C:\Program Files\PostgreSQL\15\bin;!PATH!"
    )
)

:: Build timestamp: YYYY-MM-DD_HHMM
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set "DT=%%I"
if not defined DT (
    for /f "tokens=1-4 delims=/ " %%A in ("%DATE%") do set "DT=%%C%%A%%B"
)
set "TIMESTAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,4%"
set "BACKUP_FILENAME=papertrade_%TIMESTAMP%.dump"
set "FULL_LOCAL_PATH=%LOCAL_BACKUP_DIR%\%BACKUP_FILENAME%"

:: ============================================================================
:: 2. DYNAMIC DATABASE CREDENTIALS & CONNECTION STRING
:: ============================================================================
set "PGUSER="
set "PGPASSWORD="
set "PGHOST="
set "PGPORT="
set "PGDATABASE="
set "RAW_URL="

if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b "DATABASE_URL" .env 2^>nul`) do (
        set "RAW_URL=%%B"
    )
)

if defined RAW_URL (
    :: Strip surrounding quotes
    set "RAW_URL=!RAW_URL:"=!"
    set "RAW_URL=!RAW_URL:'=!"
    
    :: Remove query parameters (e.g. ?schema=public)
    for /f "tokens=1 delims=?" %%A in ("!RAW_URL!") do set "CLEAN_URL=%%A"
    
    :: Strip protocol prefix
    set "URL_BODY=!CLEAN_URL:*://=!"
    
    :: Split user:password@host:port/database
    for /f "tokens=1,2 delims=@" %%A in ("!URL_BODY!") do (
        set "CRED_PART=%%A"
        set "HOST_PART=%%B"
    )
    
    if not defined HOST_PART (
        set "HOST_PART=!CRED_PART!"
        set "CRED_PART="
    )
    
    if defined CRED_PART (
        for /f "tokens=1,2 delims=:" %%A in ("!CRED_PART!") do (
            set "PGUSER=%%A"
            set "PGPASSWORD=%%B"
        )
    )
    
    for /f "tokens=1,2 delims=/" %%A in ("!HOST_PART!") do (
        set "NET_ADDR=%%A"
        set "PGDATABASE=%%B"
    )
    
    if defined NET_ADDR (
        for /f "tokens=1,2 delims=:" %%A in ("!NET_ADDR!") do (
            set "PGHOST=%%A"
            if not "%%B"=="" set "PGPORT=%%B"
        )
    )
)

:: Default fallbacks if unpopulated
if not defined PGUSER set "PGUSER=postgres"
if not defined PGHOST set "PGHOST=localhost"
if not defined PGPORT set "PGPORT=5432"
if not defined PGDATABASE set "PGDATABASE=papertrade"

if not exist "%LOCAL_BACKUP_DIR%" mkdir "%LOCAL_BACKUP_DIR%"

echo ============================================================================ >> "%LOG_FILE%"
echo [%date% %time%] INITIATING SCHEDULED BACKUP >> "%LOG_FILE%"

:: ============================================================================
:: 3. CREATE LOCAL POSTGRES DUMP
:: ============================================================================
echo [%date% %time%] Running pg_dump to %FULL_LOCAL_PATH%... >> "%LOG_FILE%"
pg_dump -w -h !PGHOST! -p !PGPORT! -U !PGUSER! -F c -b -v -f "%FULL_LOCAL_PATH%" !PGDATABASE! >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] CRITICAL ERROR: pg_dump failed with exit code %ERRORLEVEL%. >> "%LOG_FILE%"
    exit /b %ERRORLEVEL%
)
echo [%date% %time%] Local dump completed successfully. >> "%LOG_FILE%"

:: ============================================================================
:: 4. PRUNE LOCAL STORAGE (KEEP ONLY 3 MOST RECENT DUMPS)
:: ============================================================================
echo [%date% %time%] Pruning local folder: keeping 3 newest backups... >> "%LOG_FILE%"
for /f "skip=3 delims=" %%F in ('dir "%LOCAL_BACKUP_DIR%\*.dump" /b /a-d /o-d 2^>nul') do (
    echo [%date% %time%] Deleting older backup: %%F >> "%LOG_FILE%"
    del "%LOCAL_BACKUP_DIR%\%%F" >> "%LOG_FILE%" 2>&1
)

:: ============================================================================
:: 5. CLOUD UPLOAD & SYNC TO RCLONE PAPETRADE_BACKUP / PAPERTRADEBACKUP
:: ============================================================================
echo [%date% %time%] Starting Cloud Sync... >> "%LOG_FILE%"

:: Target: rclone papertrade_backup remote and PaperTradeBackup drive folder
set "RCLONE_REMOTE=papertrade_backup"
set "RCLONE_FOLDER=PaperTradeBackup"
set "CLOUD_TARGET=!RCLONE_REMOTE!:!RCLONE_FOLDER!/daily_latest.dump"

:: Rclone Resolution
set "RCLONE_EXE="
if exist "%~dp0rclone.exe" (
    set "RCLONE_EXE=%~dp0rclone.exe"
) else if exist "C:\rclone\rclone.exe" (
    set "RCLONE_EXE=C:\rclone\rclone.exe"
) else (
    for /f "delims=" %%I in ('where rclone 2^>nul') do (
        if not defined RCLONE_EXE set "RCLONE_EXE=%%I"
    )
)

set "RCLONE_CONF="
if exist "%APPDATA%\rclone\rclone.conf" (
    set "RCLONE_CONF=%APPDATA%\rclone\rclone.conf"
) else if exist "%USERPROFILE%\.config\rclone\rclone.conf" (
    set "RCLONE_CONF=%USERPROFILE%\.config\rclone\rclone.conf"
) else if exist "C:\rclone\rclone.conf" (
    set "RCLONE_CONF=C:\rclone\rclone.conf"
)

if defined RCLONE_EXE (
    echo [%date% %time%] Executing rclone sync to !CLOUD_TARGET!... >> "%LOG_FILE%"
    if defined RCLONE_CONF (
        "!RCLONE_EXE!" --config "!RCLONE_CONF!" copyto "%FULL_LOCAL_PATH%" "!CLOUD_TARGET!" >> "%LOG_FILE%" 2>&1
    ) else (
        "!RCLONE_EXE!" copyto "%FULL_LOCAL_PATH%" "!CLOUD_TARGET!" >> "%LOG_FILE%" 2>&1
    )
    if !ERRORLEVEL! EQU 0 (
        echo [%date% %time%] Cloud sync succeeded. >> "%LOG_FILE%"
    ) else (
        echo [%date% %time%] ERROR: Rclone failed with code !ERRORLEVEL!. >> "%LOG_FILE%"
    )
) else (
    if exist "scripts\upload_to_drive.js" (
        echo [%date% %time%] Running Node.js cloud sync fallback... >> "%LOG_FILE%"
        node "scripts\upload_to_drive.js" "%FULL_LOCAL_PATH%" >> "%LOG_FILE%" 2>&1
    ) else (
        echo [%date% %time%] WARNING: No cloud tool found. Cloud sync skipped. >> "%LOG_FILE%"
    )
)

echo [%date% %time%] BACKUP WORKFLOW COMPLETE. >> "%LOG_FILE%"
exit /b 0
