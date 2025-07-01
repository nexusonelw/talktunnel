@echo off
echo 开始打包 Windows 版本...

REM 清理dist目录
if exist dist rmdir /s /q dist

REM 安装依赖
call npm install

REM 重建原生模块
call npm run rebuild

REM 打包Windows x64版本
echo.
echo 打包 Windows x64...
call npm run dist-win-x64

REM 打包Windows ARM64版本
echo.
echo 打包 Windows ARM64...
call npm run dist-win-arm

echo.
echo 打包完成！文件在 dist 目录中
pause 