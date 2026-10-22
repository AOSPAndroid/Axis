@echo off
rem Double-click to chat with the models in your GitHub Copilot license. Needs Python 3.11 or newer.
title Axis Cloud
cd /d "%~dp0"
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY for /d %%D in ("C:\devhome\tools\python3*") do if exist "%%D\current\python.exe" set "PY="%%D\current\python.exe""
if not defined PY for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY="%%D\python.exe""
if not defined PY (
  echo Python was not found. Run copilot_chat.py with the full path to python.exe, for example:
  echo   C:\path\to\python.exe copilot_chat.py
  pause
  exit /b 1
)
%PY% copilot_chat.py %*
pause
