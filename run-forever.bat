@echo off
title Minecraft Keep-Alive Bot
cd /d "%~dp0"
:loop
echo [%date% %time%] Starting bot...
npm start
echo [%date% %time%] Bot stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop