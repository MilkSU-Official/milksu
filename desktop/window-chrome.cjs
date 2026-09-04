'use strict'

const TITLE_BAR_COLORS = {
  light: { backgroundColor: '#f7f7f5', symbolColor: '#111315' },
  dark: { backgroundColor: '#1c1d21', symbolColor: '#f4f5f6' },
}

function normalizeChromeTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light'
}

function windowChromeColors(theme) {
  return TITLE_BAR_COLORS[normalizeChromeTheme(theme)]
}

function titleBarOverlayOptions(theme) {
  const colors = windowChromeColors(theme)
  return {
    color: colors.backgroundColor,
    symbolColor: colors.symbolColor,
  }
}

function browserWindowChrome({ platform, theme } = {}) {
  const colors = windowChromeColors(theme)
  if (platform === 'darwin') {
    return {
      backgroundColor: colors.backgroundColor,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 16 },
    }
  }
  return {
    backgroundColor: colors.backgroundColor,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    titleBarOverlay: titleBarOverlayOptions(theme),
  }
}

function applyWindowChrome(window, { platform, theme } = {}) {
  if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) {
    return false
  }
  const colors = windowChromeColors(theme)
  if (typeof window.setBackgroundColor === 'function') {
    window.setBackgroundColor(colors.backgroundColor)
  }
  if (platform === 'darwin') return true
  if (typeof window.setTitleBarOverlay !== 'function') return false
  try {
    window.setTitleBarOverlay(titleBarOverlayOptions(theme))
    return true
  } catch {
    return false
  }
}

module.exports = {
  applyWindowChrome,
  browserWindowChrome,
  titleBarOverlayOptions,
  windowChromeColors,
}
