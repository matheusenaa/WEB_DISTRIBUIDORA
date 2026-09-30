@echo off
chcp 65001 >nul
title WEB DISTRIBUIDORA - Iniciando...

echo ============================================
echo   WEB DISTRIBUIDORA - Ambiente Local
echo ============================================
echo.

REM Verifica se Node.js esta instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js %node:~-10% detectado
echo.

REM Verifica se as dependencias estao instaladas
if not exist node_modules (
    echo [INFO] Instalando dependencias (primeira execucao)... 
    npm install
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependencias
        pause
        exit /b 1
    )
    echo [OK] Dependencias instaladas
    echo.
)

REM Build do shared (necessario para API e Web)
echo [INFO] Buildando pacote shared...
npm run build:shared
if %errorlevel% neq 0 (
    echo [ERRO] Falha no build do shared
    pause
    exit /b 1
)
echo [OK] Shared buildado
echo.

REM Gera Prisma Client se necessario
if not exist node_modules\.prisma\client\query_engine-windows.dll.node (
    echo [INFO] Gerando Prisma Client...
    npm run db:generate
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao gerar Prisma Client
        pause
        exit /b 1
    )
    echo [OK] Prisma Client gerado
    echo.
)

REM Sincroniza banco de dados
echo [INFO] Sincronizando banco de dados...
npm run db:push
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao sincronizar banco
    pause
    exit /b 1
)
echo [OK] Banco sincronizado
echo.

echo ============================================
echo   Iniciando servidores...
echo ============================================
echo.
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:3333
echo.
echo Login: admin / ChangeMe123!
echo.
echo Pressione CTRL+C para parar os servidores
echo ============================================
echo.

REM Inicia API e Web em paralelo
npm run dev