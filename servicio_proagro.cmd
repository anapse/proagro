@echo off
cd /d "%~dp0"
set "PORT=3792"
set "HOST=0.0.0.0"
set "HTTPS_PORT=0"
".venv\Scripts\python.exe" run.py --no-browser >> "%~dp0proagro.log" 2>&1
