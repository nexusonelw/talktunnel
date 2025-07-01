const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 先设置全局 app 对象
global.electronApp = app;

// 然后再加载 server
const { startServer, getServerInfo } = require('./server');

// 获取系统语言
function getSystemLanguage() {
  const lang = app.getLocale();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

// i18n 翻译对象
const mainTranslations = {
  zh: {
    showWindow: '显示主窗口',
    hideWindow: '隐藏主窗口', 
    serverInfo: '服务器信息',
    serverRunning: '服务器运行中',
    ipAddress: 'IP地址',
    port: '端口',
    connectedClients: '已连接设备',
    quit: '退出',
    appTooltip: 'TalkTunnel - 点击显示/隐藏窗口'
  },
  en: {
    showWindow: 'Show Window',
    hideWindow: 'Hide Window',
    serverInfo: 'Server Info', 
    serverRunning: 'Server Running',
    ipAddress: 'IP Address',
    port: 'Port',
    connectedClients: 'Connected Clients',
    quit: 'Quit',
    appTooltip: 'TalkTunnel - Click to show/hide window'
  }
};

// 翻译函数
function t(key) {
  const lang = getSystemLanguage();
  return mainTranslations[lang][key] || mainTranslations.en[key] || key;
}

let mainWindow;
let tray = null;  // 托盘实例
let isQuiting = false;  // 退出标志

function createWindow() {
  // 设置窗口图标
  let windowIcon;
  if (process.platform === 'darwin') {
    // macOS 使用 icns
    windowIcon = path.join(__dirname, 'build/icons/mac/icon.icns');
  } else if (process.platform === 'win32') {
    // Windows 使用 ico
    windowIcon = path.join(__dirname, 'build/icons/win/icon.ico');
  } else {
    // Linux 使用 png
    windowIcon = path.join(__dirname, 'build/icons/png/256x256.png');
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false
    },
    show: false,  // 初始不显示
    backgroundColor: '#ffffff'  // 设置背景色为白色
  });

  mainWindow.loadFile('index.html');

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 监听窗口关闭事件
  mainWindow.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Windows 特定：从任务栏隐藏
      if (process.platform === 'win32') {
        mainWindow.setSkipTaskbar(true);
      }
      
      // 显示通知（仅第一次）
      if (!mainWindow.hasBeenHidden) {
        mainWindow.hasBeenHidden = true;
        // 可以在这里添加系统通知
      }
    }
  });

  // 监听最小化事件
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
    
    if (process.platform === 'win32') {
      mainWindow.setSkipTaskbar(true);
    }
  });

  // Start HTTP server
  startServer();
}

// 创建系统托盘
function createTray() {
  // 简化图标加载逻辑，直接使用构建好的图标
  let trayIconPath;
  
  if (process.platform === 'darwin') {
    // macOS 使用 16x16 PNG 作为托盘图标
    trayIconPath = path.join(__dirname, 'build/icons/png/16x16.png');
  } else if (process.platform === 'win32') {
    // Windows 使用 ico
    trayIconPath = path.join(__dirname, 'build/icons/win/icon.ico');
  } else {
    // Linux 使用 png
    trayIconPath = path.join(__dirname, 'build/icons/png/32x32.png');
  }

  // 检查图标文件是否存在
  if (!fs.existsSync(trayIconPath)) {
    console.error('Tray icon file not found:', trayIconPath);
    return;
  }

  // 创建托盘图标
  try {
    const trayIcon = nativeImage.createFromPath(trayIconPath);
    
    // macOS 需要调整图标大小
    if (process.platform === 'darwin') {
      tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
      // macOS 设置为模板图像（会自动适应深色/浅色主题）
      // tray.setTemplateImage(true);
    } else {
      tray = new Tray(trayIcon);
    }
    
    // 设置提示文字
    tray.setToolTip(t('appTooltip'));
  } catch (error) {
    console.error('Error creating tray:', error);
    return;
  }
  
  // 创建托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('showWindow'),
      click: () => {
        showWindow();
      }
    },
    {
      label: t('hideWindow'),
      click: () => {
        mainWindow.hide();
        if (process.platform === 'win32') {
          mainWindow.setSkipTaskbar(true);
        }
      }
    },
    { type: 'separator' },
    {
      label: t('serverInfo'),
      click: () => {
        const serverInfo = getServerInfo();
        const { dialog } = require('electron');
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: t('serverInfo'),
          message: `${t('serverRunning')}\n\n${t('ipAddress')}: ${serverInfo.ip}\n${t('port')}: ${serverInfo.port}\n${t('connectedClients')}: ${serverInfo.connectedClients.length}`
        });
      }
    },
    { type: 'separator' },
    {
      label: t('quit'),
      click: () => {
        isQuiting = true;
        app.quit();
      }
    }
  ]);
  
  // 设置托盘菜单
  tray.setContextMenu(contextMenu);
  
  // Windows 和 Linux：单击托盘图标显示/隐藏窗口
  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
        mainWindow.setSkipTaskbar(true);
      } else {
        showWindow();
      }
    });
  }
  
  // macOS：双击托盘图标显示窗口
  if (process.platform === 'darwin') {
    tray.on('double-click', () => {
      showWindow();
    });
  }
}

// 显示窗口的辅助函数
function showWindow() {
  if (!mainWindow) return;
  
  if (process.platform === 'win32') {
    mainWindow.setSkipTaskbar(false);
  }
  
  mainWindow.show();
  mainWindow.focus();
  
  // 如果窗口最小化了，恢复它
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  
  // 置顶窗口（可选）
  mainWindow.setAlwaysOnTop(true);
  setTimeout(() => {
    mainWindow.setAlwaysOnTop(false);
  }, 1000);
}

app.whenReady().then(() => {
  createWindow();
  createTray();  // 创建托盘

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showWindow();  // macOS：从 Dock 点击时显示窗口
    }
  });
});

app.on('window-all-closed', (event) => {
  // 阻止应用退出，只隐藏窗口
  if (!isQuiting) {
    event.preventDefault();
  }
});

// 确保退出时清理托盘
app.on('before-quit', () => {
  isQuiting = true;
  if (tray) {
    tray.destroy();
  }
});

// IPC handlers
ipcMain.handle('get-server-info', () => {
  return getServerInfo();
});

// 处理外部链接
ipcMain.on('open-external-link', (event, url) => {
  console.log('Opening external link:', url);
  // 验证 URL
  try {
    const parsedUrl = new URL(url);
    // 只允许 http 和 https 协议
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      shell.openExternal(url);
    } else {
      console.warn('Blocked non-http(s) URL:', url);
    }
  } catch (error) {
    console.error('Invalid URL:', url, error);
  }
});

// 最小化到托盘的 IPC 处理
ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
    if (process.platform === 'win32') {
      mainWindow.setSkipTaskbar(true);
    }
  }
});

// 显示窗口的 IPC 处理
ipcMain.on('show-window', () => {
  showWindow();
});
