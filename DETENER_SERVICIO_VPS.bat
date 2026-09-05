@echo off
chcp 65001 >nul
schtasks /End /TN "PROAGRO-Forensics"
echo.
echo Servicio detenido. Para volver a arrancarlo:
echo   schtasks /Run /TN "PROAGRO-Forensics"
echo.
pause >nul
