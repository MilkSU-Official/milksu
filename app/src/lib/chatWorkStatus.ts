import { agentToolChip, thinkingSummary } from '@/lib/agentConversation'
import {
  buildChatActivityEntries,
  type ChatActivityEntry,
  type ChatTranscriptBlock,
} from '@/lib/chatActivity'
import { t } from '@/lib/uiLocale'
import type { Message } from '@/types'

const commandTools = new Set(['bash', 'background', 'background_output', 'bg_task', 'bg_status'])
const editTools = new Set(['edit', 'write', 'lsp_fix'])
const searchTools = new Set(['grep', 'find', 'ls'])

export interface ChatWorkCounts {
  files: number
  searches: number
  commands: number
  edits: number
  other: number
}

export interface ChatFoldModel {
  entries: ChatActivityEntry[]
  thinkingMs: number
  thinkingRunning: boolean
  thinkingStartedAt?: number
  liveLabel: string
}

function toolMessages(block: ChatTranscriptBlock): Message[] {
  if (block.kind === 'activity') return block.messages
  if (block.kind === 'process') {
    return block.blocks.flatMap(inner => (inner.kind === 'activity' ? inner.messages : []))
  }
  return []
}

function turnBounds(blocks: readonly ChatTranscriptBlock[], index: number) {
  let start = 0
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const block = blocks[cursor]
    if (block?.kind === 'message' && block.message.role === 'user') {
      start = cursor + 1
      break
    }
  }
  let end = blocks.length
  for (let cursor = start; cursor < blocks.length; cursor += 1) {
    const block = blocks[cursor]
    if (block?.kind === 'message' && block.message.role === 'user') {
      end = cursor
      break
    }
  }
  return { start, end }
}

export function chatLiveAnchorId(blocks: readonly ChatTranscriptBlock[]) {
  let id = ''
  for (const block of blocks) {
    if (block.kind === 'message' && block.message.role === 'user') id = ''
    else if (block.kind === 'process' || block.kind === 'activity') id = block.id
  }
  return id
}

function entryPath(entry: ChatActivityEntry) {
  const source = String(entry.request?.content || entry.result?.content || '')
  const line = source.split(/\r?\n/).map(part => part.trim()).find(Boolean) ?? ''
  return line.split(' · ')[0]?.trim() || line
}

export function chatWorkCounts(entries: readonly ChatActivityEntry[]): ChatWorkCounts {
  const files = new Set<string>()
  let fileAnon = 0
  let searches = 0
  let commands = 0
  let edits = 0
  let other = 0
  for (const entry of entries) {
    const name = entry.toolName.trim().toLowerCase()
    if (name === 'read') {
      const path = entryPath(entry)
      if (path) files.add(path)
      else fileAnon += 1
      continue
    }
    if (searchTools.has(name)) {
      searches += 1
      continue
    }
    if (commandTools.has(name)) {
      commands += 1
      continue
    }
    if (editTools.has(name)) {
      edits += 1
      continue
    }
    if (name === 'subagent') continue
    other += 1
  }
  return { files: files.size + fileAnon, searches, commands, edits, other }
}

function countLabel(count: number, zh: string, one: string, many: string) {
  return t(`${count} ${zh}`, count === 1 ? one : many.replace('%d', String(count)))
}

export function chatWorkTotalsLabel(entries: readonly ChatActivityEntry[], thinkingMs = 0) {
  const counts = chatWorkCounts(entries)
  const parts: string[] = []
  if (thinkingMs >= 500) parts.push(thinkingSummary(thinkingMs))
  if (counts.files) {
    parts.push(countLabel(counts.files, t('个文件', 'files'), '1 file', '%d files'))
  }
  if (counts.searches) {
    parts.push(countLabel(counts.searches, t('次检索', 'searches'), '1 search', '%d searches'))
  }
  if (counts.commands) {
    parts.push(countLabel(counts.commands, t('条命令', 'commands'), '1 command', '%d commands'))
  }
  if (counts.edits) {
    parts.push(countLabel(counts.edits, t('处编辑', 'edits'), '1 edit', '%d edits'))
  }
  if (counts.other) {
    const alongside = parts.length > 0
    parts.push(alongside
      ? countLabel(counts.other, t('次其他调用', 'other calls'), '1 other call', '%d other calls')
      : countLabel(counts.other, t('次工具调用', 'tool calls'), '1 tool call', '%d tool calls'))
  }
  return parts.join(' · ')
}

