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

// 构建配置 - 只包含需要的平台和架构
const builds = [
  { platform: 'mac', arch: 'x64', name: 'macOS (Intel)' },
  { platform: 'mac', arch: 'arm64', name: 'macOS (ARM M1/M2)' },
  { platform: 'win', arch: 'x64', name: 'Windows x64' },
  { platform: 'win', arch: 'arm64', name: 'Windows ARM64' }
];

// 执行构建
async function buildAll() {
  console.log('\n开始构建所有平台...\n');
  
  for (const build of builds) {
    console.log(`\n开始构建 ${build.name}...`);
    try {
      const cmd = `npm run dist-${build.platform}-${build.arch}`;
      execSync(cmd, { stdio: 'inherit' });
      console.log(`${build.name} 构建成功`);
      
      // 打印生成的文件
      console.log('生成的安装包:');
      if (build.platform === 'mac') {
        const dmgFiles = fs.readdirSync(distPath).filter(file => 
          file.endsWith('.dmg') && file.includes(build.arch)
        );
        dmgFiles.forEach(file => console.log(`  - ${file}`));
      } else if (build.platform === 'win') {
        const exeFiles = fs.readdirSync(distPath).filter(file => 
          file.endsWith('.exe') && file.includes('Setup')
        );
        exeFiles.forEach(file => console.log(`  - ${file}`));
      }
      
    } catch (error) {
      console.error(`${build.name} 构建失败:`, error.message);
    }
  }
  
  console.log('\n所有平台构建完成！');
  console.log('\n生成的安装包位于 dist 目录:');
  
  // 列出所有生成的安装包
  const files = fs.readdirSync(distPath);
  console.log('\nmacOS 安装包:');
  files.filter(f => f.endsWith('.dmg')).forEach(f => console.log(`  - ${f}`));
  
  console.log('\nWindows 安装包:');
  files.filter(f => f.endsWith('.exe') && f.includes('Setup')).forEach(f => console.log(`  - ${f}`));
}

buildAll().then(() => {
  console.log('\n构建脚本执行完成');
}).catch(error => {
  console.error('\n构建脚本执行失败:', error);
  process.exit(1);
}); 