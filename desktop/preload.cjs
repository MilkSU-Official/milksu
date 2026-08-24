'use strict'

const { contextBridge, ipcRenderer } = require('electron')

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('milksu', Object.freeze({
    invoke(method, args) {
      return ipcRenderer.invoke('milksu:invoke', { method, args })
    },
    onEvent(event, callback) {
      if (typeof event !== 'string' || typeof callback !== 'function') {
        throw new TypeError('event and callback are required')
      }
      const channel = `milksu:event:${event}`
      const listener = (_event, value) => callback(value)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  }))
}
