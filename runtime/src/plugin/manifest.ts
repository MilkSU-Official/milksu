import { extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { API_VERSION, LEGACY_API_VERSION, ALLOWED_PERMISSIONS, ALLOWED_SLOTS, MANIFEST_FILE, MAX_ENTRY_BYTES, MAX_MANIFEST_BYTES, type Manifest, type Permission, type ToolContribution } from './types.ts'
import { parseSemanticVersion } from './semver.ts'
import { validateInputSchema } from './schema.ts'
import { isObject, parseJsonObject, rejectUnknownKeys, securePackageFile, trim } from './util.ts'

const PLUGIN_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/
const CAPABILITY = /^[a-z][a-z0-9.-]{2,95}$/
const HEX_DIGEST = /^[a-f0-9]{64}$/

const MANIFEST_KEYS = new Set([
  'id', 'name', 'version', 'apiVersion', 'publisher', 'host', 'storageVersion',
  'storageMigrations', 'runtime', 'ui', 'theme', 'permissions', 'contributes',
])
const PUBLISHER_KEYS = new Set(['name', 'keyId'])
const HOST_KEYS = new Set(['minVersion', 'requiredCapabilities'])
const RUNTIME_KEYS = new Set(['kind', 'entry'])
const UI_KEYS = new Set(['settingsEntry'])
const THEME_KEYS = new Set(['source'])
const MIGRATION_KEYS = new Set(['from', 'to'])
const TOOL_KEYS = new Set(['name', 'description', 'inputSchema', 'outputSchema', 'effect', 'external'])
const CONTRIBUTES_KEYS = new Set(['slots', 'tools'])

export async function readManifest(directory: string): Promise<Manifest> {
  const path = await securePackageFile(directory, MANIFEST_FILE, MAX_MANIFEST_BYTES)
  const raw = await readFile(path, 'utf8')
  const value = parseJsonObject(raw, MANIFEST_FILE)
  const manifest = decodeManifest(value)
  await validateManifest(directory, manifest)
  return manifest
}

function decodeManifest(value: Record<string, unknown>): Manifest {
  rejectUnknownKeys(value, MANIFEST_KEYS, MANIFEST_FILE)
  const publisher = isObject(value.publisher) ? value.publisher : undefined
  if (publisher) rejectUnknownKeys(publisher, PUBLISHER_KEYS, 'publisher')
  const host = isObject(value.host) ? value.host : undefined
  if (host) rejectUnknownKeys(host, HOST_KEYS, 'host')
  const runtime = isObject(value.runtime) ? value.runtime : undefined
  if (!runtime) throw new Error('decode plugin.json: runtime is required')
  rejectUnknownKeys(runtime, RUNTIME_KEYS, 'runtime')
  const ui = isObject(value.ui) ? value.ui : undefined
  if (ui) rejectUnknownKeys(ui, UI_KEYS, 'ui')
  const theme = isObject(value.theme) ? value.theme : undefined
  if (theme) rejectUnknownKeys(theme, THEME_KEYS, 'theme')
  const migrations = Array.isArray(value.storageMigrations) ? value.storageMigrations : []
  for (const migration of migrations) {
    if (!isObject(migration)) throw new Error('storageMigrations entries must be objects')
    rejectUnknownKeys(migration, MIGRATION_KEYS, 'storageMigration')
  }
  const contributes = isObject(value.contributes) ? value.contributes : undefined
  if (contributes) rejectUnknownKeys(contributes, CONTRIBUTES_KEYS, 'contributes')
  const tools = Array.isArray(contributes?.tools) ? contributes.tools : []
  for (const tool of tools) {
    if (!isObject(tool)) throw new Error('tool contribution must be an object')
    rejectUnknownKeys(tool, TOOL_KEYS, 'tool')
  }
  return {
    id: String(value.id ?? ''),
    name: String(value.name ?? ''),
    version: String(value.version ?? ''),
    apiVersion: String(value.apiVersion ?? ''),
    publisher: publisher ? { name: String(publisher.name ?? ''), keyId: publisher.keyId ? String(publisher.keyId) : undefined } : undefined,
    host: host ? {
      minVersion: String(host.minVersion ?? ''),
      requiredCapabilities: Array.isArray(host.requiredCapabilities) ? host.requiredCapabilities.map((item) => String(item)) : undefined,
    } : undefined,
    storageVersion: typeof value.storageVersion === 'number' ? value.storageVersion : undefined,
    storageMigrations: migrations.map((migration) => ({
      from: Number((migration as Record<string, unknown>).from ?? 0),
      to: Number((migration as Record<string, unknown>).to ?? 0),
    })),
    runtime: { kind: String(runtime.kind ?? '') as Manifest['runtime']['kind'], entry: String(runtime.entry ?? '') },
    ui: ui ? { settingsEntry: ui.settingsEntry ? String(ui.settingsEntry) : undefined } : undefined,
    theme: theme ? { source: String(theme.source ?? '') } : undefined,
    permissions: Array.isArray(value.permissions) ? value.permissions.map((item) => String(item) as Permission) : [],
    contributes: contributes ? {
      slots: Array.isArray(contributes.slots) ? contributes.slots.map((item) => String(item)) : undefined,
      tools: tools.map((tool) => decodeTool(tool as Record<string, unknown>)),
    } : undefined,
  }
}

function decodeTool(tool: Record<string, unknown>): ToolContribution {
  return {
    name: String(tool.name ?? ''),
    description: String(tool.description ?? ''),
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    effect: String(tool.effect ?? '') as ToolContribution['effect'],
    external: String(tool.external ?? '') as ToolContribution['external'],
  }
}

export async function validateManifest(directory: string, value: Manifest): Promise<void> {
  if (value.apiVersion !== API_VERSION && value.apiVersion !== LEGACY_API_VERSION) {
    throw new Error(`unsupported plugin apiVersion "${value.apiVersion}"`)
  }
  if (value.id.length > 64 || !PLUGIN_ID.test(value.id)) {
    throw new Error(`invalid plugin id "${value.id}"`)
  }
  if (!trim(value.name) || value.name.length > 96) {
    throw new Error('plugin name must contain 1-96 characters')
  }
  try {
    parseSemanticVersion(value.version)
  } catch (error) {
    throw new Error(`plugin version: ${error instanceof Error ? error.message : error}`)
  }
  if (value.apiVersion === API_VERSION) {
    const publisherName = trim(value.publisher?.name)
    if (!publisherName || publisherName.length > 96) {
      throw new Error('stable plugins require a publisher name of at most 96 characters')
    }
    if (value.publisher?.keyId && !HEX_DIGEST.test(value.publisher.keyId)) {
      throw new Error('publisher keyId must be a lowercase SHA-256 fingerprint')
    }
    try {
      parseSemanticVersion(value.host?.minVersion ?? '')
    } catch (error) {
      throw new Error(`host minVersion: ${error instanceof Error ? error.message : error}`)
    }
    if (!value.storageVersion || value.storageVersion < 1) {
      throw new Error('stable plugins require storageVersion >= 1')
    }
    const seenMigrations = new Set<string>()
    for (const migration of value.storageMigrations ?? []) {
      const key = `${migration.from}->${migration.to}`
      if (migration.from === 0 || migration.to <= migration.from || migration.to > value.storageVersion) {
        throw new Error(`invalid storage migration ${migration.from} -> ${migration.to}`)
      }
      if (seenMigrations.has(key)) throw new Error(`duplicate storage migration ${migration.from} -> ${migration.to}`)
      seenMigrations.add(key)
    }
    const seenCapabilities = new Set<string>()
    for (const capability of value.host?.requiredCapabilities ?? []) {
      if (!CAPABILITY.test(capability)) throw new Error(`invalid required host capability "${capability}"`)
      if (seenCapabilities.has(capability)) throw new Error(`duplicate required host capability "${capability}"`)
      seenCapabilities.add(capability)
    }
  }
  switch (value.runtime.kind) {
    case 'lua':
      if (extname(value.runtime.entry).toLowerCase() !== '.lua') throw new Error('lua runtime entry must end in .lua')
      break
    case 'typescript': {
      const extension = extname(value.runtime.entry).toLowerCase()
      if (extension !== '.mjs' && extension !== '.js') {
        throw new Error('typescript runtime entry must be a compiled .mjs or .js bundle')
      }
      break
    }
    default:
      throw new Error(`unsupported plugin runtime "${value.runtime.kind}"`)
  }
  try {
    await securePackageFile(directory, value.runtime.entry, MAX_ENTRY_BYTES)
  } catch (error) {
    throw new Error(`runtime entry: ${error instanceof Error ? error.message : error}`)
  }
  const permissionSet = new Set<Permission>()
  for (const permission of value.permissions) {
    if (!ALLOWED_PERMISSIONS.has(permission)) throw new Error(`unsupported permission "${permission}"`)
    if (permissionSet.has(permission)) throw new Error(`duplicate permission "${permission}"`)
    permissionSet.add(permission)
  }
  if ((value.storageMigrations?.length ?? 0) > 0 && !permissionSet.has('plugin.storage')) {
    throw new Error('storage migrations require plugin.storage permission')
  }
  if (value.ui?.settingsEntry) {
    try {
      await securePackageFile(directory, value.ui.settingsEntry, MAX_ENTRY_BYTES)
    } catch (error) {
      throw new Error(`settings entry: ${error instanceof Error ? error.message : error}`)
    }
    const extension = extname(value.ui.settingsEntry).toLowerCase()
    if (extension !== '.js' && extension !== '.mjs') {
      throw new Error('settings entry must be a compiled .js or .mjs bundle')
    }
  }
  if (value.theme) {
    if (!permissionSet.has('ui.theme')) throw new Error('theme contribution requires ui.theme permission')
    try {
      await securePackageFile(directory, value.theme.source, MAX_ENTRY_BYTES)
    } catch (error) {
      throw new Error(`theme token map: ${error instanceof Error ? error.message : error}`)
    }
    if (extname(value.theme.source).toLowerCase() !== '.json') {
      throw new Error('theme source must be a compiled JSON token map')
    }
  }
  const seenSlots = new Set<string>()
  for (const slot of value.contributes?.slots ?? []) {
    if (!ALLOWED_SLOTS.has(slot)) throw new Error(`unsupported contribution slot "${slot}"`)
    if (seenSlots.has(slot)) throw new Error(`duplicate contribution slot "${slot}"`)
    seenSlots.add(slot)
  }
  if (value.ui?.settingsEntry && !seenSlots.has('settings.plugin-panel')) {
    throw new Error('settings entry requires settings.plugin-panel contribution')
  }
  if (seenSlots.has('app.pet') && !permissionSet.has('ui.pet')) {
    throw new Error('app.pet contribution requires ui.pet permission')
  }
  if (seenSlots.has('app.background')) {
    if (!permissionSet.has('ui.background')) throw new Error('app.background contribution requires ui.background permission')
    if (!value.theme) throw new Error('app.background contribution requires a compiled theme')
  }
  if (value.theme && !seenSlots.has('app.background')) {
    throw new Error('theme contribution requires the exclusive app.background slot')
  }
  const seenTools = new Set<string>()
  for (const [index, tool] of (value.contributes?.tools ?? []).entries()) {
    if (!TOOL_NAME.test(tool.name)) throw new Error(`tool ${index} has invalid name "${tool.name}"`)
    if (seenTools.has(tool.name)) throw new Error(`duplicate tool name "${tool.name}"`)
    seenTools.add(tool.name)
    if (!trim(tool.description) || tool.description.length > 512) {
      throw new Error(`tool "${tool.name}" requires a description of at most 512 characters`)
    }
    if (tool.effect !== 'read' && tool.effect !== 'write') {
      throw new Error(`tool "${tool.name}" has unsupported effect "${tool.effect}"`)
    }
    if (tool.external !== 'none' && tool.external !== 'read') {
      throw new Error(`tool "${tool.name}" has unsupported external exposure "${tool.external}"`)
    }
    if (tool.external === 'read' && tool.effect !== 'read') {
      throw new Error(`write tool "${tool.name}" cannot be exposed through read-only external MCP`)
    }
    if (tool.external === 'read' && !permissionSet.has('mcp.external.read')) {
      throw new Error(`tool "${tool.name}" requires mcp.external.read permission`)
    }
    if (!permissionSet.has('agent.tools')) {
      throw new Error(`tool "${tool.name}" requires agent.tools permission`)
    }
    try {
      validateInputSchema(tool.inputSchema)
    } catch (error) {
      throw new Error(`tool "${tool.name}" inputSchema: ${error instanceof Error ? error.message : error}`)
    }
    if (value.apiVersion === API_VERSION) {
      try {
        validateInputSchema(tool.outputSchema)
      } catch (error) {
        throw new Error(`tool "${tool.name}" outputSchema: ${error instanceof Error ? error.message : error}`)
      }
    }
  }
}
