export const COMPOSER_HISTORY_LIMIT = 80

export function captureComposerSnapshot(
  history: string[],
  current: string,
  limit = COMPOSER_HISTORY_LIMIT,
): { history: string[]; future: string[] } {
  if (history.at(-1) === current) return { history, future: [] }
  const next = [...history, current]
  if (next.length > limit) next.splice(0, next.length - limit)
  return { history: next, future: [] }
}

export function undoComposerHistory(
  history: string[],
  future: string[],
  current: string,
): { history: string[]; future: string[]; html: string } | null {
  if (!history.length) return null
  return {
    history: history.slice(0, -1),
    future: [...future, current],
    html: history[history.length - 1],
  }
}

export function redoComposerHistory(
  history: string[],
  future: string[],
  current: string,
): { history: string[]; future: string[]; html: string } | null {
  if (!future.length) return null
  return {
    history: [...history, current],
    future: future.slice(0, -1),
    html: future[future.length - 1],
  }
}

export function isComposerHistoryKey(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (event.altKey || event.isComposing) return null
  const key = event.key.toLowerCase()
  const shortcut = event.metaKey || event.ctrlKey
  if (!shortcut) return null
  if (key === 'z' && event.shiftKey) return 'redo'
  if (key === 'z') return 'undo'
  if (key === 'y' && !event.metaKey) return 'redo'
  return null
}
