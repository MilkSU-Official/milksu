import { companionMissingApiKey, companionSidecarDown } from '@/lib/companionUserError'

export const COMPANION_COMPLETE_HOLD_MS = 2800
export const COMPANION_PET_DRAG_THRESHOLD_PX = 4
/** Matches `--motion-base`. Holds the speak bubble while it eases out. */
export const COMPANION_PET_BUBBLE_LEAVE_MS = 180
/** Matches `--motion-slow` and the shell chat iris. Phone opens and closes on this beat. */
export const COMPANION_FORM_MS = 260

export function companionPrefersUiMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: no-preference)').matches
}

export function companionPetDragMoved(
  dx: number,
  dy: number,
  threshold = COMPANION_PET_DRAG_THRESHOLD_PX,
) {
  return (dx * dx) + (dy * dy) >= (threshold * threshold)
}

export type CompanionPetMotion = 'idle' | 'talk' | 'think' | 'decide' | 'complete'

export type CompanionPetSprite = 'idle' | 'talk' | 'decide' | 'think' | 'complete'

export function resolveCompanionPetMotion(input: {
  confirm: boolean
  error: boolean
  streaming: boolean
  busy: boolean
  complete: boolean
}): CompanionPetMotion {
  if (input.confirm || input.error) return 'decide'
  if (input.streaming) return 'talk'
  if (input.busy) return 'think'
  if (input.complete) return 'complete'
  return 'idle'
}

export function companionPetSprite(
  motion: CompanionPetMotion,
  frames?: { think?: boolean; complete?: boolean },
): CompanionPetSprite {
  if (motion === 'decide') return 'decide'
  if (motion === 'talk') return 'talk'
  if (motion === 'complete') return frames?.complete ? 'complete' : 'talk'
  if (motion === 'think') return frames?.think ? 'think' : 'idle'
  return 'idle'
}

export type CompanionIslandKind = 'none' | 'think' | 'confirm' | 'error' | 'complete'

/** Phone island. Decide, think, and complete fill the capsule. The think timer stays up while the reply streams. Idle keeps the resting capsule. */
export function resolveCompanionIsland(input: {
  confirm: boolean
  error: boolean
  streaming: boolean
  busy: boolean
  complete: boolean
}): CompanionIslandKind {
  const motion = resolveCompanionPetMotion(input)
  if (motion === 'think' || motion === 'talk') return 'think'
  if (motion === 'decide') return input.confirm ? 'confirm' : 'error'
  if (motion === 'complete') return 'complete'
  return 'none'
}

/** Elapsed think time. Under an hour this is `m:ss` (`0:12`). Minutes keep counting past 59. */
export function formatCompanionThinkElapsed(elapsedMs: number): string {
  const safe = Number.isFinite(elapsedMs) ? elapsedMs : 0
  const totalSeconds = Math.max(0, Math.floor(safe / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Think clock for one turn.
 * Starts on think, keeps running through talk and a still-busy confirm,
 * and clears when the turn ends (complete, idle, or an error that dropped busy).
 */
export function stepCompanionThinkClock(
  startedAt: number | null,
  motion: CompanionPetMotion,
  now: number,
  busy = true,
): number | null {
  if (motion === 'idle' || motion === 'complete') return null
  if (motion === 'decide' && !busy) return null
  if (motion === 'think') return startedAt ?? now
  return startedAt
}

/** Hat bang / decide bubble. Missing key and a down sidecar stay quiet. */
export function companionPetShowsError(error: string): boolean {
  const text = error.trim()
  return Boolean(text) && !companionMissingApiKey(text) && !companionSidecarDown(text)
}

export function companionAttentionText(input: {
  confirm: { action: string; text: string; targetTitle: string } | null
  error: string
  t: (zh: string, en: string) => string
}): string {
  if (input.confirm) {
    if (input.confirm.action === 'stop') {
      return input.t('有一条命令在等你确认', 'A command is waiting for your confirmation')
    }
    if (input.confirm.action === 'quit') {
      return input.t('退出 MilkSU 需要你确认', 'Quitting MilkSU needs your confirmation')
    }
    if (input.confirm.action === 'relaunch') {
      return input.t('重启 MilkSU 需要你确认', 'Relaunching MilkSU needs your confirmation')
    }
    if (input.confirm.action === 'patch_settings') {
      return input.t('有一项设置更改在等你确认', 'A settings change is waiting for your confirmation')
    }
    if (input.confirm.action === 'speak_many') {
      return input.t('有一批转达在等你确认', 'A batch relay is waiting for your confirmation')
    }
    if (input.confirm.text.trim()) return input.confirm.text.trim()
    if (input.confirm.targetTitle.trim()) return input.confirm.targetTitle.trim()
    return input.t('这次操作需要你点头', 'This action needs your confirmation')
  }
  const error = input.error.trim()
  if (!error || companionMissingApiKey(error) || companionSidecarDown(error)) return ''
  return error
}
