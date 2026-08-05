// 拼音输入法面板的 preload，通过 contextBridge 安全暴露 IPC
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinyinAPI', {
  // 触发转换
  convert: (pinyinText, mode) => ipcRenderer.invoke('pinyin:convert', pinyinText, mode),
  // 插入到外部应用当前光标位置
  insert: (text) => ipcRenderer.invoke('pinyin:insert', text),
  // 复制到剪贴板
  copyToClipboard: (text) => ipcRenderer.invoke('pinyin:copy', text),
  // 关闭面板
  close: () => ipcRenderer.send('pinyin:close'),
  // 配置读写
  getConfig: () => ipcRenderer.invoke('pinyin:get-config'),
  setConfig: (config) => ipcRenderer.invoke('pinyin:set-config', config),
  // macOS 无障碍权限
  checkAccessibility: () => ipcRenderer.invoke('pinyin:check-accessibility'),
  openAccessibilitySettings: () => ipcRenderer.invoke('pinyin:open-accessibility-settings'),
  // 复制完成后的通知
  onCopied: (callback) => ipcRenderer.on('pinyin:copied', (_e, data) => callback(data))
});