@echo off
title CTG - Simulador Simples Nacional (servidor local)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] Node.js nao encontrado no PATH.
  echo Instale o Node.js LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Primeira execucao: instalando dependencias, aguarde...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

echo.
echo ================================================================
echo   Simulador Simples Nacional - CTG (uso interno, sem publicar)
echo ----------------------------------------------------------------
echo   Neste PC:        http://localhost:8100
echo   Colegas na rede: http://SEU-IP-NA-REDE:8100
echo.
echo   Feche esta janela para derrubar o servidor.
echo ================================================================
echo.

call npm.cmd run dev
pause
