let bridgeSocket;
let reconnectTimer;
let pingTimer;
let reconnectDelay = 1500;
let bridgeConnected = false;
let lastBridgeError = '';

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => void connectBridge(), reconnectDelay);
  reconnectDelay = Math.min(Math.round(reconnectDelay * 1.6), 15000);
}

async function updateBadge(connected) {
  await chrome.action.setBadgeText({ text: connected ? 'ON' : '' });
  if (connected) {
    await chrome.action.setBadgeBackgroundColor({ color: '#9fef00' });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#101927' });
    }
  }
}

async function sendBridgeHello() {
  if (bridgeSocket?.readyState !== WebSocket.OPEN) return;
  const { bridgeSessions = {} } = await chrome.storage.local.get(['bridgeSessions']);
  bridgeSocket.send(JSON.stringify({
    type: 'hello',
    bridgeSessionIds: Object.keys(bridgeSessions).slice(0, 24),
  }));
}

async function connectBridge() {
  const { endpoint, token } = await chrome.storage.local.get(['endpoint', 'token']);
  if (!endpoint || !token) {
    bridgeConnected = false;
    await updateBadge(false);
    return;
  }
  if (bridgeSocket && (bridgeSocket.readyState === WebSocket.OPEN || bridgeSocket.readyState === WebSocket.CONNECTING)) return;

  const socketURL = endpoint.replace(/^http:/, 'ws:') + '/ws';
  let socket;
  try {
    socket = new WebSocket(socketURL, ['milksu-bridge-v1', token]);
  } catch (error) {
    bridgeConnected = false;
    lastBridgeError = String(error?.message || error);
    await updateBadge(false);
    scheduleReconnect();
    return;
  }
  bridgeSocket = socket;
  socket.addEventListener('open', async () => {
    bridgeConnected = true;
    lastBridgeError = '';
    reconnectDelay = 1500;
    await updateBadge(true);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (bridgeSocket?.readyState === WebSocket.OPEN) {
        bridgeSocket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20000);
    await sendBridgeHello();
    await flushPendingResults();
  });
  socket.addEventListener('message', event => {
    void handleBridgeMessage(event.data);
  });
  socket.addEventListener('close', () => {
    if (bridgeSocket === socket) bridgeSocket = undefined;
    bridgeConnected = false;
    lastBridgeError = 'MilkSU is not running; the extension will reconnect. MilkSU 未运行，扩展会自动重连。';
    void updateBadge(false);
    clearInterval(pingTimer);
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    lastBridgeError = 'Cannot reach the local MilkSU bridge. 无法连接 MilkSU 本地 Bridge。';
    socket.close();
  });
}

async function handleBridgeMessage(raw) {
  try {
    JSON.parse(raw);
  } catch {
    return;
  }
  // Pairing only: MilkSU keeps the socket alive with hello/ping. Unknown types are ignored.
}

async function flushPendingResults() {
  const { pendingResults = [] } = await chrome.storage.local.get(['pendingResults']);
  for (const result of pendingResults) {
    if (bridgeSocket?.readyState !== WebSocket.OPEN) return;
    bridgeSocket.send(JSON.stringify(result));
  }
  await chrome.storage.local.set({ pendingResults: [] });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'milksu.bridge.reconnect') {
    void (async () => {
      try {
        if (bridgeSocket?.readyState === WebSocket.OPEN) {
          await sendBridgeHello();
        } else {
          await connectBridge();
        }
        sendResponse({
          connected: bridgeConnected && bridgeSocket?.readyState === WebSocket.OPEN,
        });
      } catch (error) {
        lastBridgeError = String(error?.message || error);
        scheduleReconnect();
        sendResponse({ connected: false, error: lastBridgeError });
      }
    })();
    return true;
  }
  if (message?.type === 'milksu.bridge.disconnect') {
    void (async () => {
      try {
        const stored = await chrome.storage.local.get(['bridgeSessions']);
        const sessions = { ...(stored.bridgeSessions || {}) };
        const tabId = Number(message.tabId);
        const next = Number.isInteger(tabId) && tabId > 0
          ? Object.fromEntries(Object.entries(sessions).filter(([, value]) => value.tabId !== tabId))
          : {};
        await chrome.storage.local.set({ bridgeSessions: next });
        if (bridgeSocket?.readyState === WebSocket.OPEN) {
          await sendBridgeHello();
        }
        sendResponse({
          connected: bridgeConnected && bridgeSocket?.readyState === WebSocket.OPEN,
          sessionCount: Object.keys(next).length,
        });
      } catch (error) {
        sendResponse({ connected: false, error: String(error?.message || error) });
      }
    })();
    return true;
  }
  if (message?.type === 'milksu.bridge.status') {
    chrome.storage.local.get(['endpoint', 'pairingCode', 'bridgeSessions']).then(stored => {
      sendResponse({
        paired: Boolean(stored.endpoint && stored.pairingCode),
        connected: bridgeConnected && bridgeSocket?.readyState === WebSocket.OPEN,
        endpoint: stored.endpoint || '',
        sessionCount: Object.keys(stored.bridgeSessions || {}).length,
        error: lastBridgeError,
      });
    });
    return true;
  }
});
chrome.runtime.onStartup.addListener(() => void connectBridge());
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.remove(['commandResults']);
  void connectBridge();
});
void connectBridge();
