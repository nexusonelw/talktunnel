const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandProcessor } = require('../commandProcessor');

function makeStore() {
  const values = {};
  return {
    get(key, fallback) { return values[key] || fallback; },
    set(key, value) { values[key] = value; }
  };
}

test('same command from LAN and cloud is applied once, including after restart', async () => {
  const store = makeStore();
  let pastes = 0;
  let enters = 0;
  const actions = {
    store,
    pasteText: async () => { pastes++; return true; },
    pressEnter: async () => { enters++; return true; }
  };
  const command = {
    id: '11111111-1111-4111-8111-111111111111', kind: 'text_enter', text: 'hello '
  };
  const process = createCommandProcessor(actions);
  assert.equal(await process(command), true);
  assert.equal(await process(command), true);
  assert.equal(await createCommandProcessor(actions)(command), true);
  assert.equal(pastes, 1);
  assert.equal(enters, 1);
});

test('retry resumes after pasted text when the Enter step fails', async () => {
  const store = makeStore();
  let pastes = 0;
  let enters = 0;
  const process = createCommandProcessor({
    store,
    pasteText: async () => { pastes++; return true; },
    pressEnter: async () => { enters++; return enters > 1; }
  });
  const command = {
    id: '22222222-2222-4222-8222-222222222222', kind: 'text_enter', text: 'hello '
  };
  assert.equal(await process(command), false);
  assert.equal(await process(command), true);
  assert.equal(pastes, 1);
  assert.equal(enters, 2);
});
