'use strict'

const TITLE_BAR_COLORS = {
  light: { backgroundColor: '#fcfcfc', symbolColor: '#141414' },
  dark: { backgroundColor: '#181818', symbolColor: '#f0f0f0' },
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
      backgroundColor: '#00000000',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 16 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
    }
  }
  if (platform === 'win32') {
    return {
      backgroundColor: colors.backgroundColor,
      titleBarStyle: 'hidden',
      autoHideMenuBar: true,
      titleBarOverlay: titleBarOverlayOptions(theme),
      backgroundMaterial: 'acrylic',
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
  if (platform === 'darwin') {
    if (typeof window.setBackgroundColor === 'function') {
      window.setBackgroundColor('#00000000')
    }
    if (typeof window.setVibrancy === 'function') {
      window.setVibrancy('under-window')
    }
    return true
  }
  const colors = windowChromeColors(theme)
  if (typeof window.setBackgroundColor === 'function') {
    window.setBackgroundColor(colors.backgroundColor)
  }
  if (platform === 'win32' && typeof window.setBackgroundMaterial === 'function') {
    window.setBackgroundMaterial('acrylic')
  }
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
