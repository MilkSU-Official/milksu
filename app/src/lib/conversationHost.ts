/** Where Coding turns execute for this conversation. */
export type ConversationHost = 'local' | 'cloud'

export function normalizeConversationHost(value: unknown): ConversationHost {
  return value === 'cloud' ? 'cloud' : 'local'
}

/**
 * Empty conversations may flip host freely. Once a turn has started, UI must
 * call migrate (copy → verify → delete source) instead of flipping in place.
 */
export function canFlipHostWithoutMigrate(messageCount: number): boolean {
  return !Number.isFinite(messageCount) || messageCount <= 0
}
