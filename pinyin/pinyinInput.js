// 拼音输入法主进程模块
// 功能：全局快捷键唤起输入面板（定位到鼠标位置），后台调用 OpenAI 兼容大模型转汉字，自动复制到剪贴板
// 设计为独立模块，仅暴露 initPinyinInput()，对现有 TalkTunnel 代码无侵入
const { globalShortcut, BrowserWindow, clipboard, ipcMain, screen, app, shell, systemPreferences } = require('electron');
const path = require('path');
const pinyinStore = require('./config');

let pinyinWindow = null;
let registeredAccelerator = null;

const PANEL_WIDTH = 460;
const PANEL_HEIGHT = 420;

// 用 @nut-tree-fork/nut-js 获取鼠标位置（项目已有依赖）
async function getMousePosition() {
  try {
    const { mouse } = require('@nut-tree-fork/nut-js');
    const pos = await mouse.getPosition();
    return { x: pos.x, y: pos.y };
  } catch (e) {
    // 退化方案：返回屏幕中心
    const display = screen.getPrimaryDisplay();
    return { x: display.bounds.x + display.bounds.width / 2, y: display.bounds.y + display.bounds.height / 2 };
  }
}

function positionWindowNearCursor(win, mouseX, mouseY) {
  const display = screen.getDisplayNearestPoint({ x: mouseX, y: mouseY });
  const workArea = display.workArea;
  let x = mouseX + 12;
  let y = mouseY + 12;
  // 确保不超出工作区
  if (x + PANEL_WIDTH > workArea.x + workArea.width) x = workArea.x + workArea.width - PANEL_WIDTH;
  if (y + PANEL_HEIGHT > workArea.y + workArea.height) y = workArea.y + workArea.height - PANEL_HEIGHT;
  if (x < workArea.x) x = workArea.x;
  if (y < workArea.y) y = workArea.y;
  win.setPosition(Math.round(x), Math.round(y), false);
}

function createPinyinWindow() {
  pinyinWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#1e1e1e',
    // macOS 全屏应用独占 Space，需开启以下两项才能叠在全屏 App 之上
    visibleOnAllWorkspaces: process.platform === 'darwin',
    visibleOnFullScreen: process.platform === 'darwin',
    // Windows/Linux 也保持置顶
    webPreferences: {
      preload: path.join(__dirname, 'preload-pinyin.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  // 最高级置顶（screen-saver 级别，能叠在 macOS 全屏 App 之上）
  try { pinyinWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}

  pinyinWindow.loadFile(path.join(__dirname, 'pinyin.html'));

  pinyinWindow.on('closed', () => { pinyinWindow = null; });
  // 失焦不自动关闭（符合需求：用户手动关闭）
  // pinyinWindow.on('blur', ...) 不关闭
  return pinyinWindow;
}

async function togglePinyinPanel() {
  // 用内部状态追踪可见性（isVisible 在 visibleOnAllWorkspaces 下不可靠）
  if (!pinyinWindow || pinyinWindow.isDestroyed()) {
    pinyinWindow = createPinyinWindow();
    pinyinWindow._visible = false;
    pinyinWindow.once('ready-to-show', async () => {
      const mouse = await getMousePosition();
      positionWindowNearCursor(pinyinWindow, mouse.x, mouse.y);
      applyFullScreenAware(pinyinWindow, true);
      pinyinWindow.show();
      pinyinWindow.focus();
      pinyinWindow._visible = true;
    });
    return;
  }
  if (pinyinWindow._visible) {
    // 隐藏
    applyFullScreenAware(pinyinWindow, false);
    pinyinWindow.hide();
    pinyinWindow._visible = false;
  } else {
    const mouse = await getMousePosition();
    positionWindowNearCursor(pinyinWindow, mouse.x, mouse.y);
    applyFullScreenAware(pinyinWindow, true);
    pinyinWindow.show();
    pinyinWindow.focus();
    // show 后再补一次，确保覆盖当前 Space
    applyFullScreenAware(pinyinWindow, true);
    pinyinWindow._visible = true;
  }
}

// 按需要“全屏可见”或“普通”重设窗口属性
// on=true: 让窗口能叠在全屏 App 与所有 Space 之上；on=false: 关掉，避免隐藏后窗口仍绑在某个 Space
function applyFullScreenAware(win, on) {
  try {
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on });
    }
    win.setAlwaysOnTop(on, on ? 'screen-saver' : 'floating');
  } catch (_) {}
}

