@echo off
REM One-click publish — double-click this file (no terminal needed).
REM Regenerates the data from data/*.csv, builds, and deploys to production.
cd /d "%~dp0"
echo ============================================
echo   Travel Map - publishing to production...
echo ============================================
echo.
call npm run deploy
echo.
if %errorlevel%==0 (
  echo ============================================
  echo   Done. Your changes are live.
  echo ============================================
) else (
  echo ============================================
  echo   Something went wrong (see messages above^).
  echo ============================================
)
echo.
echo Press any key to close this window.
pause >nul
