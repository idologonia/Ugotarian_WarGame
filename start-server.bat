@echo off
chcp 65001 >nul
rem Юготарія: сервер онлайн-гри. Подвійний клік — запуск; вікно не закривайте, поки граєте.
rem Інший порт: start-server.bat --port 9000
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js не знайдено. Встановіть версію LTS з https://nodejs.org і запустіть цей файл знову.
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
node server\server.js %*
pause
