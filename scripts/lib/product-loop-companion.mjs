/**
 * Companion product-loop observations. Looks at official Desktop RPC results
 * after a real companion turn. Not imported by App startup.
 */

const RELAY_PREFIX = '桌宠转达 / Companion relay:'

export function companionRelayPrefix() {
  return RELAY_PREFIX
}

function pick(value, ...keys) {
  if (value == null || typeof value !== 'object') return undefined
  for (const key of keys) {
    if (value[key] !== undefined) return value[key]
  }
  return undefined
}

export function asList(value) {
  return Array.isArray(value) ? value : []
}

export function conversationIdOf(value) {
  return String(pick(value, 'id', 'ID') ?? '').trim()
}

export function eventTypeOf(event) {
  return String(pick(event, 'type', 'Type') ?? '')
}

export function companionStopPrompt(conversationId) {
  return [
    '立刻调用工具 companion_dispatch，不要只聊天，不要在对话里问用户确认。',
    `action 必须是 stop，conversationId 必须是 ${conversationId}，idempotencyKey 用一个新的唯一值。`,
    '即使目标会话是 idle 也要马上调用。产品会弹出确认按钮，那一步才是用户确认。不要发明完成状态。',
  ].join('')
}

/** Natural-language prompts: no tool schema names. Product-loop fuzz for new-user companion. */
export function companionFuzzDispatchPrompts({ title, marker }) {
  return [
    `刚升级看到桌宠了。帮我瞄一眼现在有哪些对话，把标题叫「${title}」的那条派去摸底：让它看看工作区里有啥，回复里务必带上 ${marker}。长活别在手机里自己干。`,
    `别光聊天。去找「${title}」那条对话，转达一句带 ${marker} 的调研任务过去，让那边去列文件。`,
    `先看板再调度：看一眼会话列表，确认「${title}」还在，然后只把带 ${marker} 的短任务转达过去，不要自己 bash。`,
  ]
}

export function companionFuzzAppPrompts() {
  return [
    '打开主窗口，然后只短回一句你干了什么。不要改设置，也不要退出。',
    '读一下不含密钥的设置摘要，只说界面语言和桌宠开没开，然后短回。不要改设置。',
    '看板列一下当前会话标题，挑一两个念出来，短回即可。',
  ]
}

export function companionFuzzMemoryPrompts() {
  return [
    '记一件事：我正在做 product-loop 桌宠稳定性手测。先提出来等我批准，不要直接当成已批准。',
    '如果还没提出记忆，请再提一条标题带 product-loop 的待批准记忆。',
  ]
}

export function companionTranscriptClean(page) {
  const entries = asList(pick(page, 'entries', 'Entries'))
  for (const entry of entries) {
    const hay = [
      pick(entry, 'text', 'Text'),
      pick(entry, 'error', 'Error'),
      pick(entry, 'thinking', 'Thinking'),
    ].map(value => String(value ?? '')).join('\n')
    if (/\[object Object\]/i.test(hay)) {
      return { ok: false, reason: '抄本出现了 [object Object]' }
    }
    if (/companion-host-\d+/i.test(hay)) {
      return { ok: false, reason: '抄本泄露了 companion-host 请求号' }
    }
  }
  return { ok: true, reason: '' }
}

export function companionSpeakPrompt({ conversationId, title, marker }) {
  return [
    '你是 MilkSU 桌宠。请用产品工具做完这件事，不要只聊天回复。',
    `1. 先调用 companion_board list，确认能看到标题「${title}」、id 为 ${conversationId} 的会话。`,
    `2. 再调用 companion_dispatch，action 用 speak，conversationId 必须是 ${conversationId}，text 必须原样包含 ${marker}，idempotencyKey 用一个新的唯一值，mode 用 queue。`,
    `3. 然后对同一个 conversationId 再调用 companion_dispatch stop，另给一个 idempotencyKey。stop 会等用户确认；确认之后结束。`,
    '完成标准：目标会话必须出现桌宠转达，且你实际调用了 companion_board 和 companion_dispatch。不要发明完成状态。',
  ].join('\n')
}

