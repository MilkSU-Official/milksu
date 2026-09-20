import { describe, expect, it } from 'vitest'
import {
  COMPANION_OVERLAY_ACTIONS,
  COMPANION_PET_MENU_HEIGHT,
  COMPANION_PET_MENU_WIDTH,
  COMPANION_PHONE_HEIGHT,
  COMPANION_PHONE_WIDTH,
  clampCompanionMenuOrigin,
  clampOverlayBounds,
  companionDragEffect,
  companionOverlayVisible,
  companionPetVisible,
  companionPhoneVisible,
  defaultCompanionPetOrigin,
  layoutCompanionUnit,
  normalizeCompanionOverlayState,
  reduceCompanionOverlay,
} from './companionOverlayState'

const idle = normalizeCompanionOverlayState({
  enabled: true,
  petHidden: false,
  chatOpen: false,
  mainVisible: true,
})

describe('companionOverlayState', () => {
  it('sizes the phone to the iPhone 17 logical display', () => {
    expect(COMPANION_PHONE_WIDTH).toBe(402)
    expect(COMPANION_PHONE_HEIGHT).toBe(874)
  })

  it('treats the pet as visible only when float is enabled, not hidden, and chat is closed', () => {
    expect(companionPetVisible(idle)).toBe(true)
    expect(companionPetVisible(normalizeCompanionOverlayState({
      enabled: true,
      petHidden: true,
    }))).toBe(false)
    expect(companionPetVisible(normalizeCompanionOverlayState({
      enabled: true,
      wayland: true,
    }))).toBe(false)
    expect(companionPetVisible(normalizeCompanionOverlayState({
      enabled: true,
      chatOpen: true,
    }))).toBe(false)
  })

  it('toggles phone on pet click and never shows both forms', () => {
    const opened = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.CLICK_PET)
    expect(opened.state.chatOpen).toBe(true)
    expect(opened.petVisible).toBe(false)
    expect(opened.phoneVisible).toBe(true)
    expect(opened.overlayVisible).toBe(true)
    expect(opened.effects.chat).toBe('show')
    expect(opened.effects.pet).toBe('none')
    const closed = reduceCompanionOverlay(opened.state, COMPANION_OVERLAY_ACTIONS.CLICK_PET)
    expect(closed.state.chatOpen).toBe(false)
    expect(closed.petVisible).toBe(true)
    expect(closed.phoneVisible).toBe(false)
    expect(closed.effects.chat).toBe('hide')
    const again = reduceCompanionOverlay(opened.state, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
    expect(again.state.chatOpen).toBe(true)
    expect(again.petVisible).toBe(false)
    expect(again.effects.chat).toBe('focus')
  })

  it('restores the pet when the phone is closed', () => {
    const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
    const closed = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.CLOSE_CHAT)
    expect(closed.state.chatOpen).toBe(false)
    expect(closed.petVisible).toBe(true)
    expect(closed.phoneVisible).toBe(false)
    expect(closed.effects.pet).toBe('none')
  })

  it('hides pet and phone together, then restores only the pet', () => {
    const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
    const hidden = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.HIDE_PET)
    expect(hidden.state.petHidden).toBe(true)
    expect(hidden.state.chatOpen).toBe(false)
    expect(hidden.effects.pet).toBe('hide')
    expect(hidden.effects.chat).toBe('hide')
    const shown = reduceCompanionOverlay(hidden.state, COMPANION_OVERLAY_ACTIONS.SHOW_PET)
    expect(shown.petVisible).toBe(true)
    expect(shown.state.chatOpen).toBe(false)
    expect(shown.effects.chat).toBe('none')
  })

  it('lets the main window and phone stay open together', () => {
    const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
    const main = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.SHOW_MAIN)
    expect(main.state.chatOpen).toBe(true)
    expect(main.state.mainVisible).toBe(true)
    expect(main.effects.chat).toBe('none')
    expect(main.effects.main).toBe('show')
    const settings = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.SHOW_SETTINGS)
    expect(settings.state.chatOpen).toBe(true)
    expect(settings.effects.navigateSettings).toBe(true)
    expect(settings.effects.chat).toBe('none')
  })

  it('parks the main window without closing the overlay', () => {
    const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
    const parked = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.PARK_MAIN)
    expect(parked.state.mainVisible).toBe(false)
    expect(parked.state.chatOpen).toBe(true)
    expect(parked.petVisible).toBe(false)
    expect(parked.phoneVisible).toBe(true)
    expect(parked.overlayVisible).toBe(true)
    expect(parked.effects.main).toBe('park')
  })

  it('wakes the pet from the taskbar without forcing the phone open', () => {
    const hidden = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.HIDE_PET)
    const revealed = reduceCompanionOverlay(hidden.state, COMPANION_OVERLAY_ACTIONS.REVEAL_FROM_TASKBAR)
    expect(revealed.petVisible).toBe(true)
    expect(revealed.state.chatOpen).toBe(false)
    expect(revealed.effects.main).toBe('none')
  })

  it('does not float on Wayland and still allows the phone', () => {
    const wayland = normalizeCompanionOverlayState({ enabled: true, wayland: true })
    const click = reduceCompanionOverlay(wayland, COMPANION_OVERLAY_ACTIONS.CLICK_PET)
    expect(click.petVisible).toBe(false)
    expect(click.state.chatOpen).toBe(false)
    const opened = reduceCompanionOverlay(wayland, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
    expect(opened.state.chatOpen).toBe(true)
    expect(opened.petVisible).toBe(false)
  })

  it('moves only the overlay when dragging the pet', () => {
    expect(companionDragEffect(idle)).toEqual({
      moveUnit: true,
      moveMain: false,
    })
    const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
    expect(open.effects.drag).toEqual({
      moveUnit: true,
      moveMain: false,
    })
    const withMain = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.SHOW_MAIN)
    expect(withMain.effects.drag.moveMain).toBe(false)
    const hidden = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.HIDE_PET)
    expect(companionDragEffect(hidden.state).moveUnit).toBe(false)
  })

  it('replaces the pet window with the phone instead of gluing them side by side', () => {
    const area = { x: 0, y: 0, width: 1280, height: 800 }
    expect(clampOverlayBounds({ x: 4000, y: -40, width: 232, height: 400 }, area)).toEqual({
      x: 1048,
      y: 0,
      width: 232,
      height: 400,
    })
    const phone = layoutCompanionUnit({
      chatOpen: true,
      petOrigin: { x: 80, y: 200 },
      workArea: area,
    })
    expect(phone.window).toMatchObject({
      width: COMPANION_PHONE_WIDTH,
      height: COMPANION_PHONE_HEIGHT,
    })
    expect(phone.chatScreen).toMatchObject({
      width: COMPANION_PHONE_WIDTH,
      height: COMPANION_PHONE_HEIGHT,
    })
    expect(phone.pet.width).toBe(0)
    const pet = layoutCompanionUnit({
      chatOpen: false,
      petOrigin: { x: 80, y: 200 },
      workArea: area,
    })
    expect(pet.window).toMatchObject({ width: 160, height: 160 })
    expect(pet.chatScreen).toBeNull()
    expect(companionOverlayVisible(idle)).toBe(true)
    expect(companionPhoneVisible(idle)).toBe(false)
  })

  it('spawns the unit at the bottom-right and opens the menu up-left', () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 }
    expect(defaultCompanionPetOrigin(area)).toEqual({ x: 1264, y: 724 })
    const menu = clampCompanionMenuOrigin({
      x: 1380,
      y: 860,
      workArea: area,
    })
    expect(menu.x + COMPANION_PET_MENU_WIDTH).toBeLessThanOrEqual(1440 - 8)
    expect(menu.y + COMPANION_PET_MENU_HEIGHT).toBeLessThanOrEqual(900 - 8)
    expect(menu.x).toBeLessThan(1380)
    expect(menu.y).toBeLessThan(860)
  })

  it('destroys both overlay windows when float is disabled', () => {
    const open = reduceCompanionOverlay(idle, COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
    const disabled = reduceCompanionOverlay(open.state, COMPANION_OVERLAY_ACTIONS.DISABLE)
    expect(disabled.state.enabled).toBe(false)
    expect(disabled.state.chatOpen).toBe(false)
    expect(disabled.effects.destroyOverlay).toBe(true)
    expect(disabled.effects.pet).toBe('destroy')
    expect(disabled.effects.chat).toBe('destroy')
  })
})
