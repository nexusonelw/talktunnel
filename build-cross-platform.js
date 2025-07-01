const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 清理旧的构建文件
console.log('清理旧的构建文件...');
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  fs.rmSync(distPath, { recursive: true, force: true });
}

// 安装依赖
console.log('安装依赖...');
execSync('npm install', { stdio: 'inherit' });

// 重建原生模块
console.log('重建原生模块...');
try {
  execSync('npm run rebuild', { stdio: 'inherit' });
} catch (error) {
  console.warn('原生模块重建失败，继续...');
}

// 执行跨平台构建
async function buildCrossPlatform() {
  const builds = [
    { platform: 'mac', arch: 'x64', name: 'macOS (Intel)' },
    { platform: 'mac', arch: 'arm64', name: 'macOS (ARM M1/M2)' },
    { platform: 'win', arch: 'x64', name: 'Windows x64' },
    { platform: 'win', arch: 'arm64', name: 'Windows ARM64' }
  ];

  for (const build of builds) {
    console.log(`\n开始构建 ${build.name}...`);
    try {
      const cmd = `npm run dist-${build.platform}-${build.arch}`;
      execSync(cmd, { stdio: 'inherit' });
      console.log(`${build.name} 构建成功`);
    } catch (error) {
      console.error(`${build.name} 构建失败:`, error.message);
    }
  }
}

buildCrossPlatform().then(() => {
  console.log('\n所有平台构建完成');
  console.log('输出文件在 dist 目录中');
}); 