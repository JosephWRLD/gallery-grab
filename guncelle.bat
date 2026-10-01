@echo off
chcp 65001 >nul
rem Gallery Grab: GitHub'daki en yeni eklenti surumunu bu klasorun ustune yazar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1" %*
echo.
pause
