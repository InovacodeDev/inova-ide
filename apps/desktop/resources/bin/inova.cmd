@echo off
setlocal
for %%I in ("%~dp0..\..") do set "APP_DIR=%%~fI"
set "ELECTRON_RUN_AS_NODE=1"
"%APP_DIR%\InovaIDE.exe" "%APP_DIR%\resources\cli\dist\cli.js" %*
exit /b %ERRORLEVEL%
