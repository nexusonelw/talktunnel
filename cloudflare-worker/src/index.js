const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/register' && request.method === 'POST') return register(request, env);
      if (url.pathname === '/api/update-ips' && request.method === 'POST') return updateIps(request, env);
      if (url.pathname === '/api/auth' && request.method === 'POST') return auth(request, env);
      if (url.pathname === '/api/client' && request.method === 'POST') return client(request, env);
      if (url.pathname === '/manifest.webmanifest' && request.method === 'GET') return manifestResponse(url);
      if (url.pathname === '/sw' && request.method === 'GET') return serviceWorkerResponse();
      if (url.pathname === '/pwa-icon.svg' && request.method === 'GET') return iconResponse();
      if (/^\/[0-9a-fA-F-]{36}$/.test(url.pathname) && request.method === 'GET') {
        return htmlResponse(mobilePage(url.pathname.slice(1)));
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: error.message || 'Server error' }, error.status || 500);
    }
  }
};

async function register(request, env) {
  const body = await request.json();
  const password = String(body.password || '');
  const lanIps = cleanIps(body.lanIps);
  const port = Number(body.port);
  if (!password || !lanIps.length || !Number.isInteger(port)) return json({ error: 'Invalid registration' }, 400);

  const uuid = crypto.randomUUID();
  const salt = randomBase64(16);
  const registrationSecret = randomBase64(32);
  const passwordHash = await hashSecret(password, salt);
  const registrationSecretHash = await hashSecret(registrationSecret, salt);

  await env.DB.prepare(
    `INSERT INTO clients (uuid, salt, password_hash, registration_secret_hash, lan_ips, port, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(uuid, salt, passwordHash, registrationSecretHash, JSON.stringify(lanIps), port).run();

  return json({ uuid, registrationSecret });
}

async function updateIps(request, env) {
  const body = await request.json();
  const uuid = String(body.uuid || '');
  const registrationSecret = String(body.registrationSecret || '');
  const lanIps = cleanIps(body.lanIps);
  const port = Number(body.port);
  if (!uuid || !registrationSecret || !lanIps.length || !Number.isInteger(port)) return json({ error: 'Invalid update' }, 400);

  const row = await env.DB.prepare('SELECT salt, registration_secret_hash FROM clients WHERE uuid = ?').bind(uuid).first();
  if (!row || !(await matchesSecret(registrationSecret, row.salt, row.registration_secret_hash))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  await env.DB.prepare('UPDATE clients SET lan_ips = ?, port = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?')
    .bind(JSON.stringify(lanIps), port, uuid)
    .run();

  return json({ ok: true });
}

async function auth(request, env) {
  const body = await request.json();
  const data = await getAuthedClient(env, String(body.uuid || ''), String(body.password || ''));
  return json(data);
}

async function client(request, env) {
  const body = await request.json();
  const data = await getAuthedClient(env, String(body.uuid || ''), String(body.password || ''));
  return json(data);
}

async function getAuthedClient(env, uuid, password) {
  const row = await env.DB.prepare('SELECT salt, password_hash, lan_ips, port, updated_at FROM clients WHERE uuid = ?')
    .bind(uuid)
    .first();
  if (!row || !(await matchesSecret(password, row.salt, row.password_hash))) {
    throw new HttpError('Unauthorized', 401);
  }

  return {
    uuid,
    lanIps: cleanIps(JSON.parse(row.lan_ips || '[]')),
    port: row.port,
    updatedAt: row.updated_at
  };
}

function cleanIps(ips) {
  const rank = (ip) => ip.startsWith('192.') ? 0 : ip.startsWith('100.') ? 1 : ip.startsWith('10.') ? 2 : 3;
  return [...new Set((Array.isArray(ips) ? ips : [])
    .map(String)
    .filter((ip) => /^(192|100|10)\.(\d{1,3}\.){2}\d{1,3}$/.test(ip)))]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

async function hashSecret(secret, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 },
    key,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function matchesSecret(secret, salt, expected) {
  return constantTimeEqual(await hashSecret(secret, salt), String(expected || ''));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomBase64(bytes) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function manifestResponse(url) {
  const uuid = url.searchParams.get('uuid') || '';
  const startUrl = /^[-0-9a-fA-F]{36}$/.test(uuid) ? `/${uuid}` : '/';
  return new Response(JSON.stringify({
    name: 'TalkTunnel Mobile',
    short_name: 'TalkTunnel',
    description: 'Send text and files to your TalkTunnel desktop.',
    id: startUrl,
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    background_color: '#f5f5f5',
    theme_color: '#2196F3',
    icons: [
      { src: '/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
    ]
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/manifest+json; charset=utf-8' }
  });
}

function serviceWorkerResponse() {
  return new Response(`const CACHE = 'talktunnel-pwa-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/pwa-icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});`, {
    headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8', 'Service-Worker-Allowed': '/' }
  });
}

