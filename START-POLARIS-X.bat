@echo off
setlocal EnableExtensions
title POLARIS-X Launcher
cd /d "%~dp0"

echo ============================================================
echo  POLARIS-X  -  Antarctic Navigation Decision Support System
echo  One-click launcher  (first run installs dependencies)
echo ============================================================
echo.

rem ---- 1. prerequisites ---------------------------------------
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found on PATH.
  echo         Install Python 3.11+ from https://www.python.org/downloads/
  echo         and tick "Add python.exe to PATH" during installation.
  echo.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH.
  echo         Install Node.js 20+ ^(LTS^) from https://nodejs.org/
  echo.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found on PATH. Reinstall Node.js from https://nodejs.org/
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo   Found %%v
for /f "tokens=*" %%v in ('node --version') do echo   Found Node %%v
echo.

rem ---- 2. Python packages (idempotent) ------------------------
echo [1/6] Checking Python packages ^(fastapi uvicorn numpy pillow rasterio^)...
python -m pip install --quiet --disable-pip-version-check fastapi uvicorn numpy pillow rasterio
if errorlevel 1 (
  echo [ERROR] pip install failed. Check your internet connection and retry.
  echo.
  pause
  exit /b 1
)

rem ---- 3. Node packages (only if missing) ----------------------
if exist "backend\node_modules" (
  echo [2/6] Backend packages already installed.
) else (
  echo [2/6] Installing backend packages...
  pushd backend
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    popd
    echo [ERROR] backend npm install failed.
    pause
    exit /b 1
  )
  popd
)

if exist "frontend\node_modules" (
  echo [3/6] Frontend packages already installed.
) else (
  echo [3/6] Installing frontend packages...
  pushd frontend
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    popd
    echo [ERROR] frontend npm install failed.
    pause
    exit /b 1
  )
  popd
)

rem ---- 4. production build (only if missing) -------------------
if exist "frontend\dist\index.html" (
  echo [4/6] Production build already present.
) else (
  echo [4/6] Building production frontend...
  pushd frontend
  call npm run build
  if errorlevel 1 (
    popd
    echo [ERROR] frontend build failed.
    pause
    exit /b 1
  )
  popd
)

rem ---- 5. start the three services ------------------------------
echo [5/6] Starting services - three windows will open. KEEP THEM OPEN.
start "POLARIS-X - Python env/ML API :8100" /d "%~dp0python-services" cmd /k python -m uvicorn env_data.api:app --host 0.0.0.0 --port 8100
start "POLARIS-X - Node application API :8200" /d "%~dp0backend" cmd /k npm run start
start "POLARIS-X - Web app :4173" /d "%~dp0frontend" cmd /k npm run preview

rem ---- 6. wait for health, warm drill cache, open browser -------
echo [6/6] Waiting for services to come up...
where curl >nul 2>nul
if errorlevel 1 goto nocurl

set tries=0
:waitloop
timeout /t 2 /nobreak >nul
curl -s -o nul http://localhost:8100/env/health >nul 2>nul
if errorlevel 1 goto notyet
curl -s -o nul http://localhost:8200/api/health >nul 2>nul
if errorlevel 1 goto notyet
goto healthy
:notyet
set /a tries+=1
if %tries% lss 30 goto waitloop
echo [WARN] Services are taking longer than expected - opening the app anyway.
goto openapp

:healthy
echo        Services healthy.
echo        Pre-computing the re-planning drill ^(~10 s, makes the demo instant^)...
curl -s -o nul http://localhost:8200/api/routes/replan-drill >nul 2>nul
goto openapp

:nocurl
echo        curl not found - waiting 20 s instead of health-checking...
timeout /t 20 /nobreak >nul

:openapp
start "" http://localhost:4173
echo.
echo ============================================================
echo  POLARIS-X is running:   http://localhost:4173
echo.
echo  Demo script:            docs\setup-and-demo.md  ^(section 4^)
echo  To STOP the system:     close the three service windows.
echo ============================================================
echo.
echo This launcher window can be closed now.
pause
