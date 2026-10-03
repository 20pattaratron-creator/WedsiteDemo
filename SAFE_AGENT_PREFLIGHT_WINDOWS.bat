@echo off
setlocal
cd /d "%~dp0"
echo ==================================================
echo ERP AI-Agent Repo Safety Preflight
echo This script audits only. It DOES NOT launch any AI agent.
echo ==================================================
node scripts\security\agent-repo-audit.mjs "%~dp0"
set rc=%errorlevel%
echo.
if not "%rc%"=="0" (
  echo SECURITY REVIEW REQUIRED. Do not open an AI agent yet.
) else (
  echo Preflight completed without blocking findings.
)
pause
exit /b %rc%
