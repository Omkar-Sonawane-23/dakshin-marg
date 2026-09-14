@echo off
setlocal EnableExtensions
rem ============================================================
rem  Dakshin Marg - one-click SIH demo video (Windows)
rem
rem    MAKE-DEMO-VIDEO.bat                 full render (~15 min)
rem    MAKE-DEMO-VIDEO.bat --short         core acts only
rem    MAKE-DEMO-VIDEO.bat --dry           rehearsal: screenshots only
rem    MAKE-DEMO-VIDEO.bat --help          every option
rem
rem  First run installs what is missing (node modules, python venv,
rem  Chromium, ffmpeg). Requires Node.js 20+ and Python 3.11+ on PATH.
rem ============================================================
title Dakshin Marg - demo video generator
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH. Install it from https://nodejs.org
  echo         and run this file again.
  goto :end
)

where python >nul 2>nul
if errorlevel 1 (
  echo [WARN] Python not found on PATH - the scientific services and the
  echo        default TTS voice need it. Continuing; preflight will report.
)

node tools\demo-video\bin\make-demo.mjs %*
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo ============================================================
  echo  Done. Your video is in docs\video\
  echo    Dakshin-Marg-demo.mp4         master 1600x900, narrated
  echo    Dakshin-Marg-demo-720p.mp4    shareable cut for submission
  echo    Dakshin-Marg-demo.srt         subtitles
  echo ============================================================
) else (
  echo ============================================================
  echo  The pipeline stopped with an error ^(exit code %RC%^).
  echo  Read the last FAIL line above, or check tools\demo-video\work\logs\
  echo ============================================================
)

:end
echo.
pause
endlocal
