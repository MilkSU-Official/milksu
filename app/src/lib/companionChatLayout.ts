export const COMPANION_CHAT_TIME_GAP_MS = 5 * 60 * 1000

export function companionChatTimestampMs(value: string | undefined): number {
  if (!value) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

export function formatCompanionChatStamp(
  value: string | undefined,
  locale: 'zh' | 'en',
  now = Date.now(),
): string {
  const ms = companionChatTimestampMs(value)
  if (!ms) return ''
  const date = new Date(ms)
  const tag = locale === 'en' ? 'en-US' : 'zh-CN'
  const time = new Intl.DateTimeFormat(tag, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (ms >= start.getTime()) return time
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'short' }).format(date)
  const day = new Intl.DateTimeFormat(tag, { month: 'numeric', day: 'numeric' }).format(date)
  return locale === 'en' ? `${weekday}, ${day} ${time}` : `${day} ${weekday} ${time}`
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

export function companionChatShowsTimeCaption(input: {
  currentMs: number
  nextMs: number
  currentRole?: string
  nextRole?: string
  showDivider: boolean
  isLast: boolean
}) {
  if (!input.currentMs || input.showDivider) return false
  if (input.isLast) return true
  if (input.nextRole !== input.currentRole) return true
  if (!input.nextMs) return true
  return Math.abs(input.nextMs - input.currentMs) >= COMPANION_CHAT_TIME_GAP_MS
}
