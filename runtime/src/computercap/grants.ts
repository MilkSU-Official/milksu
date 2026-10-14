import { chmod, mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { writeJSONAtomically } from '../appdata/fs.ts'
import { type Grant, type Target } from './types.ts'
import { validConversationId, validGrantedTarget } from './policy.ts'

export class GrantStore {
  private readonly directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  private path(conversationId: string): string {
    return join(this.directory, `${conversationId}.json`)
  }

  async load(conversationId: string): Promise<{ grant: Grant; exists: boolean }> {
    if (!this.directory || this.directory === '.') {
      return { grant: emptyGrant(conversationId), exists: false }
    }
    if (!validConversationId(conversationId)) {
      throw new Error('invalid Coding conversation id')
    }
    let raw: string
    try {
      raw = await readFile(this.path(conversationId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { grant: emptyGrant(conversationId), exists: false }
      }
      throw new Error(`read Computer Use task authorization: ${error instanceof Error ? error.message : error}`)
    }
    let grant: Grant
    try {
      grant = JSON.parse(raw) as Grant
    } catch {
      throw Object.assign(new Error('decode Computer Use task authorization'), { exists: true })
    }
    if (grant.conversationId !== conversationId || !validGrantedTarget(grant.target ?? emptyTarget())) {
      throw Object.assign(new Error('Computer Use task authorization is invalid'), { exists: true })
    }
    return { grant, exists: true }
  }

  async save(conversationId: string, target: Target): Promise<void> {
    if (!this.directory || this.directory === '.') return
    if (!validConversationId(conversationId)) throw new Error('invalid Coding conversation id')
    if (!validGrantedTarget(target)) throw new Error('invalid Computer Use target authorization')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      await chmod(this.directory, 0o700)
    } catch (error) {
      if (process.platform !== 'win32') {
        throw new Error(`protect Computer Use authorization directory: ${error instanceof Error ? error.message : error}`)
      }
    }
    await writeJSONAtomically(this.path(conversationId), {
      conversationId,
      target: {
        name: target.name,
        bundleId: target.bundleId,
        pid: target.pid,
        windowId: target.windowId,
        windowTitle: target.windowTitle,
        executablePath: target.executablePath,
      },
      grantedAt: new Date().toISOString(),
    } satisfies Grant)
  }

  async delete(conversationId: string): Promise<void> {
    if (!this.directory || this.directory === '.') return
    if (!validConversationId(conversationId)) throw new Error('invalid Coding conversation id')
    try {
      await unlink(this.path(conversationId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`revoke Computer Use task authorization: ${error instanceof Error ? error.message : error}`)
      }
    }
  }
}

function emptyTarget(): Target {
  return { name: '', bundleId: '', pid: 0, windowId: 0 }
}

function emptyGrant(conversationId: string): Grant {
  return { conversationId, target: emptyTarget(), grantedAt: '' }
}

export async function loadGrantOrThrow(
  store: GrantStore,
  conversationId: string,
): Promise<{ grant: Grant; exists: boolean; error?: Error }> {
  try {
    return await store.load(conversationId)
  } catch (error) {
    const exists = Boolean((error as { exists?: boolean }).exists) || true
    return {
      grant: emptyGrant(conversationId),
      exists,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
