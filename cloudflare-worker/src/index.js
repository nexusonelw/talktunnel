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
      if (url.pathname === '/api/register' && request.method === 'POST') return await register(request, env);
      if (url.pathname === '/api/update-ips' && request.method === 'POST') return await updateIps(request, env);
      if (url.pathname === '/api/change-password' && request.method === 'POST') return await changePassword(request, env);
      if (url.pathname === '/api/auth' && request.method === 'POST') return await auth(request, env);
      if (url.pathname === '/api/client' && request.method === 'POST') return await client(request, env);
      if (url.pathname === '/api/relay/submit' && request.method === 'POST') return await relaySubmit(request, env);
      if (url.pathname === '/api/relay/status' && request.method === 'POST') return await relayStatus(request, env);
      if (url.pathname === '/api/relay/poll' && request.method === 'POST') return await relayPoll(request, env);
      if (url.pathname === '/api/relay/ack' && request.method === 'POST') return await relayAck(request, env);
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
  },
  async scheduled(_controller, env) {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const result = await env.DB.prepare(
        'DELETE FROM relay_messages WHERE id IN (SELECT id FROM relay_messages WHERE expires_at <= ? LIMIT 500)'
      ).bind(now).run();
      if ((result.meta?.changes || 0) < 500) break;
    }
  }
};