// 兼容旧名
const ensureOnTop = (win) => applyFullScreenAware(win, true);

// 两个模式不同的 system prompt
const PROMPTS = {
  // 默认：纯拼音转汉字，严格保持用户原始格式不变；客观修正拼写错误
  default:
    '你是一个拼音转汉字引擎。用户会输入一段拼音（可能包含声调、英文标点、空格或连写）。' +
    '请仅输出对应的中文汉字文本，不要输出任何解释、标点以外的额外内容、引号或前后缀。' +
    '保持原文语义，标点按中文习惯补全。' +
    '严格保持用户输入的原始格式不变：保留原有的换行、段落分隔、空格结构，' +
    '不要擅自增删行、合并段落或调整排版，只在原位置把拼音替换为汉字。' +
    '用户输入的拼音可能存在拼写错误：请基于汉语拼音规则与上下文语义进行客观、合理的修正，' +
    '只修正明显有误的音节（如声母/韵母笔误、声调标注错误），不要无中生有或臆测用户未表达的意思。',
  // 处理格式并转换：规范化段落格式 + 修正错别字 + 转汉字
  format:
    '你是一个文本格式化与拼音转汉字引擎。用户会输入一段拼音或草稿文本（可能含错别字、格式混乱、缺少标点、不分段落、拼音拼写错误）。' +
    '请同时完成两件事：1）将拼音/草稿转换为规范的中文汉字；2）标准化文本段落格式——' +
    '正确分段、补全并根据语义调整中文标点、修正错别字、保持原文语义。' +
    '对于拼音拼写错误，基于汉语拼音规则与上下文语义进行客观、合理的修正，只修正明显有误的音节，不要无中生有或臆测。' +
    '仅输出规范后的中文文本，不要输出任何解释、说明、引号或前后缀，不要输出 Markdown 代码块标记。'
};

