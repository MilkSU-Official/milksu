import { randomBytes } from 'node:crypto'

export function stringValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

export function trimString(value: unknown): string {
  return stringValue(value).trim()
}

export function boolValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true' || value === '1'
  return false
}

export function intValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function stringSlice(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => trimString(item)).filter(Boolean)
  }
  return []
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function newPrefixedId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

export function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim()) return value
  }
  return ''
}
