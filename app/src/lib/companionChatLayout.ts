export const COMPANION_CHAT_TIME_GAP_MS = 5 * 60 * 1000

export function companionChatTimestampMs(value: string | undefined): number {
  if (!value) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

export function formatCompanionChatStamp(
  value: string | undefined,
  _locale?: 'zh' | 'en',
): string {
  const ms = companionChatTimestampMs(value)
  if (!ms) return ''
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms))
}

export function companionChatIsUser(role?: string) {
  return role === 'user'
}

export function companionChatIsBubble(role?: string) {
  return role === 'user' || role === 'assistant'
}

export function companionChatShowsTimeDivider(currentMs: number, previousMs: number) {
  if (!currentMs) return false
  if (!previousMs) return true
  return Math.abs(currentMs - previousMs) >= COMPANION_CHAT_TIME_GAP_MS
}

/**
 * Which side of the conversation a row belongs to. Transcript entries that are
 * not messages (model switches, thinking level changes) carry no role but still
 * form one block in the log.
 */
export function companionChatSide(role?: string) {
  return role === 'user' || role === 'assistant' ? role : 'note'
}

function companionChatRowsShareRun(
  one: { role?: string; ms: number },
  other: { role?: string; ms: number },
) {
  if (!one.ms || !other.ms) return false
  if (companionChatSide(one.role) !== companionChatSide(other.role)) return false
  return Math.abs(one.ms - other.ms) < COMPANION_CHAT_TIME_GAP_MS
}

/**
 * Two adjacent rows belong to one run when they come from the same side of the
 * conversation and were sent close together. Runs decide row spacing and which
 * outer corners stay stacked instead of fully rounded.
 */
export function companionChatContinuesRun(
  current: { role?: string; timestamp?: string },
  previous?: { role?: string; timestamp?: string },
) {
  if (!previous) return false
  return companionChatRowsShareRun(
    { role: current.role, ms: companionChatTimestampMs(current.timestamp) },
    { role: previous.role, ms: companionChatTimestampMs(previous.timestamp) },
  )
}

/** The last row of a run keeps the full outer corner and the stamp. */
export function companionChatEndsRun(input: {
  currentMs: number
  nextMs: number
  currentRole?: string
  nextRole?: string
  isLast: boolean
}) {
  if (input.isLast) return true
  return !companionChatRowsShareRun(
    { role: input.currentRole, ms: input.currentMs },
    { role: input.nextRole, ms: input.nextMs },
  )
}

export function companionChatShowsTimeCaption(input: {
  currentMs: number
  nextMs: number
  currentRole?: string
  nextRole?: string
  showDivider: boolean
  isLast: boolean
}) {
  if (!input.currentMs || input.showDivider) return false
  return companionChatEndsRun(input)
}
