import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor() {
    this.readyState = MockWebSocket.CONNECTING;
    this.listeners = new Map();
    this.sent = [];
    this.closeCount = 0;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async emit(type, event = {}) {
    if (type === 'open') this.readyState = MockWebSocket.OPEN;
    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.closeCount += 1;
    this.readyState = MockWebSocket.CLOSED;
  }
}

const ctfSurface = /nssctf|ctfshow|NSSCTF|CTFshow|\bCTF\b|\bflag\b|题面|submit_flag|fetch_attachment/i;

async function loadBackground(storage) {
  MockWebSocket.instances = [];
  const runtimeListeners = [];
  const chrome = {
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
    },
    runtime: {
      onMessage: { addListener: listener => runtimeListeners.push(listener) },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
    },
    storage: {
      local: {
        get: async keys => Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).map(key => [key, storage[key]]),
        ),
        set: async values => Object.assign(storage, values),
        remove: async keys => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        },
      },
    },
  };
  const source = await fs.readFile('browserextension/background.js', 'utf8');
  const context = vm.createContext({
    chrome,
    clearInterval: () => {},
    clearTimeout: () => {},
    console,
    crypto: globalThis.crypto,
    fetch: globalThis.fetch,
    setInterval: () => 1,
    setTimeout: () => 1,
    URL,
    WebSocket: MockWebSocket,
  });

  vm.runInContext(source, context, { filename: 'browserextension/background.js' });
  await new Promise(resolve => setImmediate(resolve));
  return { runtimeListeners, storage };
}

async function sendRuntimeMessage(listener, message) {
  return new Promise((resolve, reject) => {
    const keepChannelOpen = listener(message, {}, resolve);
    if (keepChannelOpen !== true) {
      reject(new Error('handler did not keep the response channel open'));
    }
  });
}

test('session refresh sends a new hello without closing a healthy bridge', async () => {
  const storage = {
    endpoint: 'http://127.0.0.1:50322',
    token: 'a'.repeat(48),
    pairingCode: 'paired',
    bridgeSessions: { first: { updatedAt: '2026-08-02T00:00:00Z' } },
    pendingResults: [],
  };
  const { runtimeListeners } = await loadBackground(storage);
  assert.equal(MockWebSocket.instances.length, 1);
  const socket = MockWebSocket.instances[0];
  await socket.emit('open');
  assert.deepEqual(socket.sent.at(-1), {
    type: 'hello',
    bridgeSessionIds: ['first'],
  });

  storage.bridgeSessions.second = { updatedAt: '2026-08-02T00:01:00Z' };
  const response = await sendRuntimeMessage(
    runtimeListeners.at(-1),
    { type: 'milksu.bridge.reconnect' },
  );

  assert.equal(response.connected, true);
  assert.equal(socket.closeCount, 0);
  assert.deepEqual(socket.sent.at(-1), {
    type: 'hello',
    bridgeSessionIds: ['first', 'second'],
  });
});

test('disconnect drops the current tab session and refreshes hello', async () => {
  const storage = {
    endpoint: 'http://127.0.0.1:50322',
    token: 'a'.repeat(48),
    pairingCode: 'paired',
    bridgeSessions: {
      keep: { tabId: 2, updatedAt: '2026-08-02T00:00:00Z' },
      drop: { tabId: 7, updatedAt: '2026-08-02T00:01:00Z' },
    },
    pendingResults: [],
  };
  const { runtimeListeners } = await loadBackground(storage);
  const socket = MockWebSocket.instances[0];
  await socket.emit('open');

  const response = await sendRuntimeMessage(
    runtimeListeners.at(-1),
    { type: 'milksu.bridge.disconnect', tabId: 7 },
  );

  assert.equal(response.connected, true);
  assert.equal(response.sessionCount, 1);
  assert.deepEqual(Object.keys(storage.bridgeSessions), ['keep']);
  assert.equal(socket.closeCount, 0);
  assert.deepEqual(socket.sent.at(-1), {
    type: 'hello',
    bridgeSessionIds: ['keep'],
  });
});

test('background has no CTF command handlers', async () => {
  const source = await fs.readFile('browserextension/background.js', 'utf8');
  assert.doesNotMatch(source, ctfSurface);
});
