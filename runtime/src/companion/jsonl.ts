import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { companionImageHandoffText, isHostNoticeText } from './gate.ts'
import { SESSION_ID } from './types.ts'
import { asObject, trimString } from './util.ts'

export type TranscriptCursor = {
  byteOffset: number
  entryId: string
  timestamp: string
  lineLength: number
}

export type TranscriptComponent = {
  id?: string
  kind: string
  title?: string
  detail?: string
}

export type TranscriptEntry = {
  id: string
  type: string
  timestamp: string
  role?: string
  text?: string
  thinking?: string
  tools?: string[]
  components?: TranscriptComponent[]
  error?: string
}

export type TranscriptPage = {
  entries: TranscriptEntry[]
  nextCursor?: TranscriptCursor
  prevCursor?: TranscriptCursor
  hasMore: boolean
  file?: string
}

export type CompanionArchive = {
  name: string
  size: number
  modified: number
  exportable: boolean
}

const DEFAULT_TRANSCRIPT_LIMIT = 40
const MAX_TRANSCRIPT_LIMIT = 200

export async function findCompanionSessionFile(agentDir: string): Promise<string> {
  const sessionDir = join(agentDir, 'sessions')
  let entries: string[]
  try {
    entries = await readdir(sessionDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw new Error(`list companion sessions: ${error instanceof Error ? error.message : error}`)
  }
  let latest = ''
  let latestMod = 0
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    if (!name.includes(`_${SESSION_ID}.jsonl`) && name !== `${SESSION_ID}.jsonl`) continue
    const path = join(sessionDir, name)
    try {
      const info = await stat(path)
      if (info.isDirectory()) continue
      if (info.mtimeMs >= latestMod) {
        latestMod = info.mtimeMs
        latest = path
      }
    } catch {
      continue
    }
  }
  return latest
}

export async function readTranscriptPage(
  path: string,
  limit: number,
  cursor: TranscriptCursor | null | undefined,
  before: boolean,
): Promise<TranscriptPage> {
  if (!path.trim()) return { entries: [], hasMore: false }
  let pageLimit = limit
  if (pageLimit <= 0) pageLimit = DEFAULT_TRANSCRIPT_LIMIT
  if (pageLimit > MAX_TRANSCRIPT_LIMIT) pageLimit = MAX_TRANSCRIPT_LIMIT
  let handle
  try {
    handle = await open(path, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], hasMore: false }
    throw new Error(`open companion transcript: ${error instanceof Error ? error.message : error}`)
  }
  try {
    const info = await handle.stat()
    if (!cursor || before) return readTranscriptTail(handle, path, info.size, pageLimit, cursor)
    return readTranscriptForward(handle, path, info.size, pageLimit, cursor)
  } finally {
    await handle.close()
  }
}

export async function archiveCompanionFile(agentDir: string, path: string): Promise<CompanionArchive> {
  if (!path.trim()) throw new Error('companion transcript path is required')
  const archiveDir = join(agentDir, 'archive')
  await mkdir(archiveDir, { recursive: true, mode: 0o700 })
  const name = basename(path)
  const dest = join(archiveDir, name)
  try {
    await rename(path, dest)
  } catch (error) {
    throw new Error(`archive companion transcript: ${error instanceof Error ? error.message : error}`)
  }
  const info = await stat(dest)
  return {
    name,
    size: info.size,
    modified: Math.trunc(info.mtimeMs),
    exportable: true,
  }
}

