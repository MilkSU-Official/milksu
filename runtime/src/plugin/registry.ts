import { lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  API_VERSION,
  HOST_CAPABILITIES,
  LEGACY_API_VERSION,
  LOCK_API_VERSION,
  LOCK_FILE,
  MAX_BACKGROUND_BYTES,
  MAX_ENTRY_BYTES,
  MAX_LOCK_FILE_BYTES,
  STATE_FILE,
  type ActiveTheme,
  type Descriptor,
  type Manifest,
  type PackageRecord,
  type PetPluginPackage,
  type PluginAssetResponse,
  type PluginBackgroundChoice,
  type PluginOptions,
  type PublisherTrustDescriptor,
  type RuntimeResult,
  type Source,
  type StagedPackageReview,
  type SurfaceSlot,
  type SurfaceStyle,
  type ToolCallDescriptor,
  type UIRequest,
} from './types.ts'
import { packageDigest, packagePayloadDigest, validDigest } from './digest.ts'
import { readManifest } from './manifest.ts'
import { compareSemanticVersions } from './semver.ts'
import { validateThirdPartyTools, validateToolInput } from './schema.ts'
import { clonePersistedState, defaultState, readState, writeState, type PersistedState } from './state.ts'
import { invokeRuntime, runtimeInvocation } from './runtime.ts'
import {
  emptyActiveTheme,
  assertBackgroundPermission,
  buildActiveTheme,
  inspectBackground,
  normalizeSurfaceStyle,
  pluginStorageDirectory,
  readThemeTokens,
  validSurfaceSlot,
  validateManagedSurfaceAsset,
  writeManagedAsset,
} from './theme.ts'
import {
  extractToStaging,
  installedIndexPath,
  mergeStorageWrites,
  readInstalledIndex,
  readStorageSnapshot,
  readTrustStoreFile,
  resolveInstalledDirectory,
  resolveStorageSnapshot,
  reviewStagedDirectory,
  trustStorePath,
  writeStorageSnapshot,
  type InstalledIndex,
  type StagedPackage,
} from './packages.ts'
import { trustedProof, verifyInstalledDirectory, verifySignatureSet } from './signatures.ts'
import { atomicWriteJson, contributesSlot, hasPermission, isObject, Mutex, securePackageFile, trim } from './util.ts'

export class PluginRegistry {
  private readonly mu = new Mutex()
  private readonly packageMu = new Mutex()
  private state: PersistedState
  private items = new Map<string, PackageRecord>()
  private issues: Descriptor[] = []
  private staged = new Map<string, StagedPackage>()

  readonly options: PluginOptions

  private constructor(options: PluginOptions, state: PersistedState) {
    this.options = options
    this.state = state
  }

  static async open(options: PluginOptions): Promise<PluginRegistry> {
    if (!trim(options.dataDirectory)) throw new Error('plugin data directory is required')
    const state = await readState(join(options.dataDirectory, 'services', 'plugins', STATE_FILE))
    const registry = new PluginRegistry(options, state)
    await registry.reloadLocked()
    return registry
  }

  private statePath(): string {
    return join(this.options.dataDirectory, 'services', 'plugins', STATE_FILE)
  }

  private hostVersion(): string {
    return trim(this.options.hostVersion) || '0.0.0'
  }

  private async refreshStateLocked(): Promise<void> {
    this.state = await readState(this.statePath())
  }

  private async commitStateLocked(next: PersistedState): Promise<void> {
    await writeState(this.statePath(), next)
    this.state = next
  }

  async reload(): Promise<void> {
    await this.mu.run(async () => this.reloadLocked())
  }

  private async reloadLocked(): Promise<void> {
    this.items = new Map()
    this.issues = []
    await this.loadOfficialLocked()
    await this.loadInstalledLocked()
    if (this.options.developmentMode) await this.loadDevelopmentLocked()
  }

  private addIssue(id: string, source: Source, message: string): void {
    const value = trim(id) || 'unknown'
    this.issues.push({
      id: value, name: value, version: '', api_version: '', runtime: 'lua', source,
      digest: '', permissions: [], contributions: {}, enabled: false, status: 'error', error: message,
      has_settings: false,
    })
  }

  private async addPackage(directory: string, manifest: Manifest, digest: string, source: Source): Promise<void> {
    const record: PackageRecord = {
      manifest, directory, digest, source, theme: { default: {}, light: {}, dark: {} }, errorText: '', canRollback: false,
    }
    try {
      this.validateHostCompatibility(manifest)
    } catch (error) {
      record.errorText = error instanceof Error ? error.message : String(error)
    }
    if (manifest.theme) {
      try {
        const themePath = await securePackageFile(directory, manifest.theme.source, MAX_ENTRY_BYTES)
        record.theme = await readThemeTokens(themePath)
      } catch (error) {
        record.errorText = error instanceof Error ? error.message : String(error)
      }
    }
    this.items.set(manifest.id, record)
  }

  validateHostCompatibility(manifest: Manifest): void {
    if (manifest.apiVersion === LEGACY_API_VERSION) return
    const hostVersion = this.hostVersion()
    const comparison = compareSemanticVersions(hostVersion, manifest.host?.minVersion ?? '0.0.0')
    if (comparison < 0) {
      throw new Error(`plugin requires MilkSU ${manifest.host?.minVersion} or newer (current ${hostVersion})`)
    }
    const available = new Set<string>(HOST_CAPABILITIES)
    for (const capability of manifest.host?.requiredCapabilities ?? []) {
      if (!available.has(capability)) throw new Error(`plugin requires unavailable host capability "${capability}"`)
    }
  }

