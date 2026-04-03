@echo off
setlocal

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend
set ENGINE=%ROOT%simulation_engine

echo ============================================================
echo  ACM System Launcher
echo ============================================================

:: ── Python simulation engine ─────────────────────────────────────────────────
echo [1/3] Setting up Python simulation engine...
cd /d "%ENGINE%"

where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: python not found on PATH. Install Python 3.11+ and retry.
    pause & exit /b 1
)

python -m pip install -q -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed for simulation engine.
    pause & exit /b 1
)

start "ACM - Python Engine" cmd /k "cd /d "%ENGINE%" && python -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload"

:: ── Node backend ─────────────────────────────────────────────────────────────
echo [2/3] Setting up Node backend...
cd /d "%BACKEND%"

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: node not found on PATH. Install Node.js 18+ and retry.
    pause & exit /b 1
)

call npm install --silent
if errorlevel 1 (
    echo ERROR: npm install failed for backend.
    pause & exit /b 1
)

start "ACM - Backend" cmd /k "cd /d "%BACKEND%" && node server.js"

:: ── Seed database (runs after backend, retries until ready) ─────────────────
echo Seeding database with orbital data...
start "ACM - Seeder" cmd /c "cd /d "%BACKEND%" && node src/scripts/seed.js"

:: ── React frontend ────────────────────────────────────────────────────────────
echo [3/3] Setting up React frontend...
cd /d "%FRONTEND%"

call npm install --silent
if errorlevel 1 (
    echo ERROR: npm install failed for frontend.
    pause & exit /b 1
)

start "ACM - Frontend" cmd /k "cd /d "%FRONTEND%" && npm run dev"

echo.
echo ============================================================
echo  All services started in separate windows:
echo    Python Engine : http://localhost:9000
echo    Backend API   : http://localhost:8000
echo    Frontend      : http://localhost:5173
echo ============================================================
echo.
echo  NOTE: MongoDB must be running on mongodb://127.0.0.1:27017
echo  You can start it with: mongod --dbpath ^<your-data-dir^>
echo.
pause
