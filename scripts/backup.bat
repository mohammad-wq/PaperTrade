@echo off
REM ==============================================================================
REM Paper Trade - Database Backup Entrypoint (Native Windows)
REM Delegates to backup-local.bat
REM ==============================================================================

call "%~dp0backup-local.bat" %*
exit /b %ERRORLEVEL%