export function companionIsReady(status) {
  const ready = pick(status, 'ready', 'Ready') === true
  const error = String(pick(status, 'error', 'Error') ?? '')
  if (!ready) {
    return { ok: false, reason: `桌宠未就绪 ready=${ready} error=${error || '(empty)'}` }
  }
  return { ok: true, reason: '' }
}

export function companionHostToolError(text) {
  return /companion host request timed out|companion host request failed|companion host cancelled|turn aborted|unknown companion host request|companion-host-\d+/i
    .test(String(text ?? ''))
}

export function companionTurnSettled(events) {
  return asList(events).some((event) => {
    const type = eventTypeOf(event)
    return type === 'assistant.settled' || type === 'assistant.completed'
  })
}

export function companionTurnErrored(events, options = {}) {
  const hostTimeoutIsError = options.hostTimeoutIsError !== false
  return asList(events).some((event) => {
    const text = String(
      pick(event, 'error', 'Error', 'text', 'Text')
      ?? event?.payload?.error
      ?? '',
    )
    if (companionHostToolError(text)) return hostTimeoutIsError
    return /^(error|engine\.error|engine\.protocol_error)$/i.test(eventTypeOf(event))
  })
}

export function companionTurnParked(events) {
  return asList(events).some((event) => eventTypeOf(event) === 'engine.sidecar_stopped')
}

export function parseCompanionConfirm(event) {
  if (eventTypeOf(event) !== 'companion.confirm') return null
  const raw = pick(event, 'input', 'Input')
  let request = {}
  if (typeof raw === 'string' && raw.trim()) {
    try {
      request = JSON.parse(raw)
    } catch {
      request = {}
    }
  } else if (raw && typeof raw === 'object') {
    request = raw
  }
  return {
    action: String(pick(request, 'action', 'Action') ?? 'stop'),
    conversationId: String(pick(request, 'conversationId', 'ConversationID', 'ConversationId') ?? ''),
    text: String(pick(request, 'text', 'Text') ?? ''),
    idempotencyKey: String(pick(request, 'idempotencyKey', 'IdempotencyKey') ?? ''),
    mode: String(pick(request, 'mode', 'Mode') ?? ''),
    hostRequestId: String(
      pick(request, 'hostRequestId', 'HostRequestID', 'HostRequestId')
      ?? pick(event, 'requestId', 'RequestID', 'RequestId')
      ?? '',
    ),
    targetTitle: String(pick(event, 'notice', 'Notice') ?? ''),
  }
}

export function transcriptHasPrompt(page, needle) {
  const entries = asList(pick(page, 'entries', 'Entries'))
  const found = entries.some((entry) => {
    const text = String(pick(entry, 'text', 'Text', 'content', 'Content') ?? '')
    const role = String(pick(entry, 'role', 'Role') ?? '')
    return text.includes(needle) && (!role || role === 'user')
  })
  if (!found) {
    return { ok: false, reason: `桌宠抄本没有用户原话 needle=${needle}` }
  }
  return { ok: true, reason: '' }
}

export function transcriptHasAssistantReply(page) {
  const entries = asList(pick(page, 'entries', 'Entries'))
  const assistants = entries.filter((entry) => String(pick(entry, 'role', 'Role') ?? '') === 'assistant')
  if (!assistants.length) {
    return { ok: false, reason: '桌宠抄本没有助手回复' }
  }
  const spoken = assistants.some((entry) => {
    const text = String(pick(entry, 'text', 'Text', 'content', 'Content') ?? '').trim()
    const err = String(pick(entry, 'error', 'Error') ?? '').trim()
    const type = String(pick(entry, 'type', 'Type') ?? '').trim()
    if (err) return false
    if (!text || text === type || text === 'message') return false
    return true
  })
  if (!spoken) {
    return { ok: false, reason: '桌宠助手没有可见回复（空正文、类型名 message，或只有错误）' }
  }
  return { ok: true, reason: '' }
}

export function boardHasConversation(board, id) {
  const sessions = asList(pick(board, 'sessions', 'Sessions'))
  if (!sessions.some(item => conversationIdOf(item) === id)) {
    return { ok: false, reason: `看板没有目标会话 id=${id}` }
  }
  return { ok: true, reason: '' }
}

