# 图标配置完整指南

这份文档说明了如何为您的 Electron Text Input 应用设置完整的图标配置。

## 🎯 功能概述

本配置方案为应用提供：
- **应用程序图标**：用于应用启动器、任务栏、Dock 等
- **系统托盘图标**：在系统托盘中显示的小图标
- **PWA 图标**：用于网页应用的图标
- **多平台支持**：Windows (.ico)、macOS (.icns)、Linux (.png)

## 📁 目录结构

```
electron-text-input/
├── file/
│   └── icon.png                    # 源图标文件 (1024x1024 推荐)
├── assets/                         # 托盘图标存储
│   ├── tray-icon.ico              # Windows 托盘图标
│   ├── tray-icon.icns             # macOS 托盘图标
│   ├── tray-icon.png              # 通用托盘图标
│   ├── tray-icon-win.ico          # Windows 专用托盘图标
│   ├── tray-icon-mac.icns         # macOS 专用托盘图标
│   ├── tray-icon-mac.png          # macOS PNG 托盘图标
│   ├── 16x16-tray.png             # 16x16 托盘图标
│   ├── 32x32-tray.png             # 32x32 托盘图标
│   └── 256x256-tray.png           # 256x256 托盘图标
├── build/
│   └── icons/
│       ├── mac/
│       │   └── icon.icns          # macOS 应用图标
│       ├── win/
│       │   └── icon.ico           # Windows 应用图标
│       └── png/                   # 各种尺寸的 PNG 图标
│           ├── 16x16.png
│           ├── 24x24.png
│           ├── 32x32.png
│           ├── 48x48.png
│           ├── 64x64.png
│           ├── 128x128.png
│           ├── 256x256.png
│           ├── 512x512.png
│           └── 1024x1024.png
└── public/
    └── icons/
        ├── icon-192x192.png       # PWA 图标
        └── icon-512x512.png       # PWA 图标
```

## 🛠️ 安装和使用

### 1. 安装依赖

```bash
npm install --save-dev electron-icon-maker
```

### 2. 生成图标

```bash
# 生成所有图标
npm run generate-icons

# 生成图标并构建应用
npm run build
```

### 3. 可用的脚本命令

```bash
npm run generate-icons      # 只生成图标
npm run build              # 生成图标并构建应用
npm run pack               # 生成图标并打包（不分发）
npm run dist               # 生成图标并创建分发包
npm run dist-mac           # 生成 macOS 版本
npm run dist-win           # 生成 Windows 版本
npm run dist-all           # 生成所有平台版本
```

## 🔧 配置说明

### 源图标要求

- **格式**：PNG
- **尺寸**：建议 1024x1024 像素或更大
- **质量**：高分辨率，背景透明
- **位置**：`/Users/nexusone/project/flutter/electron-text-input/file/icon.png`

### 托盘图标配置

应用会自动根据平台选择合适的托盘图标：

- **macOS**：优先使用 16x16-tray.png，回退到其他 PNG 格式
- **Windows**：优先使用 .ico 格式
- **Linux**：使用 PNG 格式

### 应用图标配置

在 `package.json` 中配置：

```json
{
  "build": {
    "mac": {
      "icon": "build/icons/mac/icon.icns"
    },
    "win": {
      "icon": "build/icons/win/icon.ico"
    },
    "linux": {
      "icon": "build/icons"
    }
  }
}
```

## 🔄 自动化流程

`generate-icons.js` 脚本会：

1. 检查源图标文件是否存在
2. 使用 electron-icon-maker 生成所有尺寸的图标
3. 创建 macOS (.icns) 和 Windows (.ico) 格式
4. 复制托盘图标到 assets 目录
5. 创建 PWA 图标到 public/icons 目录

## 🎨 图标最佳实践

### 设计建议

- 使用简洁的设计，在小尺寸下仍然清晰可辨
- 避免细节过多的图像
- 确保在明暗背景下都有良好的对比度
- 使用矢量图形（SVG）作为源文件，然后导出为高分辨率 PNG

### 托盘图标特殊考虑

- **macOS**：托盘图标应该是黑白的，系统会自动处理颜色
- **Windows**：可以使用彩色图标
- **Linux**：建议使用有颜色的图标

## 🚀 验证配置

### 检查图标是否正确生成

```bash
# 检查构建目录中的图标
ls -la build/icons/mac/
ls -la build/icons/win/
ls -la build/icons/png/

# 检查托盘图标
ls -la assets/*tray*

# 检查 PWA 图标
ls -la public/icons/
```

### 测试应用

```bash
# 启动应用并检查托盘图标
npm start

# 构建并测试打包后的应用
npm run pack
```

## 🔧 故障排除

### 常见问题

1. **托盘图标不显示**
   - 检查文件路径是否正确
   - 确认图标文件存在且可读
   - 查看控制台错误信息

2. **图标模糊或失真**
   - 确保源图标是高分辨率的
   - 重新生成图标：`npm run generate-icons`

3. **构建失败**
   - 检查 build/icons 目录是否存在
   - 确认所有必需的图标文件都已生成

### 调试信息

应用启动时会在控制台输出图标加载信息：

```bash
# 启动应用并查看图标加载日志
npm start
```

## 📝 自定义配置

如需修改图标路径或添加新尺寸，请编辑 `generate-icons.js` 文件中的相关配置。

## ✅ 完成清单

- [x] 安装 electron-icon-maker
- [x] 创建 generate-icons.js 脚本
- [x] 更新 package.json 脚本
- [x] 配置构建路径
- [x] 更新托盘图标加载逻辑
- [x] 创建 PWA 图标
- [x] 测试构建流程

您的图标配置现在已经完全设置好了！ 