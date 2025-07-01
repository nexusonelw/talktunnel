// i18n配置文件
const translations = {
  zh: {
    // 手机端文本
    appTitle: "TalkTunnel 移动端",
    autoSendDelay: "自动发送延迟时间:",
    seconds: "秒",
    manualOperation: "手动操作",
    sendAndClear: "发送并清空",
    sendAndClearWithEnter: "发送清空并回车",

    delayHint: "设置为0秒将立即发送，最大延迟10秒",
    enterTextPlaceholder: "在此输入文本...",
    sendText: "发送文本",
    selectFiles: "选择文件或图片发送到PC",
    sendSelectedFiles: "发送选中的文件",
    receivedFilesHint: "接收的文件将显示在这里",
    autopasteHint: "文本将自动粘贴到您的桌面",
    download: "下载",
    remove: "移除",
    filesSelected: "已选择",
    files: "个文件",
    totalSize: "总大小",
    sendingProgress: "发送中...",
    sending: "发送中...",
    textSent: "文本发送成功！",
    textSentWithDelay: "文本发送成功！(延迟: {0}秒)",
    fileSentSuccess: "文件 {0} 发送成功",
    filesPartiallyFailed: "{0} 个文件发送失败",
    filesSentSuccess: "成功发送 {0} 个文件",
    sendTimeout: "发送超时",
    sendFailed: "发送失败",
    fileTimeout: "文件 {0} 发送超时，请检查网络连接",
    fileFailed: "文件 {0} 发送失败: {1}",
    connectedToDesktop: "已连接到桌面",
    connectionError: "连接错误",
    failedToConnect: "无法连接到桌面",
    cannotReachDesktop: "无法访问桌面应用",
    enterSomeText: "请输入一些文本",
    error: "错误",
    somethingWrong: "出现错误",
    ok: "确定"
  },
  en: {
    // Mobile interface texts
    appTitle: "TalkTunnel Mobile",
    autoSendDelay: "Auto-send delay time:",
    seconds: "seconds",
    manualOperation: "Manual Operation",
    sendAndClear: "Send and Clear",
    sendAndClearWithEnter: "Send, Clear & Enter",

    delayHint: "Set to 0 seconds for immediate send, max delay 10 seconds",
    enterTextPlaceholder: "Enter text here...",
    sendText: "Send Text",
    selectFiles: "Select files or images to send to PC",
    sendSelectedFiles: "Send selected files",
    receivedFilesHint: "Received files will be shown here",
    autopasteHint: "Text will be automatically pasted on your desktop",
    download: "Download",
    remove: "Remove",
    filesSelected: "Selected",
    files: "files",
    totalSize: "Total size",
    sendingProgress: "Sending...",
    sending: "Sending...",
    textSent: "Text sent successfully!",
    textSentWithDelay: "Text sent successfully! (delay: {0}s)",
    fileSentSuccess: "File {0} sent successfully",
    filesPartiallyFailed: "{0} files failed to send",
    filesSentSuccess: "Successfully sent {0} files",
    sendTimeout: "Send timeout",
    sendFailed: "Send failed",
    fileTimeout: "File {0} send timeout, please check network connection",
    fileFailed: "File {0} send failed: {1}",
    connectedToDesktop: "Connected to desktop",
    connectionError: "Connection Error",
    failedToConnect: "Failed to connect to desktop",
    cannotReachDesktop: "Cannot reach desktop app",
    enterSomeText: "Please enter some text",
    error: "Error",
    somethingWrong: "Something went wrong",
    ok: "OK"
  }
};

// PC端翻译
const pcTranslations = {
  zh: {
    desktopApp: "TalkTunnel",
    scanToConnect: "扫码连接",
    scanQRCode: "使用手机扫描此二维码",
    ipAddress: "IP地址:",
    port: "端口:",
    connectedClients: "已连接客户端:",
    sendFilesToPhones: "发送文件到所有手机",
    selectFileToSend: "选择文件发送到手机",
    fileSending: "正在发送: {0}...",
    fileSentToDevices: "文件已发送到 {0} 个设备",
    sendFailed: "发送失败: {0}",
    sendFailedRetry: "发送失败，请重试",
    waitingForText: "等待手机发送文本...",
    minimizeToTray: "最小化到托盘",
    sponsorGitHub: "GitHub",
    sponsorTwitter: "Twitter/X",
    sponsorAfdian: "爱发电",
    fileUploadFailed: "文件上传失败",
    fileSizeLimit: "文件大小超过50MB限制",
    invalidFileName: "上传的文件名称不正确",
    fileCountLimit: "只能同时上传一个文件",
    uploadError: "上传错误",
    fileUploadIncomplete: "文件上传不完整，请重试",
    noFileReceived: "没有接收到文件",
    fileSaveFailed: "文件保存失败",
    emptyFile: "接收到的文件为空",
    fileProcessFailed: "文件处理失败"
  },
  en: {
    desktopApp: "TalkTunnel",
    scanToConnect: "Scan to Connect",
    scanQRCode: "Scan this QR code with your mobile device",
    ipAddress: "IP Address:",
    port: "Port:",
    connectedClients: "Connected Clients:",
    sendFilesToPhones: "Send files to all phones",
    selectFileToSend: "Select file to send to phones",
    fileSending: "Sending: {0}...",
    fileSentToDevices: "File sent to {0} devices",
    sendFailed: "Send failed: {0}",
    sendFailedRetry: "Send failed, please retry",
    waitingForText: "Waiting for text from mobile...",
    minimizeToTray: "Minimize to Tray",
    sponsorGitHub: "GitHub",
    sponsorTwitter: "Twitter/X",
    sponsorAfdian: "Afdian",
    fileUploadFailed: "File upload failed",
    fileSizeLimit: "File size exceeds 50MB limit",
    invalidFileName: "Invalid file name",
    fileCountLimit: "Only one file can be uploaded at a time",
    uploadError: "Upload error",
    fileUploadIncomplete: "File upload incomplete, please retry",
    noFileReceived: "No file received",
    fileSaveFailed: "File save failed",
    emptyFile: "Received file is empty",
    fileProcessFailed: "File processing failed"
  }
};

// 获取浏览器语言
function getBrowserLanguage() {
  const lang = navigator.language || navigator.userLanguage;
  return lang.startsWith('zh') ? 'zh' : 'en';
}

// 格式化字符串
function formatString(str, ...args) {
  return str.replace(/{(\d+)}/g, (match, index) => {
    return typeof args[index] !== 'undefined' ? args[index] : match;
  });
}

// 获取翻译
function t(key, ...args) {
  const lang = getBrowserLanguage();
  const text = translations[lang][key] || translations['en'][key] || key;
  return formatString(text, ...args);
}

// PC端获取翻译
function tpc(key, ...args) {
  const lang = getBrowserLanguage();
  const text = pcTranslations[lang][key] || pcTranslations['en'][key] || key;
  return formatString(text, ...args);
}

// 初始化页面翻译
function initializeI18n() {
  document.querySelectorAll('.i18n').forEach(element => {
    const key = element.getAttribute('data-key');
    const args = element.getAttribute('data-args');
    if (key) {
      if (args) {
        const argsArray = JSON.parse(args);
        element.textContent = t(key, ...argsArray);
      } else {
        element.textContent = t(key);
      }
    }
  });
  
  // 翻译placeholder
  document.querySelectorAll('.i18n-placeholder').forEach(element => {
    const key = element.getAttribute('data-key');
    if (key) {
      element.placeholder = t(key);
    }
  });
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeI18n);
} else {
  initializeI18n();
} 