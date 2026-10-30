@echo off
setlocal enabledelayedexpansion

:: ==============================================================================
:: SmartHome Central Platform - Automated PostgreSQL Backup Script
:: ==============================================================================

set DB_NAME=smarthome_db
set DB_USER=postgres
set DB_HOST=localhost
set DB_PORT=5432
set BACKUP_DIR=..\backups
set LOG_FILE=%BACKUP_DIR%\backup.log

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a%%b)
set TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set BACKUP_FILE=%BACKUP_DIR%\smarthome_backup_%TIMESTAMP%.sql

echo [%date% %time%] Starting automated backup of database %DB_NAME%... >> "%LOG_FILE%"
echo Backing up %DB_NAME% to %BACKUP_FILE%...

pg_dump -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -F p -b -v -f "%BACKUP_FILE%" %DB_NAME% 2>> "%LOG_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] Backup successfully created: %BACKUP_FILE% >> "%LOG_FILE%"
    echo [SUCCESS] Backup completed: %BACKUP_FILE%
) else (
    echo [%date% %time%] [ERROR] Backup failed with code %ERRORLEVEL%! >> "%LOG_FILE%"
    echo [ERROR] Backup failed! Check %LOG_FILE% for details.
)

:: Retention Policy: Keep newest 8 backups, delete older ones
for /f "skip=8 delims=" %%F in ('dir /b /o-d "%BACKUP_DIR%\smarthome_backup_*.sql" 2^>nul') do (
    echo Pruning old backup: %%F >> "%LOG_FILE%"
    del "%BACKUP_DIR%\%%F"
)

endlocal
