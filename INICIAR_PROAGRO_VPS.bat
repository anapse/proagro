@echo off
chcp 65001 >nul
title PROAGRO-WEB-FORENSICS
cd /d "%~dp0"
echo ========================================
echo  PROAGRO-WEB-FORENSICS
echo ========================================
echo.
where python >nul 2>nul
if errorlevel 1 goto :nopython
echo Python encontrado:
python --version
echo.
set "PORT=3792"
set "HOST=0.0.0.0"
set "HTTPS_PORT=0"
if not exist ".venv\Scripts\python.exe" goto :crearvenv
".venv\Scripts\python.exe" --version >nul 2>nul
if errorlevel 1 goto :recrear
goto :run

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
echo.
goto :run

:depsmin
echo [AVISO] No se pudo instalar el paquete opcional (playwright/browser).
echo         Instalando lo esencial (la app funciona sin navegador)...
".venv\Scripts\python.exe" -m pip install flask requests beautifulsoup4 qrcode pillow
if errorlevel 1 goto :fail
goto :run

:run
echo ========================================
echo  PROAGRO-WEB-FORENSICS
echo ========================================
echo  Puerto : %PORT%   (variable PORT; por defecto 3792)
echo  Bind   : %HOST%
echo  Local  : http://127.0.0.1:%PORT%
echo  VPS    : http://IP-DEL-VPS:%PORT%
echo ========================================
echo  AVISO: escucha en TODAS las interfaces de red.
echo  Para DETENER el servidor: cierra esta ventana o pulsa Ctrl+C
echo.
".venv\Scripts\python.exe" run.py --no-browser
goto :fin

:nopython
echo [ERROR] No se encontro Python en el PATH.
echo Instala Python 3.11 o superior desde https://www.python.org/downloads/
echo IMPORTANTE: marca la casilla "Add python.exe to PATH" al instalarlo.
goto :fin

:fail
echo [ERROR] Algo fallo en la instalacion o el arranque.
echo Revisa el mensaje de error de arriba.
goto :fin

:fin
echo.
echo ========================================
echo  La aplicacion termino. Ventana abierta 30 s o pulsa una tecla.
echo ========================================
timeout /t 30 >nul
pause >nul
