'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMPANION_OVERLAY_ACTIONS,
  COMPANION_PET_MENU_HEIGHT,
  COMPANION_PET_MENU_WIDTH,
  clampCompanionMenuOrigin,
  clampOverlayBounds,
  companionDragEffect,
  defaultCompanionPetOrigin,
  layoutCompanionUnit,
  reduceCompanionOverlay,
} = require('./companion-overlay-state.cjs')

const idle = {
  enabled: true,
  wayland: false,
  petHidden: false,
  chatOpen: false,
  mainVisible: true,
}

test('pet click toggles the one small chat', () => {
  const opened = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.CLICK_PET)
  assert.equal(opened.state.chatOpen, true)
  assert.equal(opened.effects.chat, 'show')
  const closed = reduceCompanionOverlay(opened.state, COMPANION_OVERLAY_ACTIONS.CLICK_PET)
  assert.equal(closed.state.chatOpen, false)
  assert.equal(closed.effects.chat, 'hide')
  const focused = reduceCompanionOverlay(opened.state, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
  assert.equal(focused.effects.chat, 'focus')
})

test('hide parks pet and chat; show and taskbar restore only the pet', () => {
  const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
  const hidden = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.HIDE_PET)
  assert.equal(hidden.state.petHidden, true)
  assert.equal(hidden.state.chatOpen, false)
  const shown = reduceCompanionOverlay(hidden.state, COMPANION_OVERLAY_ACTIONS.SHOW_PET)
  assert.equal(shown.petVisible, true)
  assert.equal(shown.state.chatOpen, false)
  const revealed = reduceCompanionOverlay(hidden.state, COMPANION_OVERLAY_ACTIONS.REVEAL_FROM_TASKBAR)
  assert.equal(revealed.petVisible, true)
  assert.equal(revealed.state.chatOpen, false)
  assert.equal(revealed.effects.main, 'none')
})

test('main window and small chat may stay open together', () => {
  const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
  const main = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.SHOW_MAIN)
  assert.equal(main.state.chatOpen, true)
  assert.equal(main.effects.chat, 'none')
  const settings = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.SHOW_SETTINGS)
  assert.equal(settings.effects.navigateSettings, true)
  assert.equal(settings.state.chatOpen, true)
})

test('drag moves the overlay only, then clamps to the work area', () => {
  const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
  assert.deepEqual(companionDragEffect(open.state), {
    moveUnit: true,
    moveMain: false,
  })
  const area = { x: 0, y: 0, width: 1280, height: 800 }
  assert.deepEqual(clampOverlayBounds({ x: 9000, y: -20, width: 232, height: 400 }, area), {
    x: 1048,
    y: 0,
    width: 232,
    height: 400,
  })
  const placed = layoutCompanionUnit({
    chatOpen: true,
    petOrigin: { x: 40, y: 80 },
    workArea: area,
  })
  assert.equal(placed.chatSide, 'right')
  assert.equal(placed.chatScreen.x, 40 + 232 + 12)
})

test('default spawn is bottom-right and the pet menu opens up-left', () => {
  const area = { x: 0, y: 0, width: 1440, height: 900 }
  assert.deepEqual(defaultCompanionPetOrigin(area), { x: 1192, y: 484 })
  const menu = clampCompanionMenuOrigin({ x: 1380, y: 860, workArea: area })
  assert.ok(menu.x + COMPANION_PET_MENU_WIDTH <= 1440 - 8)
  assert.ok(menu.y + COMPANION_PET_MENU_HEIGHT <= 900 - 8)
  assert.ok(menu.x < 1380)
  assert.ok(menu.y < 860)
})
