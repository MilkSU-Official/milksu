import type { Message } from '@/types'

export interface ChatMessageBlock {
  kind: 'message'
  id: string
  message: Message
}

export interface ChatActivityBlock {
  kind: 'activity'
  id: string
  messages: Message[]
  running: boolean
}

export interface ChatActivityEntry {
  id: string
  toolName: string
  request?: Message
  result?: Message
  durationMs?: number
  running: boolean
}

export type ChatTranscriptBlock = ChatMessageBlock | ChatActivityBlock

const commandTools = new Set([
  'bash',
  'background',
  'background_output',
  'bg_task',
  'bg_status',
])
const mutationTools = new Set(['edit', 'write', 'lsp_fix'])
const searchTools = new Set(['find', 'grep', 'ls', 'read'])
const imageGenTools = new Set(['milksu_imagegen'])

function isApproval(message: Message) {
  return Boolean(message.approvalRequestId)
}

const leftoverDeliveryStatus = /^正在把只读研究结论写入工作区交付。?$/

export function isBlankAssistantMessage(message: Message) {
  const content = String(message.content ?? '').trim()
  if (message.role === 'assistant' && leftoverDeliveryStatus.test(content)) return true
  return message.role === 'assistant'
    && !content
    && !(message.attachments && message.attachments.length)
}

export function withoutBlankAssistantMessages(messages: Message[]) {
  const next = messages.filter(message => !isBlankAssistantMessage(message))
  return next.length === messages.length ? messages : next
}

function messageBlock(message: Message): ChatMessageBlock {
  return {
    kind: 'message',
    id: `message:${message.id}`,
    message,
  }
}

function activityBlock(messages: Message[], running: boolean): ChatActivityBlock {
  return {
    kind: 'activity',
    id: `activity:${messages[0]?.id ?? 'empty'}`,
    messages,
    running,
  }
}

function flushToolSegment(
  blocks: ChatTranscriptBlock[],
  segment: Message[],
  conversationRunning: boolean,
) {
  if (!segment.length) return
  const entries = buildChatActivityEntries(segment)
  blocks.push(activityBlock(
    segment,
    conversationRunning && entries.some(entry => entry.running),
  ))
}

function lastMatchingToolIndex(
  messages: Message[],
  match: (message: Message) => boolean,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message && match(message)) return index
  }
  return -1
}

function uniqueFallbackToolStartIndex(
  messages: Message[],
  toolName?: string,
  toolCallId?: string,
) {
  const normalizedToolName = String(toolName ?? '').trim().toLowerCase()
  if (!normalizedToolName) return -1

  const matches = messages.flatMap((message, index) => (
    message.role === 'tool'
    && !message.approvalRequestId
    && message.status === 'running'
    && String(message.toolName ?? '').trim().toLowerCase() === normalizedToolName
    && (!toolCallId || !message.toolCallId)
      ? [index]
      : []
  ))
  return matches.length === 1 ? matches[0]! : -1
}

export function applyCodingToolEvent(
  messages: Message[],
  event: {
    type: 'tool.started' | 'tool.completed'
    text: string
    toolName?: string
    toolCallId?: string
    durationMs?: number
    done?: boolean
  },
  createId: () => string = () => crypto.randomUUID(),
): Message[] {
  const completing = event.type === 'tool.completed' || event.done === true
  const toolName = event.toolName
  const toolCallId = event.toolCallId
  const next = messages.slice()

  if (!completing) {
    const existing = toolCallId
      ? lastMatchingToolIndex(next, message => (
        message.role === 'tool'
        && !message.approvalRequestId
        && message.toolCallId === toolCallId
        && message.status === 'running'
      ))
      : -1
    if (existing >= 0) {
      const current = next[existing]!
      next[existing] = {
        ...current,
        content: event.text
          ? [current.content, event.text].filter(Boolean).join('\n\n')
          : current.content,
        toolName: toolName || current.toolName,
      }
      return next
    }
    next.push({
      id: createId(),
      role: 'tool',
      content: event.text,
      timestamp: Date.now(),
      toolName,
      toolCallId,
      status: 'running',
    })
    return next
  }

  let startIndex = lastMatchingToolIndex(next, message => {
    if (message.role !== 'tool' || message.approvalRequestId || message.status !== 'running') {
      return false
    }
    if (toolCallId) return message.toolCallId === toolCallId
    return message.toolName === toolName && !message.toolCallId
  })
  if (startIndex < 0) {
    startIndex = uniqueFallbackToolStartIndex(next, toolName, toolCallId)
  }
  if (startIndex >= 0) {
    const start = next[startIndex]!
    next[startIndex] = {
      ...start,
      status: 'done',
      durationMs: event.durationMs ?? start.durationMs,
      toolCallId: toolCallId || start.toolCallId,
    }
  }
  next.push({
    id: createId(),
    role: 'tool',
    content: event.text,
    timestamp: Date.now(),
    toolName,
    toolCallId: toolCallId || (startIndex >= 0 ? next[startIndex]?.toolCallId : undefined),
    durationMs: event.durationMs,
    status: 'done',
  })
  return next
}

