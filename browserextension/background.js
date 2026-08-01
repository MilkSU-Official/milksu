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
  await chrome.action.setBadgeText({ text: connected ? '✓' : '' });
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
    lastBridgeError = 'MilkSU 尚未运行，扩展会自动重连。';
    void updateBadge(false);
    clearInterval(pingTimer);
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    lastBridgeError = '无法连接 MilkSU 本地 Bridge。';
    socket.close();
  });
}

async function handleBridgeMessage(raw) {
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return;
  }
  if (
    envelope.type !== 'command'
    || ![
      'nssctf.submit_flag',
      'nssctf.fetch_attachment',
      'ctfshow.fetch_challenge',
      'ctfshow.submit_flag',
    ].includes(envelope.command?.type)
  ) return;
  const command = envelope.command;
  const stored = await chrome.storage.local.get(['bridgeSessions', 'commandResults']);
  const session = stored.bridgeSessions?.[command.bridgeSessionId];
  if (!session) return;
  const cached = stored.commandResults?.[command.id];
  if (cached) {
    await sendResult(cached);
    return;
  }

  if (command.type === 'nssctf.fetch_attachment') {
    await handleAttachmentCommand(command, stored);
    return;
  }
  if (command.type === 'ctfshow.fetch_challenge') {
    await handleCTFShowChallengeCommand(command, stored);
    return;
  }
  if (command.type === 'ctfshow.submit_flag') {
    await handleCTFShowSubmissionCommand(command, stored);
    return;
  }

  let result;
  try {
    const [{ result: adapterResult }] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      args: [command],
      func: async command => {
        const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
        const match = /^\/problem\/([1-9][0-9]*)\/?$/.exec(location.pathname);
        if (location.origin !== 'https://www.nssctf.cn' || !match || Number(match[1]) !== command.problemId) {
          return { status: 'error', message: '当前标签页已不再是绑定的 NSSCTF 题目。' };
        }
        if (Array.from(document.querySelectorAll('button')).some(button => normalize(button.textContent) === '登录')) {
          return { status: 'error', message: 'NSSCTF 登录已失效。' };
        }

        let input = document.querySelector('input[placeholder="flag"]');
        if (!input) {
          const startButton = Array.from(document.querySelectorAll('button'))
            .find(button => normalize(button.textContent).startsWith('开启环境'));
          if (startButton) {
            return {
              status: 'error',
              message: '请先由你本人确认开启 NSSCTF 题目环境，再用 MilkSU 扩展重新连接当前题目。',
            };
          }
        }
        if (!input) return { status: 'error', message: '没有找到 NSSCTF 提交区。' };

        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) return { status: 'error', message: '无法写入 NSSCTF Flag 输入框。' };
        setter.call(input, command.candidate);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        const submit = Array.from(document.querySelectorAll('button'))
          .find(button => normalize(button.textContent).replace(/\s/g, '') === '提交');
        if (!submit) return { status: 'error', message: '没有找到 NSSCTF 提交按钮。' };
        submit.click();

        for (let attempt = 0; attempt < 60; attempt++) {
          await delay(200);
          const notices = Array.from(document.querySelectorAll('[role="dialog"],[role="alert"],.el-message,.el-notification'))
            .map(element => normalize(element.textContent))
            .filter(Boolean);
          const receipt = notices.join(' · ').slice(0, 1800);
          if (receipt.includes('恭喜您通过了该题')) {
            return { status: 'accepted', correct: true, message: receipt };
          }
          if (/(flag|答案).*(错误|不正确|失败)|(错误|不正确).*(flag|答案)|incorrect|wrong flag/i.test(receipt)) {
            return { status: 'rejected', correct: false, message: receipt };
          }
        }
        return { status: 'ambiguous', message: 'NSSCTF 在等待时间内没有返回可识别的 Judge 回执。' };
      },
    });
    result = {
      type: 'result',
      commandId: command.id,
      bridgeSessionId: command.bridgeSessionId,
      problemId: command.problemId,
      status: adapterResult?.status || 'error',
      correct: adapterResult?.correct,
      message: adapterResult?.message || 'NSSCTF browser adapter returned no result.',
      url: `https://www.nssctf.cn/problem/${command.problemId}`,
    };
  } catch (error) {
    result = {
      type: 'result',
      commandId: command.id,
      bridgeSessionId: command.bridgeSessionId,
      problemId: command.problemId,
      status: 'error',
      message: String(error?.message || error),
      url: `https://www.nssctf.cn/problem/${command.problemId}`,
    };
  }

  const commandResults = { ...(stored.commandResults || {}), [command.id]: result };
  const boundedResults = Object.fromEntries(Object.entries(commandResults).slice(-20));
  await chrome.storage.local.set({ commandResults: boundedResults });
  await sendResult(result);
}

