// Renderer process script
const QRCode = require('qrcode');
const { ipcRenderer } = require('electron');

let serverInfo = null;

async function updateServerInfo() {
  try {
    serverInfo = await ipcRenderer.invoke('get-server-info');
    
    // Update UI
    document.getElementById('ipAddress').textContent = serverInfo.ips && serverInfo.ips.length
      ? serverInfo.ips.join(', ')
      : serverInfo.ip;
    document.getElementById('port').textContent = serverInfo.port;
    document.getElementById('connectedClients').textContent = serverInfo.connectedClients.length;
    
    // Generate QR code
    if (serverInfo.url) {
      const qrcodeContainer = document.getElementById('qrcode');
      qrcodeContainer.innerHTML = ''; // Clear existing QR code
      
      const canvas = document.createElement('canvas');
      qrcodeContainer.appendChild(canvas);
      
      QRCode.toCanvas(canvas, serverInfo.url, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      }, function (error) {
        if (error) {
          console.error('QR Code generation error:', error);
          qrcodeContainer.innerHTML = '<p style="color: red;">QR Code generation failed</p>';
        } else {
          console.log('QR Code generated successfully for URL:', serverInfo.url);
        }
      });
    } else {
      const qrcodeContainer = document.getElementById('qrcode');
      const message = serverInfo.cloudRegistrationError
        ? `Cloudflare registration failed:<br><pre style="white-space: pre-wrap; text-align: left;">${serverInfo.cloudRegistrationError}</pre>`
        : 'Cloudflare registration required. Please enter the device password to register.';
      qrcodeContainer.innerHTML = `<p style="color: red;">${message}</p>`;
      console.warn('No Cloudflare URL available for QR code generation');
    }
  } catch (error) {
    console.error('Failed to get server info:', error);
  }
}

// Update server info on load
updateServerInfo();
ipcRenderer.on('server-info-changed', updateServerInfo);

// Update connected clients count every 5 seconds
setInterval(updateServerInfo, 5000);

// 添加最小化到托盘按钮
function addTrayButton() {
  const container = document.querySelector('.container');
  const trayBtn = document.createElement('button');
  trayBtn.textContent = tpc('minimizeToTray');
  trayBtn.className = 'file-button';
  trayBtn.style.marginTop = '10px';
  trayBtn.style.backgroundColor = '#FF9800';
  trayBtn.onclick = minimizeToTray;
  
  // 在文件上传区域后添加按钮
  const fileSection = document.querySelector('.file-upload-section');
  if (fileSection) {
    container.insertBefore(trayBtn, fileSection.nextSibling);
  } else {
    container.appendChild(trayBtn);
  }
}

function minimizeToTray() {
  const { ipcRenderer } = require('electron');
  ipcRenderer.send('minimize-to-tray');
}

// 页面加载完成后添加按钮
window.addEventListener('load', () => {
  setTimeout(addTrayButton, 1000); // 延迟添加确保其他元素已加载
});

// 处理PC端文件上传
document.getElementById('pcFileInput').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const fileInfo = document.getElementById('pcFileInfo');
  fileInfo.textContent = tpc('fileSending', file.name);
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`http://${serverInfo.ip}:${serverInfo.port}/send-to-phones`, {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    if (response.ok) {
      fileInfo.textContent = tpc('fileSentToDevices', result.clients);
      e.target.value = '';
    } else {
      fileInfo.textContent = tpc('sendFailed', result.error);
    }
  } catch (error) {
    console.error('Error sending file:', error);
    fileInfo.textContent = tpc('sendFailedRetry');
  }
});

// 处理外部链接
document.addEventListener('DOMContentLoaded', () => {
  // 拦截所有链接点击
  document.addEventListener('click', (event) => {
    // 检查是否是链接或者链接内的 SVG 元素
    const link = event.target.closest('a');
    if (link && link.href && link.href.startsWith('http')) {
      // 阻止默认行为
      event.preventDefault();
      // 通过 IPC 发送到主进程
      ipcRenderer.send('open-external-link', link.href);
    }
  });
});

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
    // 只按修饰键忽略
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

// ===== 拼音输入法 LLM 设置弹窗（独立功能，不影响现有逻辑） =====
(function initLlmSettings() {
  function $(id) { return document.getElementById(id); }
  const overlay = $('llm-settings-overlay');
  if (!overlay) return;

  function open() {
    // 读取当前配置并填充
    ipcRenderer.invoke('pinyin:get-config').then((cfg) => {
      if (!cfg) return;
      $('llm-baseurl').value = cfg.baseURL || '';
      $('llm-apikey').value = cfg.apiKey || '';
      $('llm-model').value = cfg.model || '';
      $('llm-hotkey').value = cfg.hotkey || '';
      overlay.classList.add('show');
    }).catch((e) => {
      console.error('读取 LLM 配置失败:', e);
      alert('读取设置失败：' + (e && e.message ? e.message : e));
    });
  }

  function close() { overlay.classList.remove('show'); }

  $('openLlmSettings').addEventListener('click', open);
  $('llm-cancel').addEventListener('click', close);
  // 原先“点击外部自动关闭”已移除，避免误关。只能用保存/取消按钮关闭。

  // 快捷键录制控件：点击按钮 → 按下组合键 → 自动填入 accelerator 格式
  setupHotkeyRecorder($('llm-hotkey'), $('llm-record'));

  $('llm-save').addEventListener('click', () => {
    const cfg = {
      baseURL: $('llm-baseurl').value.trim(),
      apiKey: $('llm-apikey').value.trim(),
      model: $('llm-model').value.trim(),
      hotkey: $('llm-hotkey').value.trim()
    };
    ipcRenderer.invoke('pinyin:set-config', cfg).then(() => {
      alert('设置已保存');
      close();
    }).catch((e) => {
      alert('保存失败：' + (e && e.message ? e.message : e));
    });
  });
})();
