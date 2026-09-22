/**
 * Desktop companion overlay state machine.
 *
 * Two exclusive forms, never on screen together:
 * - pet: the floating sprite. The window is the sprite box itself so no
 *   invisible margin can swallow clicks meant for the app underneath.
 * - phone: an iPhone-like messenger. Opening chat hides the sprite; closing
 *   chat hides the phone and brings the sprite back.
 * Main MilkSU may stay open with either form. Never a second desktop window,
 * never a full-page companion workspace.
 * A hidden sprite stays hidden until show-pet or open-chat. Showing the main
 * window, or a Dock / taskbar reveal, does not clear that.
 */

export const COMPANION_PET_WIDTH = 160
export const COMPANION_PET_HEIGHT = 160
/** Matches `.companion-pet-bubble` max-height. */
export const COMPANION_PET_BUBBLE_MAX_HEIGHT = 48
/** Room above the 160px sprite: one own-height lift plus max bubble plus a top inset. */
export const COMPANION_PET_BUBBLE_LIFT = 104
/** iPhone 17 screen is 402 × 874 pt. One step up from 288, nearest integers: 320 × 696. */
export const COMPANION_CHAT_WIDTH = 320
export const COMPANION_CHAT_HEIGHT = 696
export const COMPANION_PHONE_WIDTH = COMPANION_CHAT_WIDTH
export const COMPANION_PHONE_HEIGHT = COMPANION_CHAT_HEIGHT
export const COMPANION_UNIT_GAP = 0
// Flush to the work-area corner. The sprite body sits on the canvas bottom-right
// and the hat meets the canvas top-right, so an inset shows that crop.
export const COMPANION_UNIT_MARGIN = 0
export const COMPANION_PET_MENU_WIDTH = 176
export const COMPANION_PET_MENU_HEIGHT = 184
/** Stay above normal apps, below macOS/Windows/Linux IME, menu, and Dock. */
export const COMPANION_OVERLAY_Z_LEVEL = 'floating'
export const COMPANION_FALLBACK_WORK_AREA: CompanionOverlayWorkArea = {
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
}

export const COMPANION_OVERLAY_ACTIONS = {
  CLICK_PET: 'click-pet',
  OPEN_CHAT: 'open-chat',
  CLOSE_CHAT: 'close-chat',
  HIDE_PET: 'hide-pet',
  SHOW_PET: 'show-pet',
  SHOW_MAIN: 'show-main',
  SHOW_SETTINGS: 'show-settings',
  PARK_MAIN: 'park-main',
  REVEAL_FROM_TASKBAR: 'reveal-from-taskbar',
  ENABLE: 'enable',
  DISABLE: 'disable',
  MOVE_PET: 'move-pet',
} as const

export type CompanionOverlayAction =
  typeof COMPANION_OVERLAY_ACTIONS[keyof typeof COMPANION_OVERLAY_ACTIONS]

export interface CompanionOverlayState {
  enabled: boolean
  wayland: boolean
  petHidden: boolean
  chatOpen: boolean
  mainVisible: boolean
}

export interface CompanionOverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CompanionOverlayWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface CompanionOverlayDrag {
  moveUnit: boolean
  moveMain: false
}

export type CompanionChatSide = 'left' | 'right'

export interface CompanionUnitLayout {
  window: CompanionOverlayBounds
  pet: CompanionOverlayBounds
  chat: CompanionOverlayBounds | null
  chatSide: CompanionChatSide
  petScreen: { x: number; y: number }
  chatScreen: CompanionOverlayBounds | null
}

export type CompanionOverlayPetEffect = 'show' | 'hide' | 'destroy' | 'none'
export type CompanionOverlayChatEffect = 'show' | 'hide' | 'focus' | 'destroy' | 'none'
export type CompanionOverlayMainEffect = 'show' | 'park' | 'none'

export interface CompanionOverlayDecision {
  state: CompanionOverlayState
  petVisible: boolean
  overlayVisible: boolean
  phoneVisible: boolean
  canFloat: boolean
  effects: {
    pet: CompanionOverlayPetEffect
    chat: CompanionOverlayChatEffect
    main: CompanionOverlayMainEffect
    navigateSettings: boolean
    destroyOverlay: boolean
    drag: CompanionOverlayDrag
  }
}