async function handleCTFShowChallengeCommand(command, stored) {
  const session = stored.bridgeSessions?.[command.bridgeSessionId];
  if (!session) return;

  let result;
  try {
    const [{ result: adapterResult }] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      world: 'MAIN',
      args: [command],
      func: async command => {
        if (location.origin !== 'https://ctf.show') {
          return { status: 'error', message: '当前标签页已不再是 CTFshow。' };
        }
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
        const detailResponse = await fetch(`/api/v1/challenges/${command.problemId}`, {
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        const contentType = detailResponse.headers.get('content-type') || '';
        if (!detailResponse.ok || !contentType.includes('application/json')) {
          return { status: 'error', message: `CTFshow 题目接口返回 HTTP ${detailResponse.status}，请确认登录状态。` };
        }
        const payload = await detailResponse.json();
        if (payload?.success !== true || !payload.data) {
          return { status: 'error', message: normalize(payload?.errors?.[0]) || 'CTFshow 没有返回题目详情。' };
        }
        const challenge = payload.data;
        const parser = new DOMParser();
        const descriptionDocument = parser.parseFromString(String(challenge.description || ''), 'text/html');
        const inlineImages = Array.from(descriptionDocument.body.querySelectorAll('img'))
          .slice(0, 16)
          .map((image, index) => {
            const rawURL = image.getAttribute('src') || '';
            const alt = normalize(image.getAttribute('alt'));
            const label = alt || `题面图片 ${index + 1}`;
            image.replaceWith(document.createTextNode(`\n[题面图片：${label}]\n`));
            return {
              rawURL,
              fallbackName: `challenge-${command.problemId}-image-${index + 1}.bin`,
              label,
              inlineImage: true,
            };
          })
          .filter(image => image.rawURL);
        for (const element of descriptionDocument.body.querySelectorAll('br,p,div,li,pre,h1,h2,h3,h4')) {
          element.append(document.createTextNode('\n'));
        }
        const statement = (descriptionDocument.body.textContent || '')
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (!statement) {
          return { status: 'error', message: 'CTFshow 题面为空，可能尚未解锁或登录已失效。' };
        }

        const warnings = [];
        const materials = [];
        let totalBytes = 0;
        const fileEntries = (Array.isArray(challenge.files) ? challenge.files : [])
          .slice(0, 16)
          .map((rawURL, index) => ({
            rawURL,
            fallbackName: `challenge-${command.problemId}-attachment-${index + 1}.bin`,
            label: `附件 ${index + 1}`,
            inlineImage: false,
          }));
        for (const image of inlineImages.slice(0, Math.max(16 - fileEntries.length, 0))) {
          fileEntries.push(image);
        }
        for (const entry of fileEntries) {
          let fileURL;
          try {
            fileURL = new URL(String(entry.rawURL), location.origin);
          } catch {
            warnings.push(`${entry.label}地址无法解析，已跳过。`);
            continue;
          }
          if (fileURL.protocol !== 'https:' || fileURL.origin !== location.origin) {
            warnings.push(`${entry.label}不在 CTFshow 同源范围，已跳过。`);
            continue;
          }
          const fileResponse = await fetch(fileURL, { credentials: 'include' });
          if (!fileResponse.ok) {
            warnings.push(`${entry.label}下载失败：HTTP ${fileResponse.status}。`);
            continue;
          }
          const mediaType = (fileResponse.headers.get('content-type') || 'application/octet-stream')
            .split(';')[0]
            .trim();
          if (entry.inlineImage && !mediaType.startsWith('image/')) {
            warnings.push(`${entry.label}返回 ${mediaType || '未知类型'}，未作为图片导入。`);
            continue;
          }
          const declaredLength = Number(fileResponse.headers.get('content-length') || 0);
          if (declaredLength > 4 * 1024 * 1024 || totalBytes + declaredLength > 4 * 1024 * 1024) {
            warnings.push(`${entry.label}超过本次 4 MiB 导入预算，已跳过。`);
            continue;
          }
          const bytes = new Uint8Array(await fileResponse.arrayBuffer());
          if (!bytes.length || bytes.length > 4 * 1024 * 1024 || totalBytes + bytes.length > 4 * 1024 * 1024) {
            warnings.push(`${entry.label}为空或超过本次导入预算，已跳过。`);
            continue;
          }
          totalBytes += bytes.length;
          const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          const sha256 = Array.from(digestBytes, byte => byte.toString(16).padStart(2, '0')).join('');
          const disposition = fileResponse.headers.get('content-disposition') || '';
          const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
          const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
          let name = '';
          try {
            name = decodeURIComponent(utf8Name || plainName || fileURL.pathname.split('/').at(-1) || '');
          } catch {
            name = plainName || fileURL.pathname.split('/').at(-1) || '';
          }
          name = name.split(/[\\/]/).at(-1)?.trim() || entry.fallbackName;
          if (name.length > 160) name = `challenge-${command.problemId}-${materials.length + 1}.bin`;
          let binary = '';
          const chunkSize = 32 * 1024;
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
          }
          materials.push({
            name,
            mediaType,
            dataBase64: btoa(binary),
            sha256,
            size: bytes.length,
          });
        }

        return {
          status: 'ready',
          title: normalize(challenge.name),
          category: normalize(challenge.category) || '其他',
          statement: statement.slice(0, 12000),
          points: Number(challenge.value || 0),
          solvedCount: Number(challenge.solves || 0),
          tags: Array.isArray(challenge.tags)
            ? challenge.tags
              .map(tag => typeof tag === 'string' ? tag : tag?.value || tag?.name || '')
              .map(normalize)
              .filter(Boolean)
              .slice(0, 32)
            : [],
          materials,
          warnings,
        };
      },
    });
    result = {
      type: 'ctfshow_challenge_result',
      commandId: command.id,
      bridgeSessionId: command.bridgeSessionId,
      problemId: command.problemId,
      status: adapterResult?.status || 'error',
      message: adapterResult?.message || '',
      title: adapterResult?.title || '',
      category: adapterResult?.category || '',
      statement: adapterResult?.statement || '',
      points: adapterResult?.points || 0,
      solvedCount: adapterResult?.solvedCount || 0,
      tags: adapterResult?.tags || [],
      materials: adapterResult?.materials || [],
      warnings: adapterResult?.warnings || [],
    };
  } catch (error) {
    result = {
      type: 'ctfshow_challenge_result',
      commandId: command.id,
      bridgeSessionId: command.bridgeSessionId,
      problemId: command.problemId,
      status: 'error',
      message: `CTFshow 题目导入失败：${String(error?.message || error)}`,
    };
  }
  await sendResult(result);
}

