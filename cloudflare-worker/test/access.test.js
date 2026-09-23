import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.js';

function fakeDatabase() {
  const clients = new Map();
  return {
    clients,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return clients.get(args[0]) || null;
            },
            async run() {
              if (sql.startsWith('INSERT INTO clients')) {
                clients.set(args[0], {
                  uuid: args[0], salt: args[1], password_hash: args[2],
                  registration_secret_hash: args[3], lan_ips: args[4], port: args[5]
                });
              } else if (sql.startsWith('UPDATE clients SET salt')) {
                Object.assign(clients.get(args[3]), {
                  salt: args[0], password_hash: args[1], registration_secret_hash: args[2]
                });
              } else if (sql.startsWith('UPDATE clients SET lan_ips')) {
                Object.assign(clients.get(args[2]), { lan_ips: args[0], port: args[1] });
              } else {
                throw new Error(`Unexpected query: ${sql}`);
              }
              return { success: true };
            }
          };
        }
      };
    }
  };
}

async function post(env, path, body) {
  return worker.fetch(new Request(`https://example.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), env);
}

test('password rotation requires the registration secret and revokes the old password', async () => {
  const env = { DB: fakeDatabase() };
  const registration = await post(env, '/api/register', {
    password: 'first password', lanIps: ['192.168.1.8'], port: 12345
  });
  assert.equal(registration.status, 200);
  const { uuid, registrationSecret } = await registration.json();
  assert.notEqual(env.DB.clients.get(uuid).password_hash, 'first password');

  assert.equal((await post(env, '/api/auth', { uuid, password: 'wrong' })).status, 401);
  const authorized = await post(env, '/api/auth', { uuid, password: 'first password' });
  assert.deepEqual((await authorized.json()).lanIps, ['192.168.1.8']);

  assert.equal((await post(env, '/api/change-password', {
    uuid, registrationSecret: 'wrong', password: 'second password'
  })).status, 401);
  assert.equal((await post(env, '/api/auth', { uuid, password: 'first password' })).status, 200);

  assert.equal((await post(env, '/api/change-password', {
    uuid, registrationSecret, password: 'second password'
  })).status, 200);
  assert.equal((await post(env, '/api/auth', { uuid, password: 'first password' })).status, 401);
  assert.equal((await post(env, '/api/client', { uuid, password: 'first password' })).status, 401);
  assert.equal((await post(env, '/api/auth', { uuid, password: 'second password' })).status, 200);
  assert.equal((await post(env, '/api/update-ips', {
    uuid, registrationSecret, lanIps: ['10.0.0.9'], port: 54321
  })).status, 200);
});

test('mobile page starts with the device controls hidden and no cached password login', async () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const response = await worker.fetch(new Request(`https://example.test/${uuid}`), {});
  const html = await response.text();
  assert.match(html, /id="authForm"/);
  assert.match(html, /id="deviceContent" style="display:none"/);
  assert.doesNotMatch(html, /localStorage\.getItem\('talktunnel-password:/);
  assert.doesNotMatch(html, /localStorage\.setItem\('talktunnel-password:/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
});