export async function listCompanionArchives(agentDir: string): Promise<CompanionArchive[]> {
  const archiveDir = join(agentDir, 'archive')
  let entries: string[]
  try {
    entries = await readdir(archiveDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const result: CompanionArchive[] = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    try {
      const info = await stat(join(archiveDir, name))
      if (info.isDirectory()) continue
      result.push({
        name,
        size: info.size,
        modified: Math.trunc(info.mtimeMs),
        exportable: true,
      })
    } catch {
      continue
    }
  }
  return result
}

export async function deleteCompanionArchive(agentDir: string, name: string): Promise<void> {
  const cleaned = basename(name.trim())
  if (!cleaned || cleaned !== name || !cleaned.endsWith('.jsonl')) {
    throw new Error('invalid companion archive name')
  }
  try {
    await unlink(join(agentDir, 'archive', cleaned))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

type FileHandle = Awaited<ReturnType<typeof open>>

type ScannedLine = { offset: number; length: number; raw: Buffer }

async function readTranscriptForward(
  file: FileHandle,
  path: string,
  size: number,
  limit: number,
  cursor: TranscriptCursor,
): Promise<TranscriptPage> {
  const start = cursor.byteOffset + cursor.lineLength
  if (start > size) return { entries: [], hasMore: false, file: path }
  const want = Math.max(0, size - start)
  const { bytesRead, buffer } = await file.read({
    buffer: Buffer.alloc(want),
    position: start,
  })
  let rest = buffer.subarray(0, bytesRead)
  const entries: TranscriptEntry[] = []
  let last: TranscriptCursor | undefined
  let hasMore = false
  let offset = start
  while (rest.length > 0) {
    const index = rest.indexOf(0x0a)
    const raw = index < 0 ? rest : rest.subarray(0, index)
    const length = index < 0 ? rest.length : index + 1
    const entry = decodeTranscriptLine(raw)
    if (entry) {
      if (entries.length === limit) {
        hasMore = true
        break
      }
      entries.push(entry)
      last = {
        byteOffset: offset,
        entryId: entry.id,
        timestamp: entry.timestamp,
        lineLength: length,
      }
    }
    if (index < 0) break
    offset += length
    rest = rest.subarray(index + 1)
  }
  const page: TranscriptPage = {
    entries: foldTranscriptComponents(entries),
    hasMore,
    file: path,
  }
  if (last) {
    page.nextCursor = last
    page.prevCursor = last
  }
  return page
}

async function readTranscriptTail(
  file: FileHandle,
  path: string,
  size: number,
  limit: number,
  before: TranscriptCursor | null | undefined,
): Promise<TranscriptPage> {
  let end = size
  if (before && before.byteOffset > 0) end = before.byteOffset
  if (end <= 0) return { entries: [], hasMore: false, file: path }
  const chunk = 64 * 1024
  const collected: ScannedLine[] = []
  let carry = Buffer.alloc(0)
  let remaining = end
  while (remaining > 0 && collected.length <= limit + 1) {
    const readSize = Math.min(chunk, remaining)
    remaining -= readSize
    const { bytesRead, buffer } = await file.read({
      buffer: Buffer.alloc(readSize),
      position: remaining,
    })
    const combined = Buffer.concat([buffer.subarray(0, bytesRead), carry])
    const lines = splitLines(combined, remaining)
    if (remaining > 0 && lines.length > 0) {
      carry = Buffer.from(lines[0]!.raw)
      collected.unshift(...lines.slice(1))
    } else {
      carry = Buffer.alloc(0)
      collected.unshift(...lines)
    }
  }
  const decoded: Array<{ entry: TranscriptEntry; cursor: TranscriptCursor }> = []
  for (const line of collected) {
    const entry = decodeTranscriptLine(line.raw)
    if (!entry) continue
    decoded.push({
      entry,
      cursor: {
        byteOffset: line.offset,
        entryId: entry.id,
        timestamp: entry.timestamp,
        lineLength: line.length,
      },
    })
  }
  let hasMore = false
  let kept = decoded
  if (decoded.length > limit) {
    hasMore = true
    kept = decoded.slice(decoded.length - limit)
  }
  const page: TranscriptPage = {
    entries: foldTranscriptComponents(kept.map((item) => item.entry)),
    hasMore,
    file: path,
  }
  if (kept.length > 0) {
    page.prevCursor = kept[0]!.cursor
    page.nextCursor = kept[kept.length - 1]!.cursor
  }
  return page
}

function splitLines(buf: Buffer, base: number): ScannedLine[] {
  const result: ScannedLine[] = []
  let offset = base
  let rest = buf
  while (rest.length > 0) {
    const index = rest.indexOf(0x0a)
    if (index < 0) {
      result.push({ offset, length: rest.length, raw: Buffer.from(rest) })
      break
    }
    result.push({
      offset,
      length: index + 1,
      raw: Buffer.from(rest.subarray(0, index)),
    })
    rest = rest.subarray(index + 1)
    offset += index + 1
  }
  return result
}

function decodeTranscriptLine(line: Buffer): TranscriptEntry | null {
  const trimmed = line.toString('utf8').trim()
  if (!trimmed) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  const kind = trimString(raw.type)
  if (!kind || kind === 'session') return null
  const entry: TranscriptEntry = {
    id: trimString(raw.id),
    type: kind,
    timestamp: trimString(raw.timestamp),
  }
  const message = asObject(raw.message)
  if (Object.keys(message).length) {
    const component = companionProcessComponent(message)
    if (component) {
      entry.type = 'component'
      entry.components = [component]
      return entry
    }
    if (typeof message.display === 'boolean' && !message.display) return null
    entry.role = trimString(message.role)
    if (!transcriptRoleVisible(entry.role)) return null
    entry.text = extractMessageText(message.content)
    if (entry.role === 'user' && isHostNoticeText(entry.text)) {
      const block = companionImageHandoffText(entry.text)
      if (!block) return null
      entry.role = 'assistant'
      entry.text = block
    }
    entry.thinking = extractMessageThinking(message.content)
    entry.tools = extractMessageTools(message.content)
    const errText = trimString(message.errorMessage)
    if (errText) entry.error = errText
  }
  if (raw.content !== undefined && !entry.text) {
    entry.text = extractMessageText(raw.content)
    if (!entry.thinking) entry.thinking = extractMessageThinking(raw.content)
    if (!entry.tools?.length) entry.tools = extractMessageTools(raw.content)
  }
  const summary = trimString(raw.summary)
  if (summary && !entry.text) entry.text = summary
  if (!entry.error) {
    const errText = trimString(raw.errorMessage) || trimString(raw.error)
    if (errText) entry.error = errText
  }
  if (!entry.id) entry.id = `${entry.type}:${entry.timestamp}`
  if (looksLikeCompanionAbort(entry.text ?? '')) {
    if (!trimString(entry.error)) entry.error = trimString(entry.text)
    entry.text = ''
  }
  if (looksLikeCompanionAbort(entry.error ?? '')) entry.text = ''
  if (looksLikeCompanionDebugJSON(entry.text ?? '')) {
    if (entry.role !== 'assistant' || (!entry.thinking && !(entry.tools?.length))) return null
    entry.text = ''
  }
  if (!entry.text && !entry.error && !entry.thinking && !(entry.tools?.length) && kind !== 'message') {
    return null
  }
  return entry
}

function companionProcessComponent(message: Record<string, unknown>): TranscriptComponent | null {
  let kind = ''
  switch (trimString(message.customType)) {
    case 'companion.decision':
      kind = 'decision'
      break
    case 'companion.memory':
      kind = 'memory'
      break
    default:
      return null
  }
  let detail = extractMessageText(message.content).trim()
  if (!detail) {
    const details = asObject(message.details)
    detail = trimString(details.text)
  }
  if (!detail) return null
  return { id: kind, kind, detail }
}

function foldTranscriptComponents(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (!entries.length) return entries
  const pending: TranscriptComponent[] = []
  const folded: TranscriptEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'component') {
      pending.push(...(entry.components ?? []))
      continue
    }
    if (entry.role === 'assistant' && pending.length) {
      entry.components = [...pending, ...(entry.components ?? [])]
      pending.length = 0
    }
    folded.push(entry)
  }
  if (!pending.length) return folded
  for (let index = folded.length - 1; index >= 0; index -= 1) {
    if (folded[index]!.role !== 'assistant') continue
    folded[index]!.components = [...(folded[index]!.components ?? []), ...pending]
    break
  }
  return folded
}

function transcriptRoleVisible(role: string): boolean {
  switch (role.toLowerCase()) {
    case 'user':
    case 'assistant':
    case '':
      return true
    default:
      return false
  }
}

export function looksLikeCompanionAbort(text: string): boolean {
  const folded = text.trim().toLowerCase()
  if (!folded) return false
  return folded.includes('request aborted')
    || folded.includes('request was aborted')
    || folded.includes('aborterror')
    || folded.includes('this operation was aborted')
    || folded.includes('the operation was aborted')
}

function companionCancelledCopy(locale: string): string {
  return locale.toLowerCase().startsWith('en') ? 'This turn was cancelled.' : '这一轮已取消。'
}

export function localizeCompanionTranscriptAbort(page: TranscriptPage, locale: string): void {
  const copy = companionCancelledCopy(locale)
  for (const entry of page.entries) {
    if (looksLikeCompanionAbort(entry.error ?? '') || looksLikeCompanionAbort(entry.text ?? '')) {
      entry.text = ''
      entry.error = copy
    }
  }
}

function looksLikeCompanionDebugJSON(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.toLowerCase().includes('[object object]')) return true
  if (trimmed.includes('companion_float_enabled') || trimmed.includes('tokenflux.dev/v1')) {
    return /[{[]/.test(trimmed)
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Boolean(parsed && typeof parsed === 'object')
  } catch {
    return trimmed.includes('"settings"') || trimmed.includes('"relay"')
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    const block = asObject(item)
    const blockType = trimString(block.type)
    if (blockType && blockType !== 'text') continue
    const text = trimString(block.text)
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

function extractMessageThinking(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    const block = asObject(item)
    let thinking = trimString(block.thinking)
    if (!thinking && trimString(block.type) === 'thinking') thinking = trimString(block.text)
    if (thinking) parts.push(thinking)
  }
  return parts.join('\n\n')
}

function extractMessageTools(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const tools: string[] = []
  const seen = new Set<string>()
  for (const item of content) {
    const block = asObject(item)
    if (trimString(block.type) !== 'toolCall') continue
    const name = trimString(block.name)
    if (!name || seen.has(name)) continue
    seen.add(name)
    tools.push(name)
  }
  return tools
}
