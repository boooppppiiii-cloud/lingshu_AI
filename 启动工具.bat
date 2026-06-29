@echo off
chcp 65001 >nul
title 海外工作台 - 启动中...
cd /d "%~dp0"

echo ============================================
echo   海外营销工作台  启动程序
echo ============================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 20+
    echo 下载地址：https://nodejs.org/
    pause
    exit /b 1
)

:: 检查 node_modules
if not exist "node_modules" (
    echo [提示] 首次运行，正在安装依赖（约需 2-5 分钟）...
    npm install --registry https://registry.npmmirror.com
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
)

:: 检查 rolldown 原生绑定
if not exist "node_modules\@rolldown\binding-win32-x64-msvc" (
    echo [提示] 安装 Windows 原生依赖...
    set ELECTRON_SKIP_BINARY_DOWNLOAD=1
    npm install @rolldown/binding-win32-x64-msvc --no-save --registry https://registry.npmmirror.com
)

:: 安装 PM2
where pm2 >nul 2>&1
if errorlevel 1 (
    echo [提示] 安装 PM2 进程管理器...
    npm install -g pm2 --registry https://registry.npmmirror.com
)

echo.
echo [1/3] 启动数据库 (PocketBase)...
start "PocketBase" /min "%~dp0pocketbase.exe" serve --http=127.0.0.1:8091 --dir="%~dp0pb_data"
timeout /t 3 /nobreak >nul

echo [2/3] 启动后端服务...
start "Backend" /min cmd /c "cd /d "%~dp0" && node node_modules\tsx\dist\cli.mjs server/index.ts"
timeout /t 4 /nobreak >nul

echo [3/3] 启动前端服务...
start "Frontend" /min cmd /c "cd /d "%~dp0" && node node_modules\vite\bin\vite.js"
timeout /t 5 /nobreak >nul

echo.
echo ============================================
echo   启动完成！
echo   浏览器访问：http://localhost:5174
echo ============================================
echo.
echo   关闭此窗口会停止所有服务
echo   请保持此窗口在后台运行
echo.

:: 打开浏览器
start "" "http://localhost:5174"

:: 保持窗口，等待用户关闭
:loop
timeout /t 60 /nobreak >nul
goto loop
