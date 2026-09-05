@echo off
REM Permitir SOLO el puerto TCP 3792 en redes PRIVADAS (no expone a Internet).
REM PROAGRO-WEB-FORENSICS — EJECUTAR COMO ADMINISTRADOR una sola vez.
echo [1/3] Marcando la red actual como PRIVADA...
powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object {$_.NetworkCategory -ne 'Private'} | Set-NetConnectionProfile -NetworkCategory Private" 2>nul
echo.
echo [2/3] Creando regla: TCP 3792 SOLO perfil privado...
netsh advfirewall firewall delete rule name="PROAGRO-WEB-FORENSICS 3792" >nul 2>&1
netsh advfirewall firewall add rule name="PROAGRO-WEB-FORENSICS 3792" ^
     dir=in action=allow protocol=TCP localport=3792 profile=private ^
     description="Dashboard PROAGRO-WEB-FORENSICS solo red local (privada). No expone a Internet."
echo.
echo [3/3] Comprobando...
netsh advfirewall firewall show rule name="PROAGRO-WEB-FORENSICS 3792"
echo.
echo  Abre:  http://IP-DE-ESTA-PC:3792
echo  IP:    ipconfig  (busca 'Direccion IPv4')
pause