export function hasIdleRunResidue(messages: Message[]): boolean {
  return messages.some(message => (
    message.status === 'running'
    && !message.approvalRequestId
  ))
}

export function settleRunningToolMessages(messages: Message[]): Message[] {
  if (!hasIdleRunResidue(messages)) return messages
  return messages.map(message => (
    message.status === 'running'
    && !message.approvalRequestId
      ? { ...message, status: 'done' as const }
      : message
  ))
}

export function detailsToggleOpen(event: Event): boolean | undefined {
  if (event.target !== event.currentTarget) return undefined
  const details = event.currentTarget as { open?: unknown } | null
  return typeof details?.open === 'boolean' ? details.open : undefined
}

export function buildChatTranscript(
  messages: Message[],
  conversationRunning: boolean,
): ChatTranscriptBlock[] {
  const blocks: ChatTranscriptBlock[] = []
  let toolSegment: Message[] = []

  const flush = () => {
    flushToolSegment(blocks, toolSegment, conversationRunning)
    toolSegment = []
  }

  for (const message of messages) {
    if (isBlankAssistantMessage(message)) continue

    if (message.role === 'tool' && !isApproval(message)) {
      toolSegment.push(message)
      continue
    }

    flush()
    if (message.role === 'user' || message.role === 'assistant' || isApproval(message)) {
      blocks.push(messageBlock(message))
    }
  }
  flush()

  return blocks
}

function entryCount(entries: ChatActivityEntry[], tools: Set<string>) {
  return entries.filter(entry => tools.has(entry.toolName)).length
}

export function chatActivitySummary(messages: Message[]) {
  const entries = buildChatActivityEntries(messages)
  if (!entries.length) return '正在思考'

  const architectureCount = entries.filter(entry => entry.toolName === 'milksu_archify').length
  if (architectureCount) return '处理架构图'
  const imageGenCount = entryCount(entries, imageGenTools)
  if (imageGenCount) return imageGenCount > 1 ? '处理了多张图片' : '生成或编辑了图片'

  const mutations = entryCount(entries, mutationTools)
  const commands = entryCount(entries, commandTools)
  const searches = entryCount(entries, searchTools)
  const parts: string[] = []

  if (mutations) parts.push('编辑了文件')
  if (commands) parts.push(commands > 1 ? '运行了多个命令' : '运行了命令')
  if (!parts.length && searches) parts.push('读取并检索了项目')
  if (!parts.length) {
    parts.push(entries.length > 1 ? '使用了多个工具' : `使用了 ${entries[0]?.toolName ?? '工具'}`)
  }

  return parts.join('')
}

