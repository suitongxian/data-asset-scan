@echo off
REM Electron build script for Windows
REM Usage: build.bat [mac|linux|win|all]

setlocal

cd /d "%~dp0"

set PLATFORM=%1
if "%PLATFORM%"=="" set PLATFORM=win

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found
    exit /b 1
)

REM Check yarn
where yarn >nul 2>&1
if errorlevel 1 (
    echo yarn not found
    exit /b 1
)

echo Installing dependencies...
call yarn install
if errorlevel 1 exit /b 1

echo Building app...
call yarn vue-tsc
if errorlevel 1 exit /b 1

call yarn vite build
if errorlevel 1 exit /b 1

echo Packaging for: %PLATFORM%
if "%PLATFORM%"=="mac" (
    call yarn electron-builder --mac
) else if "%PLATFORM%"=="linux" (
    call yarn electron-builder --linux
) else if "%PLATFORM%"=="win" (
    call yarn electron-builder --win
) else if "%PLATFORM%"=="all" (
    call yarn electron-builder --mac --linux --win
) else (
    echo Unknown platform: %PLATFORM%
    exit /b 1
)

if errorlevel 1 exit /b 1

echo Build complete! Output: release/
endlocal
