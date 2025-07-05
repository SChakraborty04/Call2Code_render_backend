@echo off
REM Create a .env file if it doesn't exist
if not exist .env (
  echo Creating default .env file...
  echo PORT=8787 > .env
  echo FRONTEND_URL=http://localhost:8080 >> .env
  echo NODE_ENV=development >> .env
)

REM Build and start the server
echo Building TypeScript...
call npm run build

echo Starting server with CORS debugging enabled...
call npm start
