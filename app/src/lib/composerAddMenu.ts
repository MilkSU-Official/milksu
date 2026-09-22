export const COMPOSER_ADD_MENU_HEIGHT_CAP = 24 * 16
export const COMPOSER_ADD_MENU_HEIGHT_FLOOR = 10 * 16
export const COMPOSER_ADD_MENU_VIEW_MARGIN = 16
const COMPOSER_SLASH_MENU_GAP = 8
const COMPOSER_SLASH_MENU_HEIGHT_CAP = 16 * 16

export function layoutComposerAddMenu(
  trigger: { top: number; bottom: number } | null | undefined,
  viewport: { height: number },
) {
  const margin = COMPOSER_ADD_MENU_VIEW_MARGIN
  const above = Math.max(0, (trigger?.top ?? 0) - margin)
  const below = Math.max(0, viewport.height - (trigger?.bottom ?? 0) - margin)
  const available = Math.max(above, below)
  return {
    maxHeight: Math.max(
      COMPOSER_ADD_MENU_HEIGHT_FLOOR,
      Math.min(COMPOSER_ADD_MENU_HEIGHT_CAP, Math.floor(available)),
    ),
  }
}

// The slash menu only opens upward. Use the space above the composer, with the
// same cap and window margin as the add menu, so a centered new-chat composer
// does not push the list into the top of the window.
export function layoutComposerSlashMenu(anchorTop: number) {
  const available = Math.max(0, Math.floor(anchorTop - COMPOSER_SLASH_MENU_GAP - COMPOSER_ADD_MENU_VIEW_MARGIN))
  return {
    maxHeight: Math.min(COMPOSER_SLASH_MENU_HEIGHT_CAP, available),
  }
}
