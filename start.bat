@echo off
chcp 65001 >nul
title WorkLift
cd /d "%~dp0"

REM 检查 Node.js 是否已安装
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装: https://nodejs.org
    echo 安装完成后重新运行本脚本。
    pause
    exit /b 1
)

echo WorkLift 正在启动...
echo 服务地址: http://127.0.0.1:8788
echo 停止服务请按 Ctrl+C，然后关闭本窗口。
echo.
node server.js
set EXIT_CODE=%ERRORLEVEL%
echo.
if %EXIT_CODE%==0 (
    echo WorkLift 已退出。
) else (
    echo [错误] WorkLift 异常退出，错误码: %EXIT_CODE%。可能原因: 端口已被占用或数据文件损坏。
)
pause
exit /b %EXIT_CODE%