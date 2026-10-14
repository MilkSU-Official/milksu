import { chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SECRET_NOT_FOUND = 'credential not found'

const CREDENTIALS_V1_NAME = 'create local credential store'

export class SecretNotFoundError extends Error {
  constructor() {
    super(SECRET_NOT_FOUND)
    this.name = 'SecretNotFoundError'
  }
}

export function isSecretNotFound(error: unknown): boolean {
  if (error instanceof SecretNotFoundError) return true
  return error instanceof Error && error.message.includes(SECRET_NOT_FOUND)
}

export type SecretStore = {
  get(account: string): Promise<string>
  set(account: string, secret: string): Promise<void>
  delete(account: string): Promise<void>
}

function validateSecretInput(value: string): void {
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error('must not contain NUL or newline characters')
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  async get(account: string): Promise<string> {
    const value = this.values.get(account)
    if (value === undefined) throw new SecretNotFoundError()
    return value
  }

  async set(account: string, secret: string): Promise<void> {
    validateSecretInput(secret)
    if (!secret) throw new Error('credential must not be empty')
    this.values.set(account, secret)
  }

  async delete(account: string): Promise<void> {
    if (!this.values.has(account)) throw new SecretNotFoundError()
    this.values.delete(account)
  }
}

export class SqliteSecretStore implements SecretStore {
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  static async open(path: string): Promise<SqliteSecretStore> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    try {
      await chmod(dirname(path), 0o700)
    } catch {
      // Windows cannot chmod directories the same way.
    }
    const store = new SqliteSecretStore(path)
    store.migrate()
    try {
      await chmod(path, 0o600)
    } catch {
      // Windows file mode is best-effort.
    }
    return store
  }

  async get(account: string): Promise<string> {
    const db = this.open()
    try {
      const row = db.prepare('SELECT secret FROM credentials WHERE account = ?').get(account) as
        | { secret?: string }
        | undefined
      if (!row || typeof row.secret !== 'string') throw new SecretNotFoundError()
      return row.secret
    } finally {
      db.close()
    }
  }

  async set(account: string, secret: string): Promise<void> {
    validateSecretInput(secret)
    if (!secret) throw new Error('credential must not be empty')
    const db = this.open()
    try {
      db.prepare(`
        INSERT INTO credentials(account, secret, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(account) DO UPDATE SET
          secret = excluded.secret,
          updated_at = excluded.updated_at
      `).run(account, secret, new Date().toISOString())
    } finally {
      db.close()
    }
  }

  async delete(account: string): Promise<void> {
    const db = this.open()
    try {
      const result = db.prepare('DELETE FROM credentials WHERE account = ?').run(account)
      if (Number(result.changes ?? 0) === 0) throw new SecretNotFoundError()
    } finally {
      db.close()
    }
  }

  private open(): DatabaseSync {
    return new DatabaseSync(this.path)
  }

  private migrate(): void {
    const db = this.open()
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS credentials (
          account TEXT PRIMARY KEY,
          secret TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)
      const recorded = db.prepare(
        'SELECT version, name FROM schema_migrations WHERE version = 1',
      ).get() as { version?: number; name?: string } | undefined
      if (!recorded) {
        db.prepare(
          'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
        ).run(1, CREDENTIALS_V1_NAME, new Date().toISOString())
      }
    } finally {
      db.close()
    }
  }
}

export class HelperSecretStore implements SecretStore {
  private readonly invoke: (method: string, args: unknown[]) => Promise<unknown>

  constructor(invoke: (method: string, args: unknown[]) => Promise<unknown>) {
    this.invoke = invoke
  }

  async get(account: string): Promise<string> {
    const value = await this.invoke('GetPlatformSecret', [account])
    if (typeof value !== 'string' || value === '') throw new SecretNotFoundError()
    return value
  }

  async set(account: string, secret: string): Promise<void> {
    validateSecretInput(secret)
    if (!secret) throw new Error('credential must not be empty')
    await this.invoke('SetPlatformSecret', [account, secret])
  }

  async delete(account: string): Promise<void> {
    await this.invoke('DeletePlatformSecret', [account])
  }
}

export async function deleteSecretIfPresent(store: SecretStore, account: string): Promise<void> {
  try {
    await store.delete(account)
  } catch (error) {
    if (!isSecretNotFound(error)) throw error
  }
}

export function usesDarwinKeychainHelper(platform = process.platform): boolean {
  return platform === 'darwin'
}
