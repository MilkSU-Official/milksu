'use strict'

function isRendererReloadShortcut(input) {
  if (!input || input.type !== 'keyDown') return false
  const key = String(input.key || '').toLowerCase()
  if (key === 'f5') return true
  const chord = Boolean(input.control) || Boolean(input.meta)
  return chord && !input.alt && key === 'r'
}

function installRendererReloadGuard(webContents) {
  if (!webContents || typeof webContents.on !== 'function') return
  webContents.on('before-input-event', (event, input) => {
    if (isRendererReloadShortcut(input)) event.preventDefault()
  })
}

function productApplicationMenuTemplate(platform = process.platform) {
  const isMac = platform === 'darwin'
  return [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
}

module.exports = {
  installRendererReloadGuard,
  isRendererReloadShortcut,
  productApplicationMenuTemplate,
}
