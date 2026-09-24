'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const ALLOWED = new Set([
  'GetCompanionStatus',
  'SendCompanionMessage',
  'AbortCompanionTurn',
  'ChooseCodingAttachments',
  'ImportCodingAttachments',
  'PreviewCodingAttachment',
  'GetCompanionBoard',
  'ListCompanionTranscript',
  'ArchiveCompanionTranscript',
  'ListCompanionArchives',
  'DeleteCompanionArchive',
  'GetCompanionMemory',
  'ApproveCompanionMemory',
  'ForgetCompanionMemory',
  'ConfirmCompanionDispatch',
  'GetCompanionPhoneStatus',
  'GetCompanionShellStatus',
  'SetCompanionFloatEnabled',
  'SetCompanionPetHidden',
  'SetCompanionPetBubble',
  'ShowCompanionMainWindow',
  'ShowCompanionChatWindow',
  'HideCompanionChatWindow',
  'ClickCompanionPet',
  'ShowCompanionSettings',
  'PopupCompanionMenu',
  'SetCompanionPointerPassthrough',
  'MoveCompanionPet',
  'ParkCompanionMainWindow',
  'QuitCompanionShell',
  'GetSettings',
  'SaveSettingsCmd',
  'GetModelCatalog',
  'EnsureCompanion',
  'ListCompanionSkins',
  'GetCompanionSkin',
  'ImportCompanionSkin',
  'RemoveCompanionSkin',
  'NotifyCompanionSkinChanged',
])

if (process.isMainFrame) {
  let lastMenuAt = 0
  function popupCompanionMenu() {
    const now = Date.now()
    if (now - lastMenuAt < 300) return
    lastMenuAt = now
    void ipcRenderer.invoke('milksu:invoke', { method: 'PopupCompanionMenu', args: {} })
  }

  function phoneIsOpen() {
    return Boolean(document.querySelector('[data-form="phone"]'))
  }

  function isEditableTarget(target) {
    if (!target || typeof target.closest !== 'function') return false
    return Boolean(target.closest('button, textarea, input, [contenteditable="true"]'))
  }

  function selectedTextOwns(target) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !String(selection.toString() ?? '').trim()) return false
    if (!selection.rangeCount) return false
    const node = selection.getRangeAt(0).commonAncestorContainer
    const element = node.nodeType === 1 ? node : node.parentElement
    return Boolean(element && target instanceof Node && element.contains(target))
  }

  // Single owner for the companion context menu. The renderer must not pop a
  // second one, or the stacked menus swallow the click that picks an action.
  // Phone form keeps the system menu (copy, and so on). The pet form still
  // opens the pet menu, except on a text selection or an editable field.
  window.addEventListener('contextmenu', event => {
    if (phoneIsOpen()) return
    if (isEditableTarget(event.target) || selectedTextOwns(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    popupCompanionMenu()
  }, true)

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
