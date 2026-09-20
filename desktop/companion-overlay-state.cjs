'use strict'

/**
 * Keep in sync with app/src/lib/companionOverlayState.ts.
 * Electron owns the windows; this table is the product contract both sides apply.
 */

const COMPANION_PET_WIDTH = 232
const COMPANION_PET_HEIGHT = 400
const COMPANION_CHAT_WIDTH = 336
const COMPANION_CHAT_HEIGHT = 480
const COMPANION_UNIT_GAP = 12
const COMPANION_UNIT_MARGIN = 16
const COMPANION_PET_MENU_WIDTH = 176
const COMPANION_PET_MENU_HEIGHT = 184
const COMPANION_OVERLAY_Z_LEVEL = 'floating'
const COMPANION_FALLBACK_WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 }

const COMPANION_OVERLAY_ACTIONS = {
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
}

const actions = new Set(Object.values(COMPANION_OVERLAY_ACTIONS))

function normalizeCompanionOverlayState(input) {
  const wayland = Boolean(input && input.wayland)
  return {
    enabled: Boolean(input && input.enabled) && !wayland,
    wayland,
    petHidden: Boolean(input && input.petHidden),
    chatOpen: Boolean(input && input.chatOpen),
    mainVisible: !input || input.mainVisible !== false,
  }
}

function companionCanFloat(state) {
  return state.enabled && !state.wayland
}

function companionPetVisible(state) {
  return companionCanFloat(state) && !state.petHidden
}

function companionDragEffect(state) {
  return {
    moveUnit: companionPetVisible(state),
    moveMain: false,
  }
}

function effectsFromTransition(previous, next, action) {
  const destroyOverlay = action === COMPANION_OVERLAY_ACTIONS.DISABLE
  const previousPet = companionPetVisible(previous)
  const nextPet = companionPetVisible(next)
  let pet = 'none'
  if (destroyOverlay) pet = 'destroy'
  else if (nextPet && !previousPet) pet = 'show'
  else if (!nextPet && previousPet) pet = 'hide'

  let chat = 'none'
  if (destroyOverlay) chat = 'destroy'
  else if (next.chatOpen && !previous.chatOpen) chat = 'show'
  else if (!next.chatOpen && previous.chatOpen) chat = 'hide'
  else if (next.chatOpen && previous.chatOpen && action === COMPANION_OVERLAY_ACTIONS.OPEN_CHAT) {
    chat = 'focus'
  }

  let main = 'none'
  if (action === COMPANION_OVERLAY_ACTIONS.SHOW_MAIN || action === COMPANION_OVERLAY_ACTIONS.SHOW_SETTINGS) {
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

function reduceCompanionOverlay(input, action) {
  const previous = normalizeCompanionOverlayState(input)
  const next = { ...previous }
  const known = actions.has(action) ? action : null
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

function clampOverlayBounds(bounds, workArea) {
  const width = Math.max(1, Math.round(Number(bounds && bounds.width) || 0))
  const height = Math.max(1, Math.round(Number(bounds && bounds.height) || 0))
  const x = Number(bounds && bounds.x)
  const y = Number(bounds && bounds.y)
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

function resolveCompanionWorkArea(workArea) {
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

function defaultCompanionPetOrigin(workArea) {
  const area = resolveCompanionWorkArea(workArea)
  return {
    x: area.x + area.width - COMPANION_UNIT_MARGIN - COMPANION_PET_WIDTH,
    y: area.y + area.height - COMPANION_UNIT_MARGIN - COMPANION_PET_HEIGHT,
  }
}

function resolveCompanionChatSide(petOrigin, workArea) {
  const leftX = Number(petOrigin && petOrigin.x) - COMPANION_UNIT_GAP - COMPANION_CHAT_WIDTH
  if (!workArea) return 'left'
  return leftX >= (Number(workArea.x) || 0) + 8 ? 'left' : 'right'
}

function layoutCompanionUnit(input = {}) {
  const area = input.workArea && Number.isFinite(input.workArea.width) ? input.workArea : null
  const origin = input.petOrigin || defaultCompanionPetOrigin(area)
  const side = resolveCompanionChatSide(origin, area)
  if (!input.chatOpen) {
    const windowBounds = clampOverlayBounds({
      x: origin.x,
      y: origin.y,
      width: COMPANION_PET_WIDTH,
      height: COMPANION_PET_HEIGHT,
    }, area)
    return {
      window: windowBounds,
      pet: { x: 0, y: 0, width: COMPANION_PET_WIDTH, height: COMPANION_PET_HEIGHT },
      chat: null,
      chatSide: side,
      petScreen: { x: windowBounds.x, y: windowBounds.y },
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
  const windowBounds = clampOverlayBounds(union, area)
  const shiftX = windowBounds.x - union.x
  const shiftY = windowBounds.y - union.y
  const petScreen = { x: origin.x + shiftX, y: origin.y + shiftY }
  const chatScreen = {
    x: chatX + shiftX,
    y: chatY + shiftY,
    width: COMPANION_CHAT_WIDTH,
    height: COMPANION_CHAT_HEIGHT,
  }
  return {
    window: windowBounds,
    pet: {
      x: petScreen.x - windowBounds.x,
      y: petScreen.y - windowBounds.y,
      width: COMPANION_PET_WIDTH,
      height: COMPANION_PET_HEIGHT,
    },
    chat: {
      x: chatScreen.x - windowBounds.x,
      y: chatScreen.y - windowBounds.y,
      width: COMPANION_CHAT_WIDTH,
      height: COMPANION_CHAT_HEIGHT,
    },
    chatSide: side,
    petScreen,
    chatScreen,
  }
}

function moveCompanionUnit(input = {}) {
  return layoutCompanionUnit({
    chatOpen: Boolean(input.chatOpen),
    petOrigin: {
      x: Number(input.petScreen && input.petScreen.x) + Number(input.dx),
      y: Number(input.petScreen && input.petScreen.y) + Number(input.dy),
    },
    workArea: input.workArea,
  })
}

function clampCompanionMenuOrigin(input = {}) {
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

module.exports = {
  COMPANION_CHAT_HEIGHT,
  COMPANION_CHAT_WIDTH,
  COMPANION_FALLBACK_WORK_AREA,
  COMPANION_OVERLAY_ACTIONS,
  COMPANION_OVERLAY_Z_LEVEL,
  COMPANION_PET_HEIGHT,
  COMPANION_PET_MENU_HEIGHT,
  COMPANION_PET_MENU_WIDTH,
  COMPANION_PET_WIDTH,
  COMPANION_UNIT_GAP,
  COMPANION_UNIT_MARGIN,
  clampCompanionMenuOrigin,
  clampOverlayBounds,
  companionCanFloat,
  companionDragEffect,
  companionPetVisible,
  defaultCompanionPetOrigin,
  layoutCompanionUnit,
  moveCompanionUnit,
  normalizeCompanionOverlayState,
  reduceCompanionOverlay,
  resolveCompanionChatSide,
  resolveCompanionWorkArea,
}
