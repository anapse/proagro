@echo off
chcp 65001 >nul
title Instalar servicio PROAGRO-WEB-FORENSICS
cd /d "%~dp0"
echo ========================================
echo  PROAGRO-WEB-FORENSICS — instalar como servicio
echo ========================================
echo.
where python >nul 2>nul
if errorlevel 1 goto :nopython
echo Python encontrado:
python --version
echo.
if not exist ".venv\Scripts\python.exe" goto :crearvenv
".venv\Scripts\python.exe" --version >nul 2>nul
if errorlevel 1 goto :recrear
goto :tarea

:recrear
echo [AVISO] El .venv existente esta roto (fue copiado de otra maquina o su
echo          Python base ya no existe). Se recrea ahora...
rmdir /s /q ".venv"
goto :crearvenv

:crearvenv
echo Instalando dependencias por primera vez...
python -m venv .venv
if errorlevel 1 goto :fail
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :depsmin
echo Dependencias instaladas.
goto :tarea

:depsmin
echo [AVISO] No se pudo instalar playwright; instalando lo esencial...
".venv\Scripts\python.exe" -m pip install flask requests beautifulsoup4 qrcode pillow
if errorlevel 1 goto :fail

:tarea
echo.
echo Creando tarea "PROAGRO-Forensics" (arranca con el VPS, usuario SYSTEM)...
schtasks /Create /TN "PROAGRO-Forensics" /TR "\"%~dp0servicio_proagro.cmd\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 goto :notarea
schtasks /Run /TN "PROAGRO-Forensics"
echo.
echo Tarea instalada y arrancada.
echo Log:    %~dp0proagro.log
echo Abre:   http://127.0.0.1:3792
echo Detener: DETENER_SERVICIO_VPS.bat
timeout /t 5 >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3792/api/health -TimeoutSec 6; Write-Host ('Estado: ' + $r.StatusCode + ' OK - la app responde') } catch { Write-Host 'Todavia no responde: mira proagro.log o el firewall (ABRIR_PUERTO_3792.bat).' }"
goto :fin

:nopython
echo [ERROR] No se encontro Python en el PATH.
echo Instala Python 3.11 o superior desde https://www.python.org/downloads/
echo IMPORTANTE: marca la casilla "Add python.exe to PATH".
goto :fin

:fail
echo [ERROR] Fallo al crear el entorno o instalar dependencias (detalle arriba).
goto :fin

:notarea
echo [ERROR] No se pudo crear la tarea. Ejecuta este BAT como administrador
echo (clic derecho -^> "Ejecutar como administrador").
goto :fin

:fin
echo.
timeout /t 20 >nul
pause >nul
