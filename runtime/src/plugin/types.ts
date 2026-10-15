export const API_VERSION = 'milksu.plugin/v1'
export const LEGACY_API_VERSION = 'milksu.plugin/v1alpha1'
export const LOCK_API_VERSION = 'milksu.plugin-lock/v1'
export const STATE_SCHEMA = 'milksu.plugin-state/v2'
export const LEGACY_STATE_SCHEMA = 'milksu.plugin-state/v1'
export const SIGNATURE_SCHEMA = 'milksu.plugin-signature/v1'
export const INSTALLED_INDEX_SCHEMA = 'milksu.plugin-installed/v1'
export const PUBLISHER_TRUST_SCHEMA = 'milksu.plugin-publishers/v1'
export const STORAGE_SNAPSHOT_SCHEMA = 'milksu.plugin-storage-snapshot/v1'
export const PUBLISHER_KEY_SCHEMA = 'milksu.publisher-key/v1'

export const MANIFEST_FILE = 'plugin.json'
export const SIGNATURE_FILE = 'signature.json'
export const LOCK_FILE = 'plugins.lock.json'
export const STATE_FILE = 'state.json'
export const STORAGE_DIR = 'storage'
export const DEV_MODE_ENV = 'MILKSU_PLUGIN_DEV'
export const DEVELOPMENT_HOST_VERSION = '26.823.1'

export const MAX_MANIFEST_BYTES = 64 << 10
export const MAX_ENTRY_BYTES = 2 << 20
export const MAX_PACKAGE_BYTES = 16 << 20
export const MAX_PACKAGE_FILES = 128
export const MAX_PACKAGE_ARCHIVE_BYTES = 16 << 20
export const MAX_PACKAGE_METADATA_BYTES = 512 << 10
export const MAX_STATE_BYTES = 8 << 20
export const MAX_PLUGIN_STORAGE_BYTES = 256 << 10
export const MAX_RUNTIME_RESULT_BYTES = 1 << 20
export const MAX_STORAGE_VALUE_BYTES = 64 << 10
export const MAX_LOCK_FILE_BYTES = 256 << 10
export const MAX_BACKGROUND_BYTES = 16 << 20
export const MAX_BACKGROUND_DIMENSION = 8192
export const PLUGIN_CALL_TIMEOUT_MS = 2000

export const HOST_CAPABILITIES = [
  'runtime.lua.v1',
  'runtime.typescript.v1',
  'ui.settings.v1',
  'theme.surfaces.v1',
  'theme.assets.v1',
  'agent.read-tools.v1',
  'mcp.external-read.v1',
  'storage.v1',
] as const

export const ALLOWED_SLOTS = new Set(['settings.plugin-panel', 'app.background', 'app.pet'])

export type RuntimeKind = 'lua' | 'typescript'
export type Permission =
  | 'plugin.storage'
  | 'ui.background'
  | 'ui.theme'
  | 'ui.pet'
  | 'agent.tools'
  | 'mcp.external.read'
export type ToolEffect = 'read' | 'write'
export type ExternalExposure = 'none' | 'read'
export type Source = 'official' | 'installed' | 'development'
export type Status = 'ready' | 'disabled' | 'error'

export const ALLOWED_PERMISSIONS = new Set<Permission>([
  'plugin.storage',
  'ui.background',
  'ui.theme',
  'ui.pet',
  'agent.tools',
  'mcp.external.read',
])

export type SurfaceSlot =
  | 'content-wallpaper'
  | 'workspace-list'
  | 'control-button'
  | 'workspace-topbar'
  | 'overlay-menu'
  | 'chat-composer'

export const SURFACE_SLOTS: SurfaceSlot[] = [
  'content-wallpaper',
  'workspace-list',
  'control-button',
  'workspace-topbar',
  'overlay-menu',
  'chat-composer',
]

export type SurfaceMode = 'inherit' | 'solid' | 'image'
export type SurfaceSolid =
  | 'original'
  | 'paper'
  | 'graphite'
  | 'black'
  | 'cyan'
  | 'gold'
  | 'gray'
  | 'custom'

export type PublisherSpec = {
  name: string
  keyId?: string
}

export type HostSpec = {
  minVersion: string
  requiredCapabilities?: string[]
}

export type StorageMigrationSpec = {
  from: number
  to: number
}

export type RuntimeSpec = {
  kind: RuntimeKind
  entry: string
}

export type UISpec = {
  settingsEntry?: string
}

export type ThemeSpec = {
  source: string
}

