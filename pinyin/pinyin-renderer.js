// 快捷键录制器：点击按钮进入录制，按下组合键自动转 Electron accelerator 文本
function setupHotkeyRecorder(inputEl, btnEl) {
  if (!inputEl || !btnEl) return;
  let recording = false;

  function reset() {
    btnEl.textContent = '录制快捷键';
    btnEl.style.background = '';
    btnEl.style.color = '';
  }
  function start() {
    recording = true;
    btnEl.textContent = '按下快捷键…';
    btnEl.style.background = '#FF9800';
    btnEl.style.color = '#fff';
    inputEl.value = '';
    inputEl.placeholder = '请按下组合键…';
    inputEl.blur();
  }
  function stop() { recording = false; reset(); }

  btnEl.addEventListener('click', () => { if (recording) { stop(); return; } start(); });

  document.addEventListener('keydown', (e) => {
    if (recording && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stop(); inputEl.placeholder = '点击右侧按钮录制快捷键'; return; }
    if (!recording) return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const isMac = navigator.platform.indexOf('Mac') >= 0;
    const parts = [];
    if (isMac && e.metaKey) parts.push('CommandOrControl');
    else if (!isMac && e.ctrlKey) parts.push('CommandOrControl');
    if (isMac && e.ctrlKey) parts.push('Control');
    if (!isMac && e.metaKey) parts.push('Super');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    parts.push(key);
    inputEl.value = parts.join('+');
    stop();
  }, true);
}

