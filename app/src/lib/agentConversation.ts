import { t } from '@/lib/uiLocale'
import type { ChatActivityEntry } from '@/lib/chatActivity'

export interface AgentToolChip {
  verb: string
  pill: string
  add?: number
  del?: number
}

export interface AgentSourceChip {
  label: string
  href: string
}

export interface AgentFileDiffLine {
  text: string
  tone: 'add' | 'del' | 'ctx'
}

export interface AgentFileDiffChip {
  path: string
  add: number
  del: number
  lines: AgentFileDiffLine[]
}

function firstLine(value: string) {
  return value
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(Boolean)
    ?? ''
}

function basename(path: string) {
  const trimmed = path.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts.at(-1) || trimmed
}

export type AgentToolIconKind =
  | 'terminal'
  | 'file'
  | 'edit'
  | 'folder'
  | 'search'
  | 'plan'
  | 'image'
  | 'layout'
  | 'worktree'
  | 'workspace'
  | 'server'
  | 'monitor'
  | 'tool'

const terminalToolNames = new Set([
  'bash',
  'background',
  'background_output',
  'bg_task',
  'bg_status',
])
const backgroundPollToolNames = new Set(['background_output', 'bg_status'])
const noPillToolNames = new Set([
  'bash',
  'background',
  'background_output',
  'bg_task',
  'bg_status',
  'milksu_progress',
  'milksu_workspace',
  'milksu_worktree',
  'milksu_archify',
  'env_status',
  'env_start',
  'env_reset',
  'env_stop',
  'prepare_computer_use_driver',
])

// Row label = 动作 | 对象. The action column is always localized; the subject
// column is a distilled target (file name, cleaned search pattern), never the
// raw command or model-authored text. Raw input stays in the expanded detail.
export function toolActionLabel(name: string): string {
  switch (name) {
    case 'bash':
      return t('运行命令', 'Run command')
    case 'background':
    case 'bg_task':
      return t('后台任务', 'Background task')
    case 'background_output':
    case 'bg_status':
      return t('查看后台', 'Check background')
    case 'read':
      return t('读取', 'Read')
    case 'write':
      return t('写入', 'Write')
    case 'edit':
      return t('编辑', 'Edit')
    case 'lsp_fix':
      return t('修复代码', 'Fix code')
    case 'ls':
      return t('查看目录', 'List directory')
    case 'find':
      return t('查找', 'Find')
    case 'grep':
      return t('搜索', 'Search')
    case 'milksu_progress':
      return t('更新计划', 'Update plan')
    case 'milksu_workspace':
      return t('操作 MilkSU', 'Operate MilkSU')
    case 'milksu_worktree':
      return t('隔离工作树', 'Isolated worktree')
    case 'milksu_imagegen':
      return t('生成图片', 'Generate image')
    case 'milksu_archify':
      return t('架构图', 'Architecture diagram')
    case 'env_status':
      return t('查看环境', 'Check environment')
    case 'env_start':
      return t('启动环境', 'Start environment')
    case 'env_reset':
      return t('重置环境', 'Reset environment')
    case 'env_stop':
      return t('停止环境', 'Stop environment')
    case 'prepare_computer_use_driver':
      return t('Computer Use', 'Computer Use')
    default:
      return name
  }
}

export function agentToolIconKind(name: string): AgentToolIconKind {
  if (terminalToolNames.has(name)) return 'terminal'
  if (name === 'read') return 'file'
  if (name === 'edit' || name === 'write' || name === 'lsp_fix') return 'edit'
  if (name === 'ls' || name === 'find') return 'folder'
  if (name === 'grep') return 'search'
  if (name === 'milksu_progress') return 'plan'
  if (name === 'milksu_imagegen') return 'image'
  if (name === 'milksu_archify') return 'layout'
  if (name === 'milksu_worktree') return 'worktree'
  if (name === 'milksu_workspace') return 'workspace'
  if (name.startsWith('env_')) return 'server'
  if (name === 'prepare_computer_use_driver') return 'monitor'
  return 'tool'
}

function truncatePill(value: string) {
  return value.length > 64 ? `${value.slice(0, 63).trimEnd()}…` : value
}