  private async loadOfficialLocked(): Promise<void> {
    const root = trim(this.options.officialDirectory)
    if (!root || root === '.') {
      this.addIssue('official', 'official', 'official plugin directory is unavailable')
      return
    }
    let lock: { apiVersion: string; plugins: Array<{ id: string; version: string; sha256: string }> }
    try {
      lock = await readLockFile(join(root, LOCK_FILE))
    } catch (error) {
      this.addIssue('official', 'official', error instanceof Error ? error.message : String(error))
      return
    }
    const locked = new Map<string, { id: string; version: string; sha256: string }>()
    for (const entry of lock.plugins) {
      try {
        if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(entry.id) || !validDigest(entry.sha256)) {
          throw new Error('invalid')
        }
        compareSemanticVersions(entry.version, '0.0.0')
      } catch {
        this.addIssue(entry.id, 'official', 'official lock entry is invalid')
        continue
      }
      if (locked.has(entry.id)) {
        this.addIssue(entry.id, 'official', 'official lock contains duplicate plugin id')
        continue
      }
      locked.set(entry.id, entry)
    }
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch (error) {
      this.addIssue('official', 'official', `read official plugin directory: ${error instanceof Error ? error.message : error}`)
      return
    }
    const seen = new Set<string>()
    for (const name of entries) {
      if (name === LOCK_FILE) continue
      const directory = join(root, name)
      const info = await lstat(directory).catch(() => null)
      if (!info || info.isSymbolicLink() || !info.isDirectory()) {
        this.addIssue(name, 'official', 'official plugin entry must be a non-symlink directory')
        continue
      }
      let manifest: Manifest
      try {
        manifest = await readManifest(directory)
      } catch (error) {
        this.addIssue(name, 'official', error instanceof Error ? error.message : String(error))
        continue
      }
      seen.add(manifest.id)
      if (name !== manifest.id) {
        this.addIssue(manifest.id, 'official', 'official plugin directory must equal its manifest id')
        continue
      }
      const lockEntry = locked.get(manifest.id)
      if (!lockEntry) {
        this.addIssue(manifest.id, 'official', 'official plugin is not present in the production lock')
        continue
      }
      let digest: string
      try {
        digest = await packageDigest(directory)
      } catch (error) {
        this.addIssue(manifest.id, 'official', error instanceof Error ? error.message : String(error))
        continue
      }
      if (lockEntry.version !== manifest.version || lockEntry.sha256.toLowerCase() !== digest.toLowerCase()) {
        this.addIssue(manifest.id, 'official', 'official plugin version or SHA-256 does not match the production lock')
        continue
      }
      await this.addPackage(directory, manifest, digest, 'official')
    }
    for (const id of locked.keys()) {
      if (!seen.has(id)) this.addIssue(id, 'official', 'official lock references a missing plugin package')
    }
  }

  private async loadDevelopmentLocked(): Promise<void> {
    const root = trim(this.options.developmentDirectory)
    if (!root || root === '.') return
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.addIssue('development', 'development', `read development plugin directory: ${error instanceof Error ? error.message : error}`)
      return
    }
    for (const name of entries) {
      if (name === '.gitkeep') continue
      const directory = join(root, name)
      const info = await lstat(directory).catch(() => null)
      if (!info || info.isSymbolicLink() || !info.isDirectory()) {
        this.addIssue(name, 'development', 'development plugin entry must be a non-symlink directory')
        continue
      }
      let manifest: Manifest
      try {
        manifest = await readManifest(directory)
      } catch (error) {
        this.addIssue(name, 'development', error instanceof Error ? error.message : String(error))
        continue
      }
      if (name !== manifest.id) {
        this.addIssue(manifest.id, 'development', 'development plugin directory must equal its manifest id')
        continue
      }
      if (manifest.apiVersion !== API_VERSION) {
        this.addIssue(manifest.id, 'development', 'development plugins must use milksu.plugin/v1')
        continue
      }
      try {
        validateThirdPartyTools(manifest)
      } catch (error) {
        this.addIssue(manifest.id, 'development', error instanceof Error ? error.message : String(error))
        continue
      }
      const existing = this.items.get(manifest.id)
      if (existing?.source === 'official') {
        this.addIssue(manifest.id, 'development', 'development plugin cannot shadow an official plugin')
        continue
      }
      let digest: string
      try {
        digest = await packageDigest(directory)
      } catch (error) {
        this.addIssue(manifest.id, 'development', error instanceof Error ? error.message : String(error))
        continue
      }
      await this.addPackage(directory, manifest, digest, 'development')
    }
  }

  private async loadInstalledLocked(): Promise<void> {
    let index: InstalledIndex
    let trust
    try {
      index = await readInstalledIndex(installedIndexPath(this.options))
      trust = await readTrustStoreFile(trustStorePath(this.options))
    } catch (error) {
      this.addIssue('installed', 'installed', error instanceof Error ? error.message : String(error))
      return
    }
    for (const id of Object.keys(index.plugins).sort()) {
      const installed = index.plugins[id]!
      if (this.items.has(id)) {
        this.addIssue(id, 'installed', 'installed plugin cannot shadow an official plugin')
        continue
      }
      try {
        const directory = resolveInstalledDirectory(this.options, installed.active.directory)
        const verified = await verifyInstalledDirectory(directory, trust)
        if (
          verified.manifest.apiVersion !== API_VERSION
          || verified.manifest.id !== id
          || verified.manifest.version !== installed.active.version
          || verified.manifest.publisher?.keyId !== installed.active.publisherKeyId
          || verified.digest.toLowerCase() !== installed.active.digest.toLowerCase()
        ) {
          throw new Error('installed plugin metadata does not match its signed package')
        }
        await this.addPackage(directory, verified.manifest, verified.digest, 'installed')
        this.items.get(id)!.canRollback = Boolean(installed.previous)
      } catch (error) {
        this.addIssue(id, 'installed', error instanceof Error ? error.message : String(error))
      }
    }
  }

  private descriptorLocked(record: PackageRecord): Descriptor {
    let enabled = Boolean(this.state.enabled[record.manifest.id])
    let status: Descriptor['status'] = enabled ? 'ready' : 'disabled'
    if (record.errorText) {
      status = 'error'
      enabled = false
    }
    const descriptor: Descriptor = {
      id: record.manifest.id,
      name: record.manifest.name,
      version: record.manifest.version,
      api_version: record.manifest.apiVersion,
      runtime: record.manifest.runtime.kind,
      source: record.source,
      publisher: record.manifest.publisher,
      digest: record.digest,
      permissions: [...record.manifest.permissions],
      contributions: record.manifest.contributes ?? {},
      enabled,
      status,
      has_settings: Boolean(record.manifest.ui?.settingsEntry),
    }
    if (record.errorText) descriptor.error = record.errorText
    if (record.canRollback) descriptor.can_rollback = true
    if (this.state.external[record.manifest.id]) descriptor.external_enabled = true
    if (Object.keys(record.theme.default).length) descriptor.theme_tokens = record.theme.default
    if (Object.keys(record.theme.light).length) descriptor.light_theme_tokens = record.theme.light
    if (Object.keys(record.theme.dark).length) descriptor.dark_theme_tokens = record.theme.dark
    return descriptor
  }

  async list(): Promise<Descriptor[]> {
    return this.mu.run(async () => {
      let stateErr: Error | undefined
      try {
        await this.refreshStateLocked()
      } catch (error) {
        this.state = defaultState()
        stateErr = error instanceof Error ? error : new Error(String(error))
      }
      const result = [...this.items.values()].map((record) => this.descriptorLocked(record))
      result.push(...this.issues)
      if (stateErr) {
        result.push({
          id: 'state', name: 'plugin state', version: '', api_version: '', runtime: 'lua', source: 'official',
          digest: '', permissions: [], contributions: {}, enabled: false, status: 'error',
          error: `refresh plugin state: ${stateErr.message}`, has_settings: false,
        })
      }
      result.sort((a, b) => a.source === b.source ? a.id.localeCompare(b.id) : a.source.localeCompare(b.source))
      return result
    })
  }

  async listPetPluginPackages(): Promise<PetPluginPackage[]> {
    return this.mu.run(async () => {
      try {
        await this.refreshStateLocked()
      } catch {
        this.state = defaultState()
      }
      const result: PetPluginPackage[] = []
      for (const record of this.items.values()) {
        if (record.errorText || !this.state.enabled[record.manifest.id]) continue
        if (!hasPermission(record.manifest.permissions, 'ui.pet') || !contributesSlot(record.manifest.contributes?.slots, 'app.pet')) continue
        result.push({ id: record.manifest.id, name: record.manifest.name, directory: record.directory })
      }
      result.sort((a, b) => a.id.localeCompare(b.id))
      return result
    })
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.mu.run(async () => {
      await this.refreshStateLocked()
      const record = this.items.get(trim(id))
      if (!record) throw new Error(`plugin "${id}" is not installed`)
      if (record.errorText) throw new Error(`plugin "${id}" is unavailable: ${record.errorText}`)
      const next = clonePersistedState(this.state)
      if (enabled && contributesSlot(record.manifest.contributes?.slots, 'app.background')) {
        for (const [candidateID, candidate] of this.items) {
          if (candidateID !== record.manifest.id && contributesSlot(candidate.manifest.contributes?.slots, 'app.background')) {
            next.enabled[candidateID] = false
          }
        }
      }
      next.enabled[record.manifest.id] = enabled
      if (!enabled) next.external[record.manifest.id] = false
      await this.commitStateLocked(next)
    })
  }

  async setExternalEnabled(id: string, enabled: boolean): Promise<void> {
    await this.mu.run(async () => {
      await this.refreshStateLocked()
      const record = this.items.get(id)
      if (!record || record.errorText) throw new Error('plugin is unavailable')
      if (enabled && (!this.state.enabled[id] || !hasPermission(record.manifest.permissions, 'mcp.external.read'))) {
        throw new Error('plugin must be enabled and granted mcp.external.read before external exposure')
      }
      const next = clonePersistedState(this.state)
      next.external[id] = enabled
      await this.commitStateLocked(next)
    })
  }

  private async enabledRecord(id: string): Promise<PackageRecord> {
    return this.mu.run(async () => {
      await this.refreshStateLocked()
      const record = this.items.get(trim(id))
      if (!record) throw new Error(`plugin "${id}" is not installed`)
      if (record.errorText) throw new Error(`plugin "${id}" is unavailable`)
      if (!this.state.enabled[record.manifest.id]) throw new Error(`plugin "${id}" is disabled`)
      const copy = { ...record, manifest: record.manifest, theme: record.theme }
      if (copy.source === 'official') {
        const digest = await packageDigest(copy.directory)
        if (digest.toLowerCase() !== copy.digest.toLowerCase()) {
          throw new Error(`official plugin "${id}" changed after verification`)
        }
      } else if (copy.source === 'installed') {
        const trust = await readTrustStoreFile(trustStorePath(this.options))
        const verified = await verifyInstalledDirectory(copy.directory, trust)
        if (verified.manifest.id !== copy.manifest.id || verified.manifest.version !== copy.manifest.version || verified.digest.toLowerCase() !== copy.digest.toLowerCase()) {
          throw new Error(`installed plugin "${id}" failed signature or integrity verification`)
        }
      }
      return copy
    })
  }

  async settingsScript(id: string): Promise<string> {
    const record = await this.enabledRecord(id)
    if (!record.manifest.ui?.settingsEntry) throw new Error('plugin does not contribute a settings panel')
    const path = await securePackageFile(record.directory, record.manifest.ui.settingsEntry, MAX_ENTRY_BYTES)
    return readFile(path, 'utf8')
  }

  async activeTheme(): Promise<ActiveTheme> {
    return this.mu.run(async () => {
      await this.refreshStateLocked()
      const ids = [...this.items.entries()]
        .filter(([id, record]) => this.state.enabled[id] && !record.errorText && record.manifest.theme && hasPermission(record.manifest.permissions, 'ui.theme') && contributesSlot(record.manifest.contributes?.slots, 'app.background'))
        .map(([id]) => id)
        .sort()
      if (ids.length === 0) return emptyActiveTheme()
      if (ids.length > 1) throw new Error('multiple plugins are enabled for the exclusive app.background slot')
      const id = ids[0]!
      const record = this.items.get(id)!
      return buildActiveTheme(this.options.dataDirectory, record, this.state.skin[id] ?? {})
    })
  }

  async importSurfaceAsset(id: string, slot: SurfaceSlot, selectedPath: string): Promise<ActiveTheme> {
    const record = await this.enabledRecord(id)
    assertBackgroundPermission(record)
    if (!validSurfaceSlot(slot)) throw new Error(`unsupported theme surface "${slot}"`)
    const info = await lstat(selectedPath)
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_BACKGROUND_BYTES) {
      throw new Error(`background must be a regular PNG, JPEG or WebP file no larger than ${MAX_BACKGROUND_BYTES >> 20} MiB`)
    }
    const payload = await readFile(selectedPath)
    const inspected = inspectBackground(payload)
    const directory = pluginStorageDirectory(this.options.dataDirectory, record.manifest.id)
    const written = await writeManagedAsset(directory, slot, payload, inspected.extension)
    let previous = ''
    await this.mu.run(async () => {
      await this.refreshStateLocked()
      const nextState = clonePersistedState(this.state)
      const next = nextState.skin[record.manifest.id] ?? { surfaces: {} }
      next.surfaces ??= {}
      previous = next.surfaces[slot]?.asset_id ?? ''
      const style = next.surfaces[slot] ?? { mode: 'image' }
      style.mode = 'image'
      style.asset_id = written.assetId
      if (!style.image_opacity) style.image_opacity = 0.22
      if (!style.light_mask?.color) style.light_mask = { color: '#ffffff', opacity: 0.12 }
      if (!style.dark_mask?.color) style.dark_mask = { color: '#000000', opacity: 0.22 }
      next.surfaces[slot] = style
      next.configured = true
      nextState.skin[record.manifest.id] = next
      try {
        await this.commitStateLocked(nextState)
      } catch (error) {
        if (written.created) await rm(join(directory, written.assetId), { force: true })
        throw error
      }
    })
    if (previous && previous !== written.assetId) {
      await rm(join(directory, basename(previous)), { force: true })
    }
    return this.activeTheme()
  }

  async updateSurface(id: string, slot: SurfaceSlot, style: SurfaceStyle): Promise<ActiveTheme> {
    const record = await this.enabledRecord(id)
    assertBackgroundPermission(record)
    if (!validSurfaceSlot(slot)) throw new Error(`unsupported theme surface "${slot}"`)
    const normalized = normalizeSurfaceStyle(style)
    if (normalized.mode === 'image') {
      await validateManagedSurfaceAsset(this.options.dataDirectory, id, slot, normalized.asset_id ?? '')
    }
    normalized.asset_url = undefined
    let previous = ''
    await this.mu.run(async () => {
      await this.refreshStateLocked()
      const nextState = clonePersistedState(this.state)
      const next = nextState.skin[id] ?? { surfaces: {} }
      next.surfaces ??= {}
      previous = next.surfaces[slot]?.asset_id ?? ''
      if (normalized.mode === 'inherit') delete next.surfaces[slot]
      else next.surfaces[slot] = normalized
      next.configured = Object.keys(next.surfaces).length > 0
      nextState.skin[id] = next
      await this.commitStateLocked(nextState)
    })
    if (previous && previous !== normalized.asset_id) {
      await rm(join(pluginStorageDirectory(this.options.dataDirectory, id), basename(previous)), { force: true })
    }
    return this.activeTheme()
  }

  async updateBackground(id: string, opacity: number, blur: number): Promise<ActiveTheme> {
    const record = await this.enabledRecord(id)
    if (!hasPermission(record.manifest.permissions, 'ui.background') || opacity < 0 || opacity > 0.6 || blur < 0 || blur > 24) {
      throw new Error('background update is outside the granted range')
    }
    const style = this.state.skin[id]?.surfaces?.['content-wallpaper']
    if (!style || style.mode === '' || style.mode === 'inherit') {
      await this.mu.run(async () => {
        await this.refreshStateLocked()
        const nextState = clonePersistedState(this.state)
        const next = nextState.skin[id] ?? {}
        next.opacity = opacity
        next.blur = blur
        next.configured = true
        nextState.skin[id] = next
        await this.commitStateLocked(nextState)
      })
      return this.activeTheme()
    }
    return this.updateSurface(id, 'content-wallpaper', { ...style, image_opacity: opacity, blur })
  }

  async resetSurface(id: string, slot: SurfaceSlot): Promise<ActiveTheme> {
    const record = await this.enabledRecord(id)
    if (!hasPermission(record.manifest.permissions, 'ui.background') || !contributesSlot(record.manifest.contributes?.slots, 'app.background') || !validSurfaceSlot(slot)) {
      throw new Error('plugin is not granted this theme surface')
    }
    let previous = ''
    await this.mu.run(async () => {
      await this.refreshStateLocked()
      const nextState = clonePersistedState(this.state)
      const next = nextState.skin[id] ?? { surfaces: {} }
      previous = next.surfaces?.[slot]?.asset_id ?? ''
      if (next.surfaces) delete next.surfaces[slot]
      next.configured = Object.keys(next.surfaces ?? {}).length > 0
      nextState.skin[id] = next
      await this.commitStateLocked(nextState)
    })
    if (previous) await rm(join(pluginStorageDirectory(this.options.dataDirectory, id), basename(previous)), { force: true })
    return this.activeTheme()
  }

  async resetAllSurfaces(id: string): Promise<ActiveTheme> {
    const record = await this.enabledRecord(id)
    assertBackgroundPermission(record)
    const previous: string[] = []
    await this.mu.run(async () => {
      await this.refreshStateLocked()
      const nextState = clonePersistedState(this.state)
      for (const style of Object.values(nextState.skin[id]?.surfaces ?? {})) {
        if (style.asset_id) previous.push(style.asset_id)
      }
      delete nextState.skin[id]
      await this.commitStateLocked(nextState)
    })
    for (const assetID of previous) {
      await rm(join(pluginStorageDirectory(this.options.dataDirectory, id), basename(assetID)), { force: true })
    }
    return this.activeTheme()
  }

  async surfaceAsset(id: string, slot: SurfaceSlot, assetID: string): Promise<PluginAssetResponse> {
    const record = await this.enabledRecord(id)
    if (!hasPermission(record.manifest.permissions, 'ui.background') || !validSurfaceSlot(slot)) {
      throw new Error('plugin surface asset is not available')
    }
    const configured = this.state.skin[id]?.surfaces?.[slot]?.asset_id === assetID
    if (!configured) throw new Error('plugin surface asset handle is not active')
    await validateManagedSurfaceAsset(this.options.dataDirectory, id, slot, assetID)
    const payload = await readFile(join(pluginStorageDirectory(this.options.dataDirectory, id), assetID))
    const inspected = inspectBackground(payload)
    return { mime: inspected.mime, data: payload.toString('base64') }
  }

  private invocation(record: PackageRecord, abi: string, name: string, input: unknown) {
    return runtimeInvocation(record, abi, name, input, this.hostVersion(), this.state.storage[record.manifest.id] ?? {})
  }

  async callUI(id: string, request: UIRequest): Promise<unknown> {
    const record = await this.enabledRecord(id)
    const action = trim(request.action)
    if (!action || action.length > 96) throw new Error('plugin UI action is invalid')
    const input = request.input ?? {}
    const encoded = JSON.stringify(input)
    if (Buffer.byteLength(encoded) > (1 << 20)) throw new Error('plugin UI input is invalid or oversized')
    const result = await invokeRuntime(this.options, record, this.invocation(record, 'call_ui', action, input))
    return this.dispatchUICapability(record, result)
  }

  private async dispatchUICapability(record: PackageRecord, result: RuntimeResult): Promise<unknown> {
    const capability = isObject(result.value) ? result.value : null
    if (!capability || typeof capability.capability !== 'string') {
      throw new Error('plugin UI response must be a capability envelope')
    }
    const writes = result.storageWrites ?? {}
    const hostCaps = new Set(['ui.surface.get', 'ui.surface.update', 'ui.surface.reset', 'ui.surface.reset_all', 'ui.background.get', 'ui.background.update', 'ui.background.reset'])
    if (hostCaps.has(capability.capability) && Object.keys(writes).length > 0) {
      throw new Error('host UI capabilities cannot include plugin storage writes')
    }
    const requireBackground = () => {
      if (!hasPermission(record.manifest.permissions, 'ui.background')) throw new Error('plugin lacks ui.background permission')
    }
    switch (capability.capability) {
      case 'ui.surface.get':
      case 'ui.background.get':
        requireBackground()
        return this.activeTheme()
      case 'ui.surface.update': {
        requireBackground()
        const update = isObject(capability.input) ? capability.input : {}
        return this.updateSurface(record.manifest.id, String(update.slot ?? '') as SurfaceSlot, (update.style ?? {}) as SurfaceStyle)
      }
      case 'ui.surface.reset': {
        requireBackground()
        const reset = isObject(capability.input) ? capability.input : {}
        return this.resetSurface(record.manifest.id, String(reset.slot ?? '') as SurfaceSlot)
      }
      case 'ui.surface.reset_all':
      case 'ui.background.reset':
        requireBackground()
        return this.resetAllSurfaces(record.manifest.id)
      case 'ui.background.update': {
        requireBackground()
        const update = isObject(capability.input) ? capability.input : {}
        return this.updateBackground(record.manifest.id, Number(update.opacity ?? 0), Number(update.blur ?? 0))
      }
      case 'value': {
        await this.applyStorageWrites(record, writes)
        return capability.value ?? null
      }
      default:
        throw new Error(`plugin requested unsupported UI capability "${capability.capability}"`)
    }
  }

  async callTool(pluginId: string, toolName: string, input: unknown, external: boolean): Promise<{ content: unknown }> {
    const record = await this.enabledRecord(pluginId)
    if (!hasPermission(record.manifest.permissions, 'agent.tools')) throw new Error('plugin lacks agent.tools permission')
    const descriptor = (record.manifest.contributes?.tools ?? []).find((tool) => tool.name === toolName)
    if (!descriptor) throw new Error(`plugin tool "${toolName}" is not declared`)
    if (external) {
      const externalEnabled = this.state.external[record.manifest.id]
      if (!externalEnabled || descriptor.external !== 'read' || descriptor.effect !== 'read') {
        throw new Error('plugin tool is not available through read-only external MCP')
      }
      if (!hasPermission(record.manifest.permissions, 'mcp.external.read')) {
        throw new Error('plugin lacks mcp.external.read permission')
      }
    }
    validateToolInput(input ?? {}, descriptor.inputSchema)
    const result = await invokeRuntime(this.options, record, this.invocation(record, 'call_tool', descriptor.name, input ?? {}))
    if (external && Object.keys(result.storageWrites ?? {}).length > 0) {
      throw new Error('read-only external plugin tools cannot persist storage writes')
    }
    if (record.manifest.apiVersion === API_VERSION) {
      try {
        validateToolInput(result.value, descriptor.outputSchema)
      } catch (error) {
        throw new Error(`plugin tool output: ${error instanceof Error ? error.message : error}`)
      }
    }
    await this.applyStorageWrites(record, result.storageWrites ?? {})
    return { content: result.value }
  }

  private async applyStorageWrites(record: PackageRecord, writes: Record<string, unknown>): Promise<void> {
    if (!Object.keys(writes).length) return
    if (!hasPermission(record.manifest.permissions, 'plugin.storage')) {
      throw new Error('plugin attempted storage writes without plugin.storage permission')
    }
    await this.mu.run(async () => {
      await this.refreshStateLocked()
      if (!this.state.enabled[record.manifest.id]) throw new Error('plugin was disabled while its call was running')
      const next = clonePersistedState(this.state)
      next.storage[record.manifest.id] = mergeStorageWrites(next.storage[record.manifest.id], writes)
      await this.commitStateLocked(next)
    })
  }

  async stagePackage(selectedPath: string): Promise<StagedPackageReview> {
    return this.packageMu.run(async () => {
      const { token, directory } = await extractToStaging(this.options, selectedPath)
      try {
        const index = await readInstalledIndex(installedIndexPath(this.options))
        const trust = await readTrustStoreFile(trustStorePath(this.options))
        await this.refreshStateLocked()
        const reviewed = await reviewStagedDirectory(
          this.options,
          directory,
          token,
          new Set([...this.items.values()].filter((item) => item.source === 'official').map((item) => item.manifest.id)),
          index,
          trust,
          this.hostVersion(),
          (manifest) => this.validateHostCompatibility(manifest),
          (id) => this.state.storage_versions[id] ?? 0,
          (id) => Object.keys(this.state.storage[id] ?? {}).length > 0,
        )
        const probe: PackageRecord = {
          manifest: reviewed.manifest, directory, digest: reviewed.review.digest, source: 'installed',
          theme: { default: {}, light: {}, dark: {} }, errorText: '', canRollback: false,
        }
        await invokeRuntime(this.options, probe, runtimeInvocation(probe, 'health_check', '', {}, this.hostVersion(), {}))
        this.staged.set(token, { directory, manifest: reviewed.manifest, signatures: reviewed.signatures, review: reviewed.review })
        return reviewed.review
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
    })
  }

  async discardStagedPackage(token: string): Promise<void> {
    await this.packageMu.run(async () => {
      const staged = this.staged.get(trim(token))
      this.staged.delete(trim(token))
      if (staged) await rm(staged.directory, { recursive: true, force: true })
    })
  }

  async installStagedPackage(token: string, trustPublisher: boolean, confirmSensitiveChange: boolean, resetStorage: boolean): Promise<Descriptor[]> {
    return this.packageMu.run(async () => {
      const key = trim(token)
      const staged = this.staged.get(key)
      if (!staged) throw new Error('staged plugin review expired or does not exist')
      const digest = await packagePayloadDigest(staged.directory)
      if (digest !== staged.review.digest) {
        this.staged.delete(key)
        await rm(staged.directory, { recursive: true, force: true })
        throw new Error('staged plugin changed after review')
      }
      const proofs = verifySignatureSet(staged.signatures, digest)
      const primary = proofs.get(staged.manifest.publisher?.keyId ?? '')
      if (!primary) throw new Error('manifest publisher key is not a valid package signer')
      const trust = await readTrustStoreFile(trustStorePath(this.options))
      const trusted = trustedProof(trust, staged.manifest.publisher?.name ?? '', primary)
      if (!trusted && !staged.review.key_rotation && !trustPublisher) {
        throw new Error('publisher trust confirmation is required')
      }
      if ((staged.review.permission_expansion || staged.review.major_version_change) && !confirmSensitiveChange) {
        throw new Error('permission expansion or major-version change requires explicit confirmation')
      }
      if (staged.review.storage_reset_required && !resetStorage) {
        throw new Error('upgrade has no storage migration; reset plugin data or cancel the upgrade')
      }
      this.staged.delete(key)
      const index = await readInstalledIndex(installedIndexPath(this.options))
      const previousIndex = structuredClone(index)
      await this.refreshStateLocked()
      const previousState = clonePersistedState(this.state)
      const nextState = clonePersistedState(this.state)
      const id = staged.manifest.id
      if (resetStorage) delete nextState.storage[id]
      else if (staged.review.storage_migration) {
        let from = previousState.storage_versions[id] ?? 0
        if (!from) {
          const current = index.plugins[id]
          if (current) {
            const currentManifest = await readManifest(resolveInstalledDirectory(this.options, current.active.directory))
            from = currentManifest.storageVersion ?? 0
          }
        }
        const probe: PackageRecord = {
          manifest: staged.manifest, directory: staged.directory, digest: staged.review.digest, source: 'installed',
          theme: { default: {}, light: {}, dark: {} }, errorText: '', canRollback: false,
        }
        const migrated = await invokeRuntime(this.options, probe, runtimeInvocation(probe, 'migrate_storage', '', { from, to: staged.manifest.storageVersion }, this.hostVersion(), nextState.storage[id] ?? {}))
        nextState.storage[id] = mergeStorageWrites(nextState.storage[id], migrated.storageWrites ?? {})
      }
      nextState.storage_versions[id] = staged.manifest.storageVersion ?? 1
      if (!hasPermission(staged.manifest.permissions, 'mcp.external.read')) nextState.external[id] = false
      const versionDirectory = `${staged.manifest.version}-${digest.slice(0, 16)}`
      const relativePath = `${staged.manifest.id}/${versionDirectory}`
      let destination = ''
      let snapshotPath = ''
      try {
        destination = await (async () => {
          const dest = resolveInstalledDirectory(this.options, relativePath)
          await mkdir(join(dest, '..'), { recursive: true, mode: 0o700 })
          await rename(staged.directory, dest)
          return dest
        })()
        const entry = {
          id: staged.manifest.id, version: staged.manifest.version,
          publisherKeyId: staged.manifest.publisher?.keyId ?? '', directory: relativePath, digest,
        }
        const next = { active: entry, previous: undefined as typeof entry | undefined }
        const upgrading = Boolean(index.plugins[id])
        if (upgrading) {
          const old = { ...index.plugins[id]!.active }
          snapshotPath = await writeStorageSnapshot(this.options, id, old, previousState)
          old.storageSnapshot = snapshotPath
          next.previous = old
        }
        index.plugins[id] = next
        await atomicWriteJson(installedIndexPath(this.options), index)
        await writeState(this.statePath(), nextState)
        this.state = nextState
        if (!trusted) {
          trust.publishers[primary.keyId] = {
            name: staged.manifest.publisher?.name ?? '',
            keyId: primary.keyId,
            publicKey: primary.publicKey,
            trustedAt: new Date().toISOString(),
          }
          await atomicWriteJson(trustStorePath(this.options), trust)
        }
        if (upgrading && index.plugins[id]?.previous && previousIndex.plugins[id]?.previous) {
          const stale = previousIndex.plugins[id]!.previous!
          await rm(resolveInstalledDirectory(this.options, stale.directory), { recursive: true, force: true }).catch(() => {})
          if (stale.storageSnapshot) {
            await rm(resolveStorageSnapshot(this.options, stale.storageSnapshot), { force: true }).catch(() => {})
          }
        }
      } catch (error) {
        await atomicWriteJson(installedIndexPath(this.options), previousIndex).catch(() => {})
        await writeState(this.statePath(), previousState).catch(() => {})
        this.state = previousState
        if (destination) await rename(destination, staged.directory).catch(() => {})
        if (snapshotPath) await rm(resolveStorageSnapshot(this.options, snapshotPath), { force: true }).catch(() => {})
        throw error
      }
      await this.reloadLocked()
      return this.listUnlocked()
    })
  }

  private listUnlocked(): Descriptor[] {
    const result = [...this.items.values()].map((record) => this.descriptorLocked(record))
    result.push(...this.issues)
    result.sort((a, b) => a.source === b.source ? a.id.localeCompare(b.id) : a.source.localeCompare(b.source))
    return result
  }

  async rollbackPlugin(id: string): Promise<Descriptor[]> {
    return this.packageMu.run(async () => this.mu.run(async () => {
      const index = await readInstalledIndex(installedIndexPath(this.options))
      const entry = index.plugins[id]
      if (!entry?.previous) throw new Error('plugin has no retained version to roll back to')
      const trust = await readTrustStoreFile(trustStorePath(this.options))
      const previousDirectory = resolveInstalledDirectory(this.options, entry.previous.directory)
      const verified = await verifyInstalledDirectory(previousDirectory, trust)
      if (verified.digest !== entry.previous.digest) {
        throw new Error('retained plugin version failed signature or integrity verification')
      }
      await this.refreshStateLocked()
      const previousState = clonePersistedState(this.state)
      const nextState = clonePersistedState(this.state)
      const currentSnapshot = await writeStorageSnapshot(this.options, id, entry.active, this.state)
      try {
        if (entry.previous.storageSnapshot) {
          const snapshot = await readStorageSnapshot(this.options, entry.previous.storageSnapshot)
          nextState.storage[id] = snapshot.values
          nextState.storage_versions[id] = snapshot.version
        }
        const active = { ...entry.active, storageSnapshot: currentSnapshot }
        const target = { ...entry.previous, storageSnapshot: undefined }
        const previousIndex = structuredClone(index)
        index.plugins[id] = { active: target, previous: active }
        await atomicWriteJson(installedIndexPath(this.options), index)
        try {
          await this.commitStateLocked(nextState)
        } catch (error) {
          await atomicWriteJson(installedIndexPath(this.options), previousIndex)
          await writeState(this.statePath(), previousState)
          this.state = previousState
          throw error
        }
        if (entry.previous.storageSnapshot) {
          await rm(resolveStorageSnapshot(this.options, entry.previous.storageSnapshot), { force: true }).catch(() => {})
        }
      } catch (error) {
        await rm(resolveStorageSnapshot(this.options, currentSnapshot), { force: true }).catch(() => {})
        throw error
      }
      await this.reloadLocked()
      return this.listUnlocked()
    }))
  }

  async uninstallPlugin(id: string, deleteData: boolean): Promise<Descriptor[]> {
    return this.packageMu.run(async () => this.mu.run(async () => {
      const index = await readInstalledIndex(installedIndexPath(this.options))
      const entry = index.plugins[id]
      if (!entry) throw new Error('third-party plugin is not installed')
      await this.refreshStateLocked()
      const previousIndex = structuredClone(index)
      const nextState = clonePersistedState(this.state)
      delete index.plugins[id]
      nextState.enabled[id] = false
      nextState.external[id] = false
      if (deleteData) {
        delete nextState.storage[id]
        delete nextState.storage_versions[id]
        delete nextState.skin[id]
      }
      await atomicWriteJson(installedIndexPath(this.options), index)
      try {
        await this.commitStateLocked(nextState)
      } catch (error) {
        await atomicWriteJson(installedIndexPath(this.options), previousIndex)
        throw error
      }
      await rm(resolveInstalledDirectory(this.options, entry.active.directory), { recursive: true, force: true }).catch(() => {})
      if (entry.previous) {
        await rm(resolveInstalledDirectory(this.options, entry.previous.directory), { recursive: true, force: true }).catch(() => {})
      }
      for (const version of [entry.active, entry.previous]) {
        if (version?.storageSnapshot) {
          await rm(resolveStorageSnapshot(this.options, version.storageSnapshot), { force: true }).catch(() => {})
        }
      }
      if (deleteData) await rm(pluginStorageDirectory(this.options.dataDirectory, id), { recursive: true, force: true }).catch(() => {})
      await this.reloadLocked()
      return this.listUnlocked()
    }))
  }

  async trustedPublishers(): Promise<PublisherTrustDescriptor[]> {
    const trust = await readTrustStoreFile(trustStorePath(this.options))
    return Object.values(trust.publishers)
      .map((publisher) => ({ name: publisher.name, key_id: publisher.keyId, trusted_at: publisher.trustedAt }))
      .sort((a, b) => a.key_id.localeCompare(b.key_id))
  }

  async revokePublisher(keyID: string): Promise<Descriptor[]> {
    return this.packageMu.run(async () => {
      const id = trim(keyID)
      const trust = await readTrustStoreFile(trustStorePath(this.options))
      if (!trust.publishers[id]) return this.list()
      await this.mu.run(async () => {
        await this.refreshStateLocked()
        const previousState = clonePersistedState(this.state)
        const nextState = clonePersistedState(this.state)
        for (const [pluginId, record] of this.items) {
          if (record.source === 'installed' && record.manifest.publisher?.keyId === id) {
            nextState.enabled[pluginId] = false
            nextState.external[pluginId] = false
          }
        }
        await this.commitStateLocked(nextState)
        delete trust.publishers[id]
        try {
          await atomicWriteJson(trustStorePath(this.options), trust)
        } catch (error) {
          await this.commitStateLocked(previousState)
          throw error
        }
        await this.reloadLocked()
      })
      return this.list()
    })
  }
}

async function readLockFile(path: string): Promise<{ apiVersion: string; plugins: Array<{ id: string; version: string; sha256: string }> }> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_LOCK_FILE_BYTES) {
    throw new Error('production plugin lock must be a bounded regular, non-symlink file')
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!isObject(parsed)) throw new Error('decode production plugin lock: must be an object')
  if (String(parsed.apiVersion ?? '') !== LOCK_API_VERSION) {
    throw new Error(`unsupported production plugin lock apiVersion "${String(parsed.apiVersion ?? '')}"`)
  }
  const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : []
  return {
    apiVersion: String(parsed.apiVersion),
    plugins: plugins.map((entry) => {
      const value = isObject(entry) ? entry : {}
      return { id: String(value.id ?? ''), version: String(value.version ?? ''), sha256: String(value.sha256 ?? '') }
    }),
  }
}

export type { ToolCallDescriptor, PluginBackgroundChoice }
