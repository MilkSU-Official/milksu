import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const unixSocketMaxBytes = 103

export function ephemeralRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'linux') {
    const dir = String(env.XDG_RUNTIME_DIR ?? '').trim()
    if (dir) return dir
  }
  return tmpdir()
}

export function computerUseSessionRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(ephemeralRoot(env, platform), 'milksu-computer-use')
}

function unixSocketOverflowRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'linux') {
    const cache = String(env.XDG_CACHE_HOME ?? '').trim()
    if (cache) return join(cache, 'milksu-ipc')
  }
  return join(homedir(), '.cache', 'milksu-ipc')
}

function unixComputerUseSocket(root: string, sessionId: string): string {
  const suffix = sessionId.startsWith('computer_') ? sessionId.slice('computer_'.length) : sessionId
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
  for (const name of [`mcu-${suffix}.sock`, `mcu-${digest}.sock`, `${digest}.sock`]) {
    const candidate = join(root, name)
    if (Buffer.byteLength(candidate) <= unixSocketMaxBytes) return candidate
  }
  return ''
}

export function computerUseSocket(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    return `\\\\.\\pipe\\milksu-computer-use-${sessionId}`
  }
  for (const candidateRoot of [ephemeralRoot(env, platform), unixSocketOverflowRoot(env, platform)]) {
    const path = unixComputerUseSocket(candidateRoot, sessionId)
    if (path && Buffer.byteLength(path) <= unixSocketMaxBytes) return path
  }
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
  return join(unixSocketOverflowRoot(env, platform), `mcu-${digest}.sock`)
}
