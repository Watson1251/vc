@echo off
:: Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo 🔒 Requesting admin privileges...
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

set MKCERT=mkcert.exe

if not exist %MKCERT% (
    echo ❌ mkcert.exe not found in current directory.
    exit /b 1
)

echo 📎 Installing local CA for mkcert...
%MKCERT% -install

echo ✅ Local CA installed for mkcert.
pause