export function conversationHasRelay(conversation, marker) {
  const messages = asList(pick(conversation, 'messages', 'Messages'))
  const found = messages.some((message) => {
    const content = String(pick(message, 'content', 'Content') ?? '')
    return content.includes(RELAY_PREFIX) && content.includes(marker)
  })
  if (!found) {
    return { ok: false, reason: `目标会话没有桌宠转达 marker=${marker}` }
  }
  return { ok: true, reason: '' }
}

export function companionShellHidden(status) {
  return status?.hidden === true
}

export function companionFloatReady(status) {
  if (status?.wayland) return { ok: true, wayland: true, reason: 'Wayland 没有自己贴坐标的悬浮窗' }
  if (status?.floating === true && status?.hidden !== true) {
    return { ok: true, wayland: false, reason: '' }
  }
  return { ok: false, wayland: false, reason: `悬浮窗没出来 floating=${Boolean(status?.floating)} hidden=${Boolean(status?.hidden)}` }
}

export function companionParked(status) {
  return status?.parked === true
}

export function companionPresenceKept(status) {
  if (!companionParked(status)) return { ok: false, reason: '主窗口没有收进桌面栏' }
  const platform = String(status?.platform ?? '')
  if (platform === 'linux' && status?.tray !== true) {
    return { ok: false, reason: 'Linux 关掉主窗口后托盘没留下' }
  }
  return { ok: true, reason: platform === 'win32' ? '任务栏还在' : platform === 'linux' ? '托盘还在' : 'Dock 还在' }
}

export function companionDefaultSkinVisible(snapshot) {
  const hay = `${(snapshot?.aria || []).join('\n')}\n${snapshot?.text || ''}`
  return /皮肤|Skin/.test(hay) && /\bMilk\b/.test(hay)
}

export function companionSkinEntryVisible(snapshot) {
  const hay = `${(snapshot?.aria || []).join('\n')}\n${snapshot?.text || ''}`
  return /添加皮肤|Add skin/.test(hay) && /选择文件夹|Choose folder/.test(hay)
}

export function companionImportedSkinVisible(snapshot, name = '回路皮肤') {
  const hay = `${(snapshot?.aria || []).join('\n')}\n${snapshot?.text || ''}`
  return hay.includes(name)
}

export function companionSkinListed(list, id) {
  return asList(pick(list, 'skins', 'Skins')).some(item => String(pick(item, 'id', 'ID') ?? '') === id)
}

export function companionSkinFramesAreCustom(skin) {
  const idle = String(pick(pick(skin, 'frames', 'Frames'), 'idle', 'Idle') ?? '')
  if (!idle.startsWith('data:image/png')) {
    return { ok: false, reason: '自定义皮肤没有读到 PNG 帧' }
  }
  return { ok: true, reason: '' }
}

export function companionPetSurfaceReady(page) {
  const motion = String(page?.motion ?? page?.className ?? '')
  const src = String(page?.src ?? '')
  if (!/companion-pet/.test(motion)) return { ok: false, reason: '悬浮窗没有桌宠角色' }
  if (!src.trim()) return { ok: false, reason: '出厂皮肤帧没有画上去' }
  return { ok: true, reason: '' }
}

export function companionPetSurfaceUsesCustomSkin(page) {
  const ready = companionPetSurfaceReady(page)
  if (!ready.ok) return ready
  const src = String(page?.src ?? '')
  if (!src.startsWith('data:image/png')) {
    return { ok: false, reason: '悬浮窗还在画出厂帧' }
  }
  return { ok: true, reason: '' }
}

export function conversationMovedToArchive(active, archived, id) {
  const live = asList(active).some(item => conversationIdOf(item) === id)
  const stored = asList(archived).some(item => conversationIdOf(item) === id)
  if (live) {
    return { ok: false, reason: `归档后仍在活动列表 id=${id}` }
  }
  if (!stored) {
    return { ok: false, reason: `归档后不在归档列表 id=${id}` }
  }
  return { ok: true, reason: '' }
}
