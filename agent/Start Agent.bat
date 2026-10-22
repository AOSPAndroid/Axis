@echo off
rem Double-click to start Axis.
title Axis
cd /d "%~dp0"
set "PY="
where py >/dev/null 2>/dev/null && set "PY=py -3"
if not defined PY where python >/dev/null 2>/dev/null && set "PY=python"
if not defined PY for /d %%D in ("C:\devhome\tools\python3*") do if exist "%%D\current\python.exe" set "PY="%%D\current\python.exe""
if not defined PY for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY="%%D\python.exe""
if not defined PY (
  echo Python was not found. Run start.py with the full path to python.exe, for example:
  echo   C:\path\to\python.exe start.py
  pause
  exit /b 1
)
%PY% start.py %*
pause
