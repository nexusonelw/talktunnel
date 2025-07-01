const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 确保 build/icons 目录存在
const iconsDir = path.join(__dirname, 'build', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 生成图标到临时目录
console.log('生成图标...');
execSync('electron-icon-builder --input=./file/icon.png --output=./build/temp-icon --flatten', { 
  stdio: 'inherit' 
});

// 移动生成的文件到正确位置
const tempIconsDir = path.join(__dirname, 'build', 'temp-icon', 'icons');
const targetIconsDir = path.join(__dirname, 'build', 'icons');

// 复制所有 PNG 文件
const pngFiles = fs.readdirSync(tempIconsDir).filter(file => file.endsWith('.png'));
pngFiles.forEach(file => {
  fs.copyFileSync(
    path.join(tempIconsDir, file), 
    path.join(targetIconsDir, file)
  );
});

// 复制 icns 和 ico 文件
if (fs.existsSync(path.join(tempIconsDir, 'icon.icns'))) {
  fs.copyFileSync(
    path.join(tempIconsDir, 'icon.icns'),
    path.join(targetIconsDir, 'icon.icns')
  );
}

if (fs.existsSync(path.join(tempIconsDir, 'icon.ico'))) {
  fs.copyFileSync(
    path.join(tempIconsDir, 'icon.ico'),
    path.join(targetIconsDir, 'icon.ico')
  );
}

// 创建 mac 和 win 子目录
const macDir = path.join(targetIconsDir, 'mac');
const winDir = path.join(targetIconsDir, 'win');
const pngDir = path.join(targetIconsDir, 'png');

if (!fs.existsSync(macDir)) fs.mkdirSync(macDir);
if (!fs.existsSync(winDir)) fs.mkdirSync(winDir);
if (!fs.existsSync(pngDir)) fs.mkdirSync(pngDir);

// 复制文件到子目录
if (fs.existsSync(path.join(targetIconsDir, 'icon.icns'))) {
  fs.copyFileSync(
    path.join(targetIconsDir, 'icon.icns'),
    path.join(macDir, 'icon.icns')
  );
}

if (fs.existsSync(path.join(targetIconsDir, 'icon.ico'))) {
  fs.copyFileSync(
    path.join(targetIconsDir, 'icon.ico'),
    path.join(winDir, 'icon.ico')
  );
}

// 移动 PNG 文件到 png 目录
pngFiles.forEach(file => {
  fs.renameSync(
    path.join(targetIconsDir, file),
    path.join(pngDir, file)
  );
});

// 清理临时目录
fs.rmSync(path.join(__dirname, 'build', 'temp-icon'), { recursive: true, force: true });

console.log('图标生成完成！');
console.log('图标位置：');
console.log('- macOS: build/icons/mac/icon.icns');
console.log('- Windows: build/icons/win/icon.ico');
console.log('- PNG: build/icons/png/');

// 额外复制图标到 assets 文件夹
const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir);
}

// 复制主要图标文件到 assets
if (fs.existsSync(path.join(iconsDir, 'mac/icon.icns'))) {
  fs.copyFileSync(
    path.join(iconsDir, 'mac/icon.icns'),
    path.join(assetsDir, 'icon-mac.icns')
  );
}

if (fs.existsSync(path.join(iconsDir, 'win/icon.ico'))) {
  fs.copyFileSync(
    path.join(iconsDir, 'win/icon.ico'),
    path.join(assetsDir, 'icon-win.ico')
  );
}

// 复制一些 PNG 图标
const pngSizes = ['16x16.png', '32x32.png', '256x256.png'];
pngSizes.forEach(size => {
  const sourcePath = path.join(iconsDir, 'png', size);
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, path.join(assetsDir, size));
  }
});

// 复制主图标
if (fs.existsSync(path.join(iconsDir, 'png/256x256.png'))) {
  fs.copyFileSync(
    path.join(iconsDir, 'png/256x256.png'),
    path.join(assetsDir, 'icon.png')
  );
}

console.log('图标已复制到 assets 文件夹'); 