export type AppToastTone = 'default' | 'destructive'

export type AppToast = {
  id: string
  title: string
  tone: AppToastTone
  /** Set while the toast plays its exit before it is removed from the list. */
  leaving?: boolean
}

type Listener = (toasts: AppToast[]) => void

/** Must stay in step with the toast transition in `ui/toaster.tsx`. */
export const TOAST_EXIT_MS = 180

type ToastTimers = { dismiss?: ReturnType<typeof setTimeout>; exit?: ReturnType<typeof setTimeout> }

const toasts: AppToast[] = []
const listeners = new Set<Listener>()
const timers = new Map<string, ToastTimers>()

function timersFor(id: string) {
  const existing = timers.get(id)
  if (existing) return existing
  const created: ToastTimers = {}
  timers.set(id, created)
  return created
}

function emit() {
  const snapshot = toasts.slice()
  for (const listener of listeners) listener(snapshot)
}

export function redactToastText(value: string) {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-…')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\b/g, '…')
    .replace(/\b((?:api[_-]?key|token|secret|bearer|authorization)\s*[:=]\s*)\S+/gi, '$1…')
    .trim()
}

export function toast(title: string, options?: { tone?: AppToastTone; durationMs?: number }) {
  const text = redactToastText(String(title ?? ''))
  if (!text) return ''
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  toasts.push({ id, title: text, tone: options?.tone ?? 'default' })
  if (toasts.length > 3) removeToast(toasts[0].id)
  const duration = options?.durationMs ?? 4000
  if (duration > 0) {
    timersFor(id).dismiss = setTimeout(() => dismissToast(id), duration)
  }
  emit()
  return id
}

export function toastError(reason: unknown, fallback: string) {
  const message = reason instanceof Error && reason.message.trim() ? reason.message : fallback
  return toast(message, { tone: 'destructive' })
}

/**
 * Start the toast's exit. The row stays in the list, marked as leaving, until
 * the transition finishes, so a dismissed toast leaves the same way it arrived
 * instead of blinking out.
 */
export function dismissToast(id: string) {
  const entry = timers.get(id)
  if (entry?.dismiss) {
    clearTimeout(entry.dismiss)
    entry.dismiss = undefined
  }
  const item = toasts.find(candidate => candidate.id === id)
  if (!item || item.leaving) return
  item.leaving = true
  emit()
  timersFor(id).exit = setTimeout(() => removeToast(id), TOAST_EXIT_MS)
}

function removeToast(id: string) {
  const entry = timers.get(id)
  if (entry?.dismiss) clearTimeout(entry.dismiss)
  if (entry?.exit) clearTimeout(entry.exit)
  timers.delete(id)
  const index = toasts.findIndex(item => item.id === id)
  if (index < 0) return
  toasts.splice(index, 1)
  emit()
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener)
  listener(toasts.slice())
  return () => {
    listeners.delete(listener)
  }
}

export function resetToastsForTests() {
  for (const entry of timers.values()) {
    if (entry.dismiss) clearTimeout(entry.dismiss)
    if (entry.exit) clearTimeout(entry.exit)
  }
  timers.clear()
  toasts.splice(0, toasts.length)
  emit()
}
