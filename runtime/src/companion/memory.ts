import type {
  ApprovedMemory,
  Catalog,
  MemoryHit,
  MemoryProposal,
  MemorySnapshot,
  SessionSearcher,
} from './types.ts'
import type { MemoryCommit } from './gate.ts'
import { asObject, newPrefixedId, stringSlice, trimString } from './util.ts'

const MEMORY_COMMIT_LIMIT = 3
const MEMORY_SECRET_KEY = /\bsk-[A-Za-z0-9_-]{12,}\b/g
const MEMORY_SECRET_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi
const MEMORY_SECRET_FLAG = /\b(?:flag|nssctf|ctf)\{[^}\r\n]{1,512}\}/gi

function redactMemoryText(value: string): string {
  return value
    .replace(MEMORY_SECRET_FLAG, '[redacted]')
    .replace(MEMORY_SECRET_KEY, '[redacted]')
    .replace(MEMORY_SECRET_BEARER, '[redacted]')
}

function approvedPayload(
  approved: Map<string, ApprovedMemory>,
  forgotten: Set<string>,
): Array<Record<string, string>> {
  const payload: Array<Record<string, string>> = []
  for (const memory of approved.values()) {
    if (forgotten.has(memory.id)) continue
    payload.push({ id: memory.id, title: memory.title, markdown: memory.markdown })
  }
  return payload
}

export function commitItems(value: unknown): MemoryCommit[] {
  if (!Array.isArray(value)) return []
  const items: MemoryCommit[] = []
  for (const row of value) {
    const item = asObject(row)
    items.push({
      action: trimString(item.action),
      existingId: trimString(item.existingId),
      title: trimString(item.title),
      markdown: trimString(item.markdown),
      evidence: trimString(item.evidence),
    })
  }
  return items
}

export class Memory {
  private readonly searcher?: SessionSearcher
  private readonly catalog?: Catalog
  private pending = new Map<string, MemoryProposal>()
  private approved = new Map<string, ApprovedMemory>()
  private forgotten = new Set<string>()
  private revision = 0

  constructor(searcher?: SessionSearcher, catalog?: Catalog) {
    this.searcher = searcher
    this.catalog = catalog
  }

  async handle(input: Record<string, unknown>): Promise<unknown> {
    const action = trimString(input.action)
    switch (action) {
      case 'search':
        return this.search(trimString(input.query), Number(input.limit ?? 0), trimString(input.scope))
      case 'recall':
        return this.recall(trimString(input.sessionId), trimString(input.cursor))
      case 'propose_memory':
        return { written: false }
      case 'commit':
        return this.commit(trimString(input.userText), commitItems(input.items))
      case 'forget':
        return this.forget(trimString(input.memoryId))
      default:
        throw new Error(`unknown companion_memory action ${JSON.stringify(action)}`)
    }
  }

  async search(query: string, limit: number, scope: string): Promise<Record<string, unknown>> {
    const q = query.trim()
    if (!q) return { written: false, results: [] }
    let size = limit
    if (size <= 0) size = 8
    if (size > 50) size = 50
    let results: MemoryHit[] = []
    if (this.searcher) {
      try {
        results = await this.searcher.search(q, size, scope)
      } catch (error) {
        return {
          written: false,
          results: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    return { written: false, results }
  }

  async recall(sessionId: string, cursor: string): Promise<Record<string, unknown>> {
    const id = sessionId.trim()
    if (!id) throw new Error('recall requires sessionId')
    if (!this.catalog) {
      return { written: false, sessionId: id, cursor, messages: [] }
    }
    const ref = await this.catalog.lookup(id)
    return {
      written: false,
      sessionId: ref.id,
      title: ref.title,
      cursor,
      kind: ref.kind,
    }
  }

  commit(userText: string, items: MemoryCommit[]): Record<string, unknown> {
    const text = userText.trim()
    let written = 0
    for (const item of items) {
      if (written >= MEMORY_COMMIT_LIMIT) break
      let title = item.title.trim()
      let markdown = item.markdown.trim()
      let evidence = item.evidence.trim()
      if (!title || !markdown || !evidence || !text || !text.includes(evidence)) continue
      title = redactMemoryText(title)
      markdown = redactMemoryText(markdown)
      evidence = redactMemoryText(evidence)
      if (!title || !markdown || !evidence) continue
      switch (item.action.trim()) {
        case 'update': {
          const id = item.existingId.trim()
          const current = this.approved.get(id)
          if (!current || this.forgotten.has(id)) continue
          current.title = title
          current.markdown = markdown
          current.evidence = evidence
          this.approved.set(id, current)
          written += 1
          break
        }
        case 'create': {
          const id = newPrefixedId('mem')
          this.approved.set(id, {
            id,
            title,
            markdown,
            evidence,
            at: new Date().toISOString(),
          })
          written += 1
          break
        }
        default:
          break
      }
    }
    if (written > 0) this.revision += 1
    return {
      written: true,
      count: written,
      revision: this.revision,
      approved: approvedPayload(this.approved, this.forgotten),
    }
  }

  forget(memoryId: string): Record<string, unknown> {
    const id = memoryId.trim()
    if (!id) throw new Error('forget requires memoryId')
    this.pending.delete(id)
    this.approved.delete(id)
    this.forgotten.add(id)
    this.revision += 1
    return { forgotten: id, written: false, revision: this.revision }
  }

  approve(memoryId: string): ApprovedMemory {
    const id = memoryId.trim()
    if (this.forgotten.has(id)) throw new Error(`memory ${id} was forgotten`)
    const proposal = this.pending.get(id)
    if (!proposal) throw new Error(`pending memory ${id} was not found`)
    const approved: ApprovedMemory = {
      id: proposal.id,
      title: proposal.title,
      markdown: proposal.markdown,
      sourceSessionIds: [...(proposal.sourceSessionIds ?? [])],
    }
    this.pending.delete(id)
    this.approved.set(id, approved)
    this.revision += 1
    return approved
  }

  currentRevision(): number {
    return this.revision
  }

  snapshotApproved(): { revision: number; approved: ApprovedMemory[] } {
    return { revision: this.revision, approved: this.approvedLocked() }
  }

  forgottenHas(id: string): boolean {
    return this.forgotten.has(id.trim())
  }

  replace(pending: MemoryProposal[], approved: ApprovedMemory[], forgotten: string[]): void {
    this.pending = new Map()
    for (const proposal of pending) {
      if (!trimString(proposal.id)) continue
      this.pending.set(proposal.id, proposal)
    }
    this.approved = new Map()
    for (const memory of approved) {
      if (!trimString(memory.id)) continue
      this.approved.set(memory.id, memory)
    }
    this.forgotten = new Set()
    for (const id of forgotten) {
      if (trimString(id)) this.forgotten.add(id)
    }
  }

  snapshot(): MemorySnapshot {
    const { pending, approved } = this.persist()
    return { pending, approved }
  }

  persist(): { pending: MemoryProposal[]; approved: ApprovedMemory[]; forgotten: string[] } {
    return {
      pending: [...this.pending.values()],
      approved: [...this.approved.values()],
      forgotten: [...this.forgotten],
    }
  }

  private approvedLocked(): ApprovedMemory[] {
    const result: ApprovedMemory[] = []
    for (const memory of this.approved.values()) {
      if (this.forgotten.has(memory.id)) continue
      result.push(memory)
    }
    result.sort((a, b) => {
      if (a.at === b.at) return a.id < b.id ? -1 : 1
      return (a.at ?? '') < (b.at ?? '') ? -1 : 1
    })
    return result
  }
}