// 拼音输入法面板渲染进程逻辑
(function () {
  const input = document.getElementById('pinyin-input');
  const result = document.getElementById('result');
  const btnConvert = document.getElementById('btn-convert');
  const convertText = document.getElementById('convert-text');
  const btnConvertFormat = document.getElementById('btn-convert-format');
  const btnInsert = document.getElementById('btn-insert');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnCopy = document.getElementById('btn-copy');
  const btnClear = document.getElementById('btn-clear');
  const btnClose = document.getElementById('btn-close');
  const btnSettings = document.getElementById('btn-settings');
  const overlay = document.getElementById('settings-overlay');
  const toastEl = document.getElementById('toast');

  let lastResult = '';

  // —— macOS 无障碍权限提示 ——
  const a11yBanner = document.getElementById('a11y-banner');
  async function checkAccessibility() {
    if (!window.pinyinAPI.checkAccessibility) return;
    try {
      const r = await window.pinyinAPI.checkAccessibility();
      if (r && r.platform === 'darwin' && !r.trusted) {
        showA11yBanner();
      } else {
        hideA11yBanner();
      }
    } catch (_) {}
  }
  function showA11yBanner() { if (a11yBanner) a11yBanner.classList.add('show'); }
  function hideA11yBanner() { if (a11yBanner) a11yBanner.classList.remove('show'); }
  if (document.getElementById('a11y-open')) {
    document.getElementById('a11y-open').addEventListener('click', () => window.pinyinAPI.openAccessibilitySettings && window.pinyinAPI.openAccessibilitySettings());
  }
  if (document.getElementById('a11y-retry')) {
    document.getElementById('a11y-retry').addEventListener('click', checkAccessibility);
  }
  if (document.getElementById('a11y-dismiss')) {
    document.getElementById('a11y-dismiss').addEventListener('click', hideA11yBanner);
  }

  // —— 撤销/恢复历史栈 ——
  let history = [''];      // 初始空内容；手动输入与转换都会压栈
  let historyIndex = 0;   // 指向当前状态
  let userEditingTimer = null;
  let suppressHistory = false; // 程序写入 input 时暂时关掉自动压栈

  function snapshot() {
    // 截断 “重做”尾总部以后的被重写后分支
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    const cur = input.value;
    if (history[history.length - 1] !== cur) {
      history.push(cur);
      historyIndex = history.length - 1;
    }
    updateUndoRedoState();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    suppressHistory = true;
    input.value = history[historyIndex];
    input.selectionStart = input.selectionEnd = input.value.length;
    input.focus();
    updateUndoRedoState();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    suppressHistory = true;
    input.value = history[historyIndex];
    input.selectionStart = input.selectionEnd = input.value.length;
    input.focus();
    updateUndoRedoState();
  }

  function updateUndoRedoState() {
    if (btnUndo) btnUndo.disabled = historyIndex <= 0;
    if (btnRedo) btnRedo.disabled = historyIndex >= history.length - 1;
  }

  // 用户手动输入 → 防抖压栈（仅当非程序写入时）
  input.addEventListener('input', () => {
    if (suppressHistory) { suppressHistory = false; return; }
    clearTimeout(userEditingTimer);
    userEditingTimer = setTimeout(snapshot, 350);
  });

  function showToast(msg, ms = 1600) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  function setLoading(loading) {
    btnConvert.disabled = loading;
    if (loading) {
      convertText.innerHTML = '<span class="spinner"></span>转换中…';
    } else {
      convertText.textContent = '转换为汉字';
    }
  }

  // mode: 'default'（纯转换）| 'format'（处理格式+转换）
  async function doConvert(mode = 'default') {
    const text = input.value.trim();
    if (!text) { showToast('请输入拼音'); return; }
    // 转换前压一份当前快照（原文不会丢失）
    snapshot();
    setLoading(true);
    try {
      const out = await window.pinyinAPI.convert(text, mode);
      lastResult = out || '';
      if (lastResult) {
        // 结果直接填回输入框（保留 textarea 原文不丢，因为是独立快照）
        suppressHistory = true;
        input.value = lastResult;
        // 光标放末尾
        input.selectionStart = input.selectionEnd = input.value.length;
        input.focus();
        btnCopy.disabled = false;
        btnInsert.disabled = false;
        // 结果压栈（可撤销回原文）
        snapshot();
        showToast(mode === 'format' ? '已处理格式并转换，可继续编辑后再次转换或插入' : '已转换为汉字，可继续编辑后再次转换');
      } else {
        showToast('转换失败或返回为空，原文已保留');
      }
    } catch (e) {
      showToast('错误：' + (e.message || '未知错误') + '，原文已保留');
    } finally {
      setLoading(false);
    }
  }

  async function doInsert() {
    if (!lastResult) { showToast('请先转换后再插入'); return; }
    btnInsert.disabled = true;
    showToast('正在插入到当前光标…', 1500);
    try {
      const ret = await window.pinyinAPI.insert(lastResult);
      if (ret && ret.ok && ret.method === 'paste') {
        showToast('已插入到当前光标位置');
      } else {
        // 失败：可能是无障碍权限未授，刷新横幅提示
        checkAccessibility();
        showToast('插入未成功，已复制到剪贴板，请手动粘贴或查看权限提示');
      }
    } catch (e) {
      showToast('插入错误：' + (e.message || '未知错误'));
    } finally {
      btnInsert.disabled = false;
    }
  }

  async function doCopy() {
    if (!lastResult) return;
    const ok = await window.pinyinAPI.copyToClipboard(lastResult);
    showToast(ok ? '已复制到剪贴板' : '复制失败');
  }

  function doClear() {
    input.value = '';
    lastResult = '';
    btnCopy.disabled = true;
    btnInsert.disabled = true;
    snapshot();   // 清空也压一个快照，可撤销恢复
    input.focus();
  }

  function openSettings() {
    window.pinyinAPI.getConfig().then(cfg => {
      document.getElementById('cfg-baseurl').value = cfg.baseURL || '';
      document.getElementById('cfg-apikey').value = cfg.apiKey || '';
      document.getElementById('cfg-model').value = cfg.model || '';
      document.getElementById('cfg-hotkey').value = cfg.hotkey || '';
      overlay.classList.add('show');
    });
  }

  async function saveSettings() {
    const cfg = {
      baseURL: document.getElementById('cfg-baseurl').value.trim(),
      apiKey: document.getElementById('cfg-apikey').value.trim(),
      model: document.getElementById('cfg-model').value.trim(),
      hotkey: document.getElementById('cfg-hotkey').value.trim()
    };
    await window.pinyinAPI.setConfig(cfg);
    overlay.classList.remove('show');
    showToast('设置已保存');
  }

  // 事件绑定
  btnConvert.addEventListener('click', () => doConvert('default'));
  btnConvertFormat.addEventListener('click', () => doConvert('format'));
  btnInsert.addEventListener('click', doInsert);
  btnCopy.addEventListener('click', doCopy);
  btnClear.addEventListener('click', doClear);
  btnClose.addEventListener('click', () => window.pinyinAPI.close());
  btnSettings.addEventListener('click', openSettings);
  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnRedo) btnRedo.addEventListener('click', redo);
  document.getElementById('cfg-save').addEventListener('click', saveSettings);
  document.getElementById('cfg-cancel').addEventListener('click', () => overlay.classList.remove('show'));

  // 快捷键录制控件：点击按钮 → 按下组合键 → 自动填入 accelerator 格式
  setupHotkeyRecorder(document.getElementById('cfg-hotkey'), document.getElementById('cfg-record'));

  // Ctrl/Cmd + Enter 触发默认转换
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doConvert('default');
      return;
    }
    // 撤销/恢复快捷键
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
  });

  // 主进程复制完成通知
  window.pinyinAPI.onCopied && window.pinyinAPI.onCopied((data) => {
    if (data && data.autoClose) {
      window.pinyinAPI.close();
    }
  });

  // 窗口加载后聚焦输入框 + 初始化撤销/恢复按钮状态 + 检查无障碍权限
  setTimeout(() => { input.focus(); updateUndoRedoState(); checkAccessibility(); }, 50);
})();