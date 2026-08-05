const pairingInput = document.querySelector('#pairing');
const status = document.querySelector('#status');
const title = document.querySelector('#title');
const description = document.querySelector('#description');
const connectButton = document.querySelector('#connect');
const pairingSettings = document.querySelector('#pairing-settings');
const connectionDot = document.querySelector('#connection-dot');
const connectionLabel = document.querySelector('#connection-label');

chrome.storage.local.get(['pairingCode']).then(async ({ pairingCode = '' }) => {
  pairingInput.value = pairingCode;
  pairingSettings.open = !pairingCode;
  await refreshBridgeStatus();
});

async function refreshBridgeStatus() {
  try {
    const bridge = await chrome.runtime.sendMessage({ type: 'milksu.bridge.status' });
    connectionDot.classList.toggle('online', Boolean(bridge?.connected));
    connectionLabel.textContent = bridge?.connected
      ? 'MilkSU 在线'
      : bridge?.paired
        ? '等待 MilkSU'
        : '尚未配对';
    if (!bridge?.connected && bridge?.paired && !status.textContent) {
      status.textContent = bridge.error || '启动 MilkSU 后会自动重连，不需要重新配对。';
    }
    return bridge || null;
  } catch {
    connectionDot.classList.remove('online');
    connectionLabel.textContent = '检查失败';
    return null;
  }
}

function decodePairingCode(value) {
  const raw = value.trim();
  if (!raw) {
    throw new Error('请先从 MilkSU CTF 的“连接浏览器”复制并粘贴配对码');
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
    throw new Error('配对码无效，请回到 MilkSU CTF 重新复制');
  }
}

async function readNSSCTFPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const match = /^\/problem\/([1-9][0-9]*)\/?$/.exec(location.pathname);
      if (location.origin !== 'https://www.nssctf.cn' || !match) {
        throw new Error('当前标签页不是 NSSCTF 题目详情页');
      }
      const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
      const buttons = Array.from(document.querySelectorAll('button'));
      const startButton = buttons.find(button => normalize(button.textContent).startsWith('开启环境'));
      const startMatch = normalize(startButton?.textContent).match(/([0-9]+)/);
      const loginButton = buttons.find(button => normalize(button.textContent) === '登录');
      const heading = Array.from(document.querySelectorAll('h1,h2,h3,[role="tabpanel"]'))
        .map(element => normalize(element.textContent))
        .find(value => value && !value.startsWith('题目') && value.length <= 160);
      return {
        title: document.title,
        url: location.href,
        text: (document.body?.innerText || '').slice(0, 1000000),
        nssctf: {
          problemId: Number(match[1]),
          title: heading || document.title.replace(/\s*-\s*NSSCTF\s*$/, ''),
          category: '',
          tags: [],
          loggedIn: !loginButton,
          canSubmit: Boolean(document.querySelector('input[placeholder="flag"]')),
          needsStart: Boolean(startButton),
          startCost: startMatch ? Number(startMatch[1]) : 0,
          solved: (document.body?.innerText || '').includes('恭喜您通过了该题'),
        },
      };
    },
  });
  return result;
}

async function readCTFShowCatalog(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      if (location.origin !== 'https://ctf.show') {
        throw new Error('当前标签页不是 CTFshow');
      }
      const response = await fetch('/api/v1/challenges', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) {
        throw new Error('请先在当前标签页登录 CTFshow');
      }
      const rawPayload = await response.text();
      if (!rawPayload.trim()) {
        throw new Error('CTFshow 没有返回题库数据；请刷新页面或重新登录后再试');
      }
      let payload;
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        throw new Error('CTFshow 题库接口格式已变化，当前适配器暂时无法读取');
      }
      if (payload?.success !== true || !Array.isArray(payload.data)) {
        throw new Error(payload?.errors?.[0] || 'CTFshow 没有返回题库');
      }
      const problems = payload.data.map(challenge => ({
        platformId: Number(challenge.id),
        sourceUrl: `https://ctf.show/challenges#${Number(challenge.id)}`,
        title: String(challenge.name || '').trim(),
        category: String(challenge.category || '其他').trim(),
        points: Number(challenge.value || 0),
        solvedCount: Number(challenge.solves || 0),
        tags: Array.isArray(challenge.tags)
          ? challenge.tags
            .map(tag => typeof tag === 'string' ? tag : tag?.value || tag?.name || '')
            .filter(Boolean)
          : [],
      }));
      return {
        title: document.title || 'CTFshow',
        url: location.href,
        text: '',
        ctfshow: {
          loggedIn: true,
          total: problems.length,
          problems,
        },
      };
    },
  });
  return result;
}

async function activeAdapter(tab) {
  const url = new URL(tab.url || '');
  if (url.origin === 'https://www.nssctf.cn' && /^\/problem\/[1-9][0-9]*\/?$/.test(url.pathname)) {
    return {
      adapter: 'nssctf-web-v1',
      page: await readNSSCTFPage(tab.id),
    };
  }
  if (url.origin === 'https://ctf.show') {
    return {
      adapter: 'ctfshow-catalog-v1',
      page: await readCTFShowCatalog(tab.id),
    };
  }
  throw new Error('请打开 NSSCTF 题目或 CTFshow 题库');
}

async function updatePopupCopy() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = '';
  try {
    origin = new URL(tab?.url || '').origin;
  } catch {
    // Keep generic copy for browser-internal pages.
  }
  if (origin === 'https://ctf.show') {
    title.textContent = '同步 CTFshow 题库';
    description.textContent = '读取当前登录账号可见的题目目录，写入 MilkSU 本地 SQLite。';
    connectButton.textContent = '同步到 MilkSU';
  } else if (origin === 'https://www.nssctf.cn') {
    title.textContent = '连接当前 NSSCTF 题目';
    description.textContent = '读取当前题面并让 MilkSU 通过此标签页提交 Flag。';
    connectButton.textContent = '连接这个题目';
  }
}

void updatePopupCopy();

connectButton.addEventListener('click', async () => {
  status.className = '';
  status.textContent = '正在连接…';
  try {
    const pairingCode = pairingInput.value.trim();
    const { endpoint, token } = decodePairingCode(pairingCode);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('没有可连接的当前标签页');
    const { adapter, page } = await activeAdapter(tab);
    if (page.nssctf && !page.nssctf.loggedIn) throw new Error('当前 NSSCTF 标签页尚未登录');

    const stored = await chrome.storage.local.get(['bridgeSessions']);
    const sessions = stored.bridgeSessions || {};
    const existing = Object.entries(sessions).find(([, value]) => value.tabId === tab.id);
    const bridgeSessionId = existing?.[0] || crypto.randomUUID();
    sessions[bridgeSessionId] = {
      tabId: tab.id,
      adapter,
      problemId: page.nssctf?.problemId,
      url: page.url,
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
        adapter,
        ...page,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    await chrome.runtime.sendMessage({ type: 'milksu.bridge.reconnect' });
    pairingSettings.open = false;
    status.className = 'success';
    status.textContent = adapter === 'ctfshow-catalog-v1'
      ? `已同步 ${page.ctfshow.total} 道 CTFshow 题目。`
      : `P${page.nssctf.problemId} 已连接；现在可回到 MilkSU 解题和提交。`;
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
    const pairingFailure = /配对码|pairing-code/i.test(message);
    if (pairingFailure) {
      pairingSettings.open = true;
      pairingInput.focus();
    }
    status.className = 'error';
    status.textContent = `连接失败：${message}`;
  }
});
