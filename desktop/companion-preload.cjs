'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const ALLOWED = new Set([
  'GetCompanionStatus',
  'SendCompanionMessage',
  'GetCompanionBoard',
  'ListCompanionTranscript',
  'ArchiveCompanionTranscript',
  'ListCompanionArchives',
  'DeleteCompanionArchive',
  'GetCompanionMemory',
  'ApproveCompanionMemory',
  'ForgetCompanionMemory',
  'ConfirmCompanionDispatch',
  'GetCompanionShellStatus',
  'SetCompanionFloatEnabled',
  'SetCompanionPetHidden',
  'ShowCompanionMainWindow',
  'ShowCompanionChatWindow',
  'HideCompanionChatWindow',
  'ShowCompanionSettings',
  'PopupCompanionMenu',
  'MoveCompanionPet',
  'ParkCompanionMainWindow',
  'QuitCompanionShell',
  'GetSettings',
  'EnsureCompanion',
  'ListCompanionSkins',
  'GetCompanionSkin',
])

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('milksu', Object.freeze({
    hostPlatform: process.platform,
    invoke(method, args) {
      if (!ALLOWED.has(String(method ?? ''))) {
        return Promise.reject(new Error('companion window cannot call this desktop method'))
      }
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
