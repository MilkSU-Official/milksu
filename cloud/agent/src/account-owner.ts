/**
 * Cloud session ownership is bound to a stable MilkSU account subject,
 * not the rotating access-token hash. Token refresh must not orphan sessions.
 *
 * Subject preference: account.id (when the accounts API provides it), else
 * github:<githubLogin>. The stored owner key is SHA-256(subject).
 */

export type AccountOwner = {
  /** Stable account subject (id or github:login). Never the access token. */
  subject: string
  /** Hex SHA-256 of subject; stored in cloud_sessions.owner_token_hash. */
  ownerKey: string
}

export function resolveAccountSubject(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const account = (payload as { account?: unknown }).account
  if (!account || typeof account !== 'object') return null
  const row = account as { id?: unknown; githubLogin?: unknown }
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  if (id) return `id:${id}`
  const login = typeof row.githubLogin === 'string' ? row.githubLogin.trim() : ''
  if (login) return `github:${login}`
  return null
}

export async function hashOwnerSubject(subject: string): Promise<string> {
  const data = new TextEncoder().encode(subject)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function accountOwnerFromPayload(payload: unknown): Promise<AccountOwner | null> {
  const subject = resolveAccountSubject(payload)
  if (!subject) return null
  return {
    subject,
    ownerKey: await hashOwnerSubject(subject),
  }
}
