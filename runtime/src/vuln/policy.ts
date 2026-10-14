import { isAbsolute, relative, sep } from 'node:path'
import { newId, runeCount } from './ids.ts'

export type ScopeTargetKind = 'origin' | 'directory' | 'socket' | 'ssh' | 'lab' | 'browser_tab'

export type ScopeTarget = {
  kind: ScopeTargetKind
  value: string
}

export type ScopeGrant = {
  id: string
  source: string
  purpose: string
  targets: ScopeTarget[]
  grantedBy: string
  createdAt: string
  expiresAt: string
  revocable: boolean
  revokedAt?: string
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export function newGrant(
  source: string,
  purpose: string,
  targets: ScopeTarget[],
  ttlMs: number,
  now = new Date(),
): ScopeGrant {
  if (ttlMs <= 0 || ttlMs > THIRTY_DAYS_MS) {
    throw new Error('scope duration must be between one nanosecond and 30 days')
  }
  const createdAt = now.toISOString().replace(/\.000Z$/, 'Z')
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString().replace(/\.000Z$/, 'Z')
  const grant: ScopeGrant = {
    id: newId('scope'),
    source: source.trim(),
    purpose: purpose.trim(),
    targets: targets.map((target) => normalizeTarget(target)),
    grantedBy: 'local-user',
    createdAt,
    expiresAt,
    revocable: true,
  }
  validateGrant(grant, now)
  return grant
}

export function validateGrant(grant: ScopeGrant, now = new Date()): void {
  if (!grant.id.startsWith('scope_') || !grant.source || !grant.purpose || grant.grantedBy !== 'local-user') {
    throw new Error('scope identity, source, purpose, and local grantor are required')
  }
  if (grant.targets.length === 0 || grant.targets.length > 16) {
    throw new Error('scope must contain between 1 and 16 exact targets')
  }
  const created = Date.parse(grant.createdAt)
  const expires = Date.parse(grant.expiresAt)
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created) {
    throw new Error('scope timestamps are invalid')
  }
  if (expires - created > THIRTY_DAYS_MS) {
    throw new Error('scope may not exceed 30 days')
  }
  if (grant.revokedAt || now.getTime() >= expires) {
    throw new Error('scope is revoked or expired')
  }
  const seen = new Set<string>()
  for (const target of grant.targets) {
    const normalized = normalizeTarget(target)
    const key = `${normalized.kind}\0${normalized.value}`
    if (seen.has(key)) throw new Error('scope contains a duplicate target')
    seen.add(key)
  }
}

export function normalizeTarget(target: ScopeTarget): ScopeTarget {
  const value = String(target.value ?? '').trim()
  if (!value || runeCount(value) > 2048) {
    throw new Error('scope target is empty or too long')
  }
  switch (target.kind) {
    case 'origin': {
      let parsed: URL
      try {
        parsed = new URL(value)
      } catch {
        throw new Error('origin target must be an http(s) URL without credentials')
      }
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) {
        throw new Error('origin target must be an http(s) URL without credentials')
      }
      const host = parsed.hostname.toLowerCase().trim()
      if (!host) throw new Error('origin target must include a host')
      let authority = host.includes(':') ? `[${host}]` : host
      if (parsed.port) {
        const portNumber = Number(parsed.port)
        if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
          throw new Error('origin target must include a valid port')
        }
        const isDefault = (parsed.protocol === 'http:' && portNumber === 80)
          || (parsed.protocol === 'https:' && portNumber === 443)
        if (!isDefault) authority = joinHostPort(host, portNumber)
      }
      return { kind: 'origin', value: `${parsed.protocol}//${authority}` }
    }
    case 'directory': {
      if (!isAbsolute(value)) {
        throw new Error('directory target must be an absolute user-selected path')
      }
      const cleaned = normalizePath(value)
      if (cleaned === sep || /^[A-Za-z]:[\\/]?$/.test(cleaned)) {
        throw new Error('filesystem root cannot be granted')
      }
      return { kind: 'directory', value: cleaned }
    }
    case 'socket':
    case 'ssh': {
      const split = splitHostPort(value)
      if (!split) throw new Error(`${target.kind} target must be an exact host:port`)
      const host = split.host.toLowerCase().trim()
      const portNumber = Number(split.port)
      if (!host || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        throw new Error(`${target.kind} target must include a valid port`)
      }
      return { kind: target.kind, value: joinHostPort(host, portNumber) }
    }
    case 'lab':
    case 'browser_tab':
      if (/[\0\r\n]/.test(value)) throw new Error('target contains control characters')
      return { kind: target.kind, value }
    default:
      throw new Error(`unsupported scope target kind ${JSON.stringify(target.kind)}`)
  }
}

function normalizePath(value: string): string {
  return value.replace(/[\\/]+/g, sep).replace(/[\\/]$/, '') || value
}

function joinHostPort(host: string, port: number): string {
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]:${port}`
  return `${host}:${port}`
}

function splitHostPort(value: string): { host: string; port: string } | undefined {
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 0 || value[end + 1] !== ':') return undefined
    return { host: value.slice(1, end), port: value.slice(end + 2) }
  }
  const index = value.lastIndexOf(':')
  if (index <= 0 || index === value.length - 1) return undefined
  if (value.indexOf(':') !== index) return undefined
  return { host: value.slice(0, index), port: value.slice(index + 1) }
}

export function pathWithin(base: string, target: string): boolean {
  const relativePath = relative(base, target)
  if (!relativePath || isAbsolute(relativePath)) return false
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`)
}
