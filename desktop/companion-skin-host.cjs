'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const {
  FACTORY_COMPANION_SKIN_ID,
  copyCompanionSkinPackage,
  factoryCompanionSkin,
  frameDataUrl,
  importedCompanionSkinId,
  localizeSkinError,
  parseCompanionSkinSelection,
  pluginCompanionSkinId,
  readCompanionSkinPackage,
} = require('./companion-skin.cjs')

const SKIN_METHODS = new Set([
  'ListCompanionSkins',
  'GetCompanionSkin',
  'ImportCompanionSkin',
  'RemoveCompanionSkin',
  'NotifyCompanionSkinChanged',
])

function storeRoot(userDataPath) {
  return path.join(userDataPath, 'companion-skins')
}

function importedDirectory(userDataPath, packageId) {
  return path.join(storeRoot(userDataPath), packageId)
}

function summaryFromPackage(parsed, source, id) {
  return {
    id,
    source,
    factory: source === 'factory',
    removable: source === 'imported',
    name: parsed.name,
  }
}

function resolvedFromPackage(parsed, source, id) {
  const frames = {}
  for (const [motion, buffer] of Object.entries(parsed.buffers || {})) {
    frames[motion] = frameDataUrl(buffer)
  }
  return {
    id,
    source,
    factory: false,
    removable: source === 'imported',
    name: parsed.name,
    overlay: parsed.overlay,
    mark: parsed.mark,
    frames,
  }
}

function createCompanionSkinHost(options) {
  const userDataPath = String(options.userDataPath || '')
  const openDirectory = options.openDirectory
  const listPetPlugins = typeof options.listPetPlugins === 'function'
    ? options.listPetPlugins
    : async () => []
  const emit = typeof options.emit === 'function' ? options.emit : () => {}

  function localeOf(payload) {
    const value = String(payload?.locale ?? '').trim().toLowerCase()
    if (value === 'en' || value.startsWith('en-')) return 'en'
    return 'zh'
  }

  async function listImported() {
    const root = storeRoot(userDataPath)
    let names = []
    try {
      names = await fs.readdir(root)
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }
    const skins = []
    for (const name of names.sort()) {
      try {
        const parsed = await readCompanionSkinPackage(path.join(root, name))
        skins.push(summaryFromPackage(parsed, 'imported', importedCompanionSkinId(parsed.id)))
      } catch {
        // Skip a leftover folder that is no longer a valid package.
      }
    }
    return skins
  }

  async function listPlugins() {
    let packages = []
    try {
      packages = await listPetPlugins()
    } catch {
      return []
    }
    const skins = []
    for (const item of Array.isArray(packages) ? packages : []) {
      const directory = String(item?.directory ?? item?.Directory ?? '').trim()
      const pluginId = String(item?.id ?? item?.ID ?? '').trim()
      if (!directory || !pluginId) continue
      try {
        const parsed = await readCompanionSkinPackage(directory)
        skins.push(summaryFromPackage(parsed, 'plugin', pluginCompanionSkinId(pluginId)))
      } catch {
        // Enabled pet plugins without a valid skin.json stay out of the picker.
      }
    }
    return skins
  }

  async function listSkins() {
    const imported = await listImported()
    const plugins = await listPlugins()
    const factory = factoryCompanionSkin()
    return {
      skins: [
        { id: factory.id, source: factory.source, factory: true, removable: false, name: factory.name },
        ...imported,
        ...plugins,
      ],
    }
  }

  async function resolveImported(packageId) {
    const parsed = await readCompanionSkinPackage(importedDirectory(userDataPath, packageId))
    return resolvedFromPackage(parsed, 'imported', importedCompanionSkinId(parsed.id))
  }

  async function resolvePlugin(pluginId) {
    const packages = await listPetPlugins().catch(() => [])
    const match = (Array.isArray(packages) ? packages : []).find((item) => {
      return String(item?.id ?? item?.ID ?? '') === pluginId
    })
    if (!match) throw new Error('plugin skin is unavailable')
    const parsed = await readCompanionSkinPackage(String(match.directory ?? match.Directory ?? ''))
    return resolvedFromPackage(parsed, 'plugin', pluginCompanionSkinId(pluginId))
  }

  async function getSkin(id) {
    const selection = parseCompanionSkinSelection(id)
    if (selection.source === 'imported') {
      try {
        return await resolveImported(selection.packageId)
      } catch {
        return factoryCompanionSkin()
      }
    }
    if (selection.source === 'plugin') {
      try {
        return await resolvePlugin(selection.pluginId)
      } catch {
        return factoryCompanionSkin()
      }
    }
    return factoryCompanionSkin()
  }

  async function importSkin(payload = {}) {
    const locale = localeOf(payload)
    let directory = String(payload.directory ?? '').trim()
    if (!directory) {
      directory = await openDirectory({
        title: locale === 'en' ? 'Choose a companion skin folder' : '选择看板娘皮肤文件夹',
      })
      if (!directory) return { canceled: true, skins: (await listSkins()).skins }
    }
    try {
      const destinationRoot = storeRoot(userDataPath)
      await fs.mkdir(destinationRoot, { recursive: true })
      const parsed = await readCompanionSkinPackage(directory)
      const destination = importedDirectory(userDataPath, parsed.id)
      await fs.rm(destination, { recursive: true, force: true })
      await copyCompanionSkinPackage(directory, destination)
      const skins = (await listSkins()).skins
      const imported = skins.find(item => item.id === importedCompanionSkinId(parsed.id))
      return { canceled: false, imported, skins }
    } catch (error) {
      const next = new Error(localizeSkinError(error, locale))
      next.code = error.code
      throw next
    }
  }

  async function removeSkin(payload = {}) {
    const selection = parseCompanionSkinSelection(payload.id)
    if (selection.source !== 'imported') {
      return listSkins()
    }
    await fs.rm(importedDirectory(userDataPath, selection.packageId), { recursive: true, force: true })
    return listSkins()
  }

  function notify(payload = {}) {
    const selection = parseCompanionSkinSelection(payload.id)
    emit('companion-skin.changed', { id: selection.id })
    return { id: selection.id }
  }

  function handleHostMethod(method, args = {}) {
    const payload = typeof args === 'string'
      ? { id: args }
      : args && typeof args === 'object' && !Array.isArray(args) ? args : {}
    if (method === 'ListCompanionSkins') return listSkins()
    if (method === 'GetCompanionSkin') return getSkin(payload.id)
    if (method === 'ImportCompanionSkin') return importSkin(payload)
    if (method === 'RemoveCompanionSkin') return removeSkin(payload)
    if (method === 'NotifyCompanionSkinChanged') return notify(payload)
    return undefined
  }

  return {
    handleHostMethod,
    listSkins,
    getSkin,
    importSkin,
    removeSkin,
    notify,
  }
}

module.exports = {
  SKIN_METHODS,
  createCompanionSkinHost,
  importedDirectory,
  storeRoot,
}