export function buildChatActivityEntries(messages: Message[]): ChatActivityEntry[] {
  const entries: ChatActivityEntry[] = []
  const pendingByCallID = new Map<string, ChatActivityEntry>()
  const pendingByToolName = new Map<string, ChatActivityEntry[]>()

  const complete = (entry: ChatActivityEntry, message: Message) => {
    if (entry.request?.toolCallId) pendingByCallID.delete(entry.request.toolCallId)
    const queued = pendingByToolName.get(entry.toolName)
    const queueIndex = queued?.indexOf(entry) ?? -1
    if (queued && queueIndex >= 0) queued.splice(queueIndex, 1)
    entry.result = message
    entry.durationMs = message.durationMs
    entry.running = false
  }

  for (const message of messages) {
    if (message.role !== 'tool') continue
    const toolName = String(message.toolName ?? 'tool').toLowerCase()
    const queued = pendingByToolName.get(toolName)
    const byCall = message.toolCallId
      ? pendingByCallID.get(message.toolCallId)
      : undefined
    if (byCall) {
      complete(byCall, message)
      continue
    }

    if (message.status !== 'running') {
      const compatiblePending = queued?.filter(entry => (
        !message.toolCallId || !entry.request?.toolCallId
      )) ?? []
      const requestEntry = compatiblePending.length === 1
        ? compatiblePending[0]
        : undefined
      if (requestEntry?.running) {
        complete(requestEntry, message)
        continue
      }
    }

    const entry: ChatActivityEntry = {
      id: `tool:${message.id}`,
      toolName,
      request: message,
      durationMs: message.status === 'running' ? undefined : message.durationMs,
      running: message.status === 'running',
    }
    entries.push(entry)
    if (message.toolCallId) pendingByCallID.set(message.toolCallId, entry)
    const queue = queued ?? []
    queue.push(entry)
    pendingByToolName.set(toolName, queue)
  }

  return entries
}

function compactLine(value: string, limit = 112) {
  const line = value
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(Boolean)
    ?.replace(/^[-*#>\s]+/, '')
    .replace(/`/g, '')
    ?? ''
  if (line.length <= limit) return line
  return `${line.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function usefulToolSubject(value: string) {
  const subject = compactLine(value)
  if (!subject || subject === '{}' || subject === '[]') return ''
  if (/^[{[]/.test(subject)) return ''
  return subject
}

function isChatActivityEntry(value: Message | ChatActivityEntry): value is ChatActivityEntry {
  return 'request' in value || 'result' in value
}

export function chatActivityEntrySummary(messageOrEntry: Message | ChatActivityEntry) {
  const isEntry = isChatActivityEntry(messageOrEntry)
  const message: Message | undefined = isEntry
    ? messageOrEntry.request ?? messageOrEntry.result
    : messageOrEntry
  if (!message) return '使用工具'

  const firstLine = compactLine(message.content)
  if (message.role === 'assistant') return firstLine || '整理下一步'

  const name = isEntry
    ? messageOrEntry.toolName
    : String(message.toolName ?? 'tool').toLowerCase()
  const writtenPath = name === 'write'
    ? message.content.match(/Successfully wrote \d+ bytes to ([^\r\n]+)/)?.[1]
    : undefined
  const subject = writtenPath ?? usefulToolSubject(message.content)
  const suffix = subject ? ` ${subject}` : ''
  if (name === 'bash') {
    return subject && (!isEntry || subject.startsWith('$'))
      ? `运行 ${subject}`
      : '运行命令'
  }
  if (name === 'background' || name === 'bg_task') return `管理后台任务${suffix}`
  if (name === 'background_output' || name === 'bg_status') return `检查后台任务${suffix}`
  if (name === 'read') return `读取${suffix || '文件'}`
  if (name === 'write') return `写入${suffix || '文件'}`
  if (name === 'edit') return `编辑${suffix || '文件'}`
  if (name === 'ls') return `查看${suffix || '目录'}`
  if (name === 'find') return `查找${suffix || '文件'}`
  if (name === 'grep') return `搜索${suffix || '内容'}`
  if (name === 'milksu_progress') return '更新任务进度'
  if (name === 'milksu_workspace') return subject || '操作 MilkSU'
  if (name === 'env_status') return '查看环境'
  if (name === 'env_start') return '启动环境'
  if (name === 'env_reset') return '重置环境'
  if (name === 'env_stop') return '停止环境'
  if (name === 'prepare_computer_use_driver') return subject || '准备 Computer Use Driver'
  if (name === 'milksu_archify') return '处理架构图'
  if (name === 'milksu_imagegen') {
    let outputPath = ''
    if (isEntry && messageOrEntry.result?.content) {
      try {
        outputPath = String(JSON.parse(messageOrEntry.result.content)?.output?.path ?? '')
      } catch {
        // Fall back to the bounded tool-start summary.
      }
    }
    return outputPath ? `交付图片 ${outputPath}` : subject || '处理图片'
  }
  return subject ? `${message.toolName ?? '工具'} · ${subject}` : message.toolName ?? '使用工具'
}