// Grep patterns read better without regex escapes: `attachment\.held` shows as
// `attachment.held`. Alternation stays intact, the row just carries keywords.
function cleanSearchPattern(value: string) {
  return truncatePill(
    value
      .replace(/\\(.)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

export function agentToolChip(entry: ChatActivityEntry): AgentToolChip {
  const name = entry.toolName
  const verb = toolActionLabel(name)
  const source = firstLine(entry.request?.content || entry.result?.content || '')
    .replace(/^\$\s+/, '')
  const mutation = source.match(/^(.*?)\s+\+(\d+)\s+[-−](\d+)\s*$/)
  if (mutation) {
    return {
      verb,
      pill: basename(mutation[1]!.trim()),
      add: Number(mutation[2]),
      del: Number(mutation[3]),
    }
  }
  const added = source.match(/^(.*?)\s+\+(\d+)\s*$/)
  if (added) {
    return {
      verb,
      pill: basename(added[1]!.trim()),
      add: Number(added[2]),
    }
  }
  // The command itself stays in the expanded detail: a scan of the process
  // list only needs the action, not the exact command line.
  if (noPillToolNames.has(name)) {
    if (name === 'bg_task' || name === 'background') {
      const taskName = source.split(' · ')[1]?.trim()
      return { verb, pill: taskName ? truncatePill(taskName) : '' }
    }
    if (backgroundPollToolNames.has(name)) {
      const taskId = source.split(' · ')[1]?.trim()
      return { verb, pill: taskId ? truncatePill(taskId) : '' }
    }
    return { verb, pill: '' }
  }
  if (name === 'milksu_imagegen') {
    const outputPath = source.split(' · ')[1]?.trim()
    return { verb, pill: outputPath ? basename(outputPath) : '' }
  }
  const path = source.split(' · ')[0]?.trim() || source
  if (name === 'grep') {
    return { verb, pill: path ? cleanSearchPattern(path) : '' }
  }
  const rawPill = name === 'read' || name === 'edit' || name === 'write' || name === 'ls'
    ? basename(path)
    : path
  return { verb, pill: truncatePill(rawPill) }
}

/** Beautiful UI Loading State timer: tenths of a second, then minutes. */
export function formatDemoElapsed(durationMs?: number) {
  const total = Math.max(0, (Number(durationMs) || 0) / 1000)
  if (total < 60) return `${total.toFixed(1)}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}m ${seconds.toFixed(1)}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ${seconds.toFixed(1)}s`
}

const mutationTools = new Set(['edit', 'write', 'lsp_fix'])

export function parseDiffPreview(content: string): AgentFileDiffLine[] {
  const lines: AgentFileDiffLine[] = []
  for (const raw of content.split(/\r?\n/)) {
    if (
      raw.startsWith('+++')
      || raw.startsWith('---')
      || raw.startsWith('@@')
      || raw.startsWith('diff ')
    ) continue
    if (raw.startsWith('+')) lines.push({ text: raw.slice(1), tone: 'add' })
    else if (raw.startsWith('-')) lines.push({ text: raw.slice(1), tone: 'del' })
    else if (raw.startsWith(' ') && lines.length) lines.push({ text: raw.slice(1), tone: 'ctx' })
  }
  return lines.slice(0, 8)
}

export function agentFileDiffChips(entries: ChatActivityEntry[]): AgentFileDiffChip[] {
  const chips: AgentFileDiffChip[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!mutationTools.has(entry.toolName) || entry.running) continue
    const chip = agentToolChip(entry)
    if (!chip.pill || seen.has(chip.pill)) continue
    seen.add(chip.pill)
    const source = `${entry.request?.content ?? ''}\n${entry.result?.content ?? ''}`
    chips.push({
      path: chip.pill,
      add: chip.add ?? 0,
      del: chip.del ?? 0,
      lines: parseDiffPreview(source),
    })
  }
  return chips
}

export function thinkingSummary(durationMs?: number, running?: boolean) {
  if (running && (durationMs === undefined || durationMs < 500)) {
    return t('正在思考', 'Thinking')
  }
  if (durationMs === undefined) return t('思考', 'Thought')
  return t(`想了 ${formatDemoElapsed(durationMs)}`, `Thought ${formatDemoElapsed(durationMs)}`)
}

export function messageSourceChips(content: string): AgentSourceChip[] {
  const chips: AgentSourceChip[] = []
  const seen = new Set<string>()
  const markdown = /\[[^\]]*]\((https:\/\/[^\s)]+)\)/g
  for (const match of content.matchAll(markdown)) {
    const href = match[1]
    if (!href || seen.has(href)) continue
    seen.add(href)
    try {
      chips.push({ href, label: new URL(href).hostname.replace(/^www\./, '') })
    } catch {
      chips.push({ href, label: href })
    }
  }
  return chips.slice(0, 8)
}
