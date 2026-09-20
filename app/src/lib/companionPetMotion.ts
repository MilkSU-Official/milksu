export const COMPANION_COMPLETE_HOLD_MS = 2800

export type CompanionPetMotion = 'idle' | 'talk' | 'think' | 'decide' | 'complete'

export type CompanionPetSprite = 'idle' | 'talk' | 'decide'

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

export function companionPetSprite(motion: CompanionPetMotion): CompanionPetSprite {
  if (motion === 'decide') return 'decide'
  if (motion === 'talk' || motion === 'complete') return 'talk'
  return 'idle'
}
