const pairingInput = document.querySelector('#pairing');
const status = document.querySelector('#status');
const connectButton = document.querySelector('#connect');
const disconnectButton = document.querySelector('#disconnect');
const pairingSettings = document.querySelector('#pairing-settings');
const connectionDot = document.querySelector('#connection-dot');
const connectionLabel = document.querySelector('#connection-label');
const tabMeta = document.querySelector('#tab-meta');

chrome.storage.local.get(['pairingCode']).then(async ({ pairingCode = '' }) => {
  pairingInput.value = pairingCode;
  pairingSettings.open = !pairingCode;
  await refreshTabMeta();
  await refreshBridgeStatus();
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function refreshTabMeta() {
  const tab = await activeTab();
  const title = (tab?.title || '').trim();
  const url = tab?.url || '';
  if (!url) {
    tabMeta.textContent = '没有可连接的当前标签 / No active tab';
    return tab;
  }
  tabMeta.textContent = [title, url].filter(Boolean).join('\n');
  return tab;
}

async function sessionForTab(tabId) {
  const { bridgeSessions = {} } = await chrome.storage.local.get(['bridgeSessions']);
  return Object.entries(bridgeSessions).find(([, value]) => value.tabId === tabId) || null;
}

async function refreshBridgeStatus() {
  try {
    const bridge = await chrome.runtime.sendMessage({ type: 'milksu.bridge.status' });
    connectionDot.classList.toggle('online', Boolean(bridge?.connected));
    connectionLabel.textContent = bridge?.connected
      ? 'MilkSU 在线 / Online'
      : bridge?.paired
        ? '等待 MilkSU / Waiting'
        : '尚未配对 / Not paired';
    if (!bridge?.connected && bridge?.paired && !status.textContent) {
      status.textContent = bridge.error || '启动 MilkSU 后会自动重连，不需要重新配对。';
    }
    const tab = await activeTab();
    const attached = tab?.id ? Boolean(await sessionForTab(tab.id)) : false;
    disconnectButton.disabled = !attached;
    return bridge || null;
  } catch {
    connectionDot.classList.remove('online');
    connectionLabel.textContent = '检查失败 / Check failed';
    disconnectButton.disabled = true;
    return null;
  }
}

function decodePairingCode(value) {
  const raw = value.trim();
  if (!raw) {
    throw new Error('请先从 MilkSU 设置复制并粘贴配对码 / Paste the pairing code from MilkSU settings');
  }
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes));
    if (!decoded.endpoint?.startsWith('http://127.0.0.1:') || !/^[a-f0-9]{48}$/.test(decoded.token || '')) {
      throw new Error('invalid-pairing-code');
    }
    return decoded;
  } catch {
    throw new Error('配对码无效，请回到 MilkSU 设置重新复制 / Pairing code is invalid');
  }
}

async function readCurrentTab(tab) {
  if (!tab?.id) throw new Error('没有可连接的当前标签页 / No active tab to connect');
  let title = (tab.title || '').trim();
  let url = tab.url || '';
  let text = '';
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: location.href,
        text: (document.body?.innerText || '').slice(0, 1_000_000),
      }),
    });
    if (result?.url) url = result.url;
    if (String(result?.title || '').trim()) title = String(result.title).trim();
    text = result?.text || '';
  } catch {
    // Restricted pages expose only the tabs API title/URL.
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('无法读取当前标签 / Cannot read this tab');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http(s) 页面 / Only http(s) pages can be connected');
  }
  if (!title) title = parsed.hostname || url;
  return { title, url, text };
}

connectButton.addEventListener('click', async () => {
  status.className = '';
  status.textContent = '正在连接… / Connecting';
  try {
    const pairingCode = pairingInput.value.trim();
    const { endpoint, token } = decodePairingCode(pairingCode);
    const tab = await activeTab();
    const page = await readCurrentTab(tab);
    tabMeta.textContent = [page.title, page.url].filter(Boolean).join('\n');

    const stored = await chrome.storage.local.get(['bridgeSessions']);
    const sessions = stored.bridgeSessions || {};
    const existing = Object.entries(sessions).find(([, value]) => value.tabId === tab.id);
    const bridgeSessionId = existing?.[0] || crypto.randomUUID();
    sessions[bridgeSessionId] = {
      tabId: tab.id,
      url: page.url,
      title: page.title,
      updatedAt: new Date().toISOString(),
    };
    const boundedSessions = Object.fromEntries(
      Object.entries(sessions)
        .sort((left, right) => String(right[1].updatedAt).localeCompare(String(left[1].updatedAt)))
        .slice(0, 12),
    );
    await chrome.storage.local.set({
      endpoint,
      token,
      pairingCode,
      bridgeSessions: boundedSessions,
    });

    const response = await fetch(`${endpoint}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        bridgeSessionId,
        title: page.title,
        url: page.url,
        text: page.text || '',
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    await chrome.runtime.sendMessage({ type: 'milksu.bridge.reconnect' });
    pairingSettings.open = false;
    status.className = 'success';
    status.textContent = '已连接当前标签 / Current tab connected';
    disconnectButton.disabled = false;
    setTimeout(async () => {
      const bridge = await refreshBridgeStatus();
      if (!bridge?.paired) {
        // An unpacked extension can keep an older MV3 service worker alive
        // after MilkSU updates the files on disk. Reload only when that worker
        // does not understand the current status contract; the stored pairing
        // and page sessions survive and the new worker reconnects immediately.
        chrome.runtime.reload();
      }
    }, 300);
  } catch (error) {
    const message = String(error?.message || error);
    const pairingFailure = /配对码|pairing-code|Pairing code/i.test(message);
    if (pairingFailure) {
      pairingSettings.open = true;
      pairingInput.focus();
    }
    status.className = 'error';
    status.textContent = `连接失败 / Connect failed: ${message}`;
  }
});

disconnectButton.addEventListener('click', async () => {
  status.className = '';
  status.textContent = '正在断开… / Disconnecting';
  try {
    const tab = await activeTab();
    if (!tab?.id) throw new Error('没有可断开的当前标签页 / No active tab to disconnect');
    const attached = await sessionForTab(tab.id);
    if (!attached) throw new Error('当前标签尚未连接 / This tab is not connected');
    const response = await chrome.runtime.sendMessage({
      type: 'milksu.bridge.disconnect',
      tabId: tab.id,
    });
    if (response?.error) throw new Error(response.error);
    status.className = 'success';
    status.textContent = '已断开当前标签 / Current tab disconnected';
    await refreshBridgeStatus();
  } catch (error) {
    status.className = 'error';
    status.textContent = `断开失败 / Disconnect failed: ${String(error?.message || error)}`;
  }
});
