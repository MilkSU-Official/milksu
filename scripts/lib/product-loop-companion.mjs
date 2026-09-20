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
    '调用 companion_dispatch，action 用 stop，',
    `conversationId 必须是 ${conversationId}，idempotencyKey 用一个新的唯一值。`,
    'stop 必须等用户确认。不要只聊天，不要发明完成状态。',
  ].join('')
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

export function companionTurnSettled(events) {
  return asList(events).some((event) => {
    const type = eventTypeOf(event)
    return type === 'assistant.settled' || type === 'assistant.completed'
  })
}

export function companionTurnErrored(events) {
  return asList(events).some((event) => /^(error|engine\.error|engine\.protocol_error)$/i.test(eventTypeOf(event)))
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
