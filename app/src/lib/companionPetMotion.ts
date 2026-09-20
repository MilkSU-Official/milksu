export const COMPANION_COMPLETE_HOLD_MS = 2800
export const COMPANION_PET_DRAG_THRESHOLD_PX = 4

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
