import {
  SECRET_NOT_FOUND,
  SecretNotFoundError,
  type SecretStore,
} from '../config/secret-store.ts'
import { loadNativeAddon } from './addon.ts'

export const KEYCHAIN_SERVICE = 'dev.milksu.app.credentials'

const UNAVAILABLE = 'macOS Keychain native module is unavailable'
let fallbackLogged = false

export function usesDarwinKeychain(platform = process.platform): boolean {
  return platform === 'darwin'
}

export function logDarwinKeychainFallback(): void {
  if (fallbackLogged) return
  fallbackLogged = true
  if (!String(process.env.MILKSU_RESOURCES ?? '').trim()) return
  process.stderr.write('macos-keychain.node is unavailable; Darwin credentials use sqlite\n')
}

type KeychainAddon = {
  get(account: string): string
  set(account: string, secret: string): void
  delete(account: string): void
}

let cached: KeychainAddon | null | undefined

function validateSecretInput(value: string): void {
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error('must not contain NUL or newline characters')
  }
}

function keychainAddon(): KeychainAddon | null {
  if (cached !== undefined) return cached
  const loaded = loadNativeAddon('macos-keychain') as KeychainAddon | null
  if (
    !loaded
    || typeof loaded.get !== 'function'
    || typeof loaded.set !== 'function'
    || typeof loaded.delete !== 'function'
  ) {
    cached = null
    return null
  }
  cached = loaded
  return cached
}

function mapKeychainError(error: unknown): never {
  if (error instanceof SecretNotFoundError) throw error
  if (error instanceof Error && error.message.includes(SECRET_NOT_FOUND)) {
    throw new SecretNotFoundError()
  }
  throw error
}

export class DarwinKeychainSecretStore implements SecretStore {
  available(): boolean {
    return keychainAddon() != null
  }

  async get(account: string): Promise<string> {
    const addon = keychainAddon()
    if (!addon) throw new Error(UNAVAILABLE)
    try {
      const value = addon.get(account)
      if (typeof value !== 'string') throw new SecretNotFoundError()
      return value
    } catch (error) {
      mapKeychainError(error)
    }
  }

  async set(account: string, secret: string): Promise<void> {
    const addon = keychainAddon()
    if (!addon) throw new Error(UNAVAILABLE)
    validateSecretInput(secret)
    if (!secret) throw new Error('credential must not be empty')
    try {
      addon.set(account, secret)
    } catch (error) {
      mapKeychainError(error)
    }
  }

  async delete(account: string): Promise<void> {
    const addon = keychainAddon()
    if (!addon) throw new Error(UNAVAILABLE)
    try {
      addon.delete(account)
    } catch (error) {
      mapKeychainError(error)
    }
  }
}
