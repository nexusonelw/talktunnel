const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('================================================');
console.log('    TalkTunnel 多平台安装包构建脚本');
console.log('================================================\n');

// 检查 Node.js 版本
const nodeVersion = process.version;
console.log(`Node.js 版本: ${nodeVersion}`);
if (parseInt(nodeVersion.split('.')[0].slice(1)) < 16) {
    console.error('错误: 需要 Node.js 16 或更高版本');
    process.exit(1);
}

// 清理旧的构建文件
console.log('步骤 1/4: 清理旧的构建文件...');
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    // 只删除安装包文件，保留其他可能有用的文件
    const files = fs.readdirSync(distPath);
    files.forEach(file => {
        if (file.endsWith('.dmg') || (file.endsWith('.exe') && file.includes('Setup'))) {
            fs.unlinkSync(path.join(distPath, file));
            console.log(`  删除: ${file}`);
        }
    });
}

// 生成图标
console.log('\n步骤 2/4: 生成应用图标...');
try {
    execSync('npm run generate-icons', { stdio: 'inherit' });
    console.log('  ✓ 图标生成成功');
} catch (error) {
    console.error('  ✗ 图标生成失败，使用现有图标');
}

// 构建配置
const builds = [
    {
        platform: 'mac',
        arch: 'arm64',
        name: 'macOS ARM (M1/M2)',
        expectedFile: /TalkTunnel-.*-arm64\.dmg$/
    },
    {
        platform: 'mac',
        arch: 'x64',
        name: 'macOS Intel',
        expectedFile: /TalkTunnel-.*-x64\.dmg$/
    },
    {
        platform: 'win',
        arch: 'x64',
        name: 'Windows x64',
        expectedFile: /TalkTunnel.*Setup.*\.exe$/
    },
    {
        platform: 'win',
        arch: 'arm64',
        name: 'Windows ARM64',
        expectedFile: /TalkTunnel.*Setup.*\.exe$/
    }
];

// 执行构建
console.log('\n步骤 3/4: 开始构建安装包...\n');

const results = [];

for (let i = 0; i < builds.length; i++) {
    const build = builds[i];
    console.log(`[${i + 1}/${builds.length}] 构建 ${build.name}...`);
    
    const startTime = Date.now();
    
    try {
        // 设置环境变量以确保正确的架构
        const env = { ...process.env };
        if (build.platform === 'win' && build.arch === 'arm64') {
            env.npm_config_arch = 'arm64';
        }
        
        const cmd = `npm run dist-${build.platform}-${build.arch}`;
        execSync(cmd, { stdio: 'pipe', env });
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        // 查找生成的文件
        if (fs.existsSync(distPath)) {
            const files = fs.readdirSync(distPath);
            const generatedFile = files.find(f => build.expectedFile.test(f));
            
            if (generatedFile) {
                const fileSize = (fs.statSync(path.join(distPath, generatedFile)).size / 1024 / 1024).toFixed(1);
                console.log(`  ✓ 成功 (${duration}s) - ${generatedFile} (${fileSize} MB)`);
                results.push({
                    platform: build.name,
                    success: true,
                    file: generatedFile,
                    size: fileSize
                });
            } else {
                console.log(`  ✗ 失败 - 未找到预期的安装包文件`);
                results.push({
                    platform: build.name,
                    success: false
                });
            }
        }
        
    } catch (error) {
        console.log(`  ✗ 失败 - ${error.message}`);
        results.push({
            platform: build.name,
            success: false,
            error: error.message
        });
    }
}

// 显示构建结果
console.log('\n步骤 4/4: 构建完成！\n');
console.log('================================================');
console.log('                构建结果汇总');
console.log('================================================');

const successCount = results.filter(r => r.success).length;
console.log(`\n成功: ${successCount}/${results.length}\n`);

results.forEach(result => {
    if (result.success) {
        console.log(`✓ ${result.platform}`);
        console.log(`  文件: ${result.file}`);
        console.log(`  大小: ${result.size} MB`);
    } else {
        console.log(`✗ ${result.platform}`);
        if (result.error) {
            console.log(`  错误: ${result.error}`);
        }
    }
    console.log('');
});

if (successCount > 0) {
    console.log('安装包位置: ./dist/');
    console.log('\n提示: 你可以在 dist 目录中找到所有生成的安装包');
}

console.log('================================================\n');

// 如果有失败的构建，以非零状态退出
if (successCount < results.length) {
    process.exit(1);
} 