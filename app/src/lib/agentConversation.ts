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

export function agentToolChip(entry: ChatActivityEntry): AgentToolChip {
  const name = entry.toolName
  const verb = name === 'read'
    ? 'Read'
    : name === 'edit'
      ? 'Edit'
      : name === 'write'
        ? 'Write'
        : name === 'grep'
          ? 'Grep'
          : name === 'find'
            ? 'Find'
            : name === 'ls'
              ? 'ls'
              : name === 'bash'
                ? 'bash'
                : name === 'milksu_progress'
                  ? 'Plan'
                  : name
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
  const path = source.split(' · ')[0]?.trim() || source
  const rawPill = name === 'read' || name === 'edit' || name === 'write' || name === 'ls'
    ? basename(path)
    : path
  const pill = rawPill.length > 64 ? `${rawPill.slice(0, 63).trimEnd()}…` : rawPill
  return { verb, pill }
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