export type ToolContribution = {
  name: string
  description: string
  inputSchema: unknown
  outputSchema?: unknown
  effect: ToolEffect
  external: ExternalExposure
}

export type Contributions = {
  slots?: string[]
  tools?: ToolContribution[]
}

export type Manifest = {
  id: string
  name: string
  version: string
  apiVersion: string
  publisher?: PublisherSpec
  host?: HostSpec
  storageVersion?: number
  storageMigrations?: StorageMigrationSpec[]
  runtime: RuntimeSpec
  ui?: UISpec
  theme?: ThemeSpec
  permissions: Permission[]
  contributes?: Contributions
}

export type LockEntry = {
  id: string
  version: string
  sha256: string
}

export type LockFile = {
  apiVersion: string
  plugins: LockEntry[]
}

export type ThemeTokens = {
  canvas?: string
  surface?: string
  foreground?: string
  muted_foreground?: string
  accent?: string
  border?: string
  background_opacity?: number
  background_blur?: number
  surface_opacity?: number
}

export type CompiledTheme = {
  default: ThemeTokens
  light: ThemeTokens
  dark: ThemeTokens
}

export type SurfaceMask = {
  color?: string
  opacity?: number
}

export type SurfaceStyle = {
  mode: SurfaceMode
  solid?: SurfaceSolid
  custom_color?: string
  foreground?: string
  asset_id?: string
  asset_url?: string
  image_opacity?: number
  blur?: number
  light_mask?: SurfaceMask
  dark_mask?: SurfaceMask
}

export type Descriptor = {
  id: string
  name: string
  version: string
  api_version: string
  runtime: RuntimeKind
  source: Source
  publisher?: PublisherSpec
  digest: string
  permissions: Permission[]
  contributions: Contributions
  enabled: boolean
  status: Status
  error?: string
  has_settings: boolean
  can_rollback?: boolean
  external_enabled?: boolean
  theme_tokens?: ThemeTokens
  light_theme_tokens?: ThemeTokens
  dark_theme_tokens?: ThemeTokens
}

export type CompanionPluginPackage = {
  id: string
  name: string
  directory: string
}

export type ActiveTheme = {
  plugin_id?: string
  tokens: ThemeTokens
  light_tokens?: ThemeTokens
  dark_tokens?: ThemeTokens
  background_opacity?: number
  background_data_url?: string
  surfaces?: Partial<Record<SurfaceSlot, SurfaceStyle>>
}

export type UIRequest = {
  action: string
  input?: unknown
}

export type StagedPackageReview = {
  token: string
  id: string
  name: string
  version: string
  current_version?: string
  publisher: PublisherSpec
  fingerprint: string
  permissions: Permission[]
  surfaces: string[]
  tools: ToolContribution[]
  host_min_version: string
  required_capabilities: string[]
  trusted: boolean
  key_rotation: boolean
  upgrade: boolean
  permission_expansion: boolean
  major_version_change: boolean
  storage_migration: boolean
  storage_reset_required: boolean
  digest: string
}

export type PublisherTrustDescriptor = {
  name: string
  key_id: string
  trusted_at: string
}

export type PluginBackgroundChoice = {
  canceled: boolean
  theme: ActiveTheme
}

export type PluginAssetResponse = {
  mime: string
  data: string
}

export type PluginMCPConfig = {
  available: boolean
  command?: string
  args: string[]
  configuration: Record<string, unknown>
}

export type RuntimeInvocation = {
  abi: string
  name?: string
  input: unknown
  pluginId: string
  pluginVersion: string
  apiVersion: string
  hostVersion: string
  capabilities: string[]
  permissions: Permission[]
  source: Source
  storageEnabled: boolean
  storage: Record<string, unknown>
}

export type RuntimeResult = {
  value: unknown
  storageWrites?: Record<string, unknown>
}

export type PackageRecord = {
  manifest: Manifest
  directory: string
  digest: string
  source: Source
  theme: CompiledTheme
  errorText: string
  canRollback: boolean
}

export type ToolCallDescriptor = {
  plugin_id: string
  plugin_version: string
  plugin_digest: string
  tool: ToolContribution
}

export type PluginOptions = {
  officialDirectory: string
  installedDirectory: string
  developmentDirectory?: string
  dataDirectory: string
  developmentMode?: boolean
  hostVersion?: string
  nodeExecutable?: string
  typeScriptWorker?: string
  invokeLua?: (directory: string, entry: string, request: RuntimeInvocation) => Promise<unknown>
}
