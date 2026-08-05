const fs = require('fs');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

function readConfig() {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'config', 'cloudflare.json'),
    path.join(__dirname, 'config', 'cloudflare.json')
  ].filter(Boolean);

  try {
    const configPath = candidates.find((file) => fs.existsSync(file));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('[cloud-sync] config loaded:', configPath);
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

  console.log('[cloud-sync] POST', `${workerBaseUrl}${pathname}`, {
    ...body,
    password: body.password ? '[hidden]' : undefined,
    registrationSecret: body.registrationSecret ? '[hidden]' : undefined
  });

  const response = await fetch(`${workerBaseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[cloud-sync] response error', response.status, text);
    throw new Error(`Cloud sync failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  console.log('[cloud-sync] response ok', pathname, {
    ...result,
    registrationSecret: result.registrationSecret ? '[hidden]' : undefined
  });
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
  } else {
    await updateIps({ lanIps, port });
  }

  return getClientInfo(port);
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
  readConfig
};
