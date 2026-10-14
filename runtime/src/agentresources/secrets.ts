import {
  deleteSecretIfPresent,
  isSecretNotFound,
  type SecretStore,
} from '../config/secret-store.ts'

export type SecretKeeper = {
  put(account: string, secret: string): Promise<void>
  delete(account: string): Promise<void>
  lookup(account: string): Promise<string>
}

export const MANAGED_SECRET_PREFIX = 'mcp.user.'

export function validManagedSecretAccount(account: string): boolean {
  const value = account.trim()
  if (!value.startsWith(MANAGED_SECRET_PREFIX) || value.includes('..') || value.length > 180) {
    return false
  }
  return !hasControl(value)
}

export function hasControl(value: string): boolean {
  return /\p{Cc}|\p{Cf}/u.test(value)
}

export function secretAccount(server: string, kind: string, key: string): string {
  return `${MANAGED_SECRET_PREFIX}${server}.${kind}.${key.trim()}`
}

export class MemorySecretKeeper implements SecretKeeper {
  private readonly values = new Map<string, string>()

  async put(account: string, secret: string): Promise<void> {
    if (!validManagedSecretAccount(account) || !secret.trim()) {
      throw new Error('managed secret is incomplete')
    }
    this.values.set(account, secret)
  }

  async delete(account: string): Promise<void> {
    if (!validManagedSecretAccount(account)) {
      throw new Error('managed secret account is not allowed')
    }
    this.values.delete(account)
  }

  async lookup(account: string): Promise<string> {
    if (!validManagedSecretAccount(account)) {
      throw new Error('managed secret account is not allowed')
    }
    return this.values.get(account) ?? ''
  }
}

export class SettingsSecretKeeper implements SecretKeeper {
  private readonly store: SecretStore

  constructor(store: SecretStore) {
    this.store = store
  }

  async put(account: string, secret: string): Promise<void> {
    if (!validManagedSecretAccount(account) || !secret.trim()) {
      throw new Error('managed secret is incomplete')
    }
    await this.store.set(account, secret)
  }

  async delete(account: string): Promise<void> {
    if (!validManagedSecretAccount(account)) {
      throw new Error('managed secret account is not allowed')
    }
    await deleteSecretIfPresent(this.store, account)
  }

  async lookup(account: string): Promise<string> {
    if (!validManagedSecretAccount(account)) {
      throw new Error('managed secret account is not allowed')
    }
    try {
      return await this.store.get(account)
    } catch (error) {
      if (isSecretNotFound(error)) return ''
      throw error
    }
  }
}

export class HelperSecretKeeper implements SecretKeeper {
  private readonly invoke: (method: string, args: unknown[]) => Promise<unknown>

  constructor(invoke: (method: string, args: unknown[]) => Promise<unknown>) {
    this.invoke = invoke
  }

  async put(account: string, secret: string): Promise<void> {
    if (!validManagedSecretAccount(account) || !secret.trim()) {
      throw new Error('managed secret is incomplete')
    }
    await this.invoke('PutManagedSecret', [account, secret])
  }

  async delete(account: string): Promise<void> {
    if (!validManagedSecretAccount(account)) {
      throw new Error('managed secret account is not allowed')
    }
    await this.invoke('DeleteManagedSecret', [account])
  }

  async lookup(account: string): Promise<string> {
    if (!validManagedSecretAccount(account)) {
      throw new Error('managed secret account is not allowed')
    }
    return String(await this.invoke('LookupManagedSecret', [account]) ?? '')
  }
}

export class SqliteSecretKeeper implements SecretKeeper {
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  async put(account: string, secret: string): Promise<void> {
    if (!validManagedSecretAccount(account) || !secret.trim()) {
      throw new Error('managed secret is incomplete')
    }
    await this.withDatabase(async (run) => {
      run(
        `INSERT INTO credentials(account, secret, updated_at)
         VALUES(?, ?, ?)
         ON CONFLICT(account) DO UPDATE SET
           secret = excluded.secret,
           updated_at = excluded.updated_at`,
        [account, secret, new Date().toISOString()],
      )
    })
  }

  async delete(account: string): Promise<void> {
    if (!validManagedSecretAccount(account)) {
      throw new Error('managed secret account is not allowed')
    }
    await this.withDatabase(async (run) => {
      run('DELETE FROM credentials WHERE account = ?', [account])
    })
  }

  async lookup(account: string): Promise<string> {
    if (!validManagedSecretAccount(account)) {
      throw new Error('managed secret account is not allowed')
    }
    return this.withDatabase(async (run) => {
      const row = run('SELECT secret FROM credentials WHERE account = ?', [account])[0]
      return row ? String(row.secret ?? '') : ''
    })
  }

  private async withDatabase<T>(
    fn: (run: (sql: string, params?: unknown[]) => Array<Record<string, unknown>>) => Promise<T>,
  ): Promise<T> {
    const { mkdir, chmod } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const { DatabaseSync } = await import('node:sqlite')
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700).catch(() => undefined)
    const database = new DatabaseSync(this.path)
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS credentials (
          account TEXT PRIMARY KEY,
          secret TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `)
      const run = (sql: string, params: unknown[] = []) => {
        const statement = database.prepare(sql)
        if (/^\s*select/i.test(sql)) {
          return statement.all(...params) as Array<Record<string, unknown>>
        }
        statement.run(...params)
        return []
      }
      return await fn(run)
    } finally {
      database.close()
    }
  }
}
