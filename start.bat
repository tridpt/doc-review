@echo off
chcp 65001 >nul
title DocReview Studio - Port 4185
cd /d "%~dp0"
echo ===============================================================
echo   DocReview Studio - Tram Ra Soat ^& Phe Duyet Tai Lieu (4185)
echo ===============================================================
start "" "http://localhost:4185"
node server.js
pause
