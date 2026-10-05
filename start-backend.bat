@echo off
title OLD BTC MINER V5 - POOL BACKEND
echo ==========================================
echo  OLD BTC MINER V5 - POOL BACKEND
echo ==========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: npm install failed
        pause
        exit /b 1
    )
)

if not exist .env (
    echo.
    echo WARNING: .env file not found.
    echo Copy .env.example to .env and configure your settings:
    echo   copy .env.example .env
    echo.
    echo At minimum, set PAYOUT_ADDRESS to your Bitcoin address.
    echo.
    pause
)

echo Starting server on port 3000...
echo Press Ctrl+C to stop.
echo.
node server.js
