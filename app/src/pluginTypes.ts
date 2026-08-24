export type PluginRuntime = 'lua' | 'typescript'
export type PluginSource = 'official' | 'installed' | 'development'
export type PluginStatus = 'ready' | 'disabled' | 'error'
export type PluginPermission =
  | 'plugin.storage'
  | 'ui.background'
  | 'ui.theme'
  | 'agent.tools'
  | 'mcp.external.read'

export interface PluginToolContribution {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  effect: 'read' | 'write'
  external: 'none' | 'read'
}

export interface PluginThemeTokens {
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

export interface PluginDescriptor {
  id: string
  name: string
  version: string
  api_version: string
  runtime: PluginRuntime
  source: PluginSource
  publisher?: { name: string; keyId?: string }
  digest: string
  permissions: PluginPermission[]
  contributions: {
    slots?: string[]
    tools?: PluginToolContribution[]
  }
  enabled: boolean
  status: PluginStatus
  error?: string
  has_settings: boolean
  can_rollback?: boolean
  external_enabled?: boolean
  theme_tokens?: PluginThemeTokens
  light_theme_tokens?: PluginThemeTokens
  dark_theme_tokens?: PluginThemeTokens
}

export type PluginSurfaceSlot =
  | 'content-wallpaper'
  | 'workspace-list'
  | 'control-button'
  | 'workspace-topbar'
  | 'overlay-menu'
  | 'chat-composer'

export type PluginSurfaceSolid =
  | 'original'
  | 'paper'
  | 'graphite'
  | 'black'
  | 'cyan'
  | 'gold'
  | 'gray'
  | 'custom'

export interface PluginSurfaceStyle {
  mode: 'inherit' | 'solid' | 'image'
  solid?: PluginSurfaceSolid
  custom_color?: string
  foreground?: string
  asset_id?: string
  asset_url?: string
  image_opacity?: number
  blur?: number
  light_mask?: { color?: string; opacity?: number }
  dark_mask?: { color?: string; opacity?: number }
}

export interface ActivePluginTheme {
  plugin_id?: string
  tokens: PluginThemeTokens
  light_tokens?: PluginThemeTokens
  dark_tokens?: PluginThemeTokens
  background_opacity?: number
  background_data_url?: string
  surfaces?: Partial<Record<PluginSurfaceSlot, PluginSurfaceStyle>>
}

export interface StagedPluginReview {
  token: string
  id: string
  name: string
  version: string
  current_version?: string
  publisher: { name: string; keyId?: string }
  fingerprint: string
  permissions: PluginPermission[]
  surfaces: string[]
  tools: PluginToolContribution[]
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

export interface PluginPublisherTrust {
  name: string
  key_id: string
  trusted_at: string
}

export interface PluginUIRequest {
  action: string
  input?: unknown
}

export interface PluginBackgroundChoice {
  canceled: boolean
  theme: ActivePluginTheme
}

export interface PluginMCPConfig {
  available: boolean
  command?: string
  args: string[]
  configuration: Record<string, unknown>
}
