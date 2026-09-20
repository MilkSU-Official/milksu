/**
 * Desktop companion overlay state machine.
 *
 * Surfaces
 * - pet: always-on-top sprite. Visible when float is enabled, the session can
 *   place windows, and the user has not hidden it.
 * - chat: messenger panel glued to the pet inside the same overlay window.
 *   Never a second desktop window, never a full-page companion app.
 * - main: the MilkSU product window. Settings → 桌宠 lives here. This is the
 *   "big window". Main and the overlay unit may stay open together (PiP over app).
 *
 * Grammar taken from Chrome picture-in-picture, Android / Google chat-heads,
 * and macOS notification banners. MilkSU chrome still wins: no Gemini brand,
 * no Messenger skin, no magnetic dock.
 */

export const COMPANION_PET_WIDTH = 232
export const COMPANION_PET_HEIGHT = 400
export const COMPANION_CHAT_WIDTH = 336
export const COMPANION_CHAT_HEIGHT = 480
export const COMPANION_UNIT_GAP = 12
export const COMPANION_UNIT_MARGIN = 16
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

export function companionPetVisible(state: CompanionOverlayState) {
  return companionCanFloat(state) && !state.petHidden
}

export function companionDragEffect(state: CompanionOverlayState): CompanionOverlayDrag {
  return {
    moveUnit: companionPetVisible(state),
    moveMain: false,
  }
}

function effectsFromTransition(
  previous: CompanionOverlayState,
  next: CompanionOverlayState,
  action: CompanionOverlayAction,
): CompanionOverlayDecision['effects'] {
  const destroyOverlay = action === COMPANION_OVERLAY_ACTIONS.DISABLE
  const previousPet = companionPetVisible(previous)
  const nextPet = companionPetVisible(next)
  let pet: CompanionOverlayPetEffect = 'none'
  if (destroyOverlay) pet = 'destroy'
  else if (nextPet && !previousPet) pet = 'show'
  else if (!nextPet && previousPet) pet = 'hide'

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
  } else if (known === COMPANION_OVERLAY_ACTIONS.SHOW_MAIN) {
    next.mainVisible = true
  } else if (known === COMPANION_OVERLAY_ACTIONS.SHOW_SETTINGS) {
    next.mainVisible = true
  } else if (known === COMPANION_OVERLAY_ACTIONS.PARK_MAIN) {
    next.mainVisible = false
  } else if (known === COMPANION_OVERLAY_ACTIONS.REVEAL_FROM_TASKBAR) {
    if (canFloat) next.petHidden = false
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
  petOrigin: { x: number; y: number },
  workArea?: CompanionOverlayWorkArea | null,
): CompanionChatSide {
  const leftX = Number(petOrigin.x) - COMPANION_UNIT_GAP - COMPANION_CHAT_WIDTH
  if (!workArea) return 'left'
  return leftX >= (Number(workArea.x) || 0) + 8 ? 'left' : 'right'
}

export function layoutCompanionUnit(input: {
  chatOpen: boolean
  petOrigin?: { x: number; y: number } | null
  workArea?: CompanionOverlayWorkArea | null
}): CompanionUnitLayout {
  const area = input.workArea && Number.isFinite(input.workArea.width)
    ? input.workArea
    : null
  const origin = input.petOrigin || defaultCompanionPetOrigin(area)
  const side = resolveCompanionChatSide(origin, area)
  if (!input.chatOpen) {
    const window = clampOverlayBounds({
      x: origin.x,
      y: origin.y,
      width: COMPANION_PET_WIDTH,
      height: COMPANION_PET_HEIGHT,
    }, area)
    return {
      window,
      pet: { x: 0, y: 0, width: COMPANION_PET_WIDTH, height: COMPANION_PET_HEIGHT },
      chat: null,
      chatSide: side,
      petScreen: { x: window.x, y: window.y },
      chatScreen: null,
    }
  }
  const chatX = side === 'left'
    ? origin.x - COMPANION_UNIT_GAP - COMPANION_CHAT_WIDTH
    : origin.x + COMPANION_PET_WIDTH + COMPANION_UNIT_GAP
  const chatY = origin.y + COMPANION_PET_HEIGHT - COMPANION_CHAT_HEIGHT
  const minX = Math.min(origin.x, chatX)
  const minY = Math.min(origin.y, chatY)
  const union = {
    x: minX,
    y: minY,
    width: Math.max(origin.x + COMPANION_PET_WIDTH, chatX + COMPANION_CHAT_WIDTH) - minX,
    height: Math.max(origin.y + COMPANION_PET_HEIGHT, chatY + COMPANION_CHAT_HEIGHT) - minY,
  }
  const window = clampOverlayBounds(union, area)
  const shiftX = window.x - union.x
  const shiftY = window.y - union.y
  const petScreen = { x: origin.x + shiftX, y: origin.y + shiftY }
  const chatScreen = {
    x: chatX + shiftX,
    y: chatY + shiftY,
    width: COMPANION_CHAT_WIDTH,
    height: COMPANION_CHAT_HEIGHT,
  }
  return {
    window,
    pet: {
      x: petScreen.x - window.x,
      y: petScreen.y - window.y,
      width: COMPANION_PET_WIDTH,
      height: COMPANION_PET_HEIGHT,
    },
    chat: {
      x: chatScreen.x - window.x,
      y: chatScreen.y - window.y,
      width: COMPANION_CHAT_WIDTH,
      height: COMPANION_CHAT_HEIGHT,
    },
    chatSide: side,
    petScreen,
    chatScreen,
  }
}

export function moveCompanionUnit(input: {
  petScreen: { x: number; y: number }
  dx: number
  dy: number
  chatOpen: boolean
  workArea?: CompanionOverlayWorkArea | null
}): CompanionUnitLayout {
  return layoutCompanionUnit({
    chatOpen: input.chatOpen,
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
