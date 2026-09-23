const { createHash } = require('crypto');

const VALID_KINDS = new Set(['text', 'text_enter', 'enter']);
const ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

function createCommandProcessor({ store, pasteText, pressEnter, now = Date.now }) {
  const inFlight = new Map();
  const history = new Map(Object.entries(store.get('processedCommands', {})));

  function persist(id, progress) {
    if (!id) return;
    history.set(id, { ...progress, updatedAt: now() });
    for (const [key, value] of history) {
      if (now() - value.updatedAt > HISTORY_TTL_MS) history.delete(key);
    }
    while (history.size > 1000) history.delete(history.keys().next().value);
    store.set('processedCommands', Object.fromEntries(history));
  }

  async function execute({ id, kind, text }) {
    if (!VALID_KINDS.has(kind) ||
        (kind === 'enter' ? text !== '' : typeof text !== 'string' || !text.trim()) ||
        (id && !ID_PATTERN.test(id))) {
      throw new Error('Invalid command');
    }

    const fingerprint = createHash('sha256').update(JSON.stringify({ kind, text })).digest('hex');
    const progress = id ? history.get(id) || { fingerprint, textDone: false, enterDone: false } :
      { fingerprint, textDone: false, enterDone: false };
    if (progress.fingerprint !== fingerprint) throw new Error('Command ID reused with different content');

    if (kind !== 'enter' && !progress.textDone) {
      if (!(await pasteText(text))) return false;
      progress.textDone = true;
      persist(id, progress);
    }
    if (kind !== 'text' && !progress.enterDone) {
      if (!(await pressEnter())) return false;
      progress.enterDone = true;
      persist(id, progress);
    }
    return true;
  }

  return function processCommand(command) {
    if (!command.id) return execute(command);
    if (inFlight.has(command.id)) return inFlight.get(command.id);
    const task = execute(command).finally(() => inFlight.delete(command.id));
    inFlight.set(command.id, task);
    return task;
  };
}

module.exports = { createCommandProcessor };
