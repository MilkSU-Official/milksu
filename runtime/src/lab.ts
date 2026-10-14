import { mkdir, readdir, readFile, rename, stat, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { labJobsDirectory } from './home.ts'

const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/

export type LabJob = {
  id: string
  title: string
  scope: string
  request: string
  packageId?: string
  challengeId?: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolve) => {
      release = resolve
    })
    return previous.then(fn).finally(() => release())
  }
}

function clipTitle(value: string): string {
  const line = value.trim().split(/\s+/).filter(Boolean).join(' ')
  const runes = [...line]
  return runes.length <= 40 ? line : runes.slice(0, 40).join('')
}

export function normalizeLabJob(value: LabJob): LabJob {
  const id = String(value.id ?? '').trim()
  if (!VALID_ID.test(id)) throw new Error('invalid lab job id')
  let title = clipTitle(String(value.title ?? ''))
  const request = String(value.request ?? '').trim()
  if (!title) title = clipTitle(request)
  if (!title) title = '实验室作业'
  const scope = String(value.scope ?? '').trim() === 'local' ? 'local' : 'remote'
  const createdAt = value.createdAt > 0 ? value.createdAt : Date.now()
  const updatedAt = value.updatedAt > 0 ? value.updatedAt : createdAt
  return {
    id,
    title,
    scope,
    request,
    packageId: String(value.packageId ?? '').trim() || undefined,
    challengeId: String(value.challengeId ?? '').trim() || undefined,
    createdAt,
    updatedAt,
    archivedAt: value.archivedAt,
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export class LabJobStore {
  readonly directory: string
  private readonly mutex = new Mutex()

  constructor(directory: string) {
    this.directory = directory
  }

  static async open(home?: string): Promise<LabJobStore> {
    const store = new LabJobStore(labJobsDirectory(home))
    await store.ensure()
    return store
  }

  archivedDirectory(): string {
    return join(this.directory, 'archived')
  }

  async ensure(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await mkdir(this.archivedDirectory(), { recursive: true, mode: 0o700 })
  }

  list(): Promise<LabJob[]> {
    return this.mutex.run(() => this.listDirectory(this.directory))
  }

  get(id: string): Promise<LabJob> {
    return this.mutex.run(() => this.getFromDirectory(this.directory, id))
  }

  listArchived(): Promise<LabJob[]> {
    return this.mutex.run(async () => {
      const values = await this.listDirectory(this.archivedDirectory())
      values.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
      return values
    })
  }

  save(value: LabJob): Promise<void> {
    return this.mutex.run(async () => {
      const normalized = normalizeLabJob(value)
      await this.writeToDirectory(this.directory, normalized)
    })
  }

  archive(id: string): Promise<void> {
    return this.mutex.run(async () => {
      await this.move(this.directory, this.archivedDirectory(), id)
      await this.stamp(this.archivedDirectory(), id, Date.now())
    })
  }

  restore(id: string): Promise<void> {
    return this.mutex.run(async () => {
      await this.move(this.archivedDirectory(), this.directory, id)
      await this.stamp(this.directory, id, 0)
    })
  }

  private async listDirectory(directory: string): Promise<LabJob[]> {
    let names: string[]
    try {
      names = await readdir(directory)
    } catch (error) {
      throw new Error(`list lab jobs: ${error instanceof Error ? error.message : error}`)
    }
    const values: LabJob[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const info = await stat(join(directory, name))
        if (info.isDirectory()) continue
        const raw = JSON.parse(await readFile(join(directory, name), 'utf8')) as LabJob
        values.push(normalizeLabJob(raw))
      } catch {
        continue
      }
    }
    values.sort((a, b) => {
      if (a.updatedAt === b.updatedAt) return b.createdAt - a.createdAt
      return b.updatedAt - a.updatedAt
    })
    return values
  }

  private async getFromDirectory(directory: string, id: string): Promise<LabJob> {
    if (!VALID_ID.test(id)) throw new Error('invalid lab job id')
    const raw = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')) as LabJob
    const normalized = normalizeLabJob(raw)
    if (normalized.id !== id) throw new Error('lab job id does not match stored record')
    return normalized
  }

  private async writeToDirectory(directory: string, value: LabJob): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${value.id}.json`)
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await chmod(path, 0o600)
  }

  private async move(from: string, to: string, id: string): Promise<void> {
    if (!VALID_ID.test(id)) throw new Error('invalid lab job id')
    await mkdir(to, { recursive: true, mode: 0o700 })
    try {
      await rename(join(from, `${id}.json`), join(to, `${id}.json`))
    } catch (error) {
      throw new Error(`move lab job: ${error instanceof Error ? error.message : error}`)
    }
  }

  private async stamp(directory: string, id: string, archivedAt: number): Promise<void> {
    const value = await this.getFromDirectory(directory, id)
    value.archivedAt = archivedAt
    value.updatedAt = Date.now()
    await this.writeToDirectory(directory, value)
  }
}
