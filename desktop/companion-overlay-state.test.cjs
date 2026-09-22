'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMPANION_OVERLAY_ACTIONS,
  COMPANION_PET_MENU_HEIGHT,
  COMPANION_PET_MENU_WIDTH,
  COMPANION_PET_BUBBLE_LIFT,
  COMPANION_PHONE_HEIGHT,
  COMPANION_PHONE_WIDTH,
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

test('phone window uses the iPhone 17 screen, one step wider than 288', () => {
  assert.equal(COMPANION_PHONE_WIDTH, 320)
  assert.equal(COMPANION_PHONE_HEIGHT, 696)
  assert.ok(Math.abs(COMPANION_PHONE_HEIGHT / COMPANION_PHONE_WIDTH - 874 / 402) < 0.001)
})

test('pet click toggles the phone and hides the sprite', () => {
  const opened = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.CLICK_PET)
  assert.equal(opened.state.chatOpen, true)
  assert.equal(opened.petVisible, false)
  assert.equal(opened.phoneVisible, true)
  assert.equal(opened.effects.chat, 'show')
  assert.equal(opened.effects.pet, 'none')
  const closed = reduceCompanionOverlay(opened.state, COMPANION_OVERLAY_ACTIONS.CLICK_PET)
  assert.equal(closed.state.chatOpen, false)
  assert.equal(closed.petVisible, true)
  assert.equal(closed.effects.chat, 'hide')
  const focused = reduceCompanionOverlay(opened.state, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
  assert.equal(focused.effects.chat, 'focus')
})

test('hide parks pet and chat; show restores the pet; taskbar reveal does not', () => {
  const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
  const hidden = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.HIDE_PET)
  assert.equal(hidden.state.petHidden, true)
  assert.equal(hidden.state.chatOpen, false)
  const shown = reduceCompanionOverlay(hidden.state, COMPANION_OVERLAY_ACTIONS.SHOW_PET)
  assert.equal(shown.petVisible, true)
  assert.equal(shown.state.chatOpen, false)
  const revealed = reduceCompanionOverlay(hidden.state, COMPANION_OVERLAY_ACTIONS.REVEAL_FROM_TASKBAR)
  assert.equal(revealed.state.petHidden, true)
  assert.equal(revealed.petVisible, false)
  assert.equal(revealed.state.chatOpen, false)
  assert.equal(revealed.effects.main, 'show')
  assert.equal(revealed.effects.pet, 'none')
})

test('main window and phone may stay open together', () => {
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
    petOrigin: { x: 40, y: 200 },
    workArea: area,
  })
  assert.equal(placed.window.width, COMPANION_PHONE_WIDTH)
  assert.equal(placed.window.height, COMPANION_PHONE_HEIGHT)
  assert.equal(placed.pet.width, 0)
  assert.equal(placed.chatScreen.width, COMPANION_PHONE_WIDTH)
  const speech = layoutCompanionUnit({
    chatOpen: false,
    bubble: true,
    petOrigin: { x: 80, y: 200 },
    workArea: area,
  })
  assert.deepEqual(speech.window, {
    x: 80,
    y: 200 - COMPANION_PET_BUBBLE_LIFT,
    width: 160,
    height: 160 + COMPANION_PET_BUBBLE_LIFT,
  })
  assert.deepEqual(speech.petScreen, { x: 80, y: 200 })
})

test('default spawn is flush to the bottom-right and the pet menu opens up-left', () => {
  const area = { x: 0, y: 0, width: 1440, height: 900 }
  const origin = defaultCompanionPetOrigin(area)
  assert.deepEqual(origin, { x: 1280, y: 740 })
  const phone = layoutCompanionUnit({ chatOpen: true, petOrigin: origin, workArea: area })
  assert.equal(phone.window.x + phone.window.width, area.width)
  assert.equal(phone.window.y + phone.window.height, area.height)
  assert.deepEqual(phone.petScreen, origin)
  const back = layoutCompanionUnit({ chatOpen: false, petOrigin: phone.petScreen, workArea: area })
  assert.deepEqual(back.petScreen, origin)
  const menu = clampCompanionMenuOrigin({ x: 1380, y: 860, workArea: area })
  assert.ok(menu.x + COMPANION_PET_MENU_WIDTH <= 1440 - 8)
  assert.ok(menu.y + COMPANION_PET_MENU_HEIGHT <= 900 - 8)
  assert.ok(menu.x < 1380)
  assert.ok(menu.y < 860)
})
