import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

function fakeDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_clients.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002_relay_messages.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...args) {
          return {
            async first() { return statement.get(...args) || null; },
            async all() { return { results: statement.all(...args) }; },
            async run() { return { meta: { changes: statement.run(...args).changes } }; }
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
  const row = await env.DB.prepare('SELECT password_hash FROM clients WHERE uuid = ?').bind(uuid).first();
  assert.notEqual(row.password_hash, 'first password');

  assert.equal((await post(env, '/api/auth', { uuid, password: 'wrong' })).status, 401);
  const authorized = await post(env, '/api/auth', { uuid, password: 'first password' });
  assert.deepEqual((await authorized.json()).lanIps, ['192.168.1.8']);

  assert.equal((await post(env, '/api/change-password', {
    uuid, registrationSecret: 'wrong', password: 'second password'
  })).status, 401);
  assert.equal((await post(env, '/api/auth', { uuid, password: 'first password' })).status, 200);

  const pendingId = '44444444-4444-4444-8444-444444444444';
  assert.equal((await post(env, '/api/relay/submit', {
    uuid, password: 'first password', id: pendingId, kind: 'text', text: 'pending '
  })).status, 202);

  assert.equal((await post(env, '/api/change-password', {
    uuid, registrationSecret, password: 'second password'
  })).status, 200);
  assert.equal((await post(env, '/api/auth', { uuid, password: 'first password' })).status, 401);
  assert.equal((await post(env, '/api/client', { uuid, password: 'first password' })).status, 401);
  assert.equal((await post(env, '/api/auth', { uuid, password: 'second password' })).status, 200);
  const pendingStatus = await post(env, '/api/relay/status', { uuid, password: 'second password', id: pendingId });
  assert.equal((await pendingStatus.json()).state, 'failed');
  const pendingRow = await env.DB.prepare('SELECT payload FROM relay_messages WHERE id = ?').bind(pendingId).first();
  assert.equal(pendingRow.payload, '');
  assert.equal((await post(env, '/api/update-ips', {
    uuid, registrationSecret, lanIps: ['10.0.0.9'], port: 54321
  })).status, 200);
});

test('cloud relay only accepts authenticated text and desktop secret, then clears processed payload', async () => {
  const env = { DB: fakeDatabase() };
  const registration = await post(env, '/api/register', {
    password: 'device password', lanIps: ['192.168.1.8'], port: 12345
  });
  const { uuid, registrationSecret } = await registration.json();
  const id = '33333333-3333-4333-8333-333333333333';
  const message = { uuid, id, kind: 'text_enter', text: 'hello ', password: 'device password' };

  assert.equal((await post(env, '/api/relay/submit', { ...message, password: 'wrong' })).status, 401);
  const accepted = await post(env, '/api/relay/submit', message);
  assert.equal(accepted.status, 202);
  assert.equal((await post(env, '/api/relay/poll', { uuid, registrationSecret: 'wrong' })).status, 401);
  const polled = await post(env, '/api/relay/poll', { uuid, registrationSecret });
  const jobs = (await polled.json()).messages;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].text, 'hello ');
  assert.equal((await post(env, '/api/relay/poll', { uuid, registrationSecret })).status, 200);
  assert.equal((await (await post(env, '/api/relay/poll', { uuid, registrationSecret })).json()).messages.length, 0);

  const ack = await post(env, '/api/relay/ack', {
    uuid, registrationSecret, id, leaseToken: jobs[0].leaseToken, success: true
  });
  assert.equal((await ack.json()).ok, true);
  const status = await post(env, '/api/relay/status', { uuid, password: 'device password', id });
  assert.equal((await status.json()).state, 'done');
  const stored = await env.DB.prepare('SELECT payload FROM relay_messages WHERE id = ?').bind(id).first();
  assert.equal(stored.payload, '');
  const repeated = await post(env, '/api/relay/submit', message);
  assert.equal((await repeated.json()).state, 'done');

  const retryId = '55555555-5555-4555-8555-555555555555';
  assert.equal((await post(env, '/api/relay/submit', {
    uuid, password: 'device password', id: retryId, kind: 'text', text: 'retry '
  })).status, 202);
  const firstClaim = (await (await post(env, '/api/relay/poll', { uuid, registrationSecret })).json()).messages[0];
  const rejectedAck = await post(env, '/api/relay/ack', {
    uuid, registrationSecret, id: retryId,
    leaseToken: '66666666-6666-4666-8666-666666666666', success: true
  });
  assert.equal((await rejectedAck.json()).ok, false);
  const nack = await post(env, '/api/relay/ack', {
    uuid, registrationSecret, id: retryId, leaseToken: firstClaim.leaseToken, success: false
  });
  assert.equal((await nack.json()).ok, true);
  const secondClaim = (await (await post(env, '/api/relay/poll', { uuid, registrationSecret })).json()).messages[0];
  assert.equal(secondClaim.id, retryId);
  assert.notEqual(secondClaim.leaseToken, firstClaim.leaseToken);
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