// 调用 OpenAI 兼容大模型，将拼音转为汉字
// mode: 'default'（纯转换）| 'format'（处理格式并转换）
async function callLLM(pinyinText, mode = 'default') {
  const cfg = {
    baseURL: pinyinStore.get('baseURL'),
    apiKey: pinyinStore.get('apiKey'),
    model: pinyinStore.get('model'),
    temperature: pinyinStore.get('temperature') ?? 0.2
  };
  if (!cfg.apiKey) throw new Error('未配置 API Key，请点击右上角设置按钮配置 LLM 接口');

  const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const systemPrompt = PROMPTS[mode] || PROMPTS.default;
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: pinyinText }
    ],
    temperature: cfg.temperature,
    stream: false
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`LLM 请求失败 ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回内容为空');
  return content.trim();
}

let configPersistTimeout = null;
function registerAllIPC() {
  // mode: 'default' | 'format'
  ipcMain.handle('pinyin:convert', async (_e, pinyinText, mode) => {
    return await callLLM(pinyinText, mode);
  });

  // 插入到外部应用当前光标位置：隐藏面板 → 释放焦点 → 写入剪贴板并模拟粘贴
  // 失败（如未授无障碍权限）则仅保留在剪贴板，提示用户手动粘贴
  ipcMain.handle('pinyin:insert', async (_e, text) => {
    if (!text) return { ok: false, reason: 'empty' };
    try {
      // 隐藏面板并释放焦点，让 macOS 焦点自然回到此前使用的外部输入框
      if (pinyinWindow && !pinyinWindow.isDestroyed() && pinyinWindow._visible !== false) {
        pinyinWindow.blur();          // 先主动失焦
        applyFullScreenAware(pinyinWindow, false);
        pinyinWindow.hide();
        pinyinWindow._visible = false;
      }
      // 等待焦点切换到外部应用（给够时间让上一应用重获焦点）
      await new Promise(r => setTimeout(r, 320));
      try {
        const { keyboard, Key } = require('@nut-tree-fork/nut-js');
        // 先写入剪贴板
        clipboard.writeText(text);
        // 模拟粘贴：Mac 用 Cmd+V，其他用 Ctrl+V
        const mod = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl;
        keyboard.config.autoDelayMs = 0;
        await keyboard.pressKey(mod);
        await keyboard.pressKey(Key.V);
        await keyboard.releaseKey(Key.V);
        await keyboard.releaseKey(mod);
        return { ok: true, method: 'paste' };
      } catch (ke) {
        // 退化：文本已在剪贴板，请用户手动粘贴
        return { ok: false, method: 'clipboard', reason: (ke && ke.message) || 'keyboard_failed' };
      }
    } catch (e) {
      try { clipboard.writeText(text); } catch (_) {}
      return { ok: false, method: 'clipboard', reason: (e && e.message) || 'error' };
    }
  });

  // 检测 macOS 无障碍权限状态
  // 返回 { trusted: bool, platform }；Windows/Linux 始终 trusted:true
  // 仅首次检测时给 prompt=true 让系统记录本 app（会弹一次系统授权框），后续静默查询
  let a11yPrompted = false;
  ipcMain.handle('pinyin:check-accessibility', () => {
    if (process.platform !== 'darwin') return { trusted: true, platform: process.platform };
    try {
      const trusted = systemPreferences.isTrustedAccessibilityClient(!a11yPrompted);
      a11yPrompted = true;
      return { trusted, platform: 'darwin' };
    } catch (e) {
      console.warn('[pinyin] check-accessibility error:', e);
      return { trusted: false, platform: 'darwin', error: e.message };
    }
  });

  // 跳转到 macOS 无障碍设置页
  ipcMain.handle('pinyin:open-accessibility-settings', () => {
    if (process.platform !== 'darwin') return false;
    try {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      return true;
    } catch (e) {
      console.error('[pinyin] open accessibility settings failed:', e);
      return false;
    }
  });

  ipcMain.handle('pinyin:copy', async (_e, text) => {
    try {
      clipboard.writeText(text);
      // 可选：让 render 侧关闭。这里按需求不自动关闭，只通知
      if (pinyinWindow && !pinyinWindow.isDestroyed()) {
        pinyinWindow.webContents.send('pinyin:copied', { autoClose: false });
      }
      return true;
    } catch (e) {
      console.error('[pinyin] copy failed:', e);
      return false;
    }
  });

  ipcMain.on('pinyin:close', () => {
    if (pinyinWindow && !pinyinWindow.isDestroyed()) {
      applyFullScreenAware(pinyinWindow, false);
      pinyinWindow.hide();
      pinyinWindow._visible = false;
    }
  });

  ipcMain.handle('pinyin:get-config', () => {
    return {
      baseURL: pinyinStore.get('baseURL'),
      apiKey: pinyinStore.get('apiKey'),
      model: pinyinStore.get('model'),
      hotkey: pinyinStore.get('hotkey')
    };
  });

  ipcMain.handle('pinyin:set-config', (_e, cfg) => {
    if (cfg.baseURL !== undefined) pinyinStore.set('baseURL', cfg.baseURL);
    if (cfg.apiKey !== undefined) pinyinStore.set('apiKey', cfg.apiKey);
    if (cfg.model !== undefined) pinyinStore.set('model', cfg.model);
    if (cfg.hotkey !== undefined) pinyinStore.set('hotkey', cfg.hotkey);
    // 防抖：若热键改变，重新注册
    if (cfg.hotkey !== undefined) {
      clearTimeout(configPersistTimeout);
      configPersistTimeout = setTimeout(() => registerHotkey(), 200);
    }
    return true;
  });
}

function registerHotkey() {
  if (registeredAccelerator) {
    try { globalShortcut.unregister(registeredAccelerator); } catch (_) {}
    registeredAccelerator = null;
  }
  const hotkey = pinyinStore.get('hotkey');
  if (!hotkey) return;
  try {
    const ok = globalShortcut.register(hotkey, () => {
      togglePinyinPanel();
    });
    if (ok) {
      registeredAccelerator = hotkey;
      console.log('[pinyin] hotkey registered:', hotkey);
    } else {
      console.warn('[pinyin] hotkey register failed:', hotkey);
    }
  } catch (e) {
    console.error('[pinyin] hotkey register error:', e);
  }
}

function initPinyinInput() {
  registerAllIPC();
  registerHotkey();

  // 应用退出时清理快捷键
  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch (_) {}
  });
}

module.exports = { initPinyinInput };