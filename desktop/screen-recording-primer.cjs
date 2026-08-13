'use strict'

/**
 * Make one real, renderer-attributed display-capture request so macOS can
 * register the currently running Electron host in Screen Recording settings.
 * The isolated window never becomes visible, receives no audio, stops the
 * returned stream immediately and is destroyed after the request settles.
 *
 * @param {{
 *   BrowserWindow: new (options: object) => {
 *     loadFile: (file: string) => Promise<unknown>,
 *     webContents: { executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown> },
 *     isDestroyed?: () => boolean,
 *     destroy?: () => void,
 *   },
 *   session: { fromPartition: (partition: string) => {
 *     setPermissionRequestHandler: (handler: Function | null) => void,
 *     setPermissionCheckHandler: (handler: Function | null) => void,
 *     setDisplayMediaRequestHandler: (handler: Function | null) => void,
 *   } },
 *   desktopCapturer: { getSources: (options: object) => Promise<Array<object>> },
 *   htmlPath: string,
 *   partition?: string,
 *   timeoutMs?: number,
 * }} dependencies
 */
async function requestScreenRecordingPermission(dependencies) {
  const {
    BrowserWindow,
    session,
    desktopCapturer,
    htmlPath,
  } = dependencies
  const partition = String(dependencies.partition || `milksu-screen-permission-${Date.now()}`)
  const timeoutMs = Math.max(1, Number(dependencies.timeoutMs) || 2500)
  const primerSession = session.fromPartition(partition)
  let primerWindow = null
  let timeout = null

  try {
    primerWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        session: primerSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })

    primerSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(webContents === primerWindow?.webContents && permission === 'display-capture')
    })
    primerSession.setPermissionCheckHandler((webContents, permission) => (
      webContents === primerWindow?.webContents && permission === 'display-capture'
    ))
    primerSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!request?.videoRequested || request?.audioRequested) {
        callback({})
        return
      }
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        })
        callback(sources[0] ? { video: sources[0] } : {})
      } catch {
        callback({})
      }
    })

    await primerWindow.loadFile(htmlPath)
    const capture = primerWindow.webContents.executeJavaScript(`
      (async () => {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        for (const track of stream.getTracks()) track.stop()
        return true
      })()
    `, true)
    await Promise.race([
      capture,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('screen recording permission request timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    primerSession.setDisplayMediaRequestHandler(null)
    primerSession.setPermissionRequestHandler(null)
    primerSession.setPermissionCheckHandler(null)
    if (primerWindow && !primerWindow.isDestroyed?.()) primerWindow.destroy?.()
  }
}

module.exports = { requestScreenRecordingPermission }
