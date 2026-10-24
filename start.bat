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

REM 检查 Python 是否已安装（PDF 转换工具需要本机 Python）
where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装: https://www.python.org/downloads/
    echo 安装时务必勾选 "Add python.exe to PATH"。
    pause
    exit /b 1
)

REM 首次运行：创建 Python 虚拟环境并安装 PDF 转换依赖（需联网，约几分钟）
if not exist "python\.venv\.ok" (
    echo 正在准备 Python 环境（首次运行需联网，请稍候）...
    python -m venv "python\.venv"
    if errorlevel 1 (
        echo [错误] 创建 Python 虚拟环境失败。
        pause
        exit /b 1
    )
    "python\.venv\Scripts\python.exe" -m pip install -r python\requirements.txt --disable-pip-version-check --timeout 60
    if errorlevel 1 (
        echo 官方源下载超时，改用清华镜像重试...
        "python\.venv\Scripts\python.exe" -m pip install -r python\requirements.txt --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 120 --retries 10
    )
    if errorlevel 1 (
        echo [错误] 安装 PDF 转换依赖失败，请检查网络后重新运行本脚本。
        pause
        exit /b 1
    )
    echo ok> "python\.venv\.ok"
    echo Python 环境准备完成。
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