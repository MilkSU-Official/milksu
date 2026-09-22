/** How far a transcript edge fades in. Matches `--chat-edge-fade` on the scroll frame. */
export const CHAT_EDGE_FADE_SPAN_PX = 32

export function parseFadeSpan(raw: string, rootFontSize = 16): number {
  const text = raw.trim()
  const value = Number.parseFloat(text)
  if (!Number.isFinite(value) || value <= 0) return CHAT_EDGE_FADE_SPAN_PX
  if (text.endsWith('rem')) return value * (rootFontSize > 0 ? rootFontSize : 16)
  return value
}

/**
 * 0 when that edge has nothing left to scroll, 1 once the overflow reaches the fade span.
 * The resting first and last lines stay sharp; the band only appears as text meets the chrome.
 */
export function chatEdgeFadeAmounts(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  span = CHAT_EDGE_FADE_SPAN_PX,
): { top: number; bottom: number } {
  const distance = span > 0 ? span : CHAT_EDGE_FADE_SPAN_PX
  const topOverflow = Math.max(0, metrics.scrollTop)
  const bottomOverflow = Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight)
  return {
    top: Math.min(1, topOverflow / distance),
    bottom: Math.min(1, bottomOverflow / distance),
  }
}

export function applyChatEdgeFade(frame: HTMLElement, amounts: { top: number; bottom: number }) {
  frame.style.setProperty('--chat-edge-top', amounts.top.toFixed(3))
  frame.style.setProperty('--chat-edge-bottom', amounts.bottom.toFixed(3))
}

export function syncChatEdgeFade(scrollport: HTMLElement | null) {
  const frame = scrollport?.parentElement
  if (!scrollport || !frame || typeof getComputedStyle !== 'function') return
  const declared = getComputedStyle(frame).getPropertyValue('--chat-edge-fade')
  const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  const span = parseFadeSpan(declared, Number.isFinite(rootSize) ? rootSize : 16)
  applyChatEdgeFade(frame, chatEdgeFadeAmounts({
    scrollTop: scrollport.scrollTop,
    scrollHeight: scrollport.scrollHeight,
    clientHeight: scrollport.clientHeight,
  }, span))
}
