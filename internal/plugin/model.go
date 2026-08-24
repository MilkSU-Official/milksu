package plugin

import "encoding/json"

const (
	APIVersion       = "milksu.plugin/v1"
	LegacyAPIVersion = "milksu.plugin/v1alpha1"
	LockAPIVersion   = "milksu.plugin-lock/v1"
)

var HostCapabilities = []string{
	"runtime.lua.v1",
	"runtime.typescript.v1",
	"ui.settings.v1",
	"theme.surfaces.v1",
	"theme.assets.v1",
	"agent.read-tools.v1",
	"mcp.external-read.v1",
	"storage.v1",
}

type RuntimeKind string

const (
	RuntimeLua        RuntimeKind = "lua"
	RuntimeTypeScript RuntimeKind = "typescript"
)

type Permission string

const (
	PermissionStorage         Permission = "plugin.storage"
	PermissionUIBackground    Permission = "ui.background"
	PermissionUITheme         Permission = "ui.theme"
	PermissionAgentTools      Permission = "agent.tools"
	PermissionMCPExternalRead Permission = "mcp.external.read"
)

type RuntimeSpec struct {
	Kind  RuntimeKind `json:"kind"`
	Entry string      `json:"entry"`
}

type UISpec struct {
	SettingsEntry string `json:"settingsEntry,omitempty"`
}

type ThemeSpec struct {
	// Source points at the token-map JSON emitted by scripts/build-plugins.mjs.
	// Runtime code never injects an author-supplied CSS document.
	Source string `json:"source"`
}

type PublisherSpec struct {
	Name  string `json:"name"`
	KeyID string `json:"keyId,omitempty"`
}

type HostSpec struct {
	MinVersion           string   `json:"minVersion"`
	RequiredCapabilities []string `json:"requiredCapabilities,omitempty"`
}

type StorageMigrationSpec struct {
	From uint `json:"from"`
	To   uint `json:"to"`
}

type ToolEffect string

const (
	ToolEffectRead  ToolEffect = "read"
	ToolEffectWrite ToolEffect = "write"
)

type ExternalExposure string

const (
	ExternalNone ExternalExposure = "none"
	ExternalRead ExternalExposure = "read"
)

type ToolContribution struct {
	Name         string           `json:"name"`
	Description  string           `json:"description"`
	InputSchema  json.RawMessage  `json:"inputSchema"`
	OutputSchema json.RawMessage  `json:"outputSchema,omitempty"`
	Effect       ToolEffect       `json:"effect"`
	External     ExternalExposure `json:"external"`
}

type Contributions struct {
	Slots []string           `json:"slots,omitempty"`
	Tools []ToolContribution `json:"tools,omitempty"`
}

type Manifest struct {
	ID                string                 `json:"id"`
	Name              string                 `json:"name"`
	Version           string                 `json:"version"`
	APIVersion        string                 `json:"apiVersion"`
	Publisher         PublisherSpec          `json:"publisher,omitempty"`
	Host              HostSpec               `json:"host,omitempty"`
	StorageVersion    uint                   `json:"storageVersion,omitempty"`
	StorageMigrations []StorageMigrationSpec `json:"storageMigrations,omitempty"`
	Runtime           RuntimeSpec            `json:"runtime"`
	UI                *UISpec                `json:"ui,omitempty"`
	Theme             *ThemeSpec             `json:"theme,omitempty"`
	Permissions       []Permission           `json:"permissions"`
	Contributes       Contributions          `json:"contributes,omitempty"`
}

type LockFile struct {
	APIVersion string      `json:"apiVersion"`
	Plugins    []LockEntry `json:"plugins"`
}

type LockEntry struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

type Source string

const (
	SourceOfficial    Source = "official"
	SourceInstalled   Source = "installed"
	SourceDevelopment Source = "development"
)

type Status string

const (
	StatusReady    Status = "ready"
	StatusDisabled Status = "disabled"
	StatusError    Status = "error"
)

type Descriptor struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Version         string        `json:"version"`
	APIVersion      string        `json:"api_version"`
	Runtime         RuntimeKind   `json:"runtime"`
	Source          Source        `json:"source"`
	Publisher       PublisherSpec `json:"publisher,omitempty"`
	Digest          string        `json:"digest"`
	Permissions     []Permission  `json:"permissions"`
	Contributions   Contributions `json:"contributions"`
	Enabled         bool          `json:"enabled"`
	Status          Status        `json:"status"`
	Error           string        `json:"error,omitempty"`
	HasSettings     bool          `json:"has_settings"`
	CanRollback     bool          `json:"can_rollback,omitempty"`
	ExternalEnabled bool          `json:"external_enabled,omitempty"`
	ThemeTokens     ThemeTokens   `json:"theme_tokens,omitempty"`
	LightTokens     ThemeTokens   `json:"light_theme_tokens,omitempty"`
	DarkTokens      ThemeTokens   `json:"dark_theme_tokens,omitempty"`
}

