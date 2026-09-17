import type { Message } from '@/types'
import { codingAskToolName } from '@/lib/agentAsk'
import { t } from '@/lib/uiLocale'

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

export interface ChatProcessFoldBlock {
  kind: 'process'
  id: string
  blocks: Array<ChatMessageBlock | ChatActivityBlock>
}

export type ChatTurnBlock = ChatMessageBlock | ChatActivityBlock

export type ChatTranscriptBlock = ChatTurnBlock | ChatProcessFoldBlock

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

const leftoverDeliveryStatus = new RegExp(
  `^${t('正在把只读研究结论写入工作区交付', 'Writing the read-only research conclusion into the workspace delivery')}。?$`,
)

export function isBlankAssistantMessage(message: Message) {
  const content = String(message.content ?? '').trim()
  if (message.role === 'assistant' && leftoverDeliveryStatus.test(content)) return true
  return message.role === 'assistant'
    && !content
    && !String(message.thinking ?? '').trim()
    && message.thinkingStatus !== 'running'
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

export function settleLiveThinking(
  messages: Message[],
  now = Date.now(),
): Message[] {
  const last = messages.at(-1)
  if (last?.role !== 'assistant' || last.thinkingStatus !== 'running') return messages
  const started = Number.isFinite(last.timestamp) ? last.timestamp : now
  const next = messages.slice()
  next[next.length - 1] = {
    ...last,
    thinkingStatus: 'done',
    thinkingDurationMs: last.thinkingDurationMs ?? Math.max(0, now - started),
  }
  return next
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
  const next = settleLiveThinking(messages.slice())

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

export function applyAssistantThinkingEvent(
  messages: Message[],
  event: {
    type: 'assistant.thinking_started' | 'assistant.thinking_delta' | 'assistant.thinking_completed'
    text?: string
    durationMs?: number
  },
  createId: () => string = () => crypto.randomUUID(),
): Message[] {
  const next = messages.slice()
  const last = next.at(-1)
  const delta = String(event.text ?? '')
  const completing = event.type === 'assistant.thinking_completed'
  const liveAssistant = last?.role === 'assistant'
    && (last.thinkingStatus === 'running' || last.status === 'running')
  if (liveAssistant && last) {
    next[next.length - 1] = {
      ...last,
      thinking: completing
        ? (delta || last.thinking || '')
        : `${last.thinking ?? ''}${delta}`,
      thinkingStatus: completing ? 'done' : 'running',
      thinkingDurationMs: event.durationMs
        ?? last.thinkingDurationMs
        ?? (completing && Number.isFinite(last.timestamp)
          ? Math.max(0, Date.now() - last.timestamp)
          : last.thinkingDurationMs),
      status: last.status === 'done' ? 'done' : 'running',
    }
    return next
  }
  if (!delta && !completing && event.type !== 'assistant.thinking_started') return next
  next.push({
    id: createId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    status: 'running',
    thinking: delta,
    thinkingStatus: completing ? 'done' : 'running',
    thinkingDurationMs: event.durationMs,
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

export function detailsToggleOpen(event: { target: EventTarget | null; currentTarget: EventTarget | null }): boolean | undefined {
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
      if (String(message.toolName ?? '') === codingAskToolName) continue
      toolSegment.push(message)
      continue
    }

    flush()
    if (message.role === 'user' || message.role === 'assistant' || isApproval(message)) {
      blocks.push(messageBlock(message))
    }
  }
  flush()

  return foldChatTranscriptProcess(blocks)
}

export function isThinkingOnlyAssistant(message: Message) {
  if (message.role !== 'assistant') return false
  if (String(message.content ?? '').trim()) return false
  return Boolean(String(message.thinking ?? '').trim()) || message.thinkingStatus === 'running'
}

export function shouldRetainAssistantWithoutText(message: Message) {
  return Boolean(String(message.thinking ?? '').trim())
    || message.thinkingStatus === 'running'
    || message.thinkingStatus === 'done'
}

export function retainAssistantAfterEmptyCompletion(message: Message): Message | null {
  if (!shouldRetainAssistantWithoutText(message)) return null
  return {
    ...message,
    status: 'done',
    thinkingStatus: message.thinkingStatus === 'running' ? 'done' : message.thinkingStatus,
  }
}

export function hasEmptyVisibleReply(messages: Message[], running: boolean) {
  if (running) return false
  let lastUser = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUser = index
      break
    }
  }
  if (lastUser < 0) return false
  const after = messages.slice(lastUser + 1)
  if (!after.length) return false
  if (after.some(item => item.role === 'assistant' && String(item.content ?? '').trim())) {
    return false
  }
  return after.some(item => (
    item.role === 'assistant' && shouldRetainAssistantWithoutText(item)
  ))
}

function isLiveThinking(message: Message) {
  return isThinkingOnlyAssistant(message) && message.thinkingStatus === 'running'
}

function isFoldableTurnBlock(block: ChatTurnBlock) {
  if (block.kind === 'activity') return !block.running
  if (isApproval(block.message)) return false
  if (block.message.role === 'assistant' && String(block.message.content ?? '').trim()) return false
  if (isLiveThinking(block.message)) return false
  return isThinkingOnlyAssistant(block.message)
}

export function mergeProcessThinking(blocks: readonly ChatTurnBlock[]): Message | null {
  const thoughts = blocks.flatMap(block => (
    block.kind === 'message' && isThinkingOnlyAssistant(block.message)
      ? [block.message]
      : []
  ))
  if (!thoughts.length) return null
  const text = thoughts
    .map(item => String(item.thinking ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
  const durationMs = thoughts.reduce((sum, item) => sum + Math.max(0, item.thinkingDurationMs ?? 0), 0)
  return {
    id: `process-thinking:${thoughts[0]!.id}`,
    role: 'assistant',
    content: '',
    timestamp: thoughts[0]!.timestamp,
    status: 'done',
    thinking: text,
    thinkingStatus: 'done',
    thinkingDurationMs: durationMs,
  }
}

export function processFoldStepCount(blocks: readonly ChatTurnBlock[]): number {
  let count = 0
  for (const block of blocks) {
    if (block.kind !== 'activity') continue
    count += Math.max(1, buildChatActivityEntries(block.messages).length)
  }
  return count
}

export function processFoldSummary(blocks: readonly ChatTurnBlock[]): string {
  const messages = blocks.flatMap(block => (
    block.kind === 'activity' ? block.messages : []
  ))
  if (!messages.length) return ''
  return chatActivitySummary(messages)
}

function flushFoldableTurn(
  output: ChatTranscriptBlock[],
  foldables: ChatTurnBlock[],
) {
  if (!foldables.length) return
  const hasActivity = foldables.some(block => block.kind === 'activity')
  if (hasActivity) {
    output.push({
      kind: 'process',
      id: `process:${foldables[0]!.id}`,
      blocks: foldables.slice(),
    })
    return
  }
  const merged = mergeProcessThinking(foldables)
  if (merged) output.push(messageBlock(merged))
}

// Completed thinking and finished tool groups go into 过程. Assistant text
// with content stays in the open thread (staged results). Only the live
// thinking row or a still-running tool group remains visible as work-in-progress.
function foldTurnProcess(turn: ChatTurnBlock[]): ChatTranscriptBlock[] {
  const output: ChatTranscriptBlock[] = []
  let foldables: ChatTurnBlock[] = []
  for (const block of turn) {
    if (isFoldableTurnBlock(block)) {
      foldables.push(block)
      continue
    }
    flushFoldableTurn(output, foldables)
    foldables = []
    output.push(block)
  }
  flushFoldableTurn(output, foldables)
  return output
}

export function foldChatTranscriptProcess(blocks: ChatTranscriptBlock[]): ChatTranscriptBlock[] {
  const next: ChatTranscriptBlock[] = []
  let index = 0
  while (index < blocks.length) {
    const block = blocks[index]!
    if (block.kind !== 'message' || block.message.role !== 'user') {
      if (block.kind === 'process') next.push(block)
      else next.push(...foldTurnProcess([block]))
      index += 1
      continue
    }
    next.push(block)
    index += 1
    const turn: ChatTurnBlock[] = []
    while (index < blocks.length) {
      const item = blocks[index]!
      if (item.kind === 'message' && item.message.role === 'user') break
      if (item.kind === 'process') turn.push(...item.blocks)
      else turn.push(item)
      index += 1
    }
    next.push(...foldTurnProcess(turn))
  }
  return next
}

function entryCount(entries: ChatActivityEntry[], tools: Set<string>) {
  return entries.filter(entry => tools.has(entry.toolName)).length
}

// Stable v-memo references for one transcript block. A streaming turn only
// replaces the message objects it touches, so keying on those references (not
// on the rebuilt arrays that hold them) lets every untouched block skip its
// patch while a single message keeps updating.
export function chatTranscriptBlockMemoRefs(
  block: ChatTranscriptBlock,
  sharedKey: string,
): unknown[] {
  const refs: unknown[] = [sharedKey]
  if (block.kind === 'message') {
    refs.push(block.message)
    return refs
  }
  if (block.kind === 'activity') {
    refs.push(block.running, ...block.messages)
    return refs
  }
  refs.push(block.blocks.length)
  for (const inner of block.blocks) {
    if (inner.kind === 'message') refs.push(inner.message)
    else refs.push(inner.running, ...inner.messages)
  }
  return refs
}

export function chatActivitySummary(messages: Message[]) {
  const entries = buildChatActivityEntries(messages)
  if (!entries.length) return t('正在思考', 'Thinking')

  const architectureCount = entries.filter(entry => entry.toolName === 'milksu_archify').length
  if (architectureCount) return t('处理架构图', 'Working on architecture diagram')
  const worktreeCount = entries.filter(entry => entry.toolName === 'milksu_worktree').length
  if (worktreeCount) return t('准备了隔离工作树', 'Prepared the isolated worktree')
  const imageGenCount = entryCount(entries, imageGenTools)
  if (imageGenCount) return imageGenCount > 1 ? t('处理了多张图片', 'Processed multiple images') : t('生成或编辑了图片', 'Generated or edited an image')

  const mutations = entryCount(entries, mutationTools)
  const commands = entryCount(entries, commandTools)
  const searches = entryCount(entries, searchTools)
  const parts: string[] = []

  if (mutations) parts.push(t('编辑了文件', 'Edited files'))
  if (commands) parts.push(commands > 1 ? t('运行了多个命令', 'Ran multiple commands') : t('运行了命令', 'Ran a command'))
  if (!parts.length && searches) parts.push(t('读取并检索了项目', 'Read and searched the project'))
  if (!parts.length) {
    const toolName = entries[0]?.toolName ?? t('工具', 'tool')
    parts.push(entries.length > 1 ? t('使用了多个工具', 'Used multiple tools') : t(`使用了 ${toolName}`, `Used ${toolName}`))
  }

  return parts.join('')
}

export function visibleChatActivityEntries(
  entries: ChatActivityEntry[],
  openEntryIds: ReadonlySet<string>,
): ChatActivityEntry[] {
  return entries.filter(entry => entry.running || openEntryIds.has(entry.id))
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
  if (!message) return t('使用工具', 'Using a tool')

  const firstLine = compactLine(message.content)
  if (message.role === 'assistant') return firstLine || t('整理下一步', 'Planning next step')

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
      ? t(`运行 ${subject}`, `Run ${subject}`)
      : t('运行命令', 'Run command')
  }
  if (name === 'background' || name === 'bg_task') return t(`管理后台任务${suffix}`, `Manage background task${suffix}`)
  if (name === 'background_output' || name === 'bg_status') return t(`检查后台任务${suffix}`, `Check background task${suffix}`)
  if (name === 'read') return t(`读取${suffix || '文件'}`, `Read${suffix || ' file'}`)
  if (name === 'write') return t(`写入${suffix || '文件'}`, `Write${suffix || ' file'}`)
  if (name === 'edit') return t(`编辑${suffix || '文件'}`, `Edit${suffix || ' file'}`)
  if (name === 'ls') return t(`查看${suffix || '目录'}`, `List${suffix || ' directory'}`)
  if (name === 'find') return t(`查找${suffix || '文件'}`, `Find${suffix || ' file'}`)
  if (name === 'grep') return t(`搜索${suffix || '内容'}`, `Search${suffix || ' content'}`)
  if (name === 'milksu_worktree') return t('创建隔离工作树并复制项目文件', 'Creating the isolated worktree and copying project files')
  if (name === 'milksu_progress') return t('更新任务进度', 'Update task progress')
  if (name === 'milksu_workspace') return subject || t('操作 MilkSU', 'Operate MilkSU')
  if (name === 'env_status') return t('查看环境', 'Check environment')
  if (name === 'env_start') return t('启动环境', 'Start environment')
  if (name === 'env_reset') return t('重置环境', 'Reset environment')
  if (name === 'env_stop') return t('停止环境', 'Stop environment')
  if (name === 'prepare_computer_use_driver') return subject || t('准备 Computer Use Driver', 'Prepare Computer Use Driver')
  if (name === 'milksu_archify') return t('处理架构图', 'Working on architecture diagram')
  if (name === 'milksu_imagegen') {
    let outputPath = ''
    if (isEntry && messageOrEntry.result?.content) {
      try {
        outputPath = String(JSON.parse(messageOrEntry.result.content)?.output?.path ?? '')
      } catch {
        // Fall back to the bounded tool-start summary.
      }
    }
    return outputPath
      ? t(`交付图片 ${outputPath}`, `Delivered image ${outputPath}`)
      : subject || t('处理图片', 'Process image')
  }
  const toolLabel = message.toolName ?? t('工具', 'tool')
  return subject ? `${toolLabel} · ${subject}` : message.toolName ?? t('使用工具', 'Using a tool')
}
