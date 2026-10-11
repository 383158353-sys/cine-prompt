@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Please install Node.js 22 LTS or newer first. & pause & exit /b 1)
if not exist .env.local copy .env.example .env.local >nul
if not exist node_modules (call npm install & if errorlevel 1 exit /b 1)
if not exist dist\index.html (call npm run build & if errorlevel 1 exit /b 1)
echo Open http://127.0.0.1:5173 in your browser after startup.
call npm start
pause
