export const UI_FONT_SIZE_MIN = 11
export const UI_FONT_SIZE_MAX = 18
export const FACTORY_CONVERSATION_FONT_SIZE = '14'

export type UiFontSize = string

export const CONVERSATION_FONT_SIZE_STORAGE_KEY = 'milksu.conversation-font-size'
export const UI_FONT_SYNC_CHANNEL = 'milksu.ui-font-sync'

export function normalizeUiFontSize(value: unknown): UiFontSize {
  const raw = String(value ?? '').trim().replace(/px$/i, '').trim()
  const parsed = Number.parseInt(raw, 10)
  if (Number.isInteger(parsed) && parsed >= UI_FONT_SIZE_MIN && parsed <= UI_FONT_SIZE_MAX) {
    return String(parsed)
  }
  return FACTORY_CONVERSATION_FONT_SIZE
}

function writeStored(value: string) {
  try {
    window.localStorage.setItem(CONVERSATION_FONT_SIZE_STORAGE_KEY, value)
  } catch {
    /* private mode or blocked storage */
  }
}

export function readStoredConversationFontSize(): UiFontSize {
  try {
    return normalizeUiFontSize(window.localStorage.getItem(CONVERSATION_FONT_SIZE_STORAGE_KEY))
  } catch {
    return FACTORY_CONVERSATION_FONT_SIZE
  }
}

export function applyConversationFontSize(
  value: unknown,
  options: { sync?: boolean } = {},
): UiFontSize {
  const size = normalizeUiFontSize(value)
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--conversation-font-size', `${size}px`)
  }
  writeStored(size)
  if (options.sync !== false) {
    try {
      const channel = new BroadcastChannel(UI_FONT_SYNC_CHANNEL)
      channel.postMessage({ conversationFontSize: size })
      channel.close()
    } catch {
      // BroadcastChannel is unavailable in some test and embedded renderers.
    }
  }
  return size
}

export function subscribeConversationFontSizeSync(onChange: (size: UiFontSize) => void) {
  if (typeof window === 'undefined') return () => {}
  const apply = (value: unknown) => {
    onChange(normalizeUiFontSize(value))
  }
  let channel: BroadcastChannel | undefined
  try {
    channel = new BroadcastChannel(UI_FONT_SYNC_CHANNEL)
    channel.onmessage = event => {
      apply(event.data?.conversationFontSize)
    }
  } catch {
    channel = undefined
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CONVERSATION_FONT_SIZE_STORAGE_KEY) return
    apply(readStoredConversationFontSize())
  }
  window.addEventListener('storage', onStorage)
  return () => {
    channel?.close()
    window.removeEventListener('storage', onStorage)
  }
}
