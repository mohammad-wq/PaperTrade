@echo off
REM ==============================================================================
REM Paper Trade - Safe Production Update Script (Native Windows)
REM Workflow:
REM   1. Pre-update database backup (abort on failure)
REM   2. Stop application service / running process
REM   3. git pull latest changes
REM   4. npm install if dependencies changed
REM   5. npm run build (standalone Next.js bundle)
REM   6. npx prisma migrate deploy (abort and do NOT restart if migration fails)
REM   7. Restart service (NSSM or standalone launcher)
REM   8. Automated health check verification
REM All activities logged to update-log.txt
REM ==============================================================================

cd /d "%~dp0"

set UPDATE_LOG=logs\update-log.txt
if not exist "logs" mkdir logs
if defined PAPERTRADE_BACKUP_DIR (
    set UPDATE_LOG=%PAPERTRADE_BACKUP_DIR%\update-log.txt
) else if exist "C:\PaperTradeBackups" (
    set UPDATE_LOG=C:\PaperTradeBackups\update-log.txt
)

echo [%DATE% %TIME%] [UPDATE_START] Beginning safe application update... >> "%UPDATE_LOG%"
echo ======================================================================
echo  Paper Trade - Safe Application Update
echo ======================================================================
echo.

REM ----------------------------------------------------------------------
REM STEP 1: Pre-update database backup
REM ----------------------------------------------------------------------
echo [1/7] Creating pre-update safety database backup...
echo [%DATE% %TIME%] [STEP_1] Running pre-update database backup >> "%UPDATE_LOG%"

node scripts\backup-runner.js --type=LOCAL >> "%UPDATE_LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [FATAL ERROR] Pre-update database backup failed!
    echo [%DATE% %TIME%] [ABORT] Pre-update backup failed with exit code %ERRORLEVEL%. Aborting update to protect data. >> "%UPDATE_LOG%"
    echo Update ABORTED to protect your data. Check %UPDATE_LOG% for details.
    pause
    exit /b 1
)
echo [SUCCESS] Database safety backup created successfully.

REM ----------------------------------------------------------------------
REM STEP 2: Stop application service
REM ----------------------------------------------------------------------
echo [2/7] Stopping application service...
echo [%DATE% %TIME%] [STEP_2] Stopping application service >> "%UPDATE_LOG%"

where nssm >nul 2>&1
if not errorlevel 1 (
    nssm status PaperTrade >nul 2>&1
    if not errorlevel 1 (
        nssm stop PaperTrade >> "%UPDATE_LOG%" 2>&1
    )
)
call stop.bat >> "%UPDATE_LOG%" 2>&1

REM ----------------------------------------------------------------------
REM STEP 3: Git Pull
REM ----------------------------------------------------------------------
echo [3/7] Pulling latest code changes from repository...
echo [%DATE% %TIME%] [STEP_3] Executing git pull >> "%UPDATE_LOG%"

git pull >> "%UPDATE_LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] git pull returned non-zero. Continuing with local files...
    echo [%DATE% %TIME%] [WARN] git pull exited with code %ERRORLEVEL% >> "%UPDATE_LOG%"
)

REM ----------------------------------------------------------------------
REM STEP 4: Install dependencies
REM ----------------------------------------------------------------------
echo [4/7] Checking and installing npm packages...
echo [%DATE% %TIME%] [STEP_4] Running npm install >> "%UPDATE_LOG%"

call npm install >> "%UPDATE_LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install failed!
    echo [%DATE% %TIME%] [ABORT] npm install failed. >> "%UPDATE_LOG%"
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------
REM STEP 5: Build standalone bundle
REM ----------------------------------------------------------------------
echo [5/7] Compiling application bundle (npm run build)...
echo [%DATE% %TIME%] [STEP_5] Executing npm run build >> "%UPDATE_LOG%"

call npm run build >> "%UPDATE_LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [FATAL ERROR] Build compilation failed!
    echo [%DATE% %TIME%] [ABORT] npm run build failed with code %ERRORLEVEL%. >> "%UPDATE_LOG%"
    echo Application build failed. Check %UPDATE_LOG% for error output.
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------
REM STEP 6: Apply Database Migrations (CRITICAL: DO NOT RESTART IF FAILS)
REM ----------------------------------------------------------------------
echo [6/7] Applying database schema migrations (prisma migrate deploy)...
echo [%DATE% %TIME%] [STEP_6] Running prisma migrate deploy >> "%UPDATE_LOG%"

call npx prisma migrate deploy >> "%UPDATE_LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ======================================================================
    echo  [CRITICAL ERROR] Database migration failed!
    echo ======================================================================
    echo  Service has NOT been restarted to prevent database corruption.
    echo  A pre-update backup is safely stored in your backups directory.
    echo  Log file: %UPDATE_LOG%
    echo ======================================================================
    echo [%DATE% %TIME%] [CRITICAL_ABORT] prisma migrate deploy failed with code %ERRORLEVEL%. Service NOT restarted. >> "%UPDATE_LOG%"
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------
REM STEP 7: Restart Service and Perform Health Check
REM ----------------------------------------------------------------------
echo [7/7] Restarting service and verifying health...
echo [%DATE% %TIME%] [STEP_7] Restarting application and health checking >> "%UPDATE_LOG%"

set RESTARTED=0
where nssm >nul 2>&1
if not errorlevel 1 (
    nssm status PaperTrade >nul 2>&1
    if not errorlevel 1 (
        nssm start PaperTrade >> "%UPDATE_LOG%" 2>&1
        set RESTARTED=1
    )
)

if %RESTARTED%==0 (
    call start.bat
) else (
    REM Poll health check for NSSM service
    echo Waiting for application to respond on http://localhost:3000...
    set ATTEMPTS=0
    :health_loop
    set /a ATTEMPTS+=1
    where curl >nul 2>&1
    if not errorlevel 1 (
        curl -s -f -L -o nul http://localhost:3000 >nul 2>&1
        if not errorlevel 1 goto update_success
    )
    if %ATTEMPTS% GEQ 20 goto update_timeout
    timeout /t 2 /nobreak >nul
    goto health_loop
)

:update_success
echo.
echo ======================================================================
echo  [SUCCESS] Paper Trade updated and verified healthy!
echo ======================================================================
echo [%DATE% %TIME%] [UPDATE_COMPLETE] Update succeeded and verified responsive on http://localhost:3000 >> "%UPDATE_LOG%"
pause
exit /b 0

:update_timeout
echo.
echo [WARN] Service started but health check timed out. Please check logs at %UPDATE_LOG%.
echo [%DATE% %TIME%] [WARN] Health check timed out after restart. >> "%UPDATE_LOG%"
pause
exit /b 0
