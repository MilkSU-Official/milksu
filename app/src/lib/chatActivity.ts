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
  running: boolean
}

export type ChatTranscriptBlock = ChatMessageBlock | ChatActivityBlock

const commandTools = new Set(['bash', 'background', 'background_output'])
const mutationTools = new Set(['edit', 'write'])
const searchTools = new Set(['find', 'grep', 'ls', 'read'])

function isApproval(message: Message) {
  return Boolean(message.approvalRequestId)
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
    id: `activity:${messages[0]?.id ?? 'empty'}:${messages.at(-1)?.id ?? 'empty'}`,
    messages,
    running,
  }
}

function flushAgentSegment(
  blocks: ChatTranscriptBlock[],
  segment: Message[],
  conversationRunning: boolean,
) {
  if (!segment.length) return

  let lastToolIndex = -1
  segment.forEach((message, index) => {
    if (message.role === 'tool') lastToolIndex = index
  })

  if (lastToolIndex < 0) {
    blocks.push(...segment.map(messageBlock))
    return
  }

  const activityMessages = segment.slice(0, lastToolIndex + 1)
  const trailingMessages = segment.slice(lastToolIndex + 1)

  blocks.push(activityBlock(
    activityMessages,
    conversationRunning && activityMessages.some(message => message.status === 'running'),
  ))
  blocks.push(...trailingMessages.map(messageBlock))
}

export function buildChatTranscript(
  messages: Message[],
  conversationRunning: boolean,
): ChatTranscriptBlock[] {
  const blocks: ChatTranscriptBlock[] = []
  let agentSegment: Message[] = []

  const flush = () => {
    flushAgentSegment(blocks, agentSegment, conversationRunning)
    agentSegment = []
  }

  for (const message of messages) {
    if (message.role === 'user' || isApproval(message)) {
      flush()
      blocks.push(messageBlock(message))
      continue
    }
    agentSegment.push(message)
  }
  flush()

  return blocks
}

function toolCount(messages: Message[], tools: Set<string>) {
  return messages.filter(message => (
    message.role === 'tool'
    && tools.has(String(message.toolName ?? '').toLowerCase())
  )).length
}

export function chatActivitySummary(messages: Message[]) {
  const tools = messages.filter(message => message.role === 'tool')
  if (!tools.length) return '正在思考'

  const architectureCount = tools.filter(message => (
    String(message.toolName ?? '').toLowerCase() === 'milksu_archify'
  )).length
  if (architectureCount) return '处理架构图'

  const mutations = toolCount(messages, mutationTools)
  const commands = toolCount(messages, commandTools)
  const searches = toolCount(messages, searchTools)
  const parts: string[] = []

  if (mutations) parts.push('编辑了文件')
  if (commands) parts.push(commands > 1 ? '运行了多个命令' : '运行了命令')
  if (!parts.length && searches) parts.push('读取并检索了项目')
  if (!parts.length) {
    parts.push(tools.length > 1 ? '使用了多个工具' : `使用了 ${tools[0]?.toolName ?? '工具'}`)
  }

  return parts.join('并')
}

export function buildChatActivityEntries(messages: Message[]): ChatActivityEntry[] {
  const entries: ChatActivityEntry[] = []
  const pending = new Map<string, ChatActivityEntry[]>()

  for (const message of messages) {
    if (message.role !== 'tool') continue
    const toolName = String(message.toolName ?? 'tool').toLowerCase()

    if (message.status === 'running') {
      const entry: ChatActivityEntry = {
        id: `tool:${message.id}`,
        toolName,
        request: message,
        running: true,
      }
      entries.push(entry)
      const queue = pending.get(toolName) ?? []
      queue.push(entry)
      pending.set(toolName, queue)
      continue
    }

    const queue = pending.get(toolName)
    const requestEntry = queue?.shift()
    if (requestEntry) {
      requestEntry.result = message
      requestEntry.running = false
      continue
    }

    entries.push({
      id: `tool:${message.id}`,
      toolName,
      result: message,
      running: false,
    })
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
  if (name === 'background') return `启动后台任务${suffix}`
  if (name === 'background_output') return '读取后台任务'
  if (name === 'read') return `读取${suffix || '文件'}`
  if (name === 'write') return `写入${suffix || '文件'}`
  if (name === 'edit') return `编辑${suffix || '文件'}`
  if (name === 'ls') return `查看${suffix || '目录'}`
  if (name === 'find') return `查找${suffix || '文件'}`
  if (name === 'grep') return `搜索${suffix || '内容'}`
  if (name === 'milksu_progress') return '更新任务进度'
  if (name === 'milksu_archify') return '处理架构图'
  return subject ? `${message.toolName ?? '工具'} · ${subject}` : message.toolName ?? '使用工具'
}