function iconResponse() {
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#2196F3"/>
  <path d="M128 152h256a40 40 0 0 1 40 40v128a40 40 0 0 1-40 40H231l-78 54c-13 9-31 0-31-16v-38h6a40 40 0 0 1-40-40V192a40 40 0 0 1 40-40Z" fill="white"/>
  <path d="M160 220h192M160 270h136" stroke="#2196F3" stroke-width="32" stroke-linecap="round"/>
</svg>`, {
    headers: { ...corsHeaders, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' }
  });
}

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function mobilePage(uuid) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#2196F3">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="TalkTunnel">
  <link rel="manifest" href="/manifest.webmanifest?uuid=${uuid}">
  <link rel="icon" href="/pwa-icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/pwa-icon.svg">
  <title>TalkTunnel Mobile</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;flex-direction:column}.app-bar{background:#2196F3;color:white;padding:16px 20px;box-shadow:0 2px 4px rgba(0,0,0,.1);position:sticky;top:0;z-index:10}.app-bar h1{font-size:20px;font-weight:500}.container{flex:1;padding:20px;display:flex;flex-direction:column;gap:16px;overflow-y:auto}.input-field{width:100%;padding:16px;font-size:16px;border:1px solid #ddd;border-radius:8px;background:white}.input-field:focus{outline:none;border-color:#2196F3}.textarea-field{min-height:200px;resize:vertical;font-family:inherit}.button{background:#2196F3;color:white;border:0;padding:14px 24px;font-size:16px;border-radius:8px;cursor:pointer;width:100%;text-transform:uppercase;font-weight:500}.button:disabled{background:#ccc;cursor:not-allowed}.settings-section,.file-section{background:white;border-radius:8px;padding:16px;box-shadow:0 2px 4px rgba(0,0,0,.1)}.settings-row,.manual-checkbox-row{display:flex;align-items:center;gap:12px}.settings-label,.hint,.file-info{color:#666;font-size:14px}.delay-input{width:80px;padding:8px;border:1px solid #ddd;border-radius:4px;text-align:center}.status-message{padding:12px 16px;border-radius:8px;text-align:center}.success{background:#4CAF50;color:white}.error{background:#f44336;color:white}.connected{background:#e8f5e9;color:#2e7d32;border:1px solid #4caf50}.file-label{background:#2196F3;color:white;padding:12px 20px;border-radius:8px;display:block;text-align:center}.file-input-wrapper input{position:absolute;left:-9999px}.selected-files-list{margin-top:10px}.file-item{display:flex;justify-content:space-between;gap:8px;padding:8px;margin:5px 0;background:#f5f5f5;border-radius:4px;font-size:14px}.download-area{background:#e3f2fd;border:2px dashed #2196F3;border-radius:8px;padding:20px;text-align:center;min-height:100px}.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px}.modal-content{background:white;margin:clamp(16px,8vh,64px) auto;padding:24px;width:100%;max-width:400px;max-height:calc(100vh - 32px);border-radius:12px;display:flex;flex-direction:column;gap:12px}.modal-header{font-size:20px;margin-bottom:4px}.modal-body{color:#666;margin-bottom:24px;line-height:1.5}#historyList{overflow-y:auto;-webkit-overflow-scrolling:touch;max-height:55vh;padding-right:2px}.history-item{width:100%;text-align:left;background:#f7f7f7;border:0;border-radius:6px;padding:10px;margin:6px 0;white-space:pre-wrap;word-break:break-word}.install-banner{display:none;position:fixed;left:12px;right:12px;bottom:12px;z-index:900;background:#fff;border:1px solid #d7e8fb;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:12px;gap:10px;align-items:center}.install-banner.show{display:flex}.install-banner p{flex:1;color:#333;font-size:14px;line-height:1.4}.install-actions{display:flex;gap:8px}.install-actions button{border:0;border-radius:6px;padding:9px 12px;font-size:13px}.install-primary{background:#2196F3;color:#fff}.install-close{background:#eee;color:#333}
  </style>
</head>
<body>
  <div class="app-bar"><h1>TalkTunnel Mobile</h1></div>
  <div class="container">
    <div id="statusMessage"></div>
    <div class="settings-section">
      <div class="settings-row"><label class="settings-label" for="delayInput">自动发送延迟时间:</label><input type="number" id="delayInput" class="delay-input" min="0" max="10" step="0.5" value="2"><span class="settings-label">秒</span></div>
      <div class="manual-checkbox-row"><input type="checkbox" id="manualCheckbox" checked><label for="manualCheckbox" class="settings-label">手动操作</label></div>
    </div>
    <p class="hint">设置为0秒将立即发送，最大延迟10秒</p>
    <textarea id="textInput" class="input-field textarea-field" placeholder="在此输入文本..."></textarea>
    <button id="sendButton" class="button">发送并清空</button>
    <button id="sendAndEnterButton" class="button">发送清空并回车</button>
    <button id="reloadPageButton" class="button" type="button">刷新页面</button>
    <button id="historyButton" class="button" type="button">历史记录</button>
    <button id="clearButton" class="button" type="button" style="background:#f44336">清空输入框</button>
    <div class="file-section">
      <div class="file-input-wrapper"><label for="fileInput" class="file-label">选择文件或图片发送到PC</label><input type="file" id="fileInput" multiple></div>
      <div id="fileInfo" class="file-info"></div>
      <div id="selectedFilesList" class="selected-files-list"></div>
      <button id="sendFilesButton" class="button" style="display:none;margin-top:10px">发送选中的文件</button>
    </div>
    <div class="download-area" id="downloadArea"><p>接收的文件将显示在这里</p></div>
    <p class="hint">文本将自动粘贴到您的桌面</p>
  </div>
  <div id="installBanner" class="install-banner"><p id="installText">安装 TalkTunnel 到本机，之后可像 App 一样打开。</p><div class="install-actions"><button id="installNowButton" class="install-primary" type="button">安装</button><button id="installCloseButton" class="install-close" type="button">关闭</button></div></div>
  <div id="errorModal" class="modal"><div class="modal-content"><h2 class="modal-header" id="modalTitle">Error</h2><p class="modal-body" id="modalMessage"></p><button class="button" onclick="closeModal()">OK</button></div></div>
  <div id="historyModal" class="modal"><div class="modal-content"><h2 class="modal-header">历史记录</h2><div id="historyList"></div><button class="button" onclick="closeHistory()">OK</button></div></div>
  <script>
    const uuid = location.pathname.split('/').filter(Boolean)[0];
    let password = '';
    let device = null;
    let serverUrl = '';
    let ws = null;
    let isConnected = false;
    let isSending = false;
    let manualMode = true;
    let lastSentLength = 0;
    let debounceTimer = null;
    let heartbeatInterval = null;
    let selectedFiles = [];
    const DB_NAME = 'talktunnel-history';
    const PASSWORD_KEY = 'talktunnel-password:' + uuid;
    const DEVICE_KEY = 'talktunnel-device:' + uuid;
    const TEXT_DRAFT_KEY = 'talktunnel-text-draft:' + uuid;
    const INSTALL_DISMISSED_KEY = 'talktunnel-install-dismissed';
    let deferredInstallPrompt = null;
    let deviceRefreshUsed = false;
    let deviceRefreshExhausted = false;

    setupPwaInstall();
    restoreTextDraft();
    window.addEventListener('pagehide', saveTextDraft);
    window.addEventListener('beforeunload', saveTextDraft);
    window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveTextDraft(); });
    init();

    function setupPwaInstall() {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw').catch(() => {});
      }

      window.addEventListener('beforeinstallprompt', async (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        if (!localStorage.getItem(INSTALL_DISMISSED_KEY)) {
          showInstallBanner();
          await promptInstall();
        }
      });

      window.addEventListener('appinstalled', () => {
        hideInstallBanner();
        deferredInstallPrompt = null;
      });

      installNowButton.onclick = promptInstall;
      installCloseButton.onclick = () => {
        localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
        hideInstallBanner();
      };

      setTimeout(() => {
        if (!deferredInstallPrompt && !localStorage.getItem(INSTALL_DISMISSED_KEY) && !isStandalone()) {
          if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
            installText.textContent = '可通过浏览器分享按钮选择“添加到主屏幕”安装 TalkTunnel。';
          }
          showInstallBanner();
        }
      }, 1200);
    }

    async function promptInstall() {
      if (!deferredInstallPrompt) {
        showInstallBanner();
        return;
      }

      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await promptEvent.prompt();
        await promptEvent.userChoice;
      } finally {
        hideInstallBanner();
      }
    }

    function showInstallBanner() {
      if (!isStandalone()) installBanner.classList.add('show');
    }

    function hideInstallBanner() {
      installBanner.classList.remove('show');
    }

    function isStandalone() {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    }

    async function init() {
      password = localStorage.getItem(PASSWORD_KEY) || prompt('请输入设备密码') || '';
      if (!password) return showError('认证失败', '需要设备密码');
      try {
        device = await cloud('/api/auth', { uuid, password });
        localStorage.setItem(PASSWORD_KEY, password);
        cacheDevice();
        await connectToDesktop();
      } catch (error) {
        localStorage.removeItem(PASSWORD_KEY);
        showError('认证失败', '密码错误或设备不存在');
      }
    }

    async function cloud(path, body) {
      const res = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      if (!res.ok) throw new Error('cloud failed');
      return res.json();
    }

    function orderedUrls() {
      const urls = (device?.lanIps || []).map((ip) => 'http://' + ip + ':' + device.port);
      return serverUrl ? [serverUrl, ...urls.filter((url) => url !== serverUrl)] : urls;
    }

    async function tryDesktop(path = '/', options = {}) {
      for (const base of orderedUrls()) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(base + path, { ...options, signal: controller.signal });
          clearTimeout(timeout);
          if (res.ok) {
            serverUrl = base;
            return res;
          }
        } catch (_) {}
      }
      throw new Error('desktop unreachable');
    }

    async function refreshDevice() {
      device = await cloud('/api/client', { uuid, password });
      cacheDevice();
    }

    function cacheDevice() {
      if (device) localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
    }

    function saveTextDraft() {
      const value = document.getElementById('textInput').value;
      if (value) {
        localStorage.setItem(TEXT_DRAFT_KEY, value);
      } else {
        localStorage.removeItem(TEXT_DRAFT_KEY);
      }
    }

    function restoreTextDraft() {
      const value = localStorage.getItem(TEXT_DRAFT_KEY);
      if (value) document.getElementById('textInput').value = value;
    }

    function clearTextDraft() {
      localStorage.removeItem(TEXT_DRAFT_KEY);
    }

    async function connectToDesktop() {
      try {
        await tryDesktop('/connect', { method:'POST', headers:{'Content-Type':'application/json'} });
        isConnected = true;
        showStatus('已连接到桌面', 'connected');
        startHeartbeat();
        connectWebSocket();
      } catch (error) {
        isConnected = false;
        showStatus('未完成桌面连接登记，可直接尝试发送。', 'error');
      }
    }

    async function sendViaDesktop(path, options, behavior = {}) {
      const refreshOnFailure = Boolean(behavior.refreshOnFailure);
      if (deviceRefreshExhausted) {
        showError('连接错误', '当前设备连接不可用，请刷新页面后重试。');
        throw new Error('device refresh exhausted');
      }

      try {
        return await tryDesktop(path, options);
      } catch (error) {
        if (!refreshOnFailure) {
          throw error;
        }

        if (deviceRefreshUsed) {
          deviceRefreshExhausted = true;
          showError('网络错误', '当前网络不可用，请刷新页面或重新扫码。');
          throw error;
        }

        deviceRefreshUsed = true;
        await refreshDevice();
        showStatus('访问错误，IP地址已刷新，正在重试。', 'error');

        try {
          return await tryDesktop(path, options);
        } catch (retryError) {
          deviceRefreshExhausted = true;
          showError('网络错误', '刷新后的IP地址仍然无法连接，请刷新页面或重新扫码。');
          throw retryError;
        }
      }
    }

    async function sendText() {
      if (isSending) return;
      const textInput = document.getElementById('textInput');
      const fullText = textInput.value;
      const text = manualMode ? fullText.trim() : fullText.slice(lastSentLength).trim();
      if (!text) return;
      isSending = true;
      sendButton.disabled = true;
      try {
        await sendViaDesktop('/', { method:'POST', headers:{'Content-Type':'text/plain'}, body:text + ' ' }, { refreshOnFailure:true });
        await addHistory(text);
        if (manualMode) {
          textInput.value = '';
          lastSentLength = 0;
          clearTextDraft();
        } else {
          lastSentLength = fullText.length;
          saveTextDraft();
        }
        showStatus('文本发送成功！', 'success');
      } catch (_) {
        // keep input intact on failure
      } finally {
        isSending = false;
        sendButton.disabled = false;
      }
    }

    async function sendTextAndEnter() {
      const text = document.getElementById('textInput').value.trim();
      if (!text) return;
      await sendText();
      if (!document.getElementById('textInput').value.trim()) {
        try { await sendViaDesktop('/enter-key', { method:'POST' }, { refreshOnFailure:true }); } catch (_) {}
      }
    }

    function startHeartbeat() {
      clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        sendViaDesktop('/heartbeat', { method:'POST', headers:{'Content-Type':'application/json'} }).catch(() => {});
      }, 20000);
    }

    function connectWebSocket() {
      if (!serverUrl) return;
      if (ws) ws.close();
      ws = new WebSocket(serverUrl.replace('http://', 'ws://'));
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'file') handleReceivedFile(data);
      };
      ws.onclose = () => setTimeout(connectWebSocket, 5000);
    }

    function handleReceivedFile(data) {
      const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type:data.mimetype }));
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.textContent = '下载: ' + data.filename;
      document.getElementById('downloadArea').appendChild(a);
      a.click();
    }

    function openDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('history', { keyPath:'id', autoIncrement:true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function addHistory(text) {
      const db = await openDb();
      const tx = db.transaction('history', 'readwrite');
      tx.objectStore('history').add({ text, createdAt: Date.now() });
    }

    async function readHistory() {
      const db = await openDb();
      return new Promise((resolve) => {
        const req = db.transaction('history').objectStore('history').getAll();
        req.onsuccess = () => resolve(req.result.sort((a,b) => b.createdAt - a.createdAt));
      });
    }

    async function showHistory() {
      const list = document.getElementById('historyList');
      list.innerHTML = '<p class="hint">正在读取历史记录...</p>';
      document.getElementById('historyModal').style.display = 'block';
      try {
        const rows = await readHistory();
        list.innerHTML = rows.length ? '' : '<p class="hint">暂无历史记录</p>';
        rows.forEach((row) => {
          const btn = document.createElement('button');
          btn.className = 'history-item';
          btn.type = 'button';
          btn.textContent = row.text;
          btn.onclick = () => {
            document.getElementById('textInput').value = row.text;
            saveTextDraft();
            closeHistory();
          };
          list.appendChild(btn);
        });
      } catch (error) {
        list.innerHTML = '<p class="hint">历史记录读取失败，请刷新页面后重试。</p>';
      }
    }

    function closeHistory() { document.getElementById('historyModal').style.display = 'none'; }
    function reloadPage() { saveTextDraft(); location.reload(); }
    function showStatus(message, type) { const el = document.getElementById('statusMessage'); el.textContent = message; el.className = 'status-message ' + type; }
    function showError(title, message) { modalTitle.textContent = title; modalMessage.textContent = message; errorModal.style.display = 'block'; }
    function closeModal() { errorModal.style.display = 'none'; }

    fileInput.onchange = (event) => {
      selectedFiles = selectedFiles.concat([...event.target.files]);
      selectedFilesList.innerHTML = selectedFiles.map((file, i) => '<div class="file-item"><span>' + file.name + '</span><button onclick="selectedFiles.splice(' + i + ',1); fileInput.onchange({target:{files:[]}})">移除</button></div>').join('');
      sendFilesButton.style.display = selectedFiles.length ? 'block' : 'none';
      fileInfo.textContent = selectedFiles.length ? '已选择 ' + selectedFiles.length + ' 个文件' : '';
      event.target.value = '';
    };

    sendFilesButton.onclick = async () => {
      for (const file of selectedFiles) {
        const form = new FormData();
        form.append('file', file);
        await sendViaDesktop('/upload-to-pc', { method:'POST', body:form }, { refreshOnFailure:true }).catch(() => {});
      }
      selectedFiles = [];
      fileInput.onchange({ target:{ files:[] } });
    };

    manualCheckbox.onchange = () => { manualMode = manualCheckbox.checked; };
    delayInput.onchange = () => sendViaDesktop('/save-delay', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ delay:Number(delayInput.value) }) }).catch(() => {});
    textInput.oninput = () => {
      saveTextDraft();
      if (manualMode) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(sendText, Number(delayInput.value || 2) * 1000);
    };
    sendButton.onclick = sendText;
    sendAndEnterButton.onclick = sendTextAndEnter;
    historyButton.onclick = showHistory;
    historyModal.onclick = (event) => { if (event.target === historyModal) closeHistory(); };
    reloadPageButton.onclick = reloadPage;
    clearButton.onclick = () => { textInput.value = ''; lastSentLength = 0; clearTextDraft(); };
  </script>
</body>
</html>`;
}
