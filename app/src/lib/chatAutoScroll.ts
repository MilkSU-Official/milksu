export const chatAutoScrollThreshold = 8

export function shouldFollowChatOutput(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = chatAutoScrollThreshold,
): boolean {
  const remaining = Math.max(0, scrollHeight - scrollTop - clientHeight)
  return remaining <= Math.max(0, threshold)
}

export function nextChatAutoScrollPinned(
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  if (scrollTop < previousScrollTop) return false
  return shouldFollowChatOutput(scrollTop, clientHeight, scrollHeight)
}
