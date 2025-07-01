@echo off
:: Check for admin rights
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running with administrator privileges...
    cd /d "%~dp0"
    npm start
) else (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process cmd -ArgumentList '/c cd /d %~dp0 && npm start' -Verb RunAs"
)
pause 