type SurfaceSlot string

const (
	SurfaceContentWallpaper SurfaceSlot = "content-wallpaper"
	SurfaceWorkspaceList    SurfaceSlot = "workspace-list"
	SurfaceControlButton    SurfaceSlot = "control-button"
	SurfaceWorkspaceTopbar  SurfaceSlot = "workspace-topbar"
	SurfaceOverlayMenu      SurfaceSlot = "overlay-menu"
	SurfaceChatComposer     SurfaceSlot = "chat-composer"
)

var SurfaceSlots = []SurfaceSlot{
	SurfaceContentWallpaper,
	SurfaceWorkspaceList,
	SurfaceControlButton,
	SurfaceWorkspaceTopbar,
	SurfaceOverlayMenu,
	SurfaceChatComposer,
}

type SurfaceMode string

const (
	SurfaceModeInherit SurfaceMode = "inherit"
	SurfaceModeSolid   SurfaceMode = "solid"
	SurfaceModeImage   SurfaceMode = "image"
)

type SurfaceSolid string

const (
	SurfaceSolidOriginal SurfaceSolid = "original"
	SurfaceSolidPaper    SurfaceSolid = "paper"
	SurfaceSolidGraphite SurfaceSolid = "graphite"
	SurfaceSolidBlack    SurfaceSolid = "black"
	SurfaceSolidCyan     SurfaceSolid = "cyan"
	SurfaceSolidGold     SurfaceSolid = "gold"
	SurfaceSolidGray     SurfaceSolid = "gray"
	SurfaceSolidCustom   SurfaceSolid = "custom"
)

type SurfaceMask struct {
	Color   string  `json:"color,omitempty"`
	Opacity float64 `json:"opacity,omitempty"`
}

type SurfaceStyle struct {
	Mode         SurfaceMode  `json:"mode"`
	Solid        SurfaceSolid `json:"solid,omitempty"`
	CustomColor  string       `json:"custom_color,omitempty"`
	Foreground   string       `json:"foreground,omitempty"`
	AssetID      string       `json:"asset_id,omitempty"`
	AssetURL     string       `json:"asset_url,omitempty"`
	ImageOpacity float64      `json:"image_opacity,omitempty"`
	Blur         float64      `json:"blur,omitempty"`
	LightMask    SurfaceMask  `json:"light_mask,omitempty"`
	DarkMask     SurfaceMask  `json:"dark_mask,omitempty"`
}

type ThemeTokens struct {
	Canvas            string  `json:"canvas,omitempty"`
	Surface           string  `json:"surface,omitempty"`
	Foreground        string  `json:"foreground,omitempty"`
	MutedForeground   string  `json:"muted_foreground,omitempty"`
	Accent            string  `json:"accent,omitempty"`
	Border            string  `json:"border,omitempty"`
	BackgroundOpacity float64 `json:"background_opacity,omitempty"`
	BackgroundBlur    float64 `json:"background_blur,omitempty"`
	SurfaceOpacity    float64 `json:"surface_opacity,omitempty"`
}

type ActiveTheme struct {
	PluginID          string                       `json:"plugin_id,omitempty"`
	Tokens            ThemeTokens                  `json:"tokens"`
	LightTokens       ThemeTokens                  `json:"light_tokens,omitempty"`
	DarkTokens        ThemeTokens                  `json:"dark_tokens,omitempty"`
	BackgroundOpacity *float64                     `json:"background_opacity,omitempty"`
	BackgroundDataURL string                       `json:"background_data_url,omitempty"`
	Surfaces          map[SurfaceSlot]SurfaceStyle `json:"surfaces,omitempty"`
}

type compiledTheme struct {
	Default ThemeTokens `json:"default"`
	Light   ThemeTokens `json:"light"`
	Dark    ThemeTokens `json:"dark"`
}

type UIRequest struct {
	Action string          `json:"action"`
	Input  json.RawMessage `json:"input,omitempty"`
}

type UIResponse struct {
	Value any `json:"value,omitempty"`
}

type ToolCall struct {
	PluginID string          `json:"plugin_id"`
	ToolName string          `json:"tool_name"`
	Input    json.RawMessage `json:"input"`
}

type ToolResult struct {
	Content any `json:"content"`
}
