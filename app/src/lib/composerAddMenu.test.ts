import { describe, expect, it } from 'vitest'
import {
  COMPOSER_ADD_MENU_HEIGHT_CAP,
  COMPOSER_ADD_MENU_HEIGHT_FLOOR,
  layoutComposerAddMenu,
  layoutComposerSlashMenu,
} from './composerAddMenu'

describe('layoutComposerAddMenu', () => {
  it('caps to the larger side of a centered empty-canvas composer', () => {
    const next = layoutComposerAddMenu(
      { top: 250, bottom: 330 },
      { height: 600 },
    )
    expect(next.maxHeight).toBe(600 - 330 - 16)
    expect(next.maxHeight).toBeLessThan(COMPOSER_ADD_MENU_HEIGHT_CAP)
  })

  it('uses the space above a bottom-docked composer and never exceeds the cap', () => {
    const next = layoutComposerAddMenu(
      { top: 820, bottom: 900 },
      { height: 920 },
    )
    expect(next.maxHeight).toBe(COMPOSER_ADD_MENU_HEIGHT_CAP)
  })

  it('keeps a readable floor when the trigger sits near the chrome', () => {
    const next = layoutComposerAddMenu(
      { top: 24, bottom: 80 },
      { height: 200 },
    )
    expect(next.maxHeight).toBe(COMPOSER_ADD_MENU_HEIGHT_FLOOR)
  })
})

describe('layoutComposerSlashMenu', () => {
  it('stops at the space above a centered new-chat composer', () => {
    const next = layoutComposerSlashMenu(280)
    expect(next.maxHeight).toBe(280 - 8 - 16)
    expect(next.maxHeight).toBeLessThan(COMPOSER_ADD_MENU_HEIGHT_CAP)
  })

  it('stays shorter than the add menu once the composer sits low enough', () => {
    expect(layoutComposerSlashMenu(820).maxHeight).toBe(16 * 16)
    expect(layoutComposerSlashMenu(820).maxHeight).toBeLessThan(COMPOSER_ADD_MENU_HEIGHT_CAP)
  })

  it('does not force a floor that would run into the top chrome', () => {
    expect(layoutComposerSlashMenu(40).maxHeight).toBe(40 - 8 - 16)
  })
})