const actions = new Set<string>(Object.values(COMPANION_OVERLAY_ACTIONS))

export function normalizeCompanionOverlayState(
  input: Partial<CompanionOverlayState> | null | undefined,
): CompanionOverlayState {
  const wayland = Boolean(input?.wayland)
  return {
    enabled: Boolean(input?.enabled) && !wayland,
    wayland,
    petHidden: Boolean(input?.petHidden),
    chatOpen: Boolean(input?.chatOpen),
    mainVisible: input?.mainVisible !== false,
  }
}

export function companionCanFloat(state: CompanionOverlayState) {
  return state.enabled && !state.wayland
}

export function companionOverlayVisible(state: CompanionOverlayState) {
  if (state.wayland) return state.chatOpen
  return companionCanFloat(state) && !state.petHidden
}

export type CompanionPawState = 'pet' | 'phone' | 'hidden'

/** Sidebar paw. Phone wins over hidden; opening chat from hidden clears the hide. */
export function companionPawState(input?: { chatOpen?: boolean; petHidden?: boolean } | null): CompanionPawState {
  if (input?.chatOpen) return 'phone'
  if (input?.petHidden) return 'hidden'
  return 'pet'
}

export function companionPetVisible(state: CompanionOverlayState) {
  return companionOverlayVisible(state) && !state.chatOpen && companionCanFloat(state)
}

export function companionPhoneVisible(state: CompanionOverlayState) {
  return companionOverlayVisible(state) && state.chatOpen
}

export function companionDragEffect(state: CompanionOverlayState): CompanionOverlayDrag {
  return {
    moveUnit: companionOverlayVisible(state),
    moveMain: false,
  }
}

function effectsFromTransition(
  previous: CompanionOverlayState,
  next: CompanionOverlayState,
  action: CompanionOverlayAction,
): CompanionOverlayDecision['effects'] {
  const destroyOverlay = action === COMPANION_OVERLAY_ACTIONS.DISABLE
  const previousOverlay = companionOverlayVisible(previous)
  const nextOverlay = companionOverlayVisible(next)
  let pet: CompanionOverlayPetEffect = 'none'
  if (destroyOverlay) pet = 'destroy'
  else if (nextOverlay && !previousOverlay) pet = 'show'
  else if (!nextOverlay && previousOverlay) pet = 'hide'

  let chat: CompanionOverlayChatEffect = 'none'
  if (destroyOverlay) chat = 'destroy'
  else if (next.chatOpen && !previous.chatOpen) chat = 'show'
  else if (!next.chatOpen && previous.chatOpen) chat = 'hide'
  else if (
    next.chatOpen
    && previous.chatOpen
    && action === COMPANION_OVERLAY_ACTIONS.OPEN_CHAT
  ) {
    chat = 'focus'
  }

  let main: CompanionOverlayMainEffect = 'none'
  if (
    action === COMPANION_OVERLAY_ACTIONS.SHOW_MAIN
    || action === COMPANION_OVERLAY_ACTIONS.SHOW_SETTINGS
    || action === COMPANION_OVERLAY_ACTIONS.REVEAL_FROM_TASKBAR
  ) {
    main = 'show'
  } else if (!next.mainVisible && previous.mainVisible) {
    main = 'park'
  }

  return {
    pet,
    chat,
    main,
    navigateSettings: action === COMPANION_OVERLAY_ACTIONS.SHOW_SETTINGS,
    destroyOverlay,
    drag: companionDragEffect(next),
  }
}