export function chatLiveActionLabel(entry: ChatActivityEntry) {
  const name = entry.toolName.trim().toLowerCase()
  const pill = agentToolChip(entry).pill.trim()
  if (name === 'bash' || name === 'shell') return t('正在等命令', 'Waiting for the command')
  if (name === 'read') {
    return pill ? t(`正在读 ${pill}`, `Reading ${pill}`) : t('正在读文件', 'Reading a file')
  }
  if (name === 'grep' || name === 'find' || name === 'ls') {
    return pill ? t(`正在检索 ${pill}`, `Searching ${pill}`) : t('正在检索', 'Searching')
  }
  if (name === 'edit' || name === 'write') {
    return pill ? t(`正在改 ${pill}`, `Editing ${pill}`) : t('正在改文件', 'Editing a file')
  }
  const verb = pill || name || t('工具', 'tool')
  return t(`正在调用 ${verb}`, `Running ${verb}`)
}

function ownThinkingMs(block: ChatTranscriptBlock | undefined): number {
  if (!block) return 0
  const thoughts: Message[] = []
  if (block.kind === 'message') thoughts.push(block.message)
  if (block.kind === 'process') {
    for (const inner of block.blocks) {
      if (inner.kind === 'message') thoughts.push(inner.message)
    }
  }
  return thoughts.reduce(
    (sum, message) => sum + Math.max(0, message.thinkingDurationMs ?? 0),
    0,
  )
}

export function chatFoldModel(
  blocks: readonly ChatTranscriptBlock[],
  blockId: string,
  conversationRunning: boolean,
  now = Date.now(),
): ChatFoldModel {
  const index = blocks.findIndex(block => block.id === blockId)
  const own = index >= 0 ? toolMessages(blocks[index]!) : []
  const ownEntries = buildChatActivityEntries(own)
  const empty = {
    entries: ownEntries,
    thinkingMs: ownThinkingMs(index >= 0 ? blocks[index] : undefined),
    thinkingRunning: false,
    liveLabel: '',
  }
  if (index < 0) return empty
  const { start, end } = turnBounds(blocks, index)
  let lastWork = ''
  let workCount = 0
  for (let cursor = start; cursor < end; cursor += 1) {
    const block = blocks[cursor]!
    if (block.kind === 'process' || block.kind === 'activity') {
      workCount += 1
      lastWork = block.id
    }
  }
  const live = conversationRunning && chatLiveAnchorId(blocks) === blockId
  const wide = live || (lastWork === blockId && workCount === 1)
  if (!wide) return empty

  const messages: Message[] = []
  let thinkingMs = 0
  let thinkingRunning = false
  let thinkingStartedAt: number | undefined
  let replying = false
  const accumulateThinking = (message: Message) => {
    if (message.thinkingStatus === 'running') {
      thinkingRunning = true
      const started = Number(message.timestamp)
      thinkingStartedAt = Number.isFinite(started) ? started : now
    } else if (String(message.thinking ?? '').trim() || message.thinkingDurationMs) {
      thinkingMs += Math.max(0, message.thinkingDurationMs ?? 0)
    }
  }
  for (let cursor = start; cursor < end; cursor += 1) {
    const block = blocks[cursor]!
    if (block.kind === 'activity' || block.kind === 'process') {
      messages.push(...toolMessages(block))
      // Finished thinking now folds into 过程 blocks, so its time has to be
      // picked up from the nested message blocks as well.
      if (block.kind === 'process') {
        for (const inner of block.blocks) {
          if (inner.kind === 'message' && inner.message.role === 'assistant') {
            accumulateThinking(inner.message)
          }
        }
      }
      continue
    }
    if (block.kind !== 'message' || block.message.role !== 'assistant') continue
    accumulateThinking(block.message)
    if (block.message.status === 'running' && String(block.message.content ?? '').trim()) replying = true
  }
  const entries = buildChatActivityEntries(messages)
  const runningEntry = [...entries].reverse().find(entry => entry.running)
  let liveLabel = ''
  if (live) {
    if (runningEntry) liveLabel = chatLiveActionLabel(runningEntry)
    else if (thinkingRunning) liveLabel = t('正在思考', 'Thinking')
    else if (replying) liveLabel = t('正在回复', 'Replying')
  }
  return {
    entries,
    thinkingMs,
    thinkingRunning: live && thinkingRunning,
    thinkingStartedAt: live ? thinkingStartedAt : undefined,
    liveLabel,
  }
}

export function chatFoldElapsedLabel(model: ChatFoldModel, now = Date.now()) {
  const extra = model.thinkingRunning && model.thinkingStartedAt != null
    ? Math.max(0, now - model.thinkingStartedAt)
    : 0
  return chatWorkTotalsLabel(model.entries, model.thinkingMs + extra)
}
