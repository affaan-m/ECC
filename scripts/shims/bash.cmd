@echo off
setlocal
node "%~dp0bash-shim.js" %*
exit /b %ERRORLEVEL%