export function reduceCompanionOverlay(
  input: Partial<CompanionOverlayState> | null | undefined,
  action: string,
): CompanionOverlayDecision {
  const previous = normalizeCompanionOverlayState(input)
  const next = { ...previous }
  const known = actions.has(action) ? action as CompanionOverlayAction : null
  const canFloat = companionCanFloat(previous)

  if (known === COMPANION_OVERLAY_ACTIONS.CLICK_PET && canFloat) {
    next.petHidden = false
    next.chatOpen = !previous.chatOpen
  } else if (known === COMPANION_OVERLAY_ACTIONS.OPEN_CHAT) {
    if (canFloat) next.petHidden = false
    next.chatOpen = true
  } else if (known === COMPANION_OVERLAY_ACTIONS.CLOSE_CHAT) {
    next.chatOpen = false
  } else if (known === COMPANION_OVERLAY_ACTIONS.HIDE_PET && canFloat) {
    next.petHidden = true
    next.chatOpen = false
  } else if (known === COMPANION_OVERLAY_ACTIONS.SHOW_PET && canFloat) {
    next.petHidden = false
    next.chatOpen = false
  } else if (known === COMPANION_OVERLAY_ACTIONS.SHOW_MAIN) {
    next.mainVisible = true
  } else if (known === COMPANION_OVERLAY_ACTIONS.SHOW_SETTINGS) {
    next.mainVisible = true
  } else if (known === COMPANION_OVERLAY_ACTIONS.PARK_MAIN) {
    next.mainVisible = false
  } else if (known === COMPANION_OVERLAY_ACTIONS.REVEAL_FROM_TASKBAR) {
    next.mainVisible = true
  } else if (known === COMPANION_OVERLAY_ACTIONS.ENABLE) {
    if (!previous.wayland) {
      next.enabled = true
      next.petHidden = false
    }
  } else if (known === COMPANION_OVERLAY_ACTIONS.DISABLE) {
    next.enabled = false
    next.petHidden = false
    next.chatOpen = false
  }

  const state = normalizeCompanionOverlayState(next)
  return {
    state,
    petVisible: companionPetVisible(state),
    overlayVisible: companionOverlayVisible(state),
    phoneVisible: companionPhoneVisible(state),
    canFloat: companionCanFloat(state),
    effects: known
      ? effectsFromTransition(previous, state, known)
      : {
          pet: 'none',
          chat: 'none',
          main: 'none',
          navigateSettings: false,
          destroyOverlay: false,
          drag: companionDragEffect(state),
        },
  }
}

export function clampOverlayBounds(
  bounds: CompanionOverlayBounds,
  workArea?: CompanionOverlayWorkArea | null,
): CompanionOverlayBounds {
  const width = Math.max(1, Math.round(Number(bounds.width) || 0))
  const height = Math.max(1, Math.round(Number(bounds.height) || 0))
  const x = Number(bounds.x)
  const y = Number(bounds.y)
  if (!workArea || !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)) {
    return {
      x: Number.isFinite(x) ? Math.round(x) : 0,
      y: Number.isFinite(y) ? Math.round(y) : 0,
      width,
      height,
    }
  }
  const minX = Math.round(Number(workArea.x) || 0)
  const minY = Math.round(Number(workArea.y) || 0)
  const maxX = minX + Math.max(0, Math.round(Number(workArea.width) || 0) - width)
  const maxY = minY + Math.max(0, Math.round(Number(workArea.height) || 0) - height)
  return {
    x: Math.min(Math.max(Number.isFinite(x) ? Math.round(x) : minX, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(Number.isFinite(y) ? Math.round(y) : minY, minY), Math.max(minY, maxY)),
    width,
    height,
  }
}

export function resolveCompanionWorkArea(
  workArea?: CompanionOverlayWorkArea | null,
): CompanionOverlayWorkArea {
  if (!workArea || !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)) {
    return { ...COMPANION_FALLBACK_WORK_AREA }
  }
  return {
    x: Math.round(Number(workArea.x) || 0),
    y: Math.round(Number(workArea.y) || 0),
    width: Math.max(1, Math.round(Number(workArea.width) || 0)),
    height: Math.max(1, Math.round(Number(workArea.height) || 0)),
  }
}

export function defaultCompanionPetOrigin(
  workArea?: CompanionOverlayWorkArea | null,
): { x: number; y: number } {
  const area = resolveCompanionWorkArea(workArea)
  return {
    x: area.x + area.width - COMPANION_UNIT_MARGIN - COMPANION_PET_WIDTH,
    y: area.y + area.height - COMPANION_UNIT_MARGIN - COMPANION_PET_HEIGHT,
  }
}

export function resolveCompanionChatSide(
  _petOrigin?: { x: number; y: number },
  _workArea?: CompanionOverlayWorkArea | null,
): CompanionChatSide {
  return 'left'
}

