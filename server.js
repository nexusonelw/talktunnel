const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { clipboard } = require('electron');
const multer = require('multer');
const WebSocket = require('ws');
const fs = require('fs');
const Store = require('electron-store');
const store = new Store();
const { pasteWithPowerShell } = require('./windows-paste-helper');
const cloudSync = require('./cloudSyncService');
const { startNetworkMonitor } = require('./networkMonitor');
const { createCommandProcessor } = require('./commandProcessor');

// 获取 Electron app 对象（在主进程中可用）
const electronApp = global.electronApp || null;

// 服务器端 i18n 配置
const serverTranslations = {
  zh: {
    fileSizeLimit: '文件大小超过50MB限制',
    invalidFileName: '上传的文件名称不正确',
    fileCountLimit: '只能同时上传一个文件',
    uploadError: '上传错误',
    fileUploadIncomplete: '文件上传不完整，请重试',
    fileUploadFailed: '文件上传失败',
    noFileReceived: '没有接收到文件',
    fileSaveFailed: '文件保存失败',
    emptyFile: '接收到的文件为空',
    fileProcessFailed: '文件处理失败'
  },
  en: {
    fileSizeLimit: 'File size exceeds 50MB limit',
    invalidFileName: 'Invalid file name',
    fileCountLimit: 'Only one file can be uploaded at a time',
    uploadError: 'Upload error',
    fileUploadIncomplete: 'File upload incomplete, please retry',
    fileUploadFailed: 'File upload failed',
    noFileReceived: 'No file received',
    fileSaveFailed: 'File save failed',
    emptyFile: 'Received file is empty',
    fileProcessFailed: 'File processing failed'
  }
};

// 根据请求头获取语言
function getRequestLanguage(req) {
  const lang = req.headers['accept-language'];
  return lang && lang.startsWith('zh') ? 'zh' : 'en';
}

// 服务器端翻译函数
function ts(key, req) {
  const lang = getRequestLanguage(req);
  return serverTranslations[lang][key] || serverTranslations.en[key] || key;
}

// Try to load nut.js, fallback to clipboard-only mode if it fails
let nutjs;
let nutJSAvailable = false;

try {
    nutjs = require('@nut-tree-fork/nut-js');
    
    // Windows specific configuration
    if (process.platform === 'win32') {
        // Set keyboard configurations for Windows
        nutjs.keyboard.config.autoDelayMs = 50;  // Increased from 5
        nutjs.keyboard.config.typeDelayMs = 10;  // Increased from 0
        
        // Set mouse config
        nutjs.mouse.config.autoDelayMs = 50;     // Increased from 10
        nutjs.mouse.config.mouseSpeed = 1000;
        
        // Add additional Windows-specific settings
        nutjs.keyboard.config.waitForInputEvents = true;
        nutjs.screen.config.confidence = 0.9;
        nutjs.screen.config.autoHighlight = false;
    }
    
    nutJSAvailable = true;
    console.log('Nut.js loaded successfully with enhanced Windows configuration');
} catch (error) {
    console.warn('Nut.js not available, using clipboard-only mode:', error.message);
    
    if (process.platform === 'win32') {
        console.warn('Note: Windows requires admin privileges for automatic paste functionality');
        console.warn('Please ensure the application is running with administrator rights');
    }
}

const app = express();
let server;
let serverPort;
let serverIP;
let serverIPs = [];
let cloudRegistrationError = null;
let stopNetworkMonitor = null;
let connectedClients = new Map();

// WebSocket服务器
let wss;
let wsClients = new Set();

// 获取可写的用户数据目录
let uploadsDir;

// 判断是否在打包后的环境中运行
const isPackaged = __dirname.includes('.asar');

if (isPackaged || electronApp) {
  // 在打包环境或Electron环境中，使用用户数据目录
  try {
    const app = electronApp || require('electron').app;
    uploadsDir = path.join(app.getPath('userData'), 'uploads');
  } catch (e) {
    // 如果无法获取 userData 路径，使用临时目录
    uploadsDir = path.join(require('os').tmpdir(), 'talktunnel-uploads');
  }
} else {
  // 在开发环境中使用项目目录
  uploadsDir = path.join(__dirname, 'uploads');
}

// 延迟创建目录，在实际使用时再创建
function ensureUploadDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