async function handleCTFShowSubmissionCommand(command, stored) {
  const session = stored.bridgeSessions?.[command.bridgeSessionId];
  if (!session) return;

  let result;
  try {
    const [{ result: adapterResult }] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      world: 'MAIN',
      args: [command],
      func: async command => {
        if (location.origin !== 'https://ctf.show') {
          return { status: 'error', message: '当前标签页已不再是 CTFshow。' };
        }
        const response = await fetch('/api/v1/challenges/attempt', {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            challenge_id: command.problemId,
            submission: command.candidate,
          }),
        });
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('application/json')) {
          return { status: 'error', message: `CTFshow Judge 返回 HTTP ${response.status}，请确认登录状态。` };
        }
        const payload = await response.json();
        const judgeStatus = String(payload?.data?.status || '').toLowerCase();
        const message = String(payload?.data?.message || payload?.errors?.[0] || 'CTFshow Judge 未返回说明。')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1800);
        if (judgeStatus === 'correct') {
          return { status: 'accepted', correct: true, message };
        }
        if (judgeStatus === 'incorrect') {
          return { status: 'rejected', correct: false, message };
        }
        if (judgeStatus === 'already_solved') {
          return {
            status: 'ambiguous',
            message: `already_solved: 平台只说明账号此前已解出，不能证明本次候选正确。${message ? ` ${message}` : ''}`,
          };
        }
        return { status: 'ambiguous', message: `${judgeStatus || 'unknown'}: ${message}` };
      },
    });
    result = {
      type: 'ctfshow_judge_result',
      commandId: command.id,
      bridgeSessionId: command.bridgeSessionId,
      problemId: command.problemId,
      status: adapterResult?.status || 'error',
      correct: adapterResult?.correct,
      message: adapterResult?.message || 'CTFshow browser adapter returned no result.',
      url: `https://ctf.show/challenges#${command.problemId}`,
    };
  } catch (error) {
    result = {
      type: 'ctfshow_judge_result',
      commandId: command.id,
      bridgeSessionId: command.bridgeSessionId,
      problemId: command.problemId,
      status: 'error',
      message: String(error?.message || error),
      url: `https://ctf.show/challenges#${command.problemId}`,
    };
  }
  const commandResults = { ...(stored.commandResults || {}), [command.id]: result };
  const boundedResults = Object.fromEntries(Object.entries(commandResults).slice(-20));
  await chrome.storage.local.set({ commandResults: boundedResults });
  await sendResult(result);
}