export function phoneOriginFromPet(petOrigin: { x: number; y: number }) {
  return {
    x: Number(petOrigin.x) + COMPANION_PET_WIDTH - COMPANION_PHONE_WIDTH,
    y: Number(petOrigin.y) + COMPANION_PET_HEIGHT - COMPANION_PHONE_HEIGHT,
  }
}

export function petOriginFromPhone(phoneOrigin: { x: number; y: number }) {
  return {
    x: Number(phoneOrigin.x) - COMPANION_PET_WIDTH + COMPANION_PHONE_WIDTH,
    y: Number(phoneOrigin.y) - COMPANION_PET_HEIGHT + COMPANION_PHONE_HEIGHT,
  }
}

export function layoutCompanionUnit(input: {
  chatOpen: boolean
  bubble?: boolean
  petOrigin?: { x: number; y: number } | null
  workArea?: CompanionOverlayWorkArea | null
}): CompanionUnitLayout {
  const area = input.workArea && Number.isFinite(input.workArea.width)
    ? input.workArea
    : null
  const origin = input.petOrigin || defaultCompanionPetOrigin(area)
  if (!input.chatOpen) {
    const lift = input.bubble ? COMPANION_PET_BUBBLE_LIFT : 0
    const window = clampOverlayBounds({
      x: origin.x,
      y: origin.y - lift,
      width: COMPANION_PET_WIDTH,
      height: COMPANION_PET_HEIGHT + lift,
    }, area)
    return {
      window,
      pet: { x: 0, y: lift, width: COMPANION_PET_WIDTH, height: COMPANION_PET_HEIGHT },
      chat: null,
      chatSide: 'left',
      petScreen: { x: window.x, y: window.y + lift },
      chatScreen: null,
    }
  }
  const raw = phoneOriginFromPet(origin)
  const window = clampOverlayBounds({
    x: raw.x,
    y: raw.y,
    width: COMPANION_PHONE_WIDTH,
    height: COMPANION_PHONE_HEIGHT,
  }, area)
  return {
    window,
    pet: { x: 0, y: 0, width: 0, height: 0 },
    chat: { x: 0, y: 0, width: COMPANION_PHONE_WIDTH, height: COMPANION_PHONE_HEIGHT },
    chatSide: 'left',
    petScreen: petOriginFromPhone(window),
    chatScreen: {
      x: window.x,
      y: window.y,
      width: COMPANION_PHONE_WIDTH,
      height: COMPANION_PHONE_HEIGHT,
    },
  }
}

export function moveCompanionUnit(input: {
  petScreen: { x: number; y: number }
  dx: number
  dy: number
  chatOpen: boolean
  bubble?: boolean
  workArea?: CompanionOverlayWorkArea | null
}): CompanionUnitLayout {
  return layoutCompanionUnit({
    chatOpen: input.chatOpen,
    bubble: input.bubble,
    petOrigin: {
      x: Number(input.petScreen.x) + Number(input.dx),
      y: Number(input.petScreen.y) + Number(input.dy),
    },
    workArea: input.workArea,
  })
}

export function clampCompanionMenuOrigin(input: {
  x?: number
  y?: number
  width?: number
  height?: number
  workArea?: CompanionOverlayWorkArea | null
}): { x: number; y: number } {
  const area = resolveCompanionWorkArea(input.workArea)
  const width = Math.max(1, Math.round(Number(input.width) || COMPANION_PET_MENU_WIDTH))
  const height = Math.max(1, Math.round(Number(input.height) || COMPANION_PET_MENU_HEIGHT))
  const margin = 8
  const left = area.x + margin
  const top = area.y + margin
  const right = area.x + area.width - margin
  const bottom = area.y + area.height - margin
  const maxX = Math.max(left, right - width)
  const maxY = Math.max(top, bottom - height)
  const anchorX = Number.isFinite(Number(input.x)) ? Number(input.x) : right
  const anchorY = Number.isFinite(Number(input.y)) ? Number(input.y) : bottom
  let x = anchorX
  let y = anchorY
  if (x + width > right) x = anchorX - width
  if (y + height > bottom) y = anchorY - height
  return {
    x: Math.round(Math.min(Math.max(x, left), maxX)),
    y: Math.round(Math.min(Math.max(y, top), maxY)),
  }
}
