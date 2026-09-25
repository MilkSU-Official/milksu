import type { Message } from '@/types'
import { codingAskToolName } from '@/lib/agentAsk'
import {
  captionBesideGeneratedImages,
  imageOutputFromToolMessage,
  imageOutputsFromToolMessages,
} from '@/lib/imageReply'
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

export interface ChatImageBlock {
  kind: 'image'
  id: string
  path: string
}

export type ChatTurnBlock = ChatMessageBlock | ChatActivityBlock

export type ChatTranscriptBlock = ChatTurnBlock | ChatProcessFoldBlock | ChatImageBlock


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

function imageBlock(id: string, path: string): ChatImageBlock {
  return {
    kind: 'image',
    id: `image:${id}:${path}`,
    path,
  }
}

function assistantBesideImages(message: Message, paths: string[]): Message | null {
  if (!paths.length) return message
  const caption = captionBesideGeneratedImages(message.content, paths)
  if (caption === message.content) return message
  const next = { ...message, content: caption }
  return isBlankAssistantMessage(next) ? null : next
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
  let turnImages: string[] = []

  const flush = () => {
    const images = imageOutputsFromToolMessages(toolSegment)
    flushToolSegment(blocks, toolSegment, conversationRunning)
    for (const image of images) {
      blocks.push(imageBlock(image.id, image.path))
      turnImages.push(image.path)
    }
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
    if (message.role === 'user') {
      turnImages = []
      blocks.push(messageBlock(message))
      continue
    }
    if (message.role === 'assistant') {
      const shown = assistantBesideImages(message, turnImages)
      if (shown) blocks.push(messageBlock(shown))
      continue
    }
    if (isApproval(message)) blocks.push(messageBlock(message))
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
  if (after.some(item => imageOutputFromToolMessage(item))) return false
  if (after.some(item => item.role === 'assistant' && String(item.content ?? '').trim())) {
    return false
  }
  return after.some(item => (
    item.role === 'assistant' && shouldRetainAssistantWithoutText(item)
  ))
}

type OpenTurnBlock = ChatTurnBlock | ChatImageBlock

function isFoldableTurnBlock(block: OpenTurnBlock) {
  // Finished tool groups fold into 过程, and finished thinking folds in with
  // them, so a work stretch without body text collapses into one overview
  // instead of one fold per step. The generated picture stays in the thread.
  // Running thinking and assistant text stay open too.
  if (block.kind === 'image') return false
  if (block.kind === 'activity') return !block.running
  if (block.kind === 'message') {
    return block.message.role === 'assistant'
      && block.message.thinkingStatus !== 'running'
      && isThinkingOnlyAssistant(block.message)
  }
  return false
}

function messageHasThinking(message: Message) {
  return message.role === 'assistant' && (
    Boolean(String(message.thinking ?? '').trim())
    || message.thinkingStatus === 'running'
  )
}

// Only the latest finished thinking stays open. A live burst stays open too.
// When the next burst finishes, the previous one collapses.
export function thinkingStaysOpen(messageId: string, blocks: readonly ChatTranscriptBlock[]) {
  const thoughts: Message[] = []
  for (const block of blocks) {
    if (block.kind === 'message' && messageHasThinking(block.message)) {
      thoughts.push(block.message)
    }
  }
  const index = thoughts.findIndex(item => item.id === messageId)
  if (index < 0) return false
  const message = thoughts[index]!
  if (message.thinkingStatus === 'running') return true
  return !thoughts.slice(index + 1).some(item => (
    item.thinkingStatus === 'done' && Boolean(String(item.thinking ?? '').trim())
  ))
}

export function latestFinishedThinkingId(blocks: readonly ChatTranscriptBlock[]) {
  let id = ''
  for (const block of blocks) {
    if (block.kind !== 'message') continue
    const message = block.message
    if (
      message.role === 'assistant'
      && message.thinkingStatus === 'done'
      && Boolean(String(message.thinking ?? '').trim())
    ) {
      id = message.id
    }
  }
  return id
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


function flushFoldableTurn(
  output: ChatTranscriptBlock[],
  foldables: OpenTurnBlock[],
) {
  if (!foldables.length) return
  const hasActivity = foldables.some(block => block.kind === 'activity')
  if (hasActivity) {
    output.push({
      kind: 'process',
      id: `process:${foldables[0]!.id}`,
      blocks: foldables.filter((block): block is ChatTurnBlock => block.kind !== 'image'),
    })
    return
  }
  // A thinking-only stretch without tool work stays in the open thread, one
  // row per burst.
  for (const block of foldables) {
    if (block.kind === 'message') output.push(block)
  }
}

// Finished tool groups go into 过程, and finished thinking folds in with the
// surrounding tool work, so a stretch without body text collapses into one
// overview. Assistant text stays in the open thread between folds.
// A still-running tool group stays outside the fold as work-in-progress.
function foldTurnProcess(turn: OpenTurnBlock[]): ChatTranscriptBlock[] {
  const output: ChatTranscriptBlock[] = []
  let foldables: OpenTurnBlock[] = []
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
    if (block.kind === 'image' || block.kind === 'process') {
      next.push(block)
      index += 1
      continue
    }
    if (block.kind !== 'message' || block.message.role !== 'user') {
      next.push(...foldTurnProcess([block]))
      index += 1
      continue
    }
    next.push(block)
    index += 1
    const turn: OpenTurnBlock[] = []
    while (index < blocks.length) {
      const item = blocks[index]!
      if (item.kind === 'message' && item.message.role === 'user') break
      if (item.kind === 'process') turn.push(...item.blocks)
      else if (item.kind === 'image') turn.push(item)
      else turn.push(item)
      index += 1
    }
    next.push(...foldTurnProcess(turn))
  }
  return next
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
  if (block.kind === 'image') {
    refs.push(block.path)
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
