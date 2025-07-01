#!/bin/bash

echo "开始打包 macOS 版本..."

# 清理dist目录
rm -rf dist

# 安装依赖
npm install

# 重建原生模块
npm run rebuild

# 打包macOS Intel版本
echo ""
echo "打包 macOS Intel..."
npm run dist-mac-x64

# 打包macOS ARM版本
echo ""
echo "打包 macOS ARM (M1/M2)..."
npm run dist-mac-arm

# 打包macOS Universal版本
echo ""
echo "打包 macOS Universal..."
npm run dist-mac-universal

echo ""
echo "打包完成！文件在 dist 目录中" 