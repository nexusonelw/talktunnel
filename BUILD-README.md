# 打包配置说明

这个项目现在支持跨平台打包，包括 macOS（Intel + ARM）和 Windows（x64 + ARM64）。

## 准备工作

### 1. 安装依赖
```bash
npm install
```

### 2. 准备图标文件
运行以下命令查看需要的图标文件：
```bash
node create-icons.js
```

**重要图标文件**：
- `build/icons/icon.icns` - macOS 图标
- `build/icons/icon.ico` - Windows 图标
- `build/icons/256x256.png` - Linux 图标
- `assets/tray.png` - 托盘图标

### 3. 生成图标（可选）
如果安装了 ImageMagick：
```bash
# 安装 ImageMagick (macOS)
brew install imagemagick

# 生成所有图标
./generate-icons.sh
```

## 打包命令

### 单独平台打包

**macOS**：
```bash
# Intel 版本
npm run dist-mac-x64

# ARM 版本 (M1/M2)
npm run dist-mac-arm

# 通用版本（同时支持 Intel 和 ARM）
npm run dist-mac-universal

# 所有 macOS 版本
npm run dist-mac
```

**Windows**：
```bash
# x64 版本
npm run dist-win-x64

# ARM64 版本
npm run dist-win-arm

# 所有 Windows 版本
npm run dist-win
```

### 自动化打包脚本

**所有平台**：
```bash
node build-all.js
```

**macOS 专用**：
```bash
./build-mac.sh
```

**Windows 专用**：
```bash
build-windows.bat
```

## 输出文件

打包完成后，文件将在 `dist` 目录中：

### macOS
- `Text Input Desktop-{version}-mac-{arch}.dmg` - DMG 安装包
- `Text Input Desktop-{version}-mac-{arch}.zip` - ZIP 压缩包

### Windows
- `Text Input Desktop Setup {version}.exe` - NSIS 安装程序
- `Text Input Desktop {version}.exe` - 便携版本

## 架构支持

| 平台 | Intel/x64 | ARM64 | Universal |
|------|-----------|-------|-----------|
| macOS | ✅ | ✅ | ✅ |
| Windows | ✅ | ✅ | ❌ |

## 故障排除

### 1. 原生模块编译失败
```bash
# 重新编译原生模块
npm run rebuild

# 或者删除 node_modules 重新安装
rm -rf node_modules package-lock.json
npm install
```

### 2. 图标文件缺失
确保以下文件存在：
- `build/icons/icon.icns`
- `build/icons/icon.ico`
- `build/icons/256x256.png`

### 3. macOS 代码签名
如果需要发布到 Mac App Store 或避免安全警告，需要：
1. 申请 Apple Developer 证书
2. 在 `package.json` 中配置代码签名

### 4. Windows 防病毒软件
未签名的 Windows 程序可能被防病毒软件拦截。解决方案：
1. 申请代码签名证书
2. 配置 Windows Defender 排除

## 高级配置

### 修改应用信息
编辑 `package.json` 中的 `build` 部分：
```json
{
  "build": {
    "appId": "com.yourcompany.electron-text-input",
    "productName": "Your App Name",
    "copyright": "Copyright © 2024 Your Company"
  }
}
```

### 添加更多目标平台
在 `package.json` 的 `build.win.target` 或 `build.mac.target` 中添加更多格式。

### 自定义安装程序
修改 `build.nsis` 配置来定制 Windows 安装程序。

## 性能优化

1. **文件排除**：在 `build.files` 中排除不必要的文件
2. **压缩**：启用 `build.compression` 来减小包大小
3. **分包**：对于大型应用，考虑使用 `build.electronDownload`

## 发布

打包完成后，可以将文件上传到：
- GitHub Releases
- 自己的网站
- 应用商店（需要额外配置）

## 注意事项

1. **首次打包**可能需要下载 Electron 二进制文件，耗时较长
2. **跨平台打包**需要在对应平台上进行（Windows 图标在 macOS 上可能有问题）
3. **原生依赖**可能在某些架构上编译失败，应用会自动回退到剪贴板模式
4. **文件大小**取决于 Electron 版本和依赖，通常在 100-200MB

---

如果遇到问题，请检查：
1. Node.js 版本是否兼容（推荐 16+）
2. 依赖是否正确安装
3. 图标文件是否完整
4. 打包日志中的错误信息 