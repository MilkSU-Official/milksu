import { randomBytes } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { secureRoot, writeJSONAtomically } from './fs.ts'

export const LIFESPAN_FILE = 'lifespan.json'
export const LIFESPAN_SCHEMA = 'milksu-lifespan/v1'
const MAX_LIFESPAN_BYTES = 16 * 1024

export type LifespanExit = 'none' | 'clean' | 'abnormal' | 'running'

export type LifespanState = {
  schema: string
  runId?: string
  startedAt?: string
  lastStartedAt?: string
  lastExit: LifespanExit
  lastCleanExitAt?: string
  consecutiveAbnormalExits: number
  pid?: number
  updatedAt?: string
}

export type LifespanStart = {
  previousExit: LifespanExit
  previousStartedAt?: string
  lastCleanExitAt?: string
  consecutiveAbnormalExits: number
  previousPid?: number
  startedAt: string
}

export type LifespanHandle = {
  runId: string
}

export function lifespanPath(root: string): string {
  return join(root, 'data', 'runtime', LIFESPAN_FILE)
}

export async function beginLifespan(root: string, pid: number): Promise<{ start: LifespanStart; handle: LifespanHandle }> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(root, { recursive: true, mode: 0o700 })
  root = await secureRoot(root)
  const path = lifespanPath(root)
  await mkdir(join(root, 'data', 'runtime'), { recursive: true, mode: 0o700 })

  const start: LifespanStart = {
    previousExit: 'none',
    consecutiveAbnormalExits: 0,
    startedAt: new Date().toISOString(),
  }
  try {
    const previous = await readLifespanStateFile(path)
    start.previousStartedAt = previous.startedAt
    start.lastCleanExitAt = previous.lastCleanExitAt
    start.previousPid = previous.pid
    start.consecutiveAbnormalExits = previous.consecutiveAbnormalExits
    if (previous.lastExit === 'running') {
      start.previousExit = 'abnormal'
      start.consecutiveAbnormalExits += 1
    } else if (previous.lastExit === 'clean') {
      start.previousExit = 'clean'
      start.consecutiveAbnormalExits = 0
    } else {
      start.previousExit = 'none'
      start.consecutiveAbnormalExits = 0
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`read previous lifespan state: ${error instanceof Error ? error.message : error}`)
    }
  }

  const runId = randomBytes(16).toString('hex')
  const state: LifespanState = {
    schema: LIFESPAN_SCHEMA,
    runId,
    startedAt: start.startedAt,
    lastStartedAt: start.previousStartedAt,
    lastExit: 'running',
    lastCleanExitAt: start.lastCleanExitAt,
    consecutiveAbnormalExits: start.consecutiveAbnormalExits,
    pid,
    updatedAt: start.startedAt,
  }
  await writeJSONAtomically(path, state)
  return { start, handle: { runId } }
}

export async function markCleanExit(root: string, handle: LifespanHandle): Promise<void> {
  if (!handle?.runId) throw new Error('lifespan handle is empty')
  root = await secureRoot(root)
  const path = lifespanPath(root)
  const state = await readLifespanStateFile(path)
  if (state.lastExit !== 'running' || state.runId !== handle.runId) {
    throw new Error('lifespan marker belongs to a different run')
  }
  const now = new Date().toISOString()
  state.lastExit = 'clean'
  state.lastCleanExitAt = now
  state.consecutiveAbnormalExits = 0
  state.updatedAt = now
  await writeJSONAtomically(path, state)
}

export async function readLifespanState(root: string): Promise<LifespanState> {
  root = await secureRoot(root)
  return readLifespanStateFile(lifespanPath(root))
}

async function readLifespanStateFile(path: string): Promise<LifespanState> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${LIFESPAN_FILE} must be a regular file`)
  }
  if (info.size > MAX_LIFESPAN_BYTES) {
    throw new Error(`${LIFESPAN_FILE} is larger than ${MAX_LIFESPAN_BYTES} bytes`)
  }
  const raw = await readFile(path, 'utf8')
  const state = JSON.parse(raw) as LifespanState
  if (state.schema !== LIFESPAN_SCHEMA) {
    throw new Error(`unsupported lifespan schema ${JSON.stringify(state.schema)}`)
  }
  if (state.lastExit !== 'clean' && state.lastExit !== 'running') {
    throw new Error(`invalid lifespan exit ${JSON.stringify(state.lastExit)}`)
  }
  if (state.consecutiveAbnormalExits < 0) {
    throw new Error(`invalid negative abnormal-exit count in ${LIFESPAN_FILE}`)
  }
  return state
}