// 文件上传配置
const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    fieldSize: 50 * 1024 * 1024,
    fields: 10,
    files: 1,
    parts: 1000,
    headerPairs: 2000
  },
  // 在文件上传前确保目录存在
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      ensureUploadDir();
      cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname);
    }
  }),
  // 添加文件过滤器
  fileFilter: (req, file, cb) => {
    // 检查文件是否存在
    if (!file) {
      return cb(new Error('No file provided'));
    }
    cb(null, true);
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.text({ type: 'text/plain', limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 添加请求日志中间件
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} from ${req.ip}`);
  next();
});

// Windows specific: Ensure the target window has focus
async function ensureWindowFocus() {
    if (process.platform === 'win32' && nutJSAvailable && nutjs) {
        try {
            // Method 1: Get current mouse position
            const currentPos = await nutjs.mouse.getPosition();
            
            // Method 2: Click at current mouse position to ensure focus
            await nutjs.mouse.setPosition(currentPos);
            await nutjs.mouse.leftClick();
            
            // Wait for click to be processed
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Method 3: Send Alt+Tab and Alt+Tab again to ensure our window is active
            await nutjs.keyboard.pressKey(nutjs.Key.LeftAlt, nutjs.Key.Tab);
            await nutjs.keyboard.releaseKey(nutjs.Key.LeftAlt, nutjs.Key.Tab);
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Method 4: Click again at the position
            await nutjs.mouse.leftClick();
            await new Promise(resolve => setTimeout(resolve, 100));
            
            console.log('Window focus ensured via multiple methods');
        } catch (error) {
            console.error('Error ensuring window focus:', error);
        }
    }
}

function sortLanIps(ips) {
  const rank = (ip) => ip.startsWith('192.') ? 0 : ip.startsWith('100.') ? 1 : ip.startsWith('10.') ? 2 : 3;
  return [...new Set(ips)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// Get local IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && /^(192\.|100\.|10\.)/.test(iface.address)) {
        ips.push(iface.address);
      }
    }
  }
  return sortLanIps(ips);
}

function getLocalIP() {
  return getLocalIPs()[0] || '127.0.0.1';
}

// Paste text at cursor position
async function pasteTextAtCursor(text) {
    try {
        // Windows specific handling
        if (process.platform === 'win32') {
            console.log('Windows: Attempting to paste text...');
            
            // First, always copy to clipboard as backup
            clipboard.writeText(text);
            console.log('Text copied to clipboard');
            
            if (nutJSAvailable && nutjs) {
                // Ensure window focus first
                await ensureWindowFocus();
                
                // Additional delay for Windows
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Try Method 1: Direct keyboard paste (Ctrl+V)
                try {
                    console.log('Attempting Ctrl+V paste...');
                    await nutjs.keyboard.pressKey(nutjs.Key.LeftControl, nutjs.Key.V);
                    await new Promise(resolve => setTimeout(resolve, 50));
                    await nutjs.keyboard.releaseKey(nutjs.Key.LeftControl, nutjs.Key.V);
                    
                    console.log('Ctrl+V paste completed');
                    return true;
                } catch (pasteError) {
                    console.error('Ctrl+V paste failed:', pasteError);
                    
                    // Try Method 2: Type text character by character
                    console.log('Falling back to character-by-character typing...');
                    for (const char of text) {
                        await nutjs.keyboard.type(char);
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                    console.log('Character typing completed');
                    return true;
                }
            } else {
                console.log('Nut.js not available, trying PowerShell method...');
                try {
                    await pasteWithPowerShell(text);
                    console.log('PowerShell paste successful');
                    return true;
                } catch (psError) {
                    console.error('PowerShell paste failed:', psError);
                    console.log('Text in clipboard only');
                }
            }
        } else {
            // Mac and Linux handling remains the same
            const originalClipboard = clipboard.readText();
            clipboard.writeText(text);
            
            if (nutJSAvailable && nutjs) {
                if (process.platform === 'darwin') {
                    await nutjs.keyboard.pressKey(nutjs.Key.LeftCmd, nutjs.Key.V);
                    await nutjs.keyboard.releaseKey(nutjs.Key.LeftCmd, nutjs.Key.V);
                } else {
                    await nutjs.keyboard.pressKey(nutjs.Key.LeftControl, nutjs.Key.V);
                    await nutjs.keyboard.releaseKey(nutjs.Key.LeftControl, nutjs.Key.V);
                }
                
                setTimeout(() => {
                    clipboard.writeText(originalClipboard);
                }, 200);
            }
        }
        
        return true;
    } catch (error) {
        console.error('Error in pasteTextAtCursor:', error);
        clipboard.writeText(text);
        console.log('Error occurred, text in clipboard as fallback');
        return false;
    }
}

async function pressEnterAtCursor() {
  if (nutJSAvailable && nutjs) {
    await nutjs.keyboard.pressKey(nutjs.Key.Enter);
    await nutjs.keyboard.releaseKey(nutjs.Key.Enter);
    return true;
  }
  if (process.platform === 'win32') {
    const { execFile } = require('child_process');
    await new Promise((resolve, reject) => {
      execFile('powershell', ['-NoProfile', '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"],
      (error) => error ? reject(error) : resolve());
    });
    return true;
  }
  return false;
}

const processCommand = createCommandProcessor({
  store,
  pasteText: async (text) => {
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await ensureWindowFocus();
    }
    return pasteTextAtCursor(text);
  },
  pressEnter: pressEnterAtCursor
});

async function processLocalCommand(req, res, kind) {
  try {
    const success = await processCommand({
      id: req.get('X-TalkTunnel-Command-Id') || null,
      kind,
      text: kind === 'enter' ? '' : req.body
    });
    res.status(success ? 200 : 500).send(success ? 'OK' : 'Failed');
  } catch (error) {
    console.error('Failed to process command:', error);
    res.status(error.message === 'Invalid command' ? 400 : 500).send('Error');
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 从手机上传文件到PC
app.post('/upload-to-pc', (req, res) => {
  // 设置较长的请求超时时间
  req.setTimeout(120000); // 2分钟

  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);

      // 详细的错误处理
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            return res.status(400).json({ error: ts('fileSizeLimit', req) });
          case 'LIMIT_UNEXPECTED_FILE':
            return res.status(400).json({ error: ts('invalidFileName', req) });
          case 'LIMIT_FILE_COUNT':
            return res.status(400).json({ error: ts('fileCountLimit', req) });
          default:
            return res.status(400).json({ error: ts('uploadError', req) + ': ' + err.message });
        }
      } else if (err.message === 'Unexpected end of form') {
        return res.status(400).json({ error: ts('fileUploadIncomplete', req) });
      }

      return res.status(500).json({ error: ts('fileUploadFailed', req) + ': ' + err.message });
    }

    try {
      const file = req.file;
      const clientIP = req.ip || req.connection.remoteAddress;

      if (!file) {
        return res.status(400).json({ error: ts('noFileReceived', req) });
      }

      console.log(`Received file from ${clientIP}:`, file.originalname, 'Size:', file.size);

      // 检查文件是否完整
      if (!fs.existsSync(file.path)) {
        return res.status(400).json({ error: ts('fileSaveFailed', req) });
      }

      const stats = fs.statSync(file.path);
      if (stats.size === 0) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: ts('emptyFile', req) });
      }

      // 读取文件内容
      const fileContent = fs.readFileSync(file.path);

      // 如果是图片，复制到剪贴板
      if (file.mimetype && file.mimetype.startsWith('image/')) {
        const { nativeImage } = require('electron');
        const image = nativeImage.createFromBuffer(fileContent);
        clipboard.writeImage(image);
        console.log('Image copied to clipboard');
      } else {
        // 其他文件保存到桌面
        const desktopPath = path.join(os.homedir(), 'Desktop', file.originalname);
        fs.writeFileSync(desktopPath, fileContent);
        console.log('File saved to:', desktopPath);
      }

      // 清理临时文件
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      res.json({
        status: 'success',
        filename: file.originalname,
        size: file.size,
        savedTo: file.mimetype && file.mimetype.startsWith('image/') ? 'clipboard' : 'desktop'
      });
    } catch (error) {
      console.error('Error handling file upload:', error);

      // 确保清理临时文件
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error('Error cleaning up temp file:', e);
        }
      }

      res.status(500).json({ error: ts('fileProcessFailed', req) + ': ' + error.message });
    }
  });
});

// 从PC发送文件到所有手机
app.post('/send-to-phones', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileContent = fs.readFileSync(file.path);
    const base64Content = fileContent.toString('base64');

    // 通过WebSocket发送给所有连接的客户端
    const message = JSON.stringify({
      type: 'file',
      filename: file.originalname,
      mimetype: file.mimetype,
      content: base64Content
    });

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    // 清理临时文件
    fs.unlinkSync(file.path);

    console.log(`File ${file.originalname} sent to ${wsClients.size} clients`);
    res.json({ status: 'success', clients: wsClients.size });
  } catch (error) {
    console.error('Error sending file to phones:', error);
    res.status(500).json({ error: 'Failed to send file' });
  }
});

// 客户端连接注册端点
app.post('/connect', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;

  // 注册新连接的客户端
  connectedClients.set(clientIP, {
    lastSeen: new Date(),
    count: 1
  });

  console.log(`Client connected from ${clientIP}. Total clients: ${connectedClients.size}`);
  res.json({ status: 'connected', clientIP: clientIP });
  serverIPs = getLocalIPs();
  serverIP = serverIPs[0] || '127.0.0.1';
  void cloudSync.updateIps({ lanIps: serverIPs, port: serverPort }).catch((error) => {
    console.error('Failed to sync IPs after client connect:', error.message);
  });
});

// 客户端断开连接端点
app.post('/disconnect', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;

  if (connectedClients.has(clientIP)) {
    connectedClients.delete(clientIP);
    console.log(`Client disconnected from ${clientIP}. Total clients: ${connectedClients.size}`);
  }

  res.json({ status: 'disconnected' });
});

// 心跳端点
app.post('/heartbeat', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;

  if (connectedClients.has(clientIP)) {
    connectedClients.set(clientIP, {
      ...connectedClients.get(clientIP),
      lastSeen: new Date()
    });
  }

  res.json({ status: 'alive' });
});

app.post('/', async (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    // Update last seen time and increment count
    if (connectedClients.has(clientIP)) {
        connectedClients.set(clientIP, {
            ...connectedClients.get(clientIP),
            lastSeen: new Date()
        });
    }
    
    console.log(`Received text command from ${clientIP}`);
    await processLocalCommand(req, res, 'text');
});

app.post('/send-and-enter', (req, res) => processLocalCommand(req, res, 'text_enter'));

// 获取保存的延迟时间
app.get('/get-delay', (req, res) => {
    const delay = store.get('userDelayTime', 2); // 默认2秒
    res.json({ delay: delay });
});

// 保存延迟时间
app.post('/save-delay', (req, res) => {
    const { delay } = req.body;
    if (delay !== undefined && delay >= 0 && delay <= 10) {
        store.set('userDelayTime', delay);
        console.log(`Delay time saved: ${delay} seconds`);
        res.json({ status: 'success', delay: delay });
    } else {
        res.status(400).json({ error: 'Invalid delay value' });
    }
});

// 发送回车键端点
app.post('/enter-key', (req, res) => processLocalCommand(req, res, 'enter'));

// Start server
function startServer() {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      serverPort = server.address().port;
      serverIPs = getLocalIPs();
      serverIP = serverIPs[0] || '127.0.0.1';
      console.log(`Server running on ${serverIP}:${serverPort}`);

      // 设置服务器超时
      server.timeout = 120000; // 2分钟超时
      server.keepAliveTimeout = 65000; // keep-alive超时
      server.headersTimeout = 66000; // headers超时

      // 创建WebSocket服务器
      wss = new WebSocket.Server({ server });

      wss.on('connection', (ws) => {
        wsClients.add(ws);
        console.log('WebSocket client connected. Total clients:', wsClients.size);

        ws.on('close', () => {
          wsClients.delete(ws);
          console.log('WebSocket client disconnected. Total clients:', wsClients.size);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
        });
      });

      if (!stopNetworkMonitor) {
        stopNetworkMonitor = startNetworkMonitor({
          getLanIps: getLocalIPs,
          getPort: () => serverPort,
          onChange: async ({ lanIps, port }) => {
            serverIPs = lanIps;
            serverIP = lanIps[0] || '127.0.0.1';
            await cloudSync.updateIps({ lanIps, port });
          }
        });
      }

      resolve();
    });
  });
}

// Get server info
function getServerInfo() {
  const cloud = cloudSync.getClientInfo(serverPort);
  return {
    ip: serverIP,
    ips: serverIPs,
    port: serverPort,
    url: cloud.cloudUrl,
    localUrl: `http://${serverIP}:${serverPort}`,
    wsUrl: `ws://${serverIP}:${serverPort}`,
    cloud,
    cloudRegistrationError,
    connectedClients: Array.from(connectedClients.entries()).map(([ip, data]) => ({
      ip,
      ...data
    }))
  };
}

// 定期清理超时的客户端（30秒没有心跳的视为断开）
setInterval(() => {
  const now = new Date();
  const timeout = 30000; // 30秒超时

  for (const [ip, data] of connectedClients.entries()) {
    if (now - data.lastSeen > timeout) {
      connectedClients.delete(ip);
      console.log(`Client ${ip} timed out. Total clients: ${connectedClients.size}`);
    }
  }
}, 10000); // 每10秒检查一次

// 将错误处理中间件移到所有路由之后
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error('Multer error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件大小超过限制（最大50MB）' });
    }
    return res.status(400).json({ error: `上传错误: ${error.message}` });
  } else if (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: '服务器错误: ' + error.message });
  }
  next();
});

module.exports = {
  startServer,
  getServerInfo,
  getLocalIPs,
  handleRelayCommand: ({ id, kind, text }) => processCommand({ id, kind, text }),
  setCloudRegistrationError: (error) => {
    cloudRegistrationError = error ? String(error.stack || error.message || error) : null;
  }
};
