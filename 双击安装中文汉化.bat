@echo off
setlocal
title Antigravity Localization Installer

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_windows.ps1" install %*
set "LAUNCH_EXIT=%ERRORLEVEL%"

if not "%LAUNCH_EXIT%"=="0" (
    echo.
    echo [ERROR] Localization failed. Please check the messages above.
    pause
    exit /b %LAUNCH_EXIT%
)

timeout /t 5 >nul 2>&1
exit /b 0
