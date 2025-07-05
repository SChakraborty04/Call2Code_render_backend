@echo off
echo Starting Express server...
start "Express Server" cmd /k "npm run dev"

echo Waiting for server to start...
timeout /t 5 /nobreak > nul

echo Starting ngrok tunnel...
start "ngrok" cmd /k "ngrok http 8787"

echo.
echo ================================================
echo   Backend is starting...
echo   Express server: http://localhost:8787
echo   ngrok tunnel will be available in a few seconds
echo   Health check: http://localhost:8787/health
echo   DB Status: http://localhost:8787/admin/db/status
echo ================================================
echo.
pause