async function register(request, env) {
  const body = await request.json();
  const password = String(body.password || '');
  const lanIps = cleanIps(body.lanIps);
  const port = Number(body.port);
  if (!password.trim() || password.length > 128 || !lanIps.length || !Number.isInteger(port)) return json({ error: 'Invalid registration' }, 400);

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

async function changePassword(request, env) {
  const body = await request.json();
  const uuid = String(body.uuid || '');
  const registrationSecret = String(body.registrationSecret || '');
  const password = String(body.password || '');
  if (!uuid || !registrationSecret || !password.trim() || password.length > 128) {
    return json({ error: 'Invalid password update' }, 400);
  }

  const row = await env.DB.prepare('SELECT salt, registration_secret_hash FROM clients WHERE uuid = ?').bind(uuid).first();
  if (!row || !(await matchesSecret(registrationSecret, row.salt, row.registration_secret_hash))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const salt = randomBase64(16);
  const passwordHash = await hashSecret(password, salt);
  const registrationSecretHash = await hashSecret(registrationSecret, salt);
  await env.DB.prepare('UPDATE clients SET salt = ?, password_hash = ?, registration_secret_hash = ? WHERE uuid = ?')
    .bind(salt, passwordHash, registrationSecretHash, uuid)
    .run();
  await env.DB.prepare("UPDATE relay_messages SET state = 'failed', payload = '', claimed_until = 0, lease_token = NULL WHERE uuid = ? AND state = 'queued'")
    .bind(uuid).run();
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

async function getAuthedDesktop(env, uuid, registrationSecret) {
  const row = await env.DB.prepare('SELECT salt, registration_secret_hash FROM clients WHERE uuid = ?')
    .bind(uuid).first();
  if (!row || !(await matchesSecret(registrationSecret, row.salt, row.registration_secret_hash))) {
    throw new HttpError('Unauthorized', 401);
  }
}

const RELAY_TTL_MS = 24 * 60 * 60 * 1000;
const RELAY_LEASE_MS = 60 * 1000;
const RELAY_MAX_TEXT_BYTES = 64 * 1024;
const RELAY_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function relaySubmit(request, env) {
  if (Number(request.headers.get('content-length') || 0) > 70 * 1024) {
    return json({ error: 'Text is too large for cloud relay' }, 413);
  }
  const body = await request.json();
  const uuid = String(body.uuid || '');
  const password = String(body.password || '');
  const id = String(body.id || '');
  const kind = String(body.kind || '');
  const payload = body.text;
  if (!RELAY_ID_PATTERN.test(id) || !['text', 'text_enter', 'enter'].includes(kind) ||
      (kind === 'enter' ? payload !== '' : typeof payload !== 'string' || !payload.trim()) ||
      new TextEncoder().encode(String(payload)).length > RELAY_MAX_TEXT_BYTES) {
    return json({ error: 'Invalid relay message' }, 400);
  }
  await getAuthedClient(env, uuid, password);

  const existing = await env.DB.prepare('SELECT uuid, kind, payload, state FROM relay_messages WHERE id = ?')
    .bind(id).first();
  if (existing) {
    if (existing.uuid !== uuid || existing.kind !== kind || (existing.state === 'queued' && existing.payload !== payload)) {
      return json({ error: 'Relay ID already used' }, 409);
    }
    return json({ id, state: existing.state });
  }

  const now = Date.now();
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM relay_messages WHERE uuid = ? AND state = 'queued' AND expires_at > ?")
    .bind(uuid, now).first();
  if (Number(count?.count || 0) >= 200) return json({ error: 'Relay queue is full' }, 429);

  await env.DB.prepare(
    'INSERT OR IGNORE INTO relay_messages (id, uuid, kind, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, uuid, kind, payload, now, now + RELAY_TTL_MS).run();
  return json({ id, state: 'queued' }, 202);
}

async function relayStatus(request, env) {
  const body = await request.json();
  const uuid = String(body.uuid || '');
  const id = String(body.id || '');
  if (!RELAY_ID_PATTERN.test(id)) return json({ error: 'Invalid relay ID' }, 400);
  await getAuthedClient(env, uuid, String(body.password || ''));
  const row = await env.DB.prepare('SELECT state, expires_at FROM relay_messages WHERE uuid = ? AND id = ?')
    .bind(uuid, id).first();
  if (!row) return json({ error: 'Relay message not found' }, 404);
  return json({ id, state: row.expires_at <= Date.now() && row.state === 'queued' ? 'failed' : row.state });
}

async function relayPoll(request, env) {
  const body = await request.json();
  const uuid = String(body.uuid || '');
  await getAuthedDesktop(env, uuid, String(body.registrationSecret || ''));
  const now = Date.now();
  await env.DB.prepare("UPDATE relay_messages SET state = 'failed', payload = '' WHERE uuid = ? AND state = 'queued' AND attempts >= 5 AND claimed_until <= ?")
    .bind(uuid, now).run();
  const candidates = await env.DB.prepare(
    "SELECT id, kind, payload FROM relay_messages WHERE uuid = ? AND state = 'queued' AND claimed_until <= ? AND expires_at > ? ORDER BY created_at, id LIMIT 10"
  ).bind(uuid, now, now).all();
  const messages = [];
  for (const row of candidates.results || []) {
    const leaseToken = crypto.randomUUID();
    const claim = await env.DB.prepare(
      "UPDATE relay_messages SET claimed_until = ?, lease_token = ?, attempts = attempts + 1 WHERE uuid = ? AND id = ? AND state = 'queued' AND claimed_until <= ?"
    ).bind(now + RELAY_LEASE_MS, leaseToken, uuid, row.id, now).run();
    if (claim.meta?.changes === 1) {
      messages.push({ id: row.id, kind: row.kind, text: row.payload, leaseToken });
    }
  }
  return json({ messages });
}

async function relayAck(request, env) {
  const body = await request.json();
  const uuid = String(body.uuid || '');
  const id = String(body.id || '');
  const leaseToken = String(body.leaseToken || '');
  if (!RELAY_ID_PATTERN.test(id) || !RELAY_ID_PATTERN.test(leaseToken) || typeof body.success !== 'boolean') {
    return json({ error: 'Invalid acknowledgment' }, 400);
  }
  await getAuthedDesktop(env, uuid, String(body.registrationSecret || ''));
  const now = Date.now();
  const result = body.success
    ? await env.DB.prepare("UPDATE relay_messages SET state = 'done', payload = '', processed_at = ?, claimed_until = 0, lease_token = NULL WHERE uuid = ? AND id = ? AND state = 'queued' AND lease_token = ?")
      .bind(now, uuid, id, leaseToken).run()
    : await env.DB.prepare("UPDATE relay_messages SET state = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END, payload = CASE WHEN attempts >= 5 THEN '' ELSE payload END, claimed_until = 0, lease_token = NULL WHERE uuid = ? AND id = ? AND state = 'queued' AND lease_token = ?")
      .bind(uuid, id, leaseToken).run();
  return json({ ok: result.meta?.changes === 1 });
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
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
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
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;flex-direction:column}.app-bar{background:#2196F3;color:white;padding:16px 20px;box-shadow:0 2px 4px rgba(0,0,0,.1);position:sticky;top:0;z-index:10}.app-bar h1{font-size:20px;font-weight:500}.container{flex:1;padding:20px;display:flex;flex-direction:column;gap:16px;overflow-y:auto}.input-field{width:100%;padding:16px;font-size:16px;border:1px solid #ddd;border-radius:8px;background:white}.input-field:focus{outline:none;border-color:#2196F3}.textarea-field{min-height:200px;resize:vertical;font-family:inherit}.button{background:#2196F3;color:white;border:0;padding:14px 24px;font-size:16px;border-radius:8px;cursor:pointer;width:100%;text-transform:uppercase;font-weight:500}.button:disabled{background:#ccc;cursor:not-allowed}.settings-section,.file-section{background:white;border-radius:8px;padding:16px;box-shadow:0 2px 4px rgba(0,0,0,.1)}.settings-row,.manual-checkbox-row{display:flex;align-items:center;gap:12px}.settings-label,.hint,.file-info{color:#666;font-size:14px}.delay-input{width:80px;padding:8px;border:1px solid #ddd;border-radius:4px;text-align:center}.status-message{padding:12px 16px;border-radius:8px;text-align:center}.success{background:#4CAF50;color:white}.error{background:#f44336;color:white}.connected{background:#e8f5e9;color:#2e7d32;border:1px solid #4caf50}.file-label{background:#2196F3;color:white;padding:12px 20px;border-radius:8px;display:block;text-align:center}.file-input-wrapper input{position:absolute;left:-9999px}.selected-files-list{margin-top:10px}.file-item{display:flex;justify-content:space-between;gap:8px;padding:8px;margin:5px 0;background:#f5f5f5;border-radius:4px;font-size:14px}.download-area{background:#e3f2fd;border:2px dashed #2196F3;border-radius:8px;padding:20px;text-align:center;min-height:100px}.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px}.modal-content{background:white;margin:clamp(16px,8vh,64px) auto;padding:24px;width:100%;max-width:400px;max-height:calc(100vh - 32px);border-radius:12px;display:flex;flex-direction:column;gap:12px}.modal-header{font-size:20px;margin-bottom:4px}.modal-body{color:#666;margin-bottom:24px;line-height:1.5}#historyList{overflow-y:auto;-webkit-overflow-scrolling:touch;max-height:55vh;padding-right:2px}.history-item{width:100%;text-align:left;background:#f7f7f7;border:0;border-radius:6px;padding:10px;margin:6px 0;white-space:pre-wrap;word-break:break-word}.install-banner{display:none;position:fixed;left:12px;right:12px;bottom:12px;z-index:900;background:#fff;border:1px solid #d7e8fb;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:12px;gap:10px;align-items:center}.install-banner.show{display:flex}.install-banner p{flex:1;color:#333;font-size:14px;line-height:1.4}.install-actions{display:flex;gap:8px}.install-actions button{border:0;border-radius:6px;padding:9px 12px;font-size:13px}.install-primary{background:#2196F3;color:#fff}.install-close{background:#eee;color:#333}.auth-card{width:calc(100% - 40px);max-width:400px;margin:48px auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 4px 16px rgba(0,0,0,.12)}.auth-card h2{font-size:20px;margin-bottom:12px}.auth-card p{color:#666;font-size:14px;line-height:1.5;margin-bottom:16px}.auth-card input{width:100%;padding:12px;font-size:16px;border:1px solid #ccc;border-radius:8px;margin-bottom:12px}.auth-card .auth-error{color:#d32f2f;margin:12px 0 0}
    .pending{background:#fff3cd;color:#795548;border:1px solid #ffdf80}.forget-password{align-self:center;border:0;background:transparent;color:#666;text-decoration:underline;padding:12px 8px;font-size:14px;cursor:pointer}
  </style>
</head>
<body>
  <div class="app-bar"><h1>TalkTunnel Mobile</h1></div>
  <form id="authForm" class="auth-card">
    <h2>输入访问密码</h2>
    <p>请输入桌面客户端设置的密码。验证成功后会保存在这台设备，之后自动连接。</p>
    <input id="authPassword" type="password" autocomplete="current-password" required autofocus aria-label="访问密码">
    <button id="authSubmit" class="button" type="submit">连接设备</button>
    <p id="authError" class="auth-error" role="alert"></p>
  </form>
  <div class="container" id="deviceContent" style="display:none">
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
    <button id="forgetPasswordButton" class="forget-password" type="button">清空保存的密码</button>
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
    const TEXT_DRAFT_KEY = 'talktunnel-text-draft:' + uuid;
    const SAVED_PASSWORD_KEY = 'talktunnel-password:' + uuid;
    const INSTALL_DISMISSED_KEY = 'talktunnel-install-dismissed';
    let deferredInstallPrompt = null;
    let pwaSetup = false;
    let pendingCommand = null;
    let latestRelayId = null;

    localStorage.removeItem('talktunnel-device:' + uuid);
    window.addEventListener('pagehide', saveTextDraft);
    window.addEventListener('beforeunload', saveTextDraft);
    window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveTextDraft(); });
    authForm.addEventListener('submit', authenticate);
    forgetPasswordButton.addEventListener('click', () => {
      localStorage.removeItem(SAVED_PASSWORD_KEY);
      lockAccess('已清空保存的密码，请重新输入。');
    });
    if (localStorage.getItem(SAVED_PASSWORD_KEY)) void authenticate();

    function setupPwaInstall() {
      if (pwaSetup) return;
      pwaSetup = true;
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

    async function authenticate(event) {
      if (event) event.preventDefault();
      const fromSaved = !event;
      const candidate = fromSaved ? localStorage.getItem(SAVED_PASSWORD_KEY) || '' : authPassword.value;
      if (!candidate.trim()) return;
      authSubmit.disabled = true;
      authError.textContent = '';
      try {
        const verifiedDevice = await cloud('/api/auth', { uuid, password: candidate });
        localStorage.setItem(SAVED_PASSWORD_KEY, candidate);
        password = candidate;
        device = verifiedDevice;
        pendingCommand = null;
        serverUrl = '';
        authPassword.value = '';
        authForm.style.display = 'none';
        deviceContent.style.display = 'flex';
        restoreTextDraft();
        setupPwaInstall();
        await connectToDesktop();
      } catch (error) {
        if (fromSaved && error.status === 401) {
          localStorage.removeItem(SAVED_PASSWORD_KEY);
          authPassword.value = '';
        }
        authError.textContent = error.status === 401 ? '密码错误或设备不存在' : '验证失败，请检查网络后重试';
      } finally {
        authSubmit.disabled = false;
      }
    }

    async function cloud(path, body) {
      const res = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      if (!res.ok) {
        const error = new Error('cloud failed');
        error.status = res.status;
        throw error;
      }
      return res.json();
    }

    function orderedUrls() {
      const urls = (device?.lanIps || []).map((ip) => 'http://' + ip + ':' + device.port);
      return serverUrl ? [serverUrl, ...urls.filter((url) => url !== serverUrl)] : urls;
    }

    async function tryDesktop(path = '/', options = {}) {
      for (const base of orderedUrls()) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(base + path, { ...options, signal: controller.signal });
          if (res.ok) {
            serverUrl = base;
            return res;
          }
        } catch (_) {
          // Try the next local address.
        } finally {
          clearTimeout(timeout);
        }
      }
      throw new Error('desktop unreachable');
    }

    async function refreshDevice() {
      device = await cloud('/api/client', { uuid, password });
    }

    function lockAccess(message) {
      localStorage.removeItem(SAVED_PASSWORD_KEY);
      password = '';
      device = null;
      serverUrl = '';
      isConnected = false;
      clearInterval(heartbeatInterval);
      clearTimeout(debounceTimer);
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
      deviceContent.style.display = 'none';
      authForm.style.display = 'block';
      authError.textContent = message;
      authPassword.focus();
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
        showStatus('局域网连接失败，文本和回车将改用云端发送；文件仍需局域网。', 'error');
      }
    }

    async function sendViaDesktop(path, options, behavior = {}) {
      if (!device || !password) throw new Error('authentication required');
      try {
        return await tryDesktop(path, options);
      } catch (error) {
        if (!behavior.refreshOnFailure) throw error;
        try {
          await refreshDevice();
          return await tryDesktop(path, options);
        } catch (retryError) {
          if (retryError.status === 401) lockAccess('密码已变更，请重新输入');
          throw retryError;
        }
      }
    }

    async function watchRelayStatus(id) {
      for (let attempt = 0; attempt < 20 && password; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          const result = await cloud('/api/relay/status', { uuid, password, id });
          if (result.state === 'done') {
            if (latestRelayId === id) showStatus('云端发送成功，桌面端已处理。', 'success');
            return;
          }
          if (result.state === 'failed') {
            showError('云端发送失败', '桌面端未能处理这条消息，请重新发送。');
            return;
          }
        } catch (error) {
          if (error.status === 401) {
            lockAccess('密码已变更，请重新输入');
            return;
          }
        }
      }
      if (latestRelayId === id && password) {
        showStatus('云端已接收，桌面端尚未确认；客户端恢复联网后会继续处理。', 'pending');
      }
    }

    async function sendTextCommand(kind, text) {
      if (!device || !password) throw new Error('authentication required');
      if (!pendingCommand || pendingCommand.kind !== kind || pendingCommand.text !== text) {
        pendingCommand = { id: crypto.randomUUID(), kind, text };
      }
      const { id } = pendingCommand;
      const path = kind === 'text_enter' ? '/send-and-enter' : '/';
      const options = { method:'POST', headers:{'Content-Type':'text/plain', 'X-TalkTunnel-Command-Id':id}, body:text };

      try {
        await tryDesktop(path, options);
        pendingCommand = null;
        isConnected = true;
        showStatus('局域网发送成功！', 'success');
        return 'lan';
      } catch (_) {
        showStatus('当前数据局域网发送失败，正在使用云端发送…', 'pending');
      }

      try {
        await refreshDevice();
        try {
          await tryDesktop(path, options);
          pendingCommand = null;
          isConnected = true;
          showStatus('局域网发送成功！', 'success');
          return 'lan';
        } catch (_) {
          // The refreshed LAN addresses are also unreachable.
        }
      } catch (error) {
        if (error.status === 401) {
          lockAccess('密码已变更，请重新输入');
          throw error;
        }
      }

      try {
        const result = await cloud('/api/relay/submit', { uuid, password, id, kind, text });
        if (result.state === 'failed') throw new Error('Relay message failed');
        pendingCommand = null;
        latestRelayId = id;
        if (result.state === 'done') {
          showStatus('局域网发送失败；桌面端已通过云端处理。', 'success');
        } else {
          showStatus('局域网发送失败，已使用云端发送，等待桌面端处理。', 'pending');
          void watchRelayStatus(id);
        }
        return 'cloud';
      } catch (error) {
        if (error.status === 401) lockAccess('密码已变更，请重新输入');
        else if (error.status === 413) showError('文本过长', '云端单条文本上限为 64 KiB，请缩短后重试。');
        else if (error.status === 429) showError('云端队列已满', '请等待桌面端处理已有消息后再试。');
        else showError('发送失败', '局域网和云端均未能接收，请重试。');
        throw error;
      }
    }

    async function sendText(withEnter = false) {
      if (isSending) return;
      const textInput = document.getElementById('textInput');
      const fullText = textInput.value;
      const text = manualMode || withEnter ? fullText.trim() : fullText.slice(lastSentLength).trim();
      if (!text) return;
      isSending = true;
      sendButton.disabled = true;
      sendAndEnterButton.disabled = true;
      try {
        await sendTextCommand(withEnter ? 'text_enter' : 'text', text + ' ');
        await addHistory(text).catch(() => {});
        if (manualMode || withEnter) {
          textInput.value = '';
          lastSentLength = 0;
          clearTextDraft();
        } else {
          lastSentLength = fullText.length;
          saveTextDraft();
        }
      } catch (_) {
        // keep input intact on failure
      } finally {
        isSending = false;
        sendButton.disabled = false;
        sendAndEnterButton.disabled = false;
      }
    }

    async function sendTextAndEnter() {
      await sendText(true);
    }

    function startHeartbeat() {
      clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        sendViaDesktop('/heartbeat', { method:'POST', headers:{'Content-Type':'application/json'} }).catch(() => {
          isConnected = false;
          showStatus('局域网连接已断开，文本和回车将改用云端发送。', 'error');
        });
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
      ws.onclose = () => { if (password) setTimeout(connectWebSocket, 5000); };
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
      const remaining = [];
      for (const file of selectedFiles) {
        const form = new FormData();
        form.append('file', file);
        try {
          await sendViaDesktop('/upload-to-pc', { method:'POST', body:form }, { refreshOnFailure:true });
        } catch (_) {
          remaining.push(file);
        }
      }
      selectedFiles = remaining;
      fileInput.onchange({ target:{ files:[] } });
      if (remaining.length) showError('文件发送失败', '文件仍需局域网连接，未发送的文件已保留在列表中。');
    };

    manualCheckbox.onchange = () => { manualMode = manualCheckbox.checked; };
    delayInput.onchange = () => sendViaDesktop('/save-delay', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ delay:Number(delayInput.value) }) }).catch(() => {});
    textInput.oninput = () => {
      saveTextDraft();
      if (manualMode) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(sendText, Number(delayInput.value || 2) * 1000);
    };
    sendButton.onclick = () => sendText(false);
    sendAndEnterButton.onclick = sendTextAndEnter;
    historyButton.onclick = showHistory;
    historyModal.onclick = (event) => { if (event.target === historyModal) closeHistory(); };
    reloadPageButton.onclick = reloadPage;
    clearButton.onclick = () => { textInput.value = ''; lastSentLength = 0; clearTextDraft(); };
  </script>
</body>
</html>`;
}
