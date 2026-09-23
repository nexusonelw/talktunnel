const fs = require('fs');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
let lastLoggedConfigPath = '';

function readConfig() {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'config', 'cloudflare.json'),
    path.join(__dirname, 'config', 'cloudflare.json')
  ].filter(Boolean);

  try {
    const configPath = candidates.find((file) => fs.existsSync(file));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configPath !== lastLoggedConfigPath) {
      console.log('[cloud-sync] config loaded:', configPath);
      lastLoggedConfigPath = configPath;
    }
    return {
      workerBaseUrl: String(config.workerBaseUrl || '').replace(/\/+$/, '')
    };
  } catch (error) {
    console.warn('Cloudflare config unavailable:', error.message);
    return { workerBaseUrl: '' };
  }
}

function enabled() {
  const { workerBaseUrl } = readConfig();
  return /^https?:\/\//.test(workerBaseUrl) && !workerBaseUrl.includes('your-worker-domain');
}

async function postJson(pathname, body) {
  const { workerBaseUrl } = readConfig();
  if (!workerBaseUrl || workerBaseUrl.includes('your-worker-domain')) {
    console.warn('[cloud-sync] workerBaseUrl is not configured');
    return null;
  }

  const quiet = pathname === '/api/relay/poll';
  if (!quiet) console.log('[cloud-sync] POST', `${workerBaseUrl}${pathname}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(`${workerBaseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    if (!quiet) console.error('[cloud-sync] response error', response.status, text);
    throw new Error(`Cloud sync failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  if (!quiet) console.log('[cloud-sync] response ok', pathname);
  return result;
}

async function ensureRegistered({ lanIps, port, getPassword }) {
  console.log('[cloud-sync] ensureRegistered called', { lanIps, port, enabled: enabled() });
  if (!enabled()) return getClientInfo(port);

  let uuid = store.get('cloudClient.uuid');
  let registrationSecret = store.get('cloudClient.registrationSecret');
  console.log('[cloud-sync] local identity', {
    hasUuid: Boolean(uuid),
    hasRegistrationSecret: Boolean(registrationSecret)
  });

  if (!uuid || !registrationSecret) {
    const password = await getPassword();
    if (!password) throw new Error('Cloud registration password is required');

    const result = await postJson('/api/register', { password, lanIps, port });
    uuid = result.uuid;
    registrationSecret = result.registrationSecret;
    store.set('cloudClient.uuid', uuid);
    store.set('cloudClient.registrationSecret', registrationSecret);
    store.set('cloudClient.password', password);
  } else {
    await updateIps({ lanIps, port });
  }

  return getClientInfo(port);
}

function getAccessPassword() {
  return store.get('cloudClient.password') || '';
}

async function setAccessPassword(password, { lanIps, port }) {
  if (typeof password !== 'string' || !password.trim() || password.length > 128) {
    throw new Error('访问密码须为 1–128 个字符，且不能全为空格');
  }
  if (!enabled()) throw new Error('Cloudflare 服务尚未配置');

  const uuid = store.get('cloudClient.uuid');
  const registrationSecret = store.get('cloudClient.registrationSecret');
  if (!uuid || !registrationSecret) {
    if (!port || !lanIps.length) throw new Error('本地服务尚未就绪，请稍后重试');
    await ensureRegistered({ lanIps, port, getPassword: async () => password });
    return;
  }

  await postJson('/api/change-password', { uuid, registrationSecret, password });
  store.set('cloudClient.password', password);
}

async function updateIps({ lanIps, port }) {
  const uuid = store.get('cloudClient.uuid');
  const registrationSecret = store.get('cloudClient.registrationSecret');
  if (!uuid || !registrationSecret || !enabled()) return null;

  return postJson('/api/update-ips', {
    uuid,
    registrationSecret,
    lanIps,
    port
  });
}

async function pollRelay() {
  const uuid = store.get('cloudClient.uuid');
  const registrationSecret = store.get('cloudClient.registrationSecret');
  if (!uuid || !registrationSecret || !enabled()) return [];
  const result = await postJson('/api/relay/poll', { uuid, registrationSecret });
  return result.messages || [];
}

async function ackRelay({ id, leaseToken, success }) {
  const uuid = store.get('cloudClient.uuid');
  const registrationSecret = store.get('cloudClient.registrationSecret');
  const result = await postJson('/api/relay/ack', { uuid, registrationSecret, id, leaseToken, success });
  if (!result.ok) throw new Error('Relay acknowledgment was not accepted');
}

function startRelayPolling(processMessage, intervalMs = 5000) {
  let stopped = false;
  let timer;
  let lastWarningAt = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      const messages = await pollRelay();
      for (const message of messages) {
        if (stopped) break;
        let success = false;
        try {
          success = (await processMessage(message)) !== false;
        } catch (error) {
          console.error('[cloud-relay] processing failed:', error);
        }
        await ackRelay({ id: message.id, leaseToken: message.leaseToken, success });
      }
    } catch (error) {
      if (Date.now() - lastWarningAt > 60000) {
        console.warn('[cloud-relay] polling failed:', error.message);
        lastWarningAt = Date.now();
      }
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

function getClientInfo(port) {
  const { workerBaseUrl } = readConfig();
  const uuid = store.get('cloudClient.uuid');
  return {
    uuid,
    workerBaseUrl,
    cloudUrl: uuid && workerBaseUrl && !workerBaseUrl.includes('your-worker-domain')
      ? `${workerBaseUrl}/${uuid}`
      : null,
    port
  };
}

module.exports = {
  ensureRegistered,
  updateIps,
  getClientInfo,
  readConfig,
  getAccessPassword,
  setAccessPassword,
  startRelayPolling
};
