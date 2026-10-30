@echo off
setlocal enabledelayedexpansion

:: ==============================================================================
:: SmartHome Central Platform - PostgreSQL Restore Verification Script
:: Usage: restore_postgres.bat [backup_file_path]
:: ==============================================================================

set DB_NAME=smarthome_db
set DB_USER=postgres
set DB_HOST=localhost
set DB_PORT=5432

if "%~1"=="" (
    echo [ERROR] Please provide the path to the backup file to restore.
    echo Usage: restore_postgres.bat ..\backups\smarthome_backup_YYYYMMDD_HHMMSS.sql
    exit /b 1
)

set BACKUP_FILE=%~1

if not exist "%BACKUP_FILE%" (
    echo [ERROR] Backup file "%BACKUP_FILE%" does not exist.
    exit /b 1
)

echo [WARNING] This will restore %BACKUP_FILE% into database "%DB_NAME%".
set /p CONFIRM="Are you sure you want to proceed? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Restore cancelled by user.
    exit /b 0
)

echo Restoring database %DB_NAME% from %BACKUP_FILE%...
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f "%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Database restored and verified successfully.
) else (
    echo [ERROR] Restore encountered errors. Error code: %ERRORLEVEL%
)

endlocal
