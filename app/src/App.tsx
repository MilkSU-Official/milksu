import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import AppSidebar from '@/components/AppSidebar'
import CommandPanel from '@/components/CommandPanel'
import UpdateInstallDialog from '@/components/UpdateInstallDialog'
import { Toaster } from '@/components/ui'
import CodingToolBudgetDialog from '@/components/CodingToolBudgetDialog'
import { useConversations } from '@/stores/conversationsStore'
import { useLabJobs } from '@/stores/labJobsStore'
import { invokeCommand, listenEvent } from '@/desktop'
import type { CTFAgentWorkspaceHandoff } from '@/ctfTypes'
import { useVulnerabilityDashboard, type VulnerabilityCodingTask } from '@/composables/useVulnerabilityDashboard'
import { syncWindowChrome } from '@/lib/hostPlatform'
import {
  applyThemeMode,
  nextThemeMode,
  readThemeMode,
  resolveThemeMode,
  writeThemeMode,
  type ResolvedThemeMode,
  type ThemeMode,
} from '@/lib/themeMode'
import {
  isDomainWorkspace,
  settingsReturnSection,
  type CTFWorkspaceSection,
} from '@/lib/workspaceNavigation'
import {
  normalizeSettingsCategory,
  type NormalizedSettingsCategory,
  type SettingsCategory,
} from '@/lib/settingsNavigation'
import {
  applyLabJobRecord,
  hydrateLabJobsFromBackend,
  removeLabJobIds,
  type LabJob,
} from '@/composables/useLabJobs'
import type { CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
import type { VulnerabilityIntel } from '@/vulnerabilityIntel'
import { executeVulnerabilityCodingHandoff } from '@/lib/vulnerabilityCodingHandoff'
import { debugLog } from '@/lib/debugMode'
import { applyUiLocale } from '@/lib/uiLocale'
import { applyUiFonts } from '@/lib/uiFonts'
import { applyUiEmphasis } from '@/lib/uiEmphasis'
import { useT } from '@/hooks/useUiLocale'
import { useStore, useStoreRuntime } from '@/lib/reactStore'
import { cn } from '@/lib/cn'
import { readWorkspaceViewState, writeWorkspaceViewState } from '@/lib/workspaceViewState'
import { buildCTFDomainTaskContext, buildCVEDomainTaskContext, type DomainTaskContext } from '@/lib/domainTaskContext'
import { labBriefing } from '@/lib/researchBriefing'
import {
  conversationWorkspaceHome,
  isHomeConversation,
  rememberItemChatAnchor,
  rememberWorkspaceConversation,
  selectAnchoredDomainConversationId,
  selectCTFResumePoint,
  selectReusableDomainConversationId,
} from '@/lib/workspaceSessionRouting'
import { agentRecoveryPrompt } from '@/lib/agentRecovery'
import { planUpdateRestart, selectUpdateResumeConversation } from '@/lib/updateRestart'
import {
  consumeUpdateResumeState,
  writeUpdateResumeState,
  type UpdateResumeState,
} from '@/lib/updateResumeState'
import { updateStatusMessage } from '@/lib/updateStatus'
import { FACTORY_DEFAULT_KERNEL } from '@/lib/agentKernel'
import { withAppSettingsDefaults, type AccountStatus, type AppSettings, type CTFChatAction, type UpdateStatus } from '@/types'
import type { ModelCatalogSnapshot } from '@/types'
import { installAppModelSettings, installModelCatalog, loadModelCatalog } from '@/modelCatalog'
import { toolBudgetToolName } from '@/lib/toolBudget'
import type {
  ActivePluginTheme,
  PluginSurfaceSlot,
  PluginSurfaceStyle,
  PluginThemeTokens,
} from '@/pluginTypes'

const ChatPage = lazy(() => import('@/components/ChatPage'))
const AccountLoginPage = lazy(() => import('@/components/AccountLoginPage'))
const CTFPage = lazy(() => import('@/components/CTFPage'))
const ProfilePage = lazy(() => import('@/components/ProfilePage'))
const SettingsPage = lazy(() => import('@/components/SettingsPage'))
const VulnPage = lazy(() => import('@/components/VulnPage'))
const LabPage = lazy(() => import('@/components/LabPage'))

type Section = 'chat' | 'ctf' | 'vuln' | 'lab' | 'profile' | 'settings'
type DomainHome = 'ctf' | 'vuln' | 'lab'

const localAccountModeKey = 'milksu.account.continue-local'
const solidColors: Record<string, string> = {
  paper: '#f4f1e8', graphite: '#252525', black: '#000000', cyan: '#008ccf',
  gold: '#f5c842', gray: '#6b7280',
}

function readLocalAccountMode() {
  try {
    return window.localStorage?.getItem(localAccountModeKey) === '1'
  } catch {
    return false
  }
}

function writeLocalAccountMode(enabled: boolean) {
  try {
    if (enabled) window.localStorage?.setItem(localAccountModeKey, '1')
    else window.localStorage?.removeItem(localAccountModeKey)
  } catch {
    // Some embedded or test renderers intentionally expose no local storage.
  }
}

function normalizeActivePluginTheme(value: ActivePluginTheme | null | undefined): ActivePluginTheme {
  const slots: PluginSurfaceSlot[] = [
    'content-wallpaper', 'workspace-list', 'control-button',
    'workspace-topbar', 'overlay-menu', 'chat-composer',
  ]
  const surfaces = Object.fromEntries(slots.map(slot => [slot, { mode: 'inherit' }])) as Record<PluginSurfaceSlot, PluginSurfaceStyle>
  if (!value) return { tokens: {}, surfaces }
  Object.assign(surfaces, value.surfaces ?? {})
  if (value.background_data_url && surfaces['content-wallpaper'].mode === 'inherit') {
    surfaces['content-wallpaper'] = {
      mode: 'image', asset_url: value.background_data_url,
      image_opacity: value.background_opacity ?? value.tokens?.background_opacity ?? 0.22,
      blur: value.tokens?.background_blur ?? 0,
      light_mask: { color: '#ffffff', opacity: 0.12 },
      dark_mask: { color: '#000000', opacity: 0.22 },
    }
  }
  return { ...value, tokens: value.tokens ?? {}, surfaces }
}

function surfaceColor(surface: PluginSurfaceStyle) {
  return surface.solid === 'custom' ? surface.custom_color : solidColors[surface.solid ?? '']
}

function contrastingForeground(color: string | undefined, resolvedTheme: ResolvedThemeMode) {
  if (!/^#[0-9a-f]{6}$/iu.test(color ?? '')) return resolvedTheme === 'dark' ? '#f8f8f5' : '#101c2b'
  const channels = [1, 3, 5].map(offset => Number.parseInt(color!.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#101c2b' : '#f8f8f5'
}

function maskColor(surface: PluginSurfaceStyle, resolvedTheme: ResolvedThemeMode) {
  const mask = resolvedTheme === 'dark' ? surface.dark_mask : surface.light_mask
  const color = /^#[0-9a-f]{6}$/iu.test(mask?.color ?? '') ? mask?.color : resolvedTheme === 'dark' ? '#000000' : '#ffffff'
  const opacity = Math.min(1, Math.max(0, mask?.opacity ?? 0))
  return `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`
}

function surfaceForeground(surface: PluginSurfaceStyle, resolvedTheme: ResolvedThemeMode) {
  if (surface.mode === 'solid') return surface.foreground || contrastingForeground(surfaceColor(surface), resolvedTheme)
  const mask = resolvedTheme === 'dark' ? surface.dark_mask : surface.light_mask
  if ((mask?.opacity ?? 0) >= 0.45) return contrastingForeground(mask?.color, resolvedTheme)
  return resolvedTheme === 'dark' ? '#f8f8f5' : '#101c2b'
}

function surfaceBackground(surface: PluginSurfaceStyle, fallback: string, resolvedTheme: ResolvedThemeMode) {
  if (surface.mode === 'solid') return surfaceColor(surface) || fallback
  if (surface.mode !== 'image' || !surface.asset_url) return fallback
  const visibility = Math.min(0.6, Math.max(0, surface.image_opacity ?? 0.22))
  const cover = Math.round((1 - visibility) * 100)
  const mask = maskColor(surface, resolvedTheme)
  return `linear-gradient(${mask}, ${mask}), linear-gradient(color-mix(in srgb, ${fallback} ${cover}%, transparent), color-mix(in srgb, ${fallback} ${cover}%, transparent)), url("${surface.asset_url}")`
}

function startupLog(label: string, detail = '') {
  const suffix = detail ? ` ${detail}` : ''
  console.info(`[startup] ${label}${suffix}`)
}

async function timedStartupStep<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    return await work()
  } finally {
    startupLog(label, `${Math.round(performance.now() - started)}ms`)
  }
}

export default function App() {
  const t = useT()
  const restoredViewState = useRef(readWorkspaceViewState()).current
  const openPluginSettingsOnStartup = useRef(
    typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('open-settings') === 'plugins',
  ).current
  const conversations = useConversations()
  const vulnerabilityDashboard = useStoreRuntime(useVulnerabilityDashboard)
  const labJobs = useLabJobs()
  useStore(labJobs.store)

  const [section, setSection] = useState<Section>(openPluginSettingsOnStartup ? 'settings' : restoredViewState?.section ?? 'ctf')
  const [keptWorkspacePages, setKeptWorkspacePages] = useState<Set<DomainHome>>(() => {
    const initial = openPluginSettingsOnStartup ? 'settings' : restoredViewState?.section ?? 'ctf'
    return initial === 'ctf' || initial === 'vuln' || initial === 'lab' ? new Set([initial]) : new Set()
  })
  const [codingConversationDrawerOpen, setCodingConversationDrawerOpen] = useState(restoredViewState?.codingHistoryOpen ?? true)
  const [ctfSection, setCtfSection] = useState<CTFWorkspaceSection>(restoredViewState?.ctfSection ?? 'catalog')
  const [ctfResumeJobId, setCtfResumeJobId] = useState<string | null>(null)
  const [ctfCatalogEpoch, setCtfCatalogEpoch] = useState(0)
  const [vulnNavigationEpoch, setVulnNavigationEpoch] = useState(0)
  const lastCodingConversationId = useRef<string | null>(null)
  const lastCTFConversationId = useRef<string | null>(null)
  const lastLabConversationId = useRef<string | null>(null)
  const activeVulnerabilityCodingConversationId = useRef<string | null>(null)
  const itemChatAnchors = useRef<Record<string, string>>({})
  const [domainChatMaximized, setDomainChatMaximizedState] = useState({ ctf: false, vuln: false, lab: false })
  const [domainChatDockOpen, setDomainChatDockOpenState] = useState({ ctf: false, vuln: false, lab: false })
  const [vulnerabilityCodingWorkspacePath, setVulnerabilityCodingWorkspacePath] = useState('')
  const [settingsReturnTarget, setSettingsReturnTarget] = useState<Exclude<Section, 'settings'>>(restoredViewState?.settingsReturnTarget ?? 'ctf')
  const [settingsCategory, setSettingsCategory] = useState<NormalizedSettingsCategory>(openPluginSettingsOnStartup ? 'plugins' : 'general')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [accountStatus, setAccountStatus] = useState<AccountStatus>({ configured: false, authenticated: false, state: 'unconfigured' })
  const [accountLoaded, setAccountLoaded] = useState(false)
  const [accountLoginBusy, setAccountLoginBusy] = useState(false)
  const [accountLoginError, setAccountLoginError] = useState('')
  const [continueWithoutAccount, setContinueWithoutAccount] = useState(readLocalAccountMode)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [installUpdatePromptOpen, setInstallUpdatePromptOpen] = useState(false)
  const [commandPanelOpen, setCommandPanelOpen] = useState(false)
  const [pendingUpdateResume, setPendingUpdateResume] = useState<UpdateResumeState | null>(null)
  const installingUpdate = useRef(false)
  const updateRestartDeferred = useRef(false)
  const applyingUpdate = useRef(false)
  const confirmingUpdateRestart = useRef(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode)
  const [systemDark, setSystemDark] = useState(false)
  const [pluginTheme, setPluginTheme] = useState<ActivePluginTheme>(() => normalizeActivePluginTheme(null))
  const [runtimeStatus, setRuntimeStatus] = useState<'ready' | 'starting' | 'recovering' | 'exited'>('ready')
  const workspaceViewStateReady = useRef(false)
  const documentPluginSurfaceProperties = useRef(new Set<string>())
  const accountStatusRef = useRef(accountStatus)
  const updateStatusRef = useRef(updateStatus)
  const themeModeRef = useRef(themeMode)
  const sectionRef = useRef(section)
  const settingsReturnTargetRef = useRef(settingsReturnTarget)
  const codingConversationDrawerOpenRef = useRef(codingConversationDrawerOpen)
  const ctfSectionRef = useRef(ctfSection)
  accountStatusRef.current = accountStatus
  updateStatusRef.current = updateStatus
  themeModeRef.current = themeMode
  sectionRef.current = section
  settingsReturnTargetRef.current = settingsReturnTarget
  codingConversationDrawerOpenRef.current = codingConversationDrawerOpen
  ctfSectionRef.current = ctfSection

  const conv = {
    rows: conversations.conversations,
    activeId: conversations.activeId,
    active: conversations.active,
    workspacePath: conversations.workspacePath,
    running: conversations.activeRunning,
    aborting: conversations.activeAborting,
    abortStalled: conversations.activeAbortStalled,
    messageQueue: conversations.activeMessageQueue,
    sessionReady: conversations.activeSessionReady,
    resumed: conversations.activeResumed,
    compacting: conversations.activeCompacting,
    compactedAt: conversations.activeCompactedAt,
    compactionError: conversations.activeCompactionError,
    turnStatus: conversations.activeTurnStatus,
    runningIds: conversations.runningConversationIds,
    actionError: conversations.conversationActionError,
    kernel: conversations.selectedKernel,
    modelMode: conversations.selectedModelMode,
    modelProvider: conversations.selectedModelProvider,
    modelId: conversations.selectedModelId,
    thinkingLevel: conversations.selectedThinkingLevel,
    modelSourcePreference: conversations.selectedModelSourcePreference,
    executionMode: conversations.selectedExecutionMode,
    approvalPolicy: conversations.selectedApprovalPolicy,
    mcpServers: conversations.selectedMCPServers,
    mcpConfigDigest: conversations.selectedMCPConfigDigest,
    pendingComposerDraft: conversations.pendingComposerDraft,
    engineNotice: conversations.engineNotice,
    engineNoticeRepeat: conversations.engineNoticeRepeat,
  }
  const trackedVulnerabilities = vulnerabilityDashboard.tracked
  const toolBudgetPrompt = useMemo(() => {
    for (const conversation of conversations.conversations) {
      const pending = [...conversation.messages].reverse().find(message => (
        message.toolName === toolBudgetToolName
        && message.approvalState === 'pending'
        && message.approvalRequestId
      ))
      if (!pending?.approvalRequestId) continue
      const count = Number.parseInt(String(pending.approvalInput || '0'), 10)
      return {
        requestId: pending.approvalRequestId,
        count: Number.isFinite(count) && count > 0 ? count : 150,
      }
    }
    return null
  }, [conversations.conversations])

  const resolvedTheme = useMemo<ResolvedThemeMode>(
    () => resolveThemeMode(themeMode, systemDark),
    [themeMode, systemDark],
  )
  const resolvedPluginTokens = useMemo<PluginThemeTokens>(() => ({
    ...pluginTheme.tokens,
    ...(resolvedTheme === 'dark' ? pluginTheme.dark_tokens : pluginTheme.light_tokens),
  }), [pluginTheme, resolvedTheme])
  const pluginRootStyle = useMemo<CSSProperties>(() => {
    if (!pluginTheme.plugin_id) return {}
    const tokens = resolvedPluginTokens
    const style: Record<string, string> = {}
    const assign = (names: string[], value?: string) => {
      if (!value) return
      for (const name of names) style[name] = value
    }
    assign(['--background', '--surface-editor'], tokens.canvas)
    assign(['--card', '--popover', '--surface-composer'], tokens.surface)
    assign(['--foreground', '--card-foreground', '--popover-foreground'], tokens.foreground)
    assign(['--muted-foreground'], tokens.muted_foreground)
    assign(['--brand', '--primary', '--ring'], tokens.accent)
    assign(['--border', '--input', '--border-hairline'], tokens.border)
    const surfaceOpacity = tokens.surface_opacity || 0.88
    style['--plugin-surface-percent'] = `${Math.round(Math.min(1, Math.max(0.55, surfaceOpacity)) * 100)}%`
    const fallback: Record<Exclude<PluginSurfaceSlot, 'content-wallpaper'>, string> = {
      'workspace-list': 'var(--card)',
      'control-button': 'var(--secondary)',
      'workspace-topbar': 'var(--surface-editor)',
      'overlay-menu': 'var(--popover)',
      'chat-composer': 'var(--surface-composer)',
    }
    for (const slot of Object.keys(fallback) as Array<Exclude<PluginSurfaceSlot, 'content-wallpaper'>>) {
      const surface = pluginTheme.surfaces?.[slot]
      if (!surface || surface.mode === 'inherit') continue
      const prefix = `--plugin-${slot}`
      style[`${prefix}-background`] = surfaceBackground(surface, fallback[slot], resolvedTheme)
      style[`${prefix}-foreground`] = surfaceForeground(surface, resolvedTheme)
      style[`${prefix}-blur`] = `${Math.min(24, Math.max(0, surface.blur ?? 0))}px`
    }
    return style
  }, [pluginTheme, resolvedPluginTokens, resolvedTheme])
  const contentSurface = pluginTheme.surfaces?.['content-wallpaper'] ?? { mode: 'inherit' as const }
  const pluginBackgroundStyle = useMemo<CSSProperties>(() => {
    const surface = contentSurface
    const style: CSSProperties = {}
    if (surface.mode !== 'image' || !surface.asset_url) return style
    style.backgroundImage = `url("${surface.asset_url}")`
    style.opacity = String(Math.min(0.6, Math.max(0, surface.image_opacity ?? 0.22)))
    style.filter = `blur(${Math.min(24, Math.max(0, surface.blur ?? 0))}px)`
    return style
  }, [contentSurface])
  const pluginContentMaskStyle = useMemo<CSSProperties>(() => {
    const surface = contentSurface
    const style: CSSProperties = {}
    if (surface.mode === 'solid') style.backgroundColor = surfaceColor(surface) || 'var(--background)'
    if (surface.mode === 'image') style.backgroundColor = maskColor(surface, resolvedTheme)
    return style
  }, [contentSurface, resolvedTheme])

  function surfaceActive(slot: PluginSurfaceSlot) {
    return (pluginTheme.surfaces?.[slot]?.mode ?? 'inherit') !== 'inherit'
  }

  function syncDocumentPluginSurfaces() {
    if (typeof document === 'undefined') return
    for (const property of documentPluginSurfaceProperties.current) document.documentElement.style.removeProperty(property)
    documentPluginSurfaceProperties.current.clear()
    for (const [property, value] of Object.entries(pluginRootStyle)) {
      if (!property.startsWith('--plugin-')) continue
      document.documentElement.style.setProperty(property, String(value))
      documentPluginSurfaceProperties.current.add(property)
    }
    document.documentElement.classList.toggle('plugin-surface-overlay-menu-active', surfaceActive('overlay-menu'))
  }

  const defaultTaskModel = settings
    ? { provider: settings.active_provider, model: settings.active_model }
    : null
  const activeProvider = defaultTaskModel ? settings?.providers[defaultTaskModel.provider] : undefined
  const accountModelReady = Boolean(
    accountStatus.state === 'active'
    && settings?.relay?.enabled
    && settings.relay.has_key,
  )
  const personalModelReady = Boolean(activeProvider?.enabled && activeProvider.has_api_key)
  const modelReady = accountModelReady || personalModelReady
  const modelVerified = Boolean(
    settings?.model_verification
    && settings.model_verification.provider === defaultTaskModel?.provider
    && settings.model_verification.model === defaultTaskModel?.model,
  )
  const arenaReady = Boolean(settings?.nssctf_arena?.has_token)
  const showAccountGate = (
    accountLoaded
    && accountStatus.configured
    && accountStatus.state !== 'active'
    && !continueWithoutAccount
  )
  const activeCTFConversation = Boolean(conv.active?.ctfJobId)
  const activeVulnerabilityCodingConversation = conv.active?.domainTaskContext?.kind === 'cve'
  const dossierChatMaximized = section === 'ctf'
    ? domainChatMaximized.ctf
    : section === 'vuln'
      ? domainChatMaximized.vuln
      : section === 'lab'
        ? domainChatMaximized.lab
        : false
  const workspaceSurfaceVisible = section === 'chat' || section === 'ctf' || section === 'vuln' || section === 'lab'
  const domainDockOpen = section === 'ctf'
    ? domainChatDockOpen.ctf
    : section === 'vuln'
      ? domainChatDockOpen.vuln
      : section === 'lab'
        ? domainChatDockOpen.lab
        : false
  const codingAgentBind = useMemo<CodingAgentSurfaceBind>(() => ({
    settings,
    workspacePath: conv.workspacePath,
    running: conv.running,
    aborting: conv.aborting,
    abortStalled: conv.abortStalled,
    messageQueue: conv.messageQueue,
    sessionReady: conv.sessionReady,
    resumed: conv.resumed,
    compacting: conv.compacting,
    compactedAt: conv.compactedAt,
    compactionError: conv.compactionError,
    turnStatus: conv.turnStatus,
    ctfSession: Boolean(conv.active?.ctfJobId),
    vulnerabilitySession: conv.active?.domainTaskContext?.kind === 'cve',
    ctfMode: conv.active?.ctfMode,
    ctfRole: conv.active?.ctfRole,
    kernel: conv.kernel,
    modelMode: conv.modelMode,
    modelProvider: conv.modelProvider,
    modelId: conv.modelId,
    modelSourcePreference: conv.modelSourcePreference,
    executionMode: conv.executionMode,
    approvalPolicy: conv.approvalPolicy,
    mcpServers: conv.mcpServers,
    mcpConfigDigest: conv.mcpConfigDigest,
    pendingComposerDraft: conv.pendingComposerDraft,
  }), [settings, conv])

  function applyCurrentTheme() {
    const mode = themeModeRef.current
    applyThemeMode(mode)
    const resolved = resolveThemeMode(mode)
    syncWindowChrome(resolved, globalThis, mode)
    applyUiEmphasis({ theme: resolved })
  }

  function persistWorkspaceViewState() {
    if (!workspaceViewStateReady.current) return
    writeWorkspaceViewState({
      version: 1,
      section: sectionRef.current,
      activeConversationId: conversations.activeId,
      codingHistoryOpen: codingConversationDrawerOpenRef.current,
      ctfSection: ctfSectionRef.current,
      settingsReturnTarget: settingsReturnTargetRef.current,
    })
  }

  function applySettings(value: AppSettings) {
    const normalized = withAppSettingsDefaults(value)
    setSettings(normalized)
    installAppModelSettings(normalized)
    applyUiLocale(normalized.locale)
    applyUiFonts({
      uiFont: normalized.ui_font,
      conversationFont: normalized.conversation_font,
      uiFontSize: normalized.ui_font_size,
      conversationFontSize: normalized.conversation_font_size,
    })
    applyUiEmphasis({ preset: normalized.ui_emphasis })
    conversations.setDefaultKernel(normalized.default_kernel ?? FACTORY_DEFAULT_KERNEL)
    conversations.setBusySend(normalized.busy_send ?? 'interrupt')
  }

  async function loadSettings() {
    const value = await invokeCommand<AppSettings>('get_settings')
    applySettings(value)
  }

  async function loadAccountStatus() {
    try {
      const next = await invokeCommand<AccountStatus | null>('get_account_status')
      if (next?.state) {
        accountStatusRef.current = next
        setAccountStatus(next)
      }
    } finally {
      setAccountLoaded(true)
    }
  }

  async function startAccountLogin() {
    setAccountLoginBusy(true)
    setAccountLoginError('')
    try {
      const next = await invokeCommand<AccountStatus>('start_account_login')
      accountStatusRef.current = next
      setAccountStatus(next)
    } catch {
      setAccountLoginError(t('无法打开 GitHub 登录。请检查网络或稍后再试；你仍可使用自己的 API Key。', 'Could not open GitHub sign-in. Check your network or try again later. You can still use your own API key.'))
      const next = {
        ...accountStatusRef.current,
        authenticated: false,
        state: 'unavailable' as const,
      }
      accountStatusRef.current = next
      setAccountStatus(next)
    } finally {
      setAccountLoginBusy(false)
    }
  }

  async function logoutAccount() {
    setAccountLoginError('')
    const next = await invokeCommand<AccountStatus>('logout_account')
    accountStatusRef.current = next
    setAccountStatus(next)
    setContinueWithoutAccount(false)
    writeLocalAccountMode(false)
    setCodingConversationDrawerOpen(false)
    setSection('ctf')
  }

  function toggleCodingConversationDrawer() {
    setCodingConversationDrawerOpen(open => !open)
  }

  function useLocalAccountMode() {
    setAccountLoginError('')
    setContinueWithoutAccount(true)
    writeLocalAccountMode(true)
  }

  function openSettings(category: SettingsCategory = 'general') {
    setSettingsReturnTarget(settingsReturnSection(sectionRef.current, settingsReturnTargetRef.current))
    setSettingsCategory(normalizeSettingsCategory(category))
    setSection('settings')
  }

  function startSecurityToolCodingSetup(handoff: {
    prompt: string
    visibleText: string
    executionMode: 'go'
    approvalPolicy: 'full-auto'
    workspacePath?: string
  }) {
    rememberActiveConversation()
    conversations.startNew()
    if (handoff.workspacePath) conversations.setWorkspace(handoff.workspacePath)
    conversations.setCodingPolicy(handoff.executionMode, handoff.approvalPolicy)
    conversations.stageComposerDraft(handoff.prompt, handoff.visibleText)
    lastCodingConversationId.current = null
    setSection('chat')
  }

  function newConversation() {
    rememberActiveConversation()
    conversations.startNew()
    lastCodingConversationId.current = null
    setSection('chat')
  }

  function newWorkspaceConversation() {
    if (isDomainWorkspace(sectionRef.current)) {
      createDossierConversation()
      return
    }
    newConversation()
  }

  function openHistoryConversation(conversationId: string) {
    selectSidebarConversation(conversationId)
  }

  function rememberActiveConversation() {
    const remembered = rememberWorkspaceConversation(conversations.active, {
      codingConversationId: lastCodingConversationId.current,
      ctfConversationId: lastCTFConversationId.current,
      vulnConversationId: activeVulnerabilityCodingConversationId.current,
      labConversationId: lastLabConversationId.current,
    })
    lastCodingConversationId.current = remembered.codingConversationId
    lastCTFConversationId.current = remembered.ctfConversationId
    activeVulnerabilityCodingConversationId.current = remembered.vulnConversationId
    lastLabConversationId.current = remembered.labConversationId
    itemChatAnchors.current = rememberItemChatAnchor(itemChatAnchors.current, conversations.active)
  }

  function restoreCodingWorkspace() {
    const restored = conversations.conversations.find(conversation => (
      conversation.id === lastCodingConversationId.current && isHomeConversation(conversation)
    ))
    if (restored) {
      conversations.activeId = restored.id
      return
    }
    conversations.resumePendingHome('chat')
  }

  function restoreCTFWorkspaceResumePoint() {
    const next = selectCTFResumePoint(
      conversations.conversations,
      conversations.activeId,
      lastCTFConversationId.current,
    )
    setCtfResumeJobId(next.jobId)
    if (next.conversationId) lastCTFConversationId.current = next.conversationId
  }

  function restoreConversation(id: string | null) {
    const conversationId = String(id ?? '').trim()
    if (!conversationId) return
    if (conversations.conversations.some(item => item.id === conversationId)) {
      conversations.activeId = conversationId
    }
  }

  function openDomainCatalog(home: DomainHome) {
    rememberActiveConversation()
    if (home === 'ctf') {
      setCtfResumeJobId(null)
      setCtfCatalogEpoch(value => value + 1)
    }
    if (home === 'lab') labJobs.selectedId = ''
    if (home === 'vuln') {
      vulnerabilityDashboard.selectedId = ''
      setVulnNavigationEpoch(value => value + 1)
    }
    conversations.startNew({ workspaceHome: home })
    setDomainChatMaximized(false)
    setDomainChatDockOpen(false, home)
    setSection(home)
  }

  function navigateSection(value: Section) {
    debugLog('section', value)
    if (value === 'ctf' || value === 'vuln' || value === 'lab') {
      openDomainCatalog(value)
      return
    }
    rememberActiveConversation()
    if (value === 'chat') {
      restoreCodingWorkspace()
      setSection(value)
      return
    }
    setSection(value)
  }

  function returnToCTFWorkspace() {
    rememberActiveConversation()
    restoreCTFWorkspaceResumePoint()
    restoreConversation(lastCTFConversationId.current)
    setDomainChatMaximized(false)
    setSection('ctf')
  }

  function returnToVulnerabilityWorkspace() {
    rememberActiveConversation()
    restoreConversation(activeVulnerabilityCodingConversationId.current)
    setDomainChatMaximized(false)
    setSection('vuln')
  }

  function returnToLabWorkspace() {
    rememberActiveConversation()
    restoreConversation(lastLabConversationId.current)
    setDomainChatMaximized(false)
    setSection('lab')
  }

  function setDomainChatMaximized(value: boolean) {
    const home = sectionRef.current
    if (home !== 'ctf' && home !== 'vuln' && home !== 'lab') return
    setDomainChatMaximizedState(current => ({ ...current, [home]: value }))
  }

  function setDomainChatDockOpen(value: boolean, home: Section = sectionRef.current) {
    if (home !== 'ctf' && home !== 'vuln' && home !== 'lab') return
    setDomainChatDockOpenState(current => ({ ...current, [home]: value }))
  }

  function maximizeDossierChat() {
    rememberActiveConversation()
    setDomainChatDockOpen(true)
    setDomainChatMaximized(true)
  }

  function restoreDossierChat() {
    setDomainChatMaximized(false)
    setDomainChatDockOpen(true)
  }

  function closeDossierChat() {
    setDomainChatMaximized(false)
    setDomainChatDockOpen(false)
  }

  function selectSidebarConversation(id: string) {
    const target = conversations.conversations.find(item => item.id === id)
    if (!target) return
    rememberActiveConversation()
    conversations.activeId = id
    rememberActiveConversation()
    const home = conversationWorkspaceHome(target)
    setCodingConversationDrawerOpen(true)
    if (home === 'chat') {
      setSection('chat')
      return
    }
    setSection(home)
    setDomainChatDockOpen(true, home)
  }

  async function chooseAgentWorkspace() {
    const workspacePath = await invokeCommand<string>('choose_agent_workspace')
    if (workspacePath) conversations.setWorkspace(workspacePath)
  }

  async function chooseAgentWorkspaceForNewTask() {
    const workspacePath = await invokeCommand<string>('choose_agent_workspace')
    if (!workspacePath) return
    newConversation()
    conversations.setWorkspace(workspacePath)
  }

  function selectCodingWorkspace(path: string) {
    const next = path.trim()
    if (!next) return
    if (conversations.active?.messages.length) newConversation()
    conversations.setWorkspace(next)
  }

  function clearCodingWorkspace() {
    if (conversations.active?.messages.length) newConversation()
    conversations.clearWorkspace()
  }

  async function forgetCodingWorkspace(path: string) {
    const next = path.trim()
    if (!next) return
    try {
      await invokeCommand('forget_coding_project', { path: next })
      if (conversations.workspacePath === next) conversations.clearWorkspace()
    } catch (reason) {
      console.error(reason)
    }
  }

  function newCodingProjectSession(workspacePath: string) {
    const next = workspacePath.trim()
    if (!next) return
    newConversation()
    conversations.setWorkspace(next)
    setCodingConversationDrawerOpen(true)
  }

  async function chooseVulnerabilityCodingWorkspace() {
    const workspacePath = await invokeCommand<string>('choose_agent_workspace')
    if (workspacePath) setVulnerabilityCodingWorkspacePath(workspacePath)
  }

  async function abortConversation() {
    const conversationId = conversations.activeId
    if (conversationId) await conversations.abort(conversationId)
  }

  function domainContextFromCTFHandoff(handoff: CTFAgentWorkspaceHandoff) {
    const role = handoff.role ?? 'solver'
    const title = String(handoff.title ?? '').replace(/^CTF\s*·\s*/u, '').trim()
    return buildCTFDomainTaskContext({
      jobId: handoff.jobId,
      challengeId: handoff.challengeId || handoff.jobId,
      challengeTitle: title || handoff.title,
      statement: handoff.statement,
      category: handoff.category,
      objective: handoff.humanGoal,
      originLabel: handoff.externalPlatform
        ? `${handoff.externalPlatform.replace(/-web$/u, '').toUpperCase()}${handoff.externalAttemptId ? ` · P${handoff.externalAttemptId}` : ''}`
        : t('自定义题目', 'Custom challenge'),
      role,
      materials: handoff.materials,
      networkScopes: [],
      evidenceCount: 0,
      artifactCount: 0,
      judgeReceipts: [],
    })
  }

  async function startCTFAgent(handoff: CTFAgentWorkspaceHandoff & {
    domainTaskContext?: DomainTaskContext
  }) {
    rememberActiveConversation()
    await conversations.startWorkspaceTask({
      ...handoff,
      domainTaskContext: handoff.domainTaskContext ?? domainContextFromCTFHandoff(handoff),
      autoSend: false,
    })
    lastCTFConversationId.current = conversations.activeId
    setDomainChatDockOpen(true)
  }

  function selectDossierConversation(id: string) {
    if (!conversations.conversations.some(item => item.id === id)) return
    conversations.activeId = id
    rememberActiveConversation()
    setDomainChatDockOpen(true)
  }

  function createDossierConversation() {
    const home = sectionRef.current
    if (home !== 'ctf' && home !== 'vuln' && home !== 'lab') return
    rememberActiveConversation()
    conversations.startNew({ workspaceHome: home })
    setDomainChatMaximized(false)
    setDomainChatDockOpen(true, home)
  }

  async function bindDossierConversation(
    title: string,
    conversationId: string,
    domainTaskContext: NonNullable<DomainTaskContext>,
  ) {
    rememberActiveConversation()
    const reused = selectAnchoredDomainConversationId(
      conversations.conversations,
      domainTaskContext,
      itemChatAnchors.current,
    )
    conversations.ensureConversation(title, {
      conversationId: reused ?? conversationId,
      domainTaskContext,
    })
    rememberActiveConversation()
    setDomainChatDockOpen(true)
    try {
      const workspace = await invokeCommand<string>('ensure_coding_artifact_workspace', {
        conversationId: conversations.activeId,
      })
      if (workspace) conversations.setWorkspace(workspace)
    } catch {
      // Report preview stays empty until the first Agent turn creates the workspace.
    }
  }

  async function enterVulnerabilityDossier(item: VulnerabilityIntel) {
    const cveId = item.id.trim()
    await bindDossierConversation(
      t(`${cveId} 复现`, `${cveId} reproduction`),
      `cve-research-${cveId.toLowerCase()}`,
      buildCVEDomainTaskContext({
        cveId,
        title: item.title,
        summary: item.summary,
        vendor: item.vendor,
        product: item.product,
        affected: item.affected,
      }),
    )
    activeVulnerabilityCodingConversationId.current = conversations.activeId
  }

  async function runVulnerabilityReproduction(item: VulnerabilityIntel) {
    await enterVulnerabilityDossier(item)
  }

  async function runLabJob(job: LabJob) {
    await enterLabJob(job)
    const conversation = conversations.active
    if (conversation && conversation.messages.length === 0) {
      const briefing = labBriefing({ scope: job.scope, request: job.request })
      await conversations.send(briefing.prompt, briefing.visible)
    }
  }

  function renameLabJob(id: string, title: string) {
    labJobs.rename(id, title)
    conversations.rename(`lab-job-${id}`, title)
  }

  async function enterLabJob(job: LabJob) {
    await bindDossierConversation(
      job.title,
      `lab-job-${job.id}`,
      {
        kind: 'lab',
        jobId: job.id,
        title: job.title,
        scope: job.scope,
        request: job.request,
      },
    )
    lastLabConversationId.current = conversations.activeId
  }

  function applyWorkspaceRecord(payload: {
    action?: string
    kind?: string
    id?: string
    ids?: string[]
    record?: Record<string, unknown>
  }) {
    const action = String(payload.action ?? '').trim()
    const kind = String(payload.kind ?? '').trim()
    const record = payload.record ?? {}
    const id = String(payload.id || record.id || '').trim()
    if (action === 'focus') {
      if (kind === 'lab' && id) {
        labJobs.selectedId = id
        const job = labJobs.jobs.find(item => item.id === id)
        setSection('lab')
        if (job) void enterLabJob(job)
        return
      }
      if (kind === 'cve' && id) {
        vulnerabilityDashboard.selectedId = id.toUpperCase()
        setSection('vuln')
        return
      }
      if (kind === 'ctf' && id) {
        setCtfResumeJobId(id)
        setSection('ctf')
        return
      }
      if (kind === 'conversation' && id) {
        selectSidebarConversation(id)
      }
      return
    }
    if (kind === 'lab') {
      if (action === 'archive') {
        removeLabJobIds(payload.ids?.length ? payload.ids : (id ? [id] : []))
        return
      }
      if (record.id) {
        applyLabJobRecord(record)
        if (record.title) conversations.rename(`lab-job-${String(record.id)}`, String(record.title))
      }
      return
    }
    if (kind === 'conversation') {
      if (action === 'update' && id && record.title) {
        conversations.rename(id, String(record.title))
        return
      }
      void conversations.load()
      return
    }
    if (kind === 'cve' && id) {
      const tracking = {
        id,
        title: String(record.title ?? ''),
        vendor: String(record.vendor ?? ''),
        product: String(record.product ?? ''),
        affected: String(record.affected ?? ''),
        summary: String(record.summary ?? ''),
        referenceHref: String(record.url ?? ''),
      }
      if (action === 'update') {
        vulnerabilityDashboard.patchTrackingItem(id, {
          title: tracking.title,
          vendor: tracking.vendor,
          product: tracking.product,
          affected: tracking.affected,
          summary: tracking.summary,
        })
        return
      }
      try {
        vulnerabilityDashboard.addTrackingItem(tracking)
      } catch {
        vulnerabilityDashboard.patchTrackingItem(id, tracking)
      }
    }
  }

  async function startVulnerabilityCodingTask(
    task: VulnerabilityCodingTask,
    recordHandoff?: (workspacePath: string) => void,
  ) {
    const accepted = await executeVulnerabilityCodingHandoff(task, vulnerabilityCodingWorkspacePath, {
      rememberActiveConversation,
      startNewConversation: conversations.startNew,
      ensureConversation: conversations.ensureConversation,
      activeConversationId: () => conversations.activeId,
      reusableConversationId: context => selectReusableDomainConversationId(
        conversations.conversations,
        context,
      ),
      setLastCodingConversationId: id => {
        activeVulnerabilityCodingConversationId.current = id
      },
      setSection: () => { setSection('vuln') },
    })
    if (accepted) {
      recordHandoff?.(conversations.workspacePath)
    }
  }

  async function switchCTFAgent(role: 'solver' | 'tool-builder' | 'strategist') {
    const conversation = conversations.active
    if (!conversation?.ctfJobId) return
    if (conversation.ctfRole === role) return
    const command = role === 'tool-builder'
      ? 'prepare_ctf_tool_builder_workspace'
      : role === 'strategist'
        ? 'prepare_ctf_strategist_workspace'
        : 'prepare_ctf_agent_workspace'
    try {
      const handoff = await invokeCommand<CTFAgentWorkspaceHandoff>(command, {
        id: conversation.ctfJobId,
      })
      await conversations.startWorkspaceTask({
        ...handoff,
        domainTaskContext: domainContextFromCTFHandoff(handoff),
        autoSend: false,
      })
      lastCTFConversationId.current = conversations.activeId
    } catch (reason) {
      console.error('Failed to switch CTF Agent role', reason)
    }
  }

  async function runCTFChatAction(action: CTFChatAction) {
    const conversation = conversations.active
    if (!conversation || !conversation.ctfJobId) return
    if (action.kind === 'hint' && action.level && conversation.ctfJobId) {
      try {
        await invokeCommand('record_ctf_learning', {
          id: conversation.ctfJobId,
          request: {
            kind: 'hint',
            level: action.level,
            concept: t('PI 分级提示', 'Pi graded hint'),
            content: t(`用户主动请求 ${action.level} 级提示。`, `The user requested a level ${action.level} hint.`),
          },
        })
      } catch (reason) {
        console.error('Failed to record CTF hint dependency', reason)
      }
    }
    await conversations.send(action.prompt)
  }

  function changeModel(mode: 'auto' | 'manual', provider?: string, model?: string) {
    conversations.setModelSelection(mode, provider, model)
  }

  function changeKernel(kernel: 'pi' | 'dsh') {
    conversations.setKernel(kernel)
  }

  function migrateKernel(kernel: 'pi' | 'dsh') {
    void conversations.handoffContext(kernel)
  }

  function toggleThemeMode() {
    const next = nextThemeMode(themeModeRef.current)
    themeModeRef.current = next
    setThemeMode(next)
    applyCurrentTheme()
    writeThemeMode(next)
  }

  async function downloadUpdate() {
    try {
      const next = await invokeCommand<UpdateStatus>('download_update')
      updateStatusRef.current = next
      setUpdateStatus(next)
      return next
    } catch (reason) {
      console.error('Failed to download update', reason)
      const current = updateStatusRef.current
      const next: UpdateStatus = {
        state: 'error',
        currentVersion: current?.currentVersion || '',
        enabled: current?.enabled !== false,
        version: current?.version,
        code: 'download_failed',
        message: updateStatusMessage({
          state: 'error',
          currentVersion: current?.currentVersion || '',
          enabled: current?.enabled !== false,
          version: current?.version,
          code: 'download_failed',
        }),
      }
      updateStatusRef.current = next
      setUpdateStatus(next)
      return next
    }
  }

  async function installUpdate() {
    if (installingUpdate.current) return
    installingUpdate.current = true
    setInstallUpdatePromptOpen(false)
    try {
      const started = await invokeCommand<boolean>('install_update')
      if (started) return
      const current = updateStatusRef.current
      const refreshed = await invokeCommand<UpdateStatus>('get_update_status').catch(() => current)
      if (refreshed?.state === 'error') {
        const next = {
          ...refreshed,
          message: updateStatusMessage(refreshed) || refreshed.message,
        }
        updateStatusRef.current = next
        setUpdateStatus(next)
        return
      }
      const next: UpdateStatus = {
        state: 'error',
        currentVersion: current?.currentVersion || '',
        enabled: current?.enabled !== false,
        version: current?.version,
        code: 'install_failed',
        message: updateStatusMessage({
          state: 'error',
          currentVersion: current?.currentVersion || '',
          enabled: current?.enabled !== false,
          version: current?.version,
          code: 'install_failed',
        }),
      }
      updateStatusRef.current = next
      setUpdateStatus(next)
    } catch (reason) {
      console.error('Failed to install update', reason)
      const current = updateStatusRef.current
      const next: UpdateStatus = {
        state: 'error',
        currentVersion: current?.currentVersion || '',
        enabled: current?.enabled !== false,
        version: current?.version,
        code: 'install_failed',
        message: updateStatusMessage({
          state: 'error',
          currentVersion: current?.currentVersion || '',
          enabled: current?.enabled !== false,
          version: current?.version,
          code: 'install_failed',
        }),
      }
      updateStatusRef.current = next
      setUpdateStatus(next)
    } finally {
      if (updateStatusRef.current?.state !== 'downloaded') installingUpdate.current = false
    }
  }

  async function persistAndInstallUpdate() {
    persistWorkspaceViewState()
    const runningIds = conversations.runningConversationIds
    if (runningIds.length) {
      writeUpdateResumeState({
        version: 1,
        conversationIds: runningIds,
        activeConversationId: conversations.activeId,
      })
    }
    try {
      await conversations.prepareConversationsForUpdateRestart()
    } catch (reason) {
      console.error('Failed to persist conversations before update restart', reason)
    }
    await installUpdate()
  }

  async function requestInstallUpdate() {
    if (installingUpdate.current) return
    const next = planUpdateRestart({
      runningConversationIds: conversations.runningConversationIds,
      restartDeferred: updateRestartDeferred.current,
    })
    if (next === 'stay') return
    if (next === 'confirm') {
      setInstallUpdatePromptOpen(true)
      return
    }
    await persistAndInstallUpdate()
  }

  async function applyUpdate() {
    if (applyingUpdate.current || installingUpdate.current) return
    if (updateStatusRef.current?.state === 'downloading') return
    applyingUpdate.current = true
    updateRestartDeferred.current = false
    try {
      if (updateStatusRef.current?.state !== 'downloaded') {
        const downloaded = await downloadUpdate()
        if (downloaded.state !== 'downloaded') return
      }
      await requestInstallUpdate()
    } finally {
      applyingUpdate.current = false
    }
  }

  function confirmInstallUpdate() {
    confirmingUpdateRestart.current = true
    updateRestartDeferred.current = false
    setInstallUpdatePromptOpen(false)
    void persistAndInstallUpdate()
  }

  function cancelInstallUpdate() {
    if (confirmingUpdateRestart.current || installingUpdate.current) return
    updateRestartDeferred.current = true
    setInstallUpdatePromptOpen(false)
  }

  async function resumeAfterUpdateRestart(resume: UpdateResumeState) {
    const conversationId = selectUpdateResumeConversation(resume)
    if (!conversationId) return
    const conversation = conversations.conversations.find(item => item.id === conversationId)
    if (!conversation) return
    conversations.activeId = conversationId
    const lastUserMessage = [...conversation.messages].reverse().find(message => message.role === 'user')
    await conversations.send(
      agentRecoveryPrompt(Boolean(conversation.ctfJobId)),
      t('继续', 'Continue'),
      lastUserMessage?.attachments,
    )
  }

  function continueToolBudget() {
    if (!toolBudgetPrompt) return
    void conversations.respondApproval(toolBudgetPrompt.requestId, true, 'once')
  }

  function stopToolBudget() {
    if (!toolBudgetPrompt) return
    void conversations.respondApproval(toolBudgetPrompt.requestId, false)
  }

  const applyWorkspaceRecordRef = useRef(applyWorkspaceRecord)
  applyWorkspaceRecordRef.current = applyWorkspaceRecord
  const persistWorkspaceViewStateRef = useRef(persistWorkspaceViewState)
  persistWorkspaceViewStateRef.current = persistWorkspaceViewState
  const resumeAfterUpdateRestartRef = useRef(resumeAfterUpdateRestart)
  resumeAfterUpdateRestartRef.current = resumeAfterUpdateRestart

  useLayoutEffect(() => {
    applyCurrentTheme()
  }, [themeMode])

  useLayoutEffect(() => {
    syncDocumentPluginSurfaces()
  }, [pluginRootStyle, resolvedTheme, pluginTheme])

  useEffect(() => {
    persistWorkspaceViewStateRef.current()
  }, [section, codingConversationDrawerOpen, ctfSection, settingsReturnTarget, conv.activeId])

  useEffect(() => {
    function onCommandPanelShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'k') return
      if (event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      setCommandPanelOpen(open => !open)
    }
    window.addEventListener('keydown', onCommandPanelShortcut)
    return () => window.removeEventListener('keydown', onCommandPanelShortcut)
  }, [])

  useEffect(() => {
    if (section !== 'ctf' && section !== 'vuln' && section !== 'lab') return
    setKeptWorkspacePages(prev => {
      if (prev.has(section)) return prev
      const next = new Set(prev)
      next.add(section)
      return next
    })
  }, [section])

  useEffect(() => {
    if (!pendingUpdateResume) return
    if (runtimeStatus === 'starting' || runtimeStatus === 'recovering') return
    const resume = pendingUpdateResume
    setPendingUpdateResume(null)
    void resumeAfterUpdateRestartRef.current(resume)
  }, [pendingUpdateResume, runtimeStatus])

  useEffect(() => {
    const mountedAt = performance.now()
    startupLog('renderer.onMounted')
    applyCurrentTheme()
    let systemThemeMedia: MediaQueryList | undefined
    let systemThemeListener: (() => void) | undefined
    if (typeof window.matchMedia === 'function') {
      systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
      setSystemDark(systemThemeMedia.matches)
      systemThemeListener = () => {
        setSystemDark(systemThemeMedia?.matches ?? false)
        if (themeModeRef.current === 'system') applyCurrentTheme()
      }
      systemThemeMedia.addEventListener('change', systemThemeListener)
    }

    let cancelled = false
    let unlistenAccount: (() => void) | undefined
    let unlistenModelCatalog: (() => void) | undefined
    let unlistenUpdate: (() => void) | undefined
    let unlistenWorkspaceRecords: (() => void) | undefined
    let unlistenRuntime: (() => void) | undefined
    let unlistenPluginTheme: (() => void) | undefined

    void (async () => {
      unlistenAccount = await listenEvent<AccountStatus>('account.changed', event => {
        const previous = accountStatusRef.current
        accountStatusRef.current = event.payload
        setAccountStatus(event.payload)
        if (event.payload.state === 'active') {
          setAccountLoginError('')
          setContinueWithoutAccount(false)
          writeLocalAccountMode(false)
          if (previous.provisional && !event.payload.provisional) {
            void loadSettings().catch(() => {})
          }
        }
      })
      unlistenModelCatalog = await listenEvent<ModelCatalogSnapshot>('model-catalog-changed', event => {
        installModelCatalog(event.payload)
      })
      unlistenUpdate = await listenEvent<UpdateStatus>('update.changed', event => {
        updateStatusRef.current = event.payload
        setUpdateStatus(event.payload)
      })
      unlistenRuntime = await listenEvent<{ state?: string }>('runtime.status', event => {
        const state = event.payload?.state
        if (state === 'recovering' || state === 'starting' || state === 'exited' || state === 'ready') {
          setRuntimeStatus(state)
        }
        if (state === 'recovering' || state === 'exited') {
          conversations.settleRunsForRuntimeRecovery()
        }
      })
      unlistenWorkspaceRecords = await listenEvent<{
        action?: string
        kind?: string
        id?: string
        ids?: string[]
        record?: Record<string, unknown>
      }>('workspace-record.changed', event => {
        applyWorkspaceRecordRef.current(event.payload ?? {})
      })
      unlistenPluginTheme = await listenEvent<ActivePluginTheme | null>('plugin-theme-changed', event => {
        setPluginTheme(normalizeActivePluginTheme(event.payload))
      })
      if (cancelled) return

      const parallelStarted = performance.now()
      async function measure(label: string, work: () => Promise<unknown>) {
        const started = performance.now()
        await work()
        const ms = Math.round(performance.now() - started)
        startupLog(label, `${ms}ms`)
        return ms
      }
      const [catalogMs, settingsMs, accountMs, conversationsMs, pluginThemeMs] = await Promise.all([
        measure('rpc.loadModelCatalog', () => loadModelCatalog()),
        measure('rpc.loadSettings', () => loadSettings()),
        measure('rpc.loadAccountStatus', () => loadAccountStatus()),
        measure('rpc.conversations.load', () => conversations.load()),
        measure('rpc.pluginTheme', () => invokeCommand<ActivePluginTheme | null>('get_active_plugin_theme')
          .then(value => { setPluginTheme(normalizeActivePluginTheme(value)) })
          .catch(() => {})),
      ])
      await hydrateLabJobsFromBackend()
      if (cancelled) return
      const parallelWallMs = Math.round(performance.now() - parallelStarted)
      const slowest = Math.max(catalogMs, settingsMs, accountMs, conversationsMs, pluginThemeMs)
      startupLog(
        'renderer.parallelBootstrap',
        `wall=${parallelWallMs}ms catalog=${catalogMs}ms settings=${settingsMs}ms account=${accountMs}ms conversations=${conversationsMs}ms pluginTheme=${pluginThemeMs}ms slowest=${slowest}ms accountLoaded=${true} provisional=${accountStatusRef.current.provisional === true}`,
      )
      if (restoredViewState) {
        const restoredConversation = conversations.conversations.find(
          conversation => conversation.id === restoredViewState.activeConversationId,
        )
        conversations.activeId = restoredConversation?.id ?? null
        if (restoredConversation?.ctfJobId) lastCTFConversationId.current = restoredConversation.id
        else if (restoredConversation) lastCodingConversationId.current = restoredConversation.id
      }
      workspaceViewStateReady.current = true
      persistWorkspaceViewStateRef.current()
      const nextUpdate = await timedStartupStep('rpc.get_update_status', () =>
        invokeCommand<UpdateStatus>('get_update_status').catch(() => null),
      )
      if (!cancelled) {
        updateStatusRef.current = nextUpdate
        setUpdateStatus(nextUpdate)
      }
      await conversations.listen()
      if (!cancelled) {
        const resume = consumeUpdateResumeState()
        if (resume) setPendingUpdateResume(resume)
      }
      startupLog(
        'renderer.firstPaintGateDone',
        `fromMount=${Math.round(performance.now() - mountedAt)}ms state=${accountStatusRef.current.state} provisional=${accountStatusRef.current.provisional === true}`,
      )
    })()

    return () => {
      cancelled = true
      unlistenAccount?.()
      unlistenModelCatalog?.()
      unlistenUpdate?.()
      unlistenWorkspaceRecords?.()
      unlistenRuntime?.()
      unlistenPluginTheme?.()
      if (typeof document !== 'undefined') {
        for (const property of documentPluginSurfaceProperties.current) document.documentElement.style.removeProperty(property)
        document.documentElement.classList.remove('plugin-surface-overlay-menu-active')
      }
      if (systemThemeMedia && systemThemeListener) {
        systemThemeMedia.removeEventListener('change', systemThemeListener)
      }
    }
  }, [])

  const domainAgentHandlers = {
    onSend: conversations.send,
    onAbort: abortConversation,
    onSelectConversation: selectDossierConversation,
    onCreateConversation: createDossierConversation,
    onExpand: maximizeDossierChat,
    onCloseDock: closeDossierChat,
    onConsumePendingDraft: () => conversations.consumeComposerDraft(),
    onCompactContext: conversations.compactContext,
    onRewindContext: conversations.rewindContext,
    onHandoffContext: conversations.handoffContext,
    onChangeKernel: changeKernel,
    onMigrateKernel: migrateKernel,
    onControlGoal: conversations.controlGoal,
    onRespondApproval: conversations.respondApproval,
    onEditUser: conversations.editAndResend,
    onBranchAssistant: conversations.branchFromAssistant,
    onChangeModel: changeModel,
    onChangeModelSource: conversations.setModelSourcePreference,
    onChangeCodingPolicy: conversations.setCodingPolicy,
    onChangeMcpServers: conversations.setMCPSelection,
    onChooseWorkspace: chooseAgentWorkspace,
    onChooseWorkspaceForNewTask: chooseAgentWorkspaceForNewTask,
    onSelectWorkspace: selectCodingWorkspace,
    onForgetWorkspace: forgetCodingWorkspace,
    onClearWorkspace: clearCodingWorkspace,
    onCancelQueuedGuidance: conversations.cancelQueuedGuidance,
    onEditQueuedGuidance: conversations.editQueuedGuidance,
  }

  if (!accountLoaded) {
    return (
      <div className="grid h-screen place-items-center bg-background text-xl font-semibold text-foreground">
        MilkSU
      </div>
    )
  }

  if (showAccountGate) {
    return (
      <Suspense fallback={<div className="grid h-screen place-items-center bg-background text-xl font-semibold text-foreground">MilkSU</div>}>
        <AccountLoginPage
          status={accountStatus}
          busy={accountLoginBusy}
          error={accountLoginError}
          onLogin={startAccountLogin}
          onContinueLocal={useLocalAccountMode}
        />
      </Suspense>
    )
  }

  return (
    <div
      className={cn(
        'game-shell relative flex h-screen min-w-0 flex-col overflow-hidden text-foreground',
        Boolean(pluginTheme.plugin_id) && 'plugin-skin-active',
        surfaceActive('content-wallpaper') && 'plugin-wallpaper-active',
        surfaceActive('workspace-list') && 'plugin-surface-workspace-list-active',
        surfaceActive('control-button') && 'plugin-surface-control-button-active',
        surfaceActive('workspace-topbar') && 'plugin-surface-workspace-topbar-active',
        surfaceActive('overlay-menu') && 'plugin-surface-overlay-menu-active',
        surfaceActive('chat-composer') && 'plugin-surface-chat-composer-active',
      )}
      style={pluginRootStyle}
    >
      {contentSurface.mode === 'image' ? (
        <div
          aria-hidden="true"
          className="plugin-skin-background pointer-events-none absolute inset-[-24px] z-0 bg-cover bg-center bg-no-repeat"
          style={pluginBackgroundStyle}
        />
      ) : null}
      {surfaceActive('content-wallpaper') ? (
        <div
          aria-hidden="true"
          className="plugin-skin-canvas pointer-events-none absolute inset-0 z-0"
          style={pluginContentMaskStyle}
        />
      ) : null}
      {runtimeStatus === 'recovering' || runtimeStatus === 'starting' ? (
        <p className="relative z-10 shell-traffic-light-safe-x shell-window-control-safe-x shrink-0 border-b border-border bg-card px-4 py-2 text-caption text-foreground">
          {t('正在恢复运行时', 'Restoring the runtime')}
        </p>
      ) : runtimeStatus === 'exited' ? (
        <p className="relative z-10 shell-traffic-light-safe-x shell-window-control-safe-x shrink-0 border-b border-border bg-card px-4 py-2 text-caption text-foreground">
          {t('本地运行时已停止', 'Local runtime stopped')}
        </p>
      ) : null}
      <div className="relative z-10 flex min-h-0 flex-1 app-no-drag">
        <AppSidebar
          activeSection={section}
          activeConversationId={conv.activeId}
          conversations={conv.rows}
          runningConversationIds={conv.runningIds}
          conversationActionError={conv.actionError}
          accountStatus={accountStatus}
          ctfSection={ctfSection}
          codingContextOpen={codingConversationDrawerOpen}
          themeMode={themeMode}
          updateStatus={updateStatus}
          onNew={newWorkspaceConversation}
          onNavigate={navigateSection}
          onProfile={() => navigateSection('profile')}
          onAccountLogin={startAccountLogin}
          onAccountLogout={logoutAccount}
          onSettings={() => openSettings('general')}
          settingsCategory={settingsCategory}
          onSelectSettingsCategory={category => {
            setSettingsCategory(category)
            setSection('settings')
          }}
          onCloseSettings={async () => {
            await loadSettings()
            setSection(settingsReturnTargetRef.current)
          }}
          onToggleTheme={toggleThemeMode}
          onApplyUpdate={applyUpdate}
          onOpenCommandPanel={() => setCommandPanelOpen(true)}
          onOpenCodingContext={() => setCodingConversationDrawerOpen(true)}
          onCollapseCodingContext={() => setCodingConversationDrawerOpen(false)}
          onSelectConversation={selectSidebarConversation}
          onDeleteConversation={conversations.archive}
          onDeleteConversationPermanently={conversations.remove}
          onNewProjectSession={newCodingProjectSession}
          onRenameConversation={conversations.rename}
          onSetPinned={conversations.setConversationPinned}
          onMovePinned={conversations.movePinnedConversation}
          onReorderPinned={conversations.reorderPinnedConversation}
          onForkConversation={async (id: string) => {
            const nextId = await conversations.forkConversation(id)
            if (nextId) selectSidebarConversation(nextId)
          }}
          onNavigateCtf={setCtfSection}
        />

        <Suspense fallback={null}>
          {section === 'settings' ? (
            <SettingsPage
              initialCategory={settingsCategory}
              settings={settings}
              accountStatus={accountStatus}
              vulnerabilityDashboard={vulnerabilityDashboard}
              resolvedTheme={resolvedTheme}
              onClose={async () => {
                await loadSettings()
                setSection(settingsReturnTargetRef.current)
              }}
              onSettingsChange={applySettings}
              onAccountLogin={startAccountLogin}
              onAccountLogout={logoutAccount}
              onSecurityToolCodingHandoff={startSecurityToolCodingSetup}
              onConversationsChanged={conversations.load}
            />
          ) : section === 'profile' ? (
            <ProfilePage
              accountStatus={accountStatus}
              conversations={conv.rows}
              vulnerabilities={trackedVulnerabilities}
              onAccountStatusChange={(next: AccountStatus) => {
                accountStatusRef.current = next
                setAccountStatus(next)
              }}
            />
          ) : null}

          <div
            className="relative flex min-h-0 min-w-0 flex-1"
            style={{ display: workspaceSurfaceVisible ? undefined : 'none' }}
          >
            {keptWorkspacePages.has('ctf') ? (
              <div
                className="relative flex min-h-0 min-w-0 flex-1"
                style={{ display: section === 'ctf' && !dossierChatMaximized ? undefined : 'none' }}
              >
                <CTFPage
                  {...codingAgentBind}
                  {...domainAgentHandlers}
                  modelReady={modelReady}
                  modelVerified={modelVerified}
                  arenaReady={arenaReady}
                  initialJobId={ctfResumeJobId}
                  catalogEpoch={ctfCatalogEpoch}
                  ctfSection={ctfSection}
                  conversations={conv.rows}
                  conversation={conv.active}
                  ensureConversation={conversations.ensureConversation}
                  chatMaximized={dossierChatMaximized}
                  chatDockOpen={domainDockOpen}
                  onOpenSettings={(category?: 'apikeys' | 'browser') => openSettings(category ?? 'apikeys')}
                  onStartCodingAgent={startCTFAgent}
                  onOpenCodingConversation={openHistoryConversation}
                  onCtfAction={runCTFChatAction}
                />
              </div>
            ) : null}
            {keptWorkspacePages.has('vuln') ? (
              <div
                className="relative flex min-h-0 min-w-0 flex-1"
                style={{ display: section === 'vuln' && !dossierChatMaximized ? undefined : 'none' }}
              >
                <VulnPage
                  {...codingAgentBind}
                  {...domainAgentHandlers}
                  dashboard={vulnerabilityDashboard}
                  codingWorkspacePath={vulnerabilityCodingWorkspacePath}
                  navigationEpoch={vulnNavigationEpoch}
                  conversations={conv.rows}
                  conversation={conv.active}
                  ensureConversation={conversations.ensureConversation}
                  chatMaximized={dossierChatMaximized}
                  chatDockOpen={domainDockOpen}
                  onChooseCodingWorkspace={chooseVulnerabilityCodingWorkspace}
                  onStartCodingTask={startVulnerabilityCodingTask}
                  onOpenCodingConversation={openHistoryConversation}
                  onEnter={enterVulnerabilityDossier}
                  onRun={runVulnerabilityReproduction}
                  onOpenSettings={() => openSettings('apikeys')}
                  onOpenLabSettings={() => openSettings('lab')}
                />
              </div>
            ) : null}
            {keptWorkspacePages.has('lab') ? (
              <div
                className="relative flex min-h-0 min-w-0 flex-1"
                style={{ display: section === 'lab' && !dossierChatMaximized ? undefined : 'none' }}
              >
                <LabPage
                  {...codingAgentBind}
                  {...domainAgentHandlers}
                  conversations={conv.rows}
                  conversation={conv.active}
                  ensureConversation={conversations.ensureConversation}
                  chatMaximized={dossierChatMaximized}
                  chatDockOpen={domainDockOpen}
                  onEnter={enterLabJob}
                  onRun={runLabJob}
                  onRename={renameLabJob}
                  onOpenSettings={() => openSettings('apikeys')}
                  onOpenLabSettings={() => openSettings('lab')}
                />
              </div>
            ) : null}
            {section === 'chat' || section === 'settings' || section === 'profile' || dossierChatMaximized ? (
              <div
                className="relative flex min-h-0 min-w-0 flex-1"
                style={{ display: section === 'chat' || dossierChatMaximized ? undefined : 'none' }}
              >
              <ChatPage
                className="min-h-0 min-w-0 flex-1 bg-surface-editor"
                conversation={conv.active}
                settings={settings}
                workspacePath={conv.workspacePath}
                running={conv.running}
                aborting={conv.aborting}
                abortStalled={conv.abortStalled}
                messageQueue={conv.messageQueue}
                sessionReady={conv.sessionReady}
                resumed={conv.resumed}
                compacting={conv.compacting}
                compactedAt={conv.compactedAt}
                compactionError={conv.compactionError}
                turnStatus={conv.turnStatus}
                ctfSession={activeCTFConversation}
                vulnerabilitySession={activeVulnerabilityCodingConversation}
                ctfMode={conv.active?.ctfMode}
                ctfRole={conv.active?.ctfRole}
                kernel={conv.kernel}
                modelMode={conv.modelMode}
                modelProvider={conv.modelProvider}
                modelId={conv.modelId}
                thinkingLevel={conv.thinkingLevel}
                modelSourcePreference={conv.modelSourcePreference}
                executionMode={conv.executionMode}
                approvalPolicy={conv.approvalPolicy}
                mcpServers={conv.mcpServers}
                mcpConfigDigest={conv.mcpConfigDigest}
                ensureConversation={conversations.ensureConversation}
                pendingComposerDraft={conv.pendingComposerDraft}
                engineNotice={conv.engineNotice}
                engineNoticeRepeat={conv.engineNoticeRepeat}
                conversationDrawerOpen={codingConversationDrawerOpen}
                restorable={dossierChatMaximized}
                onSend={conversations.send}
                onConsumePendingDraft={() => conversations.consumeComposerDraft()}
                onCtfAction={runCTFChatAction}
                onAbort={abortConversation}
                onCompactContext={conversations.compactContext}
                onRewindContext={conversations.rewindContext}
                onHandoffContext={conversations.handoffContext}
                onNewConversation={newWorkspaceConversation}
                onControlGoal={conversations.controlGoal}
                onRespondApproval={conversations.respondApproval}
                onEditUser={conversations.editAndResend}
                onBranchAssistant={conversations.branchFromAssistant}
                onChooseWorkspace={chooseAgentWorkspace}
                onChooseWorkspaceForNewTask={chooseAgentWorkspaceForNewTask}
                onSelectWorkspace={selectCodingWorkspace}
                onForgetWorkspace={forgetCodingWorkspace}
                onClearWorkspace={clearCodingWorkspace}
                onCancelQueuedGuidance={conversations.cancelQueuedGuidance}
                onEditQueuedGuidance={conversations.editQueuedGuidance}
                onChangeModel={changeModel}
                onChangeKernel={changeKernel}
                onMigrateKernel={migrateKernel}
                onChangeThinkingLevel={conversations.setThinkingLevel}
                onChangeModelSource={conversations.setModelSourcePreference}
                onChangeCodingPolicy={conversations.setCodingPolicy}
                onChangeMcpServers={conversations.setMCPSelection}
                onOpenSettings={() => openSettings('apikeys')}
                onOpenConversation={openHistoryConversation}
                onReturnCtf={returnToCTFWorkspace}
                onReturnVuln={returnToVulnerabilityWorkspace}
                onReturnLab={returnToLabWorkspace}
                onRestore={restoreDossierChat}
                onSwitchCtfAgent={switchCTFAgent}
                onToggleConversationDrawer={toggleCodingConversationDrawer}
              />
              </div>
            ) : null}
          </div>
        </Suspense>
      </div>
      <CodingToolBudgetDialog
        open={Boolean(toolBudgetPrompt)}
        count={toolBudgetPrompt?.count ?? 150}
        onOpenChange={open => { if (!open) stopToolBudget() }}
        onContinue={continueToolBudget}
        onStop={stopToolBudget}
      />
      <UpdateInstallDialog
        open={installUpdatePromptOpen}
        onOpenChange={open => { if (!open) cancelInstallUpdate() }}
        onConfirm={confirmInstallUpdate}
        onCancel={cancelInstallUpdate}
      />
      <CommandPanel
        open={commandPanelOpen}
        conversations={conv.rows}
        onOpenChange={setCommandPanelOpen}
        onSelectConversation={selectSidebarConversation}
        onSelectSettings={category => openSettings(category)}
      />
      <Toaster />
    </div>
  )
}