async function handleAttachmentCommand(command, stored) {
  const session = stored.bridgeSessions?.[command.bridgeSessionId];
  if (!session) return;

  let result;
  try {
    const [{ result: adapterResult }] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      world: 'MAIN',
      args: [command],
      func: async command => {
        const match = /^\/problem\/([1-9][0-9]*)\/?$/.exec(location.pathname);
        if (location.origin !== 'https://www.nssctf.cn' || !match || Number(match[1]) !== command.problemId) {
          return { status: 'error', message: '当前标签页已不再是绑定的 NSSCTF 题目。' };
        }
        const loginVisible = Array.from(document.querySelectorAll('button'))
          .some(button => (button.textContent || '').replace(/\s+/g, ' ').trim() === '登录');
        if (loginVisible) return { status: 'error', message: 'NSSCTF 登录已失效。' };

        const metadataResponse = await fetch(`/api/problem/${command.problemId}/annex/download/`, {
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        if (!metadataResponse.ok) {
          return { status: 'error', message: `NSSCTF 附件接口返回 HTTP ${metadataResponse.status}。` };
        }
        const metadata = await metadataResponse.json();
        if (metadata?.code === 402) {
          return {
            status: 'requires_start',
            message: '附件尚未解锁。请先在 NSSCTF 页面由你本人确认并开启题目，再重试导入。',
          };
        }
        if (metadata?.code !== 200 || typeof metadata.data !== 'string') {
          return { status: 'error', message: 'NSSCTF 没有返回可用的附件地址。' };
        }
        const attachmentURL = new URL(metadata.data, location.origin);
        if (attachmentURL.protocol !== 'https:') {
          return { status: 'error', message: 'NSSCTF 返回了非 HTTPS 附件地址，MilkSU 已拒绝。' };
        }
        const attachmentResponse = await fetch(attachmentURL, {
          credentials: attachmentURL.origin === location.origin ? 'include' : 'omit',
        });
        if (!attachmentResponse.ok) {
          return { status: 'error', message: `附件下载返回 HTTP ${attachmentResponse.status}。` };
        }
        const declaredLength = Number(attachmentResponse.headers.get('content-length') || 0);
        if (declaredLength > 4 * 1024 * 1024) {
          return { status: 'error', message: '附件超过 MilkSU M3 的 4 MiB 导入限制。' };
        }
        const bytes = new Uint8Array(await attachmentResponse.arrayBuffer());
        if (!bytes.length || bytes.length > 4 * 1024 * 1024) {
          return { status: 'error', message: '附件为空或超过 MilkSU M3 的 4 MiB 导入限制。' };
        }
        const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const sha256 = Array.from(digestBytes, byte => byte.toString(16).padStart(2, '0')).join('');
        const disposition = attachmentResponse.headers.get('content-disposition') || '';
        const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
        let name = '';
        try {
          name = decodeURIComponent(utf8Name || plainName || '');
        } catch {
          name = plainName || '';
        }
        name = name.split(/[\\/]/).at(-1)?.trim() || `P${command.problemId}-annex.bin`;
        if (!name || name.length > 160) name = `P${command.problemId}-annex.bin`;
        let binary = '';
        const chunkSize = 32 * 1024;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return {
          status: 'ready',
          name,
          mediaType: (attachmentResponse.headers.get('content-type') || 'application/octet-stream')
            .split(';')[0]
            .trim(),
          dataBase64: btoa(binary),
          sha256,
          size: bytes.length,
        };
      },
    });
    result = {
      type: 'attachment_result',
      commandId: command.id,
      bridgeSessionId: command.bridgeSessionId,
      problemId: command.problemId,
      status: adapterResult?.status || 'error',
      message: adapterResult?.message || '',
      name: adapterResult?.name || '',
      mediaType: adapterResult?.mediaType || '',
      dataBase64: adapterResult?.dataBase64 || '',
      sha256: adapterResult?.sha256 || '',
      size: adapterResult?.size || 0,
    };
  } catch (error) {
    result = {
      type: 'attachment_result',
      commandId: command.id,
      bridgeSessionId: command.bridgeSessionId,
      problemId: command.problemId,
      status: 'error',
      message: `附件导入失败：${String(error?.message || error)}`,
    };
  }

  // Do not persist multi-megabyte attachment payloads in commandResults. The
  // command arrives over a live socket and has a unique ID; sendResult retains
  // one pending response only if that socket closes during the download.
  await sendResult(result);
}

async function sendResult(result) {
  if (bridgeSocket?.readyState === WebSocket.OPEN) {
    bridgeSocket.send(JSON.stringify(result));
    return;
  }
  const { pendingResults = [] } = await chrome.storage.local.get(['pendingResults']);
  await chrome.storage.local.set({ pendingResults: [...pendingResults, result].slice(-20) });
  scheduleReconnect();
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
chrome.runtime.onInstalled.addListener(() => void connectBridge());
void connectBridge();
