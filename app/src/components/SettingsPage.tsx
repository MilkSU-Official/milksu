import { createStore, useStore, useStoreRuntime } from '@/lib/reactStore'
import { useEffect, useRef } from 'react'
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Box,
  Bug,
  BookMarked,
  Check,
  Copy,
  Download,
  FileWarning,
  Flag,
  FlaskConical,
  FolderOpen,
  Gauge,
  Globe2,
  KeyRound,
  LogOut,
  Plug,
  Plus,
  Puzzle,
  RotateCcw,
  Settings2,
  Trash2,
  WalletCards,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
  Switch,
  Textarea,
} from '@/components/ui'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand, isMissingDesktopRuntime, listenEvent } from '@/desktop'
import type {
  BrowserUseRuntime,
  CodingComputerUsePermission,
  CodingComputerUseStatus,
} from '@/codingEnvironmentTypes'
import type { NSSCTFWebBridgeStatus } from '@/nssctfWebTypes'
import type {
  AppSettings,
  AccountStatus,
  BuildTracking,
  DatabaseCompatibilityState,
  DatabaseCompatibilityStatus,
  LocalDataBackupExport,
  LocalDataBackupRestore,
  LocalDataStatus,
  UserArtifactDirectoryStatus,
  LocalDiagnosticExport,
  ModelProbeResult,
  ModelThinkingConfig,
  ModelThinkingLevel,
  ProviderConfig,
  ProviderInfo,
} from '@/types'
import {
  customProviderInfo,
  PRESET_DEEPSEEK_SERVICE_ID,
  withAppSettingsDefaults,
} from '@/types'
import {
  encodePickerSelection,
  installAppModelSettings,
  loadModelCatalog,
  parsePickerSelection,
  useModelCatalog as readModelCatalog,
  modelCatalogStore,
  type PickerServiceGroup,
} from '@/modelCatalog'
import { GitHubIcon } from '@/components/GitHubIcon'
import VulnerabilityIntelSettingsPanel from '@/components/VulnerabilityIntelSettingsPanel'
import SettingsMCPPanel from '@/components/SettingsMCPPanel'
import EvalSettingsPanel from '@/components/EvalSettingsPanel'
import LabSettingsPanel from '@/components/LabSettingsPanel'
import PluginSettingsPanel from '@/components/PluginSettingsPanel'
import ModelVendorIcon from '@/components/ModelVendorIcon'
import ArchivedConversationsSettings from '@/components/ArchivedConversationsSettings'
import ConnectionLiveStatus from '@/components/ConnectionLiveStatus'
import type { VulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import {
  allCodingSkills,
  isOptionalCodingSkill,
  skillIsEnabled,
} from '@/codingSkills'
import {
  emptyAgentResourceCatalog,
  type AgentResourceCatalog,
  type AgentResourceSkill,
  type BuiltinConfigHandoff,
  type BuiltinSkillDocument,
} from '@/agentResourceTypes'
import {
  EXTERNAL_EDITORS,
  normalizePreferredExternalEditor,
} from '@/lib/externalEditor'
import ExternalEditorIcon from '@/components/ExternalEditorIcon'
import { buildDiagnosticText, isDebugMode, setDebugMode } from '@/lib/debugMode'
import { explainModelVerificationFailure } from '@/lib/tokenFluxError'
import { applyUiLocale, normalizeUiLocale, t } from '@/lib/uiLocale'
import {
  builtInModelThinking,
  MODEL_THINKING_LEVEL_LABELS,
  MODEL_THINKING_LEVELS,
  normalizeModelThinkingConfig,
  resolveModelThinking,
} from '@/lib/modelThinking'
import { resolveModelContextWindow } from '@/lib/knownContextWindow'
import type { ResolvedThemeMode } from '@/lib/themeMode'
import { useT } from '@/hooks/useUiLocale'

type SettingsCategory = 'general' | 'apikeys' | 'ctf' | 'cve' | 'lab' | 'coding' | 'skills' | 'mcp' | 'chats' | 'browser' | 'security-tools' | 'eval' | 'plugins'
type NormalizedSettingsCategory = Exclude<SettingsCategory, 'security-tools' | 'coding'>
type SettingsNotice = { tone: 'ok' | 'error'; text: string }
type PendingCustomRelay = { id: string; config: ProviderConfig }

type SettingsState = {
  category: NormalizedSettingsCategory
  working: AppSettings | null
  saving: boolean
  verifying: boolean
  localDataLoading: boolean
  computerUseLoading: boolean
  computerUseRequesting: CodingComputerUsePermission | null
  computerUseRestarting: boolean
  browserBridgeLoading: boolean
  browserSetupBusy: boolean
  browserUseOpening: boolean
  browserUseRuntimeLoading: boolean
  browserUseRuntime: BrowserUseRuntime | null
  backupExporting: boolean
  restoreScheduling: boolean
  diagnosticExporting: boolean
  localData: LocalDataStatus | null
  userArtifacts: UserArtifactDirectoryStatus | null
  computerUseStatus: CodingComputerUseStatus | null
  browserBridgeStatus: NSSCTFWebBridgeStatus | null
  buildTracking: BuildTracking | null
  buildTrackingCopying: boolean
  notice: SettingsNotice | null
  editingProviderID: string | null
  customModelInput: string
  pendingCustomRelay: PendingCustomRelay | null
  accountStatusProp: AccountStatus | undefined
  thinkingModelKey: string
  windowModelKey: string
  codingToolSkills: CodingToolSkillSnapshot[]
  codingToolSetupBusy: string
  userSkillCatalog: AgentResourceCatalog
  userSkillBusy: boolean
  userSkillError: string
  editingBuiltinSkill: string
  builtinSkillDocument: string
  builtinSkillCustomized: boolean
  debugModeOn: boolean
}

function normalizeSettingsCategory(value: SettingsCategory): NormalizedSettingsCategory {
  if (value === 'security-tools') return 'mcp'
  if (value === 'coding') return 'skills'
  return value
}

type CodingToolSkillSnapshot = {
  name: string
  status: 'found' | 'missing' | 'needs_setup' | 'configuring' | 'failed'
  version?: string
  problem?: string
  canPrepare: boolean
  preparing: boolean
}

type ModelServiceRow =
  | { key: 'account'; source: 'account'; provider?: undefined }
  | { key: string; source: 'personal'; provider: ProviderInfo }

const WORKER_MODEL_INHERIT = 'inherit'

const databaseStateVariants: Record<DatabaseCompatibilityState, 'secondary' | 'destructive' | 'outline'> = {
  compatible: 'secondary',
  missing: 'outline',
  newer: 'destructive',
  corrupt: 'destructive',
  remaining: 'outline',
}

export default function SettingsPage({
  settings,
  initialCategory,
  accountStatus,
  vulnerabilityDashboard,
  resolvedTheme,
  onClose,
  onSettingsChange,
  onAccountLogin,
  onAccountLogout,
  onSecurityToolCodingHandoff,
  onConversationsChanged,
}: {
  settings: AppSettings | null
  initialCategory: SettingsCategory
  accountStatus?: AccountStatus
  vulnerabilityDashboard?: VulnerabilityDashboard
  resolvedTheme: ResolvedThemeMode
  onClose?: () => void
  onSettingsChange?: (value: AppSettings) => void
  onAccountLogin?: () => void
  onAccountLogout?: () => void
  onSecurityToolCodingHandoff?: (handoff: BuiltinConfigHandoff) => void
  onConversationsChanged?: () => void
}) {
  const t = useT()
  const callbacks = useRef({
    onSettingsChange,
    onAccountLogin,
    onAccountLogout,
    onSecurityToolCodingHandoff,
    onConversationsChanged,
  })
  callbacks.current = {
    onSettingsChange,
    onAccountLogin,
    onAccountLogout,
    onSecurityToolCodingHandoff,
    onConversationsChanged,
  }

  const store = useStoreRuntime(() => createSettingsStore(callbacks))
  useStore(modelCatalogStore)
  const state = store.store.getState()

  useEffect(() => {
    store.applySettings(settings)
  }, [settings, store])

  useEffect(() => {
    store.applyInitialCategory(initialCategory)
  }, [initialCategory, store])

  useEffect(() => {
    store.setAccountStatusProp(accountStatus)
  }, [store, accountStatus])

  const category = state.category
  const working = state.working
  const saving = state.saving
  const verifying = state.verifying
  const localDataLoading = state.localDataLoading
  const computerUseLoading = state.computerUseLoading
  const computerUseRequesting = state.computerUseRequesting
  const computerUseRestarting = state.computerUseRestarting
  const browserBridgeLoading = state.browserBridgeLoading
  const browserSetupBusy = state.browserSetupBusy
  const browserUseOpening = state.browserUseOpening
  const browserUseRuntimeLoading = state.browserUseRuntimeLoading
  const browserUseRuntime = state.browserUseRuntime
  const backupExporting = state.backupExporting
  const restoreScheduling = state.restoreScheduling
  const diagnosticExporting = state.diagnosticExporting
  const localData = state.localData
  const userArtifacts = state.userArtifacts
  const computerUseStatus = state.computerUseStatus
  const browserBridgeStatus = state.browserBridgeStatus
  const buildTracking = state.buildTracking
  const buildTrackingCopying = state.buildTrackingCopying
  const notice = state.notice
  const customModelInput = state.customModelInput
  const thinkingModelKey = state.thinkingModelKey
  const windowModelKey = state.windowModelKey
  const codingToolSetupBusy = state.codingToolSetupBusy
  const userSkillBusy = state.userSkillBusy
  const userSkillError = state.userSkillError
  const editingBuiltinSkill = state.editingBuiltinSkill
  const builtinSkillDocument = state.builtinSkillDocument
  const debugModeOn = state.debugModeOn
  const availablePickerGroups = store.availablePickerGroups()
  const account = store.account()
  const accountStateLabel = store.accountStateLabel()
  const databaseStateLabels: Record<DatabaseCompatibilityState, string> = {
    compatible: t('兼容', 'Compatible'),
    missing: t('尚未创建', 'Not created yet'),
    newer: t('数据库较新', 'Database is newer'),
    corrupt: t('损坏或不可读', 'Corrupt or unreadable'),
    remaining: t('尚未纳入迁移', 'Not yet migrated'),
  }
  const defaultModelKey = store.defaultModelKey()
  const defaultModelAvailable = store.defaultModelAvailable()
  const availableModelCount = store.availableModelCount()
  const defaultModelLabel = store.defaultModelLabel()
  const thinkingModelID = store.thinkingModelID()
  const thinkingModelLabel = store.thinkingModelLabel()
  const thinkingOverride = store.thinkingOverride()
  const thinkingProfile = store.thinkingProfile()
  const windowModelID = store.windowModelID()
  const windowModelLabel = store.windowModelLabel()
  const windowOverride = store.windowOverride()
  const effectiveWindow = store.effectiveWindow()
  const workerModelKey = store.workerModelKey()
  const workerModelLabel = store.workerModelLabel()
  const userSkills = store.userSkills()
  const accountRoute = store.accountRoute()
  const modelServiceRows = store.modelServiceRows()
  const editingProviderInfo = store.editingProviderInfo()
  const editingProviderModel = store.editingProviderModel()
  const editingProviderModels = store.editingProviderModels()
  const editingProvider = store.editingProvider()
  const providerEditorOpen = store.providerEditorOpen()
  const computerUsePermissionsReady = store.computerUsePermissionsReady()
  const browserUseDescription = store.browserUseDescription()
  const browserBridgeConnected = store.browserBridgeConnected()
  const browserPairingReady = store.browserPairingReady()
  const browserExtensionReady = store.browserExtensionReady()
  const settingsCategories = store.settingsCategories()
  const dashboard = vulnerabilityDashboard

  const categoryIcons = {
    general: Settings2,
    apikeys: Box,
    ctf: Flag,
    cve: Bug,
    lab: FlaskConical,
    skills: BookMarked,
    mcp: Plug,
    chats: Archive,
    browser: Globe2,
    eval: Gauge,
    plugins: Puzzle,
  } as const

  return (
    <main className="settings-page flex min-w-0 flex-1 flex-col bg-background">
      <header className="app-drag settings-page-header shell-window-control-safe-x flex h-14 shrink-0 items-center border-b border-border bg-background pl-5 text-foreground">
        <Button variant="ghost" size="icon-sm" className="app-no-drag mr-3" aria-label={t('返回', 'Back')} onClick={onClose}>
          <ArrowLeft className="size-4" />
        </Button>
        <p className="text-lg font-semibold tracking-[-0.02em]">
          {settingsCategories.find(item => item.value === category)?.label}
        </p>
      </header>

      <div className="settings-layout flex min-h-0 flex-1">
        <nav className="settings-nav settings-nav-surface app-no-drag w-56 shrink-0 border-r px-3 py-5" aria-label={t('设置分类', 'Settings categories')} data-plugin-surface="workspace-list">
          <div className="grid gap-0.5">
              {settingsCategories.map(item => {
                const Icon = categoryIcons[item.value]
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={`settings-nav-item${category === item.value ? ' active' : ''}`}
                    aria-selected={category === item.value}
                    aria-current={category === item.value ? 'page' : undefined}
                    onClick={() => store.selectCategory(item.value)}
                  >
                    <Icon className="mr-3 size-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
          </div>
        </nav>

        <div className="page-scroll min-w-0 flex-1">
          <div className="page-column page-stack" data-plugin-surface="workspace-list">
            {notice ? (
              <Alert
                variant={notice.tone === 'error' ? 'destructive' : 'default'}
                className={notice.tone === 'error' ? 'settings-notice settings-notice--error' : 'settings-notice settings-notice--ok'}
              >
                {notice.tone === 'error' ? <AlertCircle className="size-4" /> : <Check className="size-4" />}
                <AlertDescription>{notice.text}</AlertDescription>
              </Alert>
            ) : null}

            {working && category === 'general' ? (
              <>
                <SettingsSection title={t('账户', 'Account')}>
                  <SettingsRow
                    label={t('GitHub 账户', 'GitHub account')}
                    description={account.state === 'active'
                      ? `@${account.user?.githubLogin || 'GitHub'} · ${t('内测用户', 'beta user')}`
                      : ''}
                    trailing={(
                      <div className="flex items-center gap-3">
                        <Badge variant={account.state === 'active' ? 'secondary' : 'outline'}>{accountStateLabel}</Badge>
                        {account.state === 'active' ? (
                          <Button variant="ghost" size="sm" onClick={onAccountLogout}>
                            <LogOut className="size-4" />{t('退出', 'Sign out')}
                          </Button>
                        ) : account.configured ? (
                          <Button variant="outline" size="sm" onClick={onAccountLogin}>
                            <GitHubIcon className="size-4" />{t('GitHub 登录', 'GitHub sign-in')}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  />
                </SettingsSection>

                <SettingsSection title={t('应用', 'App')}>
                  <SettingsRow
                    label={t('界面语言', 'Interface language')}
                    trailing={(
                      <NativeSelect
                        value={working.locale ?? 'zh'}
                        aria-label={t('界面语言', 'Interface language')}
                        onChange={event => void store.changeLocale(event.target.value)}
                      >
                        <NativeSelectOption value="zh">{t('简体中文', 'Simplified Chinese')}</NativeSelectOption>
                        <NativeSelectOption value="en">English</NativeSelectOption>
                      </NativeSelect>
                    )}
                  />
                </SettingsSection>
                <SettingsSection title={t('编辑器', 'Editor')}>
                  <SettingsRow
                    label={t('打开文件', 'Open files')}
                    divider={false}
                    trailing={(
                      <div className="flex items-center gap-2">
                        <ExternalEditorIcon editor={working.preferred_external_editor} />
                        <NativeSelect
                          value={normalizePreferredExternalEditor(working.preferred_external_editor)}
                          aria-label={t('打开文件的编辑器', 'Editor for opening files')}
                          onChange={event => {
                            store.patchWorking(value => { value.preferred_external_editor = String(event.target.value) })
                            void store.save()
                          }}
                        >
                          {EXTERNAL_EDITORS.map(editor => (
                            <NativeSelectOption key={editor.id} value={editor.id}>
                              {editor.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </div>
                    )}
                  />
                </SettingsSection>
                <SettingsSection title={t('文件', 'Files')}>
                  <SettingsRow
                    label={t('文档', 'Documents')}
                    description={userArtifacts?.directory || ''}
                    divider={false}
                    data-testid="user-artifact-directory"
                  />
                </SettingsSection>
                <SettingsSection title={t('本地数据', 'Local data')}>
                  <SettingsRow
                    stack="always"
                    label={t('数据与备份', 'Data and backups')}
                    description={localDataLoading
                      ? t('正在统计本地数据', 'Counting local data')
                      : localData
                        ? t(`${localData.fileCount} 个文件 · ${store.formatBytes(localData.bytes)}`, `${localData.fileCount} files · ${store.formatBytes(localData.bytes)}`)
                        : ''}
                  >
                    {localData?.directory ? (
                      <p className="mb-3 truncate font-mono text-caption text-muted-foreground" title={localData.directory}>
                        {localData.directory}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => void store.revealLocalData()}>
                        <FolderOpen className="size-3.5" />
                        {t('打开数据目录', 'Open data folder')}
                      </Button>
                      <Button variant="outline" size="sm" disabled={backupExporting} onClick={() => void store.exportLocalDataBackup()}>
                        <Download className="size-3.5" />
                        {t('导出安全备份', 'Export a safe backup')}
                      </Button>
                      <Button variant="outline" size="sm" disabled={restoreScheduling} onClick={() => void store.scheduleLocalDataRestore()}>
                        <RotateCcw className="size-3.5" />
                        {t('从备份恢复', 'Restore from backup')}
                      </Button>
                      <Button variant="outline" size="sm" disabled={diagnosticExporting} onClick={() => void store.exportLocalDiagnostics()}>
                        <FileWarning className="size-3.5" />
                        {t('导出诊断包', 'Export diagnostics')}
                      </Button>
                    </div>
                  </SettingsRow>
                  {localData?.databases?.length ? (
                    <SettingsRow stack="always" label={t('数据库兼容性', 'Database compatibility')}>
                      <ul className="flex min-w-0 flex-col gap-3">
                        {localData.databases.map(database => (
                          <li key={database.relativePath} className="min-w-0 rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex min-w-0 flex-col items-start gap-y-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
                              <span className="min-w-0 text-control font-medium">{database.logicalName}</span>
                              <Badge variant={databaseStateVariants[database.state]} className="min-w-0">
                                {databaseStateLabels[database.state]}
                              </Badge>
                              {store.databaseVersionText(database) ? (
                                <span className="min-w-0 text-caption text-muted-foreground">
                                  {store.databaseVersionText(database)}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 break-all font-mono text-caption text-muted-foreground" title={database.relativePath}>
                              {database.relativePath}
                            </p>
                            {database.error ? <p className="break-words text-caption text-destructive">{database.error}</p> : null}
                          </li>
                        ))}
                      </ul>
                    </SettingsRow>
                  ) : null}
                </SettingsSection>

                <SettingsSection title={t('构建追踪', 'Build tracking')} className="border-t border-border pt-6">
                  <SettingsRow stack="always" label={t('可复制构建追踪', 'Copyable build tracking')}>
                    {buildTracking ? (
                      <div
                        className="rounded-xl border border-border bg-muted/30 p-3 font-mono text-caption leading-5 text-foreground"
                        aria-label={t('构建追踪', 'Build tracking')}
                        data-testid="build-tracking"
                      >
                        <pre className="whitespace-pre-wrap break-all">{store.formatBuildTrackingText(buildTracking)}</pre>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" disabled={buildTrackingCopying} onClick={() => void store.copyBuildTracking()}>
                            <Copy className="size-3.5" />
                            {t('复制完整追踪', 'Copy full tracking')}
                          </Button>
                          {buildTracking.channel === 'beta' && !buildTracking.development ? <Badge variant="secondary">BETA</Badge> : null}
                          {buildTracking.development ? <Badge variant="outline">development/unpackaged</Badge>
                            : buildTracking.missing ? <Badge variant="destructive">{t('sealed provenance 缺失', 'sealed provenance missing')}</Badge>
                              : buildTracking.dirty ? <Badge variant="outline">dirty</Badge>
                                : <Badge variant="outline">clean</Badge>}
                        </div>
                      </div>
                    ) : (
                      <p className="text-caption text-muted-foreground">{t('未能读取构建追踪。', 'Could not read build tracking.')}</p>
                    )}
                  </SettingsRow>
                  <SettingsRow
                    label={t('调试模式', 'Debug mode')}
                    divider={false}
                    trailing={(
                      <div className="flex items-center gap-2">
                        {debugModeOn ? (
                          <Button variant="ghost" size="sm" onClick={() => void store.copyDebugDiagnostics()}>
                            {t('复制诊断', 'Copy diagnostics')}
                          </Button>
                        ) : null}
                        <Switch
                          checked={debugModeOn}
                          aria-label={t('开启调试模式', 'Turn on debug mode')}
                          onCheckedChange={value => {
                            store.setDebugModeOn(Boolean(value))
                            setDebugMode(Boolean(value))
                          }}
                        />
                      </div>
                    )}
                  />
                </SettingsSection>
              </>
            ) : working && category === 'skills' ? (
              <>
                <SettingsSection title={t('内置 Skills', 'Built-in Skills')}>
                  {userSkillError ? <p className="px-4 py-3 text-caption text-destructive">{userSkillError}</p> : null}
                  {allCodingSkills().map(skill => (
                    <SettingsRow
                      key={skill.name}
                      label={skill.label}
                      description={[
                        skill.description,
                        store.codingToolSkill(skill.name) ? store.codingToolStatusLabel(store.codingToolSkill(skill.name)!) : '',
                        store.skillOverlay(skill.name)?.customized ? t('已修改', 'Modified') : '',
                      ].filter(Boolean).join(' · ')}
                      trailing={(
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {store.codingToolSkill(skill.name)?.canPrepare ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={codingToolSetupBusy === skill.name}
                              onClick={() => void store.prepareCodingToolSkill(skill.name)}
                            >
                              {t('准备', 'Prepare')}
                            </Button>
                          ) : null}
                          <Button type="button" variant="outline" size="sm" disabled={userSkillBusy} onClick={() => void store.startEditBuiltinSkill(skill.name)}>
                            {t('编辑', 'Edit')}
                          </Button>
                          {store.skillOverlay(skill.name)?.customized ? (
                            <Button type="button" variant="outline" size="sm" disabled={userSkillBusy} onClick={() => void store.restoreBuiltinSkill(skill.name)}>
                              {t('恢复默认', 'Restore default')}
                            </Button>
                          ) : null}
                          <Button type="button" variant="outline" size="sm" disabled={userSkillBusy} onClick={() => void store.openBuiltinSkillConversation(skill.name)}>
                            {t('用对话配置', 'Configure in chat')}
                          </Button>
                          <Switch
                            checked={store.skillEnabled(skill.name)}
                            aria-label={t(`启用${skill.label}`, `Enable ${skill.label}`)}
                            onCheckedChange={value => store.setSkillEnabled(skill.name, Boolean(value))}
                          />
                        </div>
                      )}
                    />
                  ))}
                </SettingsSection>

                {editingBuiltinSkill ? (
                  <SettingsSection
                    title={t('编辑内置 Skill', 'Edit built-in Skill')}
                    footer={(
                      <div className="flex items-center justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={userSkillBusy} onClick={() => store.closeBuiltinSkillEditor()}>
                          {t('取消', 'Cancel')}
                        </Button>
                        <Button type="button" size="sm" disabled={userSkillBusy} onClick={() => void store.saveBuiltinSkill()}>
                          {t('保存', 'Save')}
                        </Button>
                      </div>
                    )}
                  >
                    <SettingsRow
                      label={t('SKILL.md', 'SKILL.md')}
                      divider={false}
                      trailing={(
                        <Textarea
                          value={builtinSkillDocument}
                          onChange={event => { store.setBuiltinSkillDocument(event.target.value) }}
                          className="w-[28rem] max-w-full min-h-48"
                          disabled={userSkillBusy}
                          aria-label={t('Skill 文档', 'Skill document')}
                        />
                      )}
                    />
                  </SettingsSection>
                ) : null}

                <SettingsSection
                  title={t('用户 Skills', 'User Skills')}
                  actions={(
                    <Button type="button" variant="outline" size="sm" disabled={userSkillBusy} onClick={() => void store.importUserSkill()}>
                      {t('导入', 'Import')}
                    </Button>
                  )}
                >
                  {userSkillError ? <p className="px-4 py-3 text-caption text-destructive">{userSkillError}</p> : null}
                  {userSkills.map(skill => (
                    <SettingsRow
                      key={skill.name}
                      label={skill.label}
                      description={skill.slashOnly
                        ? [skill.description, t('仅斜杠调用', 'Slash only')].filter(Boolean).join(' · ')
                        : skill.description}
                      trailing={(
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            disabled={userSkillBusy}
                            aria-label={t(`删除 ${skill.label}`, `Delete ${skill.label}`)}
                            onClick={() => void store.deleteUserSkill(skill.name)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                          <Switch
                            checked={skill.enabled}
                            disabled={userSkillBusy}
                            aria-label={t(`启用${skill.label}`, `Enable ${skill.label}`)}
                            onCheckedChange={value => void store.setUserSkillEnabled(skill, Boolean(value))}
                          />
                        </div>
                      )}
                    />
                  ))}
                </SettingsSection>
              </>
            ) : category === 'mcp' ? (
              <SettingsMCPPanel onCodingHandoff={handoff => onSecurityToolCodingHandoff?.(handoff)} />
            ) : category === 'chats' ? (
              <ArchivedConversationsSettings onChanged={onConversationsChanged} />
            ) : working && category === 'browser' ? (
              <>
                <SettingsSection title="Browser Use">
                  <SettingsRow
                    label={t('真实浏览器', 'Your browser')}
                    description={browserUseDescription}
                    divider={false}
                    trailing={(
                      <div className="flex items-center gap-2">
                        <ConnectionLiveStatus live={Boolean(browserUseRuntime?.found)} />
                        <Button variant="outline" size="sm" disabled={browserUseRuntimeLoading} onClick={() => void store.refreshBrowserUseRuntime()}>
                          {t('检测', 'Check')}
                        </Button>
                        <Button variant="outline" size="sm" disabled={browserUseOpening || !browserUseRuntime?.found} onClick={() => void store.openPlaywrightBrowserExtension()}>
                          {t('安装扩展', 'Install extension')}
                        </Button>
                      </div>
                    )}
                  />
                </SettingsSection>

                <SettingsSection title={t('CTF 站点', 'CTF sites')}>
                  <SettingsRow
                    label={t('连接', 'Connection')}
                    trailing={(
                      <div className="flex items-center gap-2">
                        <ConnectionLiveStatus live={browserBridgeConnected} />
                        <Button variant="outline" size="sm" disabled={browserBridgeLoading} onClick={() => void store.refreshBrowserBridgeStatus()}>
                          {t('检测', 'Check')}
                        </Button>
                      </div>
                    )}
                  />
                  <SettingsRow
                    label={t('本地扩展', 'Local extension')}
                    trailing={(
                      <Button variant="outline" size="sm" disabled={browserSetupBusy || !browserExtensionReady} onClick={() => void store.prepareBrowserExtension()}>
                        {t('安装', 'Install')}
                      </Button>
                    )}
                  />
                  <SettingsRow
                    label={t('配对码', 'Pairing code')}
                    description={browserBridgeStatus?.bridge.pairingCode || ''}
                    divider={false}
                    trailing={(
                      <Button variant="outline" size="sm" disabled={!browserPairingReady} onClick={() => void store.copyBrowserPairingCode()}>
                        {t('复制', 'Copy')}
                      </Button>
                    )}
                  />
                </SettingsSection>

                <SettingsSection
                  title="Computer Use"
                  actions={(
                    <>
                      <Button variant="outline" size="sm" disabled={computerUseLoading} onClick={() => void store.refreshComputerUseStatus()}>
                        {t('重新检测', 'Recheck')}
                      </Button>
                      {computerUseStatus && computerUsePermissionsReady ? (
                        <Button variant="outline" size="sm" disabled={computerUseRestarting} onClick={() => void store.relaunchDesktopApp()}>
                          {t('重新打开 MilkSU', 'Reopen MilkSU')}
                        </Button>
                      ) : null}
                    </>
                  )}
                >
                  {computerUseStatus && !computerUseStatus.available ? (
                    <SettingsRow
                      label={t('状态', 'Status')}
                      description={computerUseStatus.problem || ''}
                      divider={false}
                      trailing={<ConnectionLiveStatus live={false} />}
                    />
                  ) : computerUseStatus?.signing?.signature === 'linux-portal' ? (
                    <SettingsRow
                      label={t('桌面共享', 'Desktop sharing')}
                      description={t('启动任务时 GNOME 会弹出授权。截屏、按坐标点击和打字是整桌面级，不是单个窗口。', 'GNOME prompts for sharing when you start a task. Screenshot, coordinate clicks and typing are display-level, not a single window.')}
                      divider={false}
                      trailing={<ConnectionLiveStatus live={true} />}
                    />
                  ) : computerUseStatus ? (
                    <>
                      <SettingsRow
                        label={t('辅助功能', 'Accessibility')}
                        trailing={(
                          <div className="flex items-center gap-2">
                            <ConnectionLiveStatus live={Boolean(computerUseStatus.permissions.accessibility)} />
                            {!computerUseStatus.permissions.accessibility ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!computerUseStatus.available || Boolean(computerUseRequesting)}
                                onClick={() => void store.requestComputerUsePermission('accessibility')}
                              >
                                {t('打开辅助功能设置', 'Open Accessibility settings')}
                              </Button>
                            ) : null}
                          </div>
                        )}
                      />
                      <SettingsRow
                        label={t('屏幕录制', 'Screen Recording')}
                        divider={false}
                        trailing={(
                          <div className="flex items-center gap-2">
                            <ConnectionLiveStatus live={Boolean(computerUseStatus.permissions.screenRecording)} />
                            {!computerUseStatus.permissions.screenRecording ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!computerUseStatus.available || Boolean(computerUseRequesting)}
                                onClick={() => void store.requestComputerUsePermission('screen-recording')}
                              >
                                {t('打开屏幕录制设置', 'Open Screen Recording settings')}
                              </Button>
                            ) : null}
                          </div>
                        )}
                      />
                    </>
                  ) : null}
                </SettingsSection>
              </>
            ) : working && category === 'apikeys' ? (
              <>
                <SettingsSection title={t('调用', 'Invocation')}>
                  <SettingsRow
                    label={t('默认模型', 'Default model')}
                    description={!defaultModelAvailable && availableModelCount > 0
                      ? t('当前默认模型不可用', 'The current default model is unavailable')
                      : ''}
                    trailing={(
                      <Select value={defaultModelKey} onValueChange={value => { store.setDefaultModelKey(value) }}>
                        <SelectTrigger id="default-model" className="w-72 max-w-full" aria-label={t('默认模型', 'Default model')}>
                          <SelectValue>
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <ModelVendorIcon model={working?.active_model ?? ''} label={defaultModelLabel} />
                              <span className="min-w-0 truncate">{defaultModelLabel}</span>
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-96">
                          {!defaultModelAvailable && defaultModelKey ? (
                            <SelectGroup>
                              <SelectLabel>{t('当前选择', 'Current selection')}</SelectLabel>
                              <SelectItem value={defaultModelKey} disabled>
                                <span className="inline-flex min-w-0 items-center gap-2">
                                  <ModelVendorIcon model={working?.active_model ?? ''} label={defaultModelLabel} />
                                  <span className="min-w-0 truncate">{t(`${defaultModelLabel}（当前不可用）`, `${defaultModelLabel} (unavailable)`)}</span>
                                </span>
                              </SelectItem>
                            </SelectGroup>
                          ) : null}
                          {!defaultModelAvailable && availablePickerGroups.length ? <SelectSeparator /> : null}
                          {availablePickerGroups.map((group, groupIndex) => (
                            <SelectGroup key={group.key}>
                              {groupIndex > 0 || (!defaultModelAvailable && defaultModelKey) ? <SelectSeparator /> : null}
                              <SelectLabel>{group.label}</SelectLabel>
                              {group.models.map(model => (
                                <SelectItem key={`${group.key}:${model}`} value={encodePickerSelection(group.providerId, model, group.source)}>
                                  <span className="inline-flex min-w-0 items-center gap-2">
                                    <ModelVendorIcon model={model} label={store.availablePickerModelLabel(group, model)} />
                                    <span className="min-w-0 truncate">{store.availablePickerModelLabel(group, model)}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <SettingsRow
                    label={t('subagent', 'subagent')}
                    divider={false}
                    trailing={(
                      <Select value={workerModelKey} onValueChange={value => { store.setWorkerModelKey(value) }}>
                        <SelectTrigger id="worker-model" className="w-72 max-w-full" aria-label={t('subagent', 'subagent')}>
                          <SelectValue>
                            <span className="min-w-0 truncate">{workerModelLabel}</span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-96">
                          <SelectGroup>
                            <SelectItem value={WORKER_MODEL_INHERIT}>
                              {t('跟随当前对话', 'Follow current conversation')}
                            </SelectItem>
                          </SelectGroup>
                          {availablePickerGroups.length ? <SelectSeparator /> : null}
                          {availablePickerGroups.map((group, groupIndex) => (
                            <SelectGroup key={group.key}>
                              {groupIndex > 0 ? <SelectSeparator /> : null}
                              <SelectLabel>{group.label}</SelectLabel>
                              {group.models.map(model => (
                                <SelectItem key={`${group.key}:${model}`} value={encodePickerSelection(group.providerId, model, group.source)}>
                                  <span className="inline-flex min-w-0 items-center gap-2">
                                    <ModelVendorIcon model={model} label={store.availablePickerModelLabel(group, model)} />
                                    <span className="min-w-0 truncate">{store.availablePickerModelLabel(group, model)}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </SettingsSection>

                <section>
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-title font-semibold">{t('模型服务', 'Model services')}</h2>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t('新增模型服务', 'Add a model service')}
                      title={t('新增自定义中转站', 'Add a custom relay')}
                      onClick={() => store.addModelService()}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>

                  <div className="model-service-list mt-4 overflow-hidden rounded-lg border border-border bg-card">
                    {modelServiceRows.map(row => (
                      <article
                        key={row.key}
                        className="model-service-row grid min-h-20 grid-cols-[48px_minmax(170px,1fr)_minmax(180px,1.1fr)_90px_auto_auto] items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
                      >
                        <span className="model-service-icon grid size-11 place-items-center rounded-lg border border-border bg-muted/40 text-foreground">
                          {row.source === 'account' ? <WalletCards className="size-5" /> : row.provider.kind === 'relay' ? <Box className="size-5" /> : <KeyRound className="size-5" />}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : store.providerServiceName(row.provider)}
                          </p>
                          {row.source === 'account' ? (
                            <p className="mt-0.5 text-caption text-muted-foreground">{t('登录后由管理员分配的 TokenFlux 配额', 'TokenFlux quota assigned by an admin after sign-in')}</p>
                          ) : row.provider.id === 'tokenflux' ? (
                            <p className="mt-0.5 text-caption text-muted-foreground">{t('你自己的 TokenFlux API Key', 'Your own TokenFlux API key')}</p>
                          ) : null}
                        </div>
                        <p
                          className="truncate text-caption text-muted-foreground"
                          title={row.source === 'account' ? store.accountModelsText() : store.providerModelsText(row.provider)}
                        >
                          {row.source === 'account' ? store.accountModelsText() : store.providerModelsText(row.provider)}
                        </p>
                        <span className="text-caption font-medium text-muted-foreground">{store.serviceStatus(row)}</span>
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap text-caption">
                          {row.source === 'personal' ? (
                            <>
                              <button type="button" className="text-link hover:underline" onClick={() => store.openProviderEditor(row.provider.id)}>
                                {t('编辑', 'Edit')}
                              </button>
                              <span className="text-muted-foreground">/</span>
                              <button type="button" className="text-destructive hover:underline" onClick={() => store.removeModelService(row.provider.id)}>
                                {t('删除', 'Delete')}
                              </button>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                        <Switch
                          checked={row.source === 'account' ? Boolean(accountRoute?.enabled) : Boolean(store.providerConfig(row.provider.id)?.enabled)}
                          aria-label={t(`启用${row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : store.providerServiceName(row.provider)}`, `Enable ${row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : store.providerServiceName(row.provider)}`)}
                          onCheckedChange={value => store.setModelServiceEnabled(row, Boolean(value))}
                        />
                      </article>
                    ))}
                  </div>
                </section>

                <SettingsSection title={t('模型能力', 'Model capabilities')}>
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{t('思考层级', 'Thinking levels')}</p>
                        <p className="mt-1 text-caption text-muted-foreground">
                          {t('GPT 与 Claude Opus、Sonnet、Fable 使用内置预设；其他模型需要手动启用并选择实际支持的档位', 'GPT and Claude Opus, Sonnet, and Fable use built-in presets. Other models need thinking enabled by hand, with the levels they actually support.')}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {thinkingProfile.source === 'preset'
                          ? t('内置预设', 'Built-in preset')
                          : thinkingProfile.source === 'manual'
                            ? t('手动配置', 'Custom')
                            : t('未启用', 'Off')}
                      </Badge>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <Select value={thinkingModelKey} onValueChange={value => { store.setThinkingModelKey(value) }}>
                        <SelectTrigger className="w-full" aria-label={t('配置思考层级的模型', 'Model for thinking levels')}>
                          <SelectValue>
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <ModelVendorIcon model={thinkingModelID} label={thinkingModelLabel} />
                              <span className="min-w-0 truncate">{thinkingModelLabel}</span>
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-96">
                          {availablePickerGroups.map((group, groupIndex) => (
                            <SelectGroup key={`thinking:${group.key}`}>
                              {groupIndex > 0 ? <SelectSeparator /> : null}
                              <SelectLabel>{group.label}</SelectLabel>
                              {group.models.map(model => (
                                <SelectItem key={`thinking:${group.key}:${model}`} value={encodePickerSelection(group.providerId, model, group.source)}>
                                  <span className="inline-flex min-w-0 items-center gap-2">
                                    <ModelVendorIcon model={model} label={store.availablePickerModelLabel(group, model)} />
                                    <span className="min-w-0 truncate">{store.availablePickerModelLabel(group, model)}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="flex items-center justify-end gap-3">
                        {thinkingOverride ? (
                          <button type="button" className="text-caption text-link hover:underline" onClick={() => store.resetModelThinkingOverride()}>
                            {t('恢复预设', 'Restore preset')}
                          </button>
                        ) : null}
                        <Switch
                          checked={thinkingProfile.enabled}
                          disabled={!thinkingModelID}
                          aria-label={t('启用模型思考层级', 'Enable model thinking levels')}
                          onCheckedChange={value => store.setModelThinkingEnabled(Boolean(value))}
                        />
                      </div>
                    </div>

                    {thinkingProfile.enabled ? (
                      <div className="mt-4 border-t border-border pt-4">
                        <p className="text-label font-medium text-muted-foreground">{t('支持档位', 'Supported levels')}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {MODEL_THINKING_LEVELS.map(level => (
                            <button
                              key={level}
                              type="button"
                              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-caption transition-colors ${thinkingProfile.levels.includes(level) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50'}`}
                              aria-pressed={thinkingProfile.levels.includes(level)}
                              onClick={() => store.toggleModelThinkingLevel(level)}
                            >
                              {thinkingProfile.levels.includes(level) ? <Check className="size-3.5" /> : null}
                              {MODEL_THINKING_LEVEL_LABELS[level]}
                            </button>
                          ))}
                        </div>
                        <label className="mt-4 flex items-center justify-between gap-4 text-caption">
                          <span className="text-muted-foreground">{t('默认档位', 'Default level')}</span>
                          <NativeSelect
                            value={thinkingProfile.defaultLevel}
                            aria-label={t('默认思考层级', 'Default thinking level')}
                            onChange={event => store.setModelThinkingDefault(event.target.value)}
                          >
                            {thinkingProfile.levels.map(level => (
                              <NativeSelectOption key={level} value={level}>
                                {MODEL_THINKING_LEVEL_LABELS[level]}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </label>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                    <div className="min-w-0">
                      <p className="font-medium">{t('上下文窗口', 'Context window')}</p>
                      <p className="mt-1 text-caption text-muted-foreground">
                        {t('目录或型号族会自动填充；中转站或不准的窗口可在这里覆盖', 'Catalog and model-family presets fill this automatically. Override it for relays or a wrong window.')}
                      </p>
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <Select value={windowModelKey} onValueChange={value => { store.setWindowModelKey(value) }}>
                        <SelectTrigger className="w-full" aria-label={t('配置上下文窗口的模型', 'Model for context window')}>
                          <SelectValue>
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <ModelVendorIcon model={windowModelID} label={windowModelLabel} />
                              <span className="min-w-0 truncate">{windowModelLabel}</span>
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-96">
                          {availablePickerGroups.map((group, groupIndex) => (
                            <SelectGroup key={`window:${group.key}`}>
                              {groupIndex > 0 ? <SelectSeparator /> : null}
                              <SelectLabel>{group.label}</SelectLabel>
                              {group.models.map(model => (
                                <SelectItem key={`window:${group.key}:${model}`} value={encodePickerSelection(group.providerId, model, group.source)}>
                                  <span className="inline-flex min-w-0 items-center gap-2">
                                    <ModelVendorIcon model={model} label={store.availablePickerModelLabel(group, model)} />
                                    <span className="min-w-0 truncate">{store.availablePickerModelLabel(group, model)}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center justify-end gap-3">
                        {windowOverride ? (
                          <button type="button" className="text-caption text-link hover:underline" onClick={() => store.resetModelContextWindowOverride()}>
                            {t('恢复自动', 'Restore automatic')}
                          </button>
                        ) : null}
                        <Input
                          type="number"
                          className="w-36"
                          value={effectiveWindow || ''}
                          min={1024}
                          max={10000000}
                          disabled={!windowModelID}
                          aria-label={t('上下文窗口 token 数', 'Context window tokens')}
                          onChange={event => store.setModelContextWindowOverride(event.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </SettingsSection>

                <div className="mt-6 flex justify-end">
                  <Button disabled={saving || verifying} onClick={() => void store.save()}>
                    {verifying ? t('正在验证', 'Verifying') : t('保存并验证', 'Save and verify')}
                  </Button>
                </div>

                <Dialog open={providerEditorOpen} onOpenChange={open => { store.setProviderEditorOpen(open) }}>
                  <DialogContent className="provider-editor-dialog sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle>{t(`编辑 ${editingProviderInfo ? store.providerServiceName(editingProviderInfo) : t('模型服务', 'model service')}`, `Edit ${editingProviderInfo ? store.providerServiceName(editingProviderInfo) : t('模型服务', 'model service')}`)}</DialogTitle>
                      <DialogDescription className="sr-only">{t('配置这个模型服务的接口地址、凭据和可用模型。', 'Configure this model service endpoint, credentials, and available models.')}</DialogDescription>
                    </DialogHeader>
                    {editingProvider && editingProviderInfo ? (
                      <div className="grid gap-4">
                        <label className="provider-editor-field">
                          <span>{t('API 端点', 'API endpoint')}</span>
                          <Input
                            value={editingProvider.base_url ?? editingProviderInfo.defaultBaseUrl}
                            type="url"
                            autoComplete="url"
                            placeholder={editingProviderInfo.defaultBaseUrl || 'https://example.com/v1'}
                            aria-label={t('API 端点', 'API endpoint')}
                              onChange={event => { store.patchEditingProvider(config => { config.base_url = event.target.value.trim() }) }}
                          />
                        </label>
                        {editingProvider.custom ? (
                          <label className="provider-editor-field">
                            <span>{t('自定义名字', 'Custom name')}</span>
                            <Input
                              value={editingProvider.name ?? ''}
                              autoComplete="off"
                              placeholder={t('例如：我的中转站', 'e.g. My relay')}
                              aria-label={t('中转站名称', 'Relay name')}
                              onChange={event => { store.patchEditingProvider(config => { config.name = event.target.value }) }}
                            />
                          </label>
                        ) : (
                          <label className="provider-editor-field">
                            <span>{t('名称', 'Name')}</span>
                            <Input value={store.providerServiceName(editingProviderInfo)} readOnly aria-label={t('名称', 'Name')} />
                          </label>
                        )}
                        {editingProvider.custom ? (
                          <div className="provider-editor-field items-start">
                            <span className="pt-2">{t('模型 / 前缀', 'Models / prefixes')}</span>
                            <div className="min-w-0">
                              <div className="flex gap-2">
                                <Input
                                  value={customModelInput}
                                  autoComplete="off"
                                  placeholder={t('例如：grok-4.5 或 openai/gpt-5', 'e.g. grok-4.5 or openai/gpt-5')}
                                  aria-label={t('模型 ID 或关键词前缀', 'Model ID or keyword prefix')}
                                  onChange={event => { store.setCustomModelInput(event.target.value) }}
                                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); store.addCustomRelayModel() } }}
                                />
                                <Button variant="outline" onClick={() => store.addCustomRelayModel()}>{t('添加', 'Add')}</Button>
                              </div>
                              {editingProvider.models?.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {editingProvider.models.map(model => (
                                    <span key={model} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 font-mono text-caption">
                                      {model}
                                      <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={t(`移除模型 ${model}`, `Remove model ${model}`)} onClick={() => store.removeCustomRelayModel(model)}>
                                        <Trash2 className="size-3.5" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        <label className="provider-editor-field">
                          <span>API Key</span>
                          <Input
                            value={editingProvider.api_key}
                            type="password"
                            autoComplete="off"
                            placeholder={editingProviderInfo.placeholder}
                            aria-label="API Key"
                              onChange={event => {
                              store.patchEditingProvider(config => {
                                config.api_key = event.target.value
                                if (event.target.value) config.session_only = false
                              })
                            }}
                          />
                        </label>
                        {!editingProvider.custom ? (
                          <label className="provider-editor-field items-start">
                            <span className="pt-2">{t('可用模型', 'Available models')}</span>
                            <div className="min-w-0">
                              <Select
                                value={editingProviderModels.length
                                  ? store.modelSelectionKey(editingProviderInfo.id, editingProviderModel || editingProviderModels[0] || '')
                                  : ''}
                                onValueChange={value => {
                                  const selection = store.parseModelSelectionKey(String(value ?? ''))
                                  if (!selection) return
                                  store.setEditingProviderModel(selection[1])
                                }}
                              >
                                <SelectTrigger className="min-w-72" disabled={!editingProviderModels.length} aria-label={t('可用模型', 'Available models')}>
                                  <SelectValue>
                                    {editingProviderModels.length
                                      ? store.modelDisplayLabel(editingProviderInfo.id, editingProviderModel || editingProviderModels[0] || '')
                                      : ''}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent className="min-w-96">
                                  <SelectGroup>
                                    <SelectLabel>{store.providerServiceName(editingProviderInfo)}</SelectLabel>
                                    {editingProviderModels.map(model => (
                                      <SelectItem key={store.modelSelectionKey(editingProviderInfo.id, model)} value={store.modelSelectionKey(editingProviderInfo.id, model)}>
                                        {store.modelDisplayLabel(editingProviderInfo.id, model)}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </div>
                          </label>
                        ) : null}
                        {notice ? <p className={`text-caption ${notice.tone === 'error' ? 'text-destructive' : 'text-primary'}`}>{notice.text}</p> : null}
                      </div>
                    ) : null}
                    <DialogFooter>
                      <Button variant="outline" disabled={saving || verifying} onClick={() => void store.saveProviderEditor(false)}>{t('测试连接', 'Test connection')}</Button>
                      <Button disabled={saving || verifying} onClick={() => void store.saveProviderEditor(true)}>{t('保存', 'Save')}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            ) : working && category === 'ctf' ? (
              <>
                <SettingsSection title="NSSCTF Agent Arena">
                  <SettingsRow
                    stack="always"
                    label="Arena Token"
                    description={working.nssctf_arena?.session_only ? t('本地数据库写入失败；当前仅在本次运行可用', 'Could not write the local database; this value is only available in the current session.') : ''}
                  >
                    <Input
                      value={working.nssctf_arena?.token ?? ''}
                      type="password"
                      autoComplete="off"
                      placeholder="NSSCTF Agent Token"
                      onChange={event => {
                        store.patchWorking(value => {
                          value.nssctf_arena = {
                            token: event.target.value,
                            has_token: value.nssctf_arena?.has_token ?? false,
                            session_only: event.target.value ? false : value.nssctf_arena?.session_only,
                          }
                        })
                      }}
                      onBlur={() => void store.save()}
                    />
                  </SettingsRow>
                </SettingsSection>
                <SettingsSection title={t('题目浏览器扩展', 'Challenge browser extension')}>
                  <SettingsRow
                    label={t('连接', 'Connection')}
                    trailing={(
                      <div className="flex items-center gap-2">
                        <ConnectionLiveStatus live={browserBridgeConnected} />
                        <Button variant="outline" size="sm" disabled={browserBridgeLoading} onClick={() => void store.refreshBrowserBridgeStatus()}>
                          {t('检测', 'Check')}
                        </Button>
                      </div>
                    )}
                  />
                </SettingsSection>
              </>
            ) : working && category === 'lab' ? (
              <LabSettingsPanel settings={working} onPersist={() => void store.save()} />
            ) : category === 'plugins' ? (
              <PluginSettingsPanel theme={resolvedTheme} />
            ) : category === 'cve' && dashboard ? (
              <VulnerabilityIntelSettingsPanel dashboard={dashboard} />
            ) : category === 'eval' ? (
              <EvalSettingsPanel settings={working} />
            ) : null}
          </div>
        </div>
      </div>
      <style>{settingsPageCss}</style>
    </main>
  )
}

function createSettingsStore(
  callbacks: { current: {
    onSettingsChange?: (value: AppSettings) => void
    onSecurityToolCodingHandoff?: (handoff: BuiltinConfigHandoff) => void
  } },
) {
  const store = createStore<SettingsState>({
    category: 'general',
    working: null,
    saving: false,
    verifying: false,
    localDataLoading: false,
    computerUseLoading: false,
    computerUseRequesting: null,
    computerUseRestarting: false,
    browserBridgeLoading: false,
    browserSetupBusy: false,
    browserUseOpening: false,
    browserUseRuntimeLoading: false,
    browserUseRuntime: null,
    backupExporting: false,
    restoreScheduling: false,
    diagnosticExporting: false,
    localData: null,
    userArtifacts: null,
    computerUseStatus: null,
    browserBridgeStatus: null,
    buildTracking: null,
    buildTrackingCopying: false,
    notice: null,
    editingProviderID: null,
    customModelInput: '',
    pendingCustomRelay: null,
    accountStatusProp: undefined,
    thinkingModelKey: '',
    windowModelKey: '',
    codingToolSkills: [],
    codingToolSetupBusy: '',
    userSkillCatalog: emptyAgentResourceCatalog(),
    userSkillBusy: false,
    userSkillError: '',
    editingBuiltinSkill: '',
    builtinSkillDocument: '',
    builtinSkillCustomized: false,
    debugModeOn: isDebugMode(),
  })
  const s = {
    get category() { return store.getState().category },
    set category(value) { store.setState({ category: value }); syncSkillsCategorySafe(); },
    get working() { return store.getState().working },
    set working(value) { store.setState({ working: value }); syncInstalledSettingsSafe(); },
    get saving() { return store.getState().saving },
    set saving(value) { store.setState({ saving: value }); },
    get verifying() { return store.getState().verifying },
    set verifying(value) { store.setState({ verifying: value }); },
    get localDataLoading() { return store.getState().localDataLoading },
    set localDataLoading(value) { store.setState({ localDataLoading: value }); },
    get computerUseLoading() { return store.getState().computerUseLoading },
    set computerUseLoading(value) { store.setState({ computerUseLoading: value }); },
    get computerUseRequesting() { return store.getState().computerUseRequesting },
    set computerUseRequesting(value) { store.setState({ computerUseRequesting: value }); },
    get computerUseRestarting() { return store.getState().computerUseRestarting },
    set computerUseRestarting(value) { store.setState({ computerUseRestarting: value }); },
    get browserBridgeLoading() { return store.getState().browserBridgeLoading },
    set browserBridgeLoading(value) { store.setState({ browserBridgeLoading: value }); },
    get browserSetupBusy() { return store.getState().browserSetupBusy },
    set browserSetupBusy(value) { store.setState({ browserSetupBusy: value }); },
    get browserUseOpening() { return store.getState().browserUseOpening },
    set browserUseOpening(value) { store.setState({ browserUseOpening: value }); },
    get browserUseRuntimeLoading() { return store.getState().browserUseRuntimeLoading },
    set browserUseRuntimeLoading(value) { store.setState({ browserUseRuntimeLoading: value }); },
    get browserUseRuntime() { return store.getState().browserUseRuntime },
    set browserUseRuntime(value) { store.setState({ browserUseRuntime: value }); },
    get backupExporting() { return store.getState().backupExporting },
    set backupExporting(value) { store.setState({ backupExporting: value }); },
    get restoreScheduling() { return store.getState().restoreScheduling },
    set restoreScheduling(value) { store.setState({ restoreScheduling: value }); },
    get diagnosticExporting() { return store.getState().diagnosticExporting },
    set diagnosticExporting(value) { store.setState({ diagnosticExporting: value }); },
    get localData() { return store.getState().localData },
    set localData(value) { store.setState({ localData: value }); },
    get userArtifacts() { return store.getState().userArtifacts },
    set userArtifacts(value) { store.setState({ userArtifacts: value }); },
    get computerUseStatus() { return store.getState().computerUseStatus },
    set computerUseStatus(value) { store.setState({ computerUseStatus: value }); },
    get browserBridgeStatus() { return store.getState().browserBridgeStatus },
    set browserBridgeStatus(value) { store.setState({ browserBridgeStatus: value }); },
    get buildTracking() { return store.getState().buildTracking },
    set buildTracking(value) { store.setState({ buildTracking: value }); },
    get buildTrackingCopying() { return store.getState().buildTrackingCopying },
    set buildTrackingCopying(value) { store.setState({ buildTrackingCopying: value }); },
    get notice() { return store.getState().notice },
    set notice(value) { store.setState({ notice: value }); },
    get editingProviderID() { return store.getState().editingProviderID },
    set editingProviderID(value) { store.setState({ editingProviderID: value }); },
    get customModelInput() { return store.getState().customModelInput },
    set customModelInput(value) { store.setState({ customModelInput: value }); },
    get pendingCustomRelay() { return store.getState().pendingCustomRelay },
    set pendingCustomRelay(value) { store.setState({ pendingCustomRelay: value }); },
    get accountStatusProp() { return store.getState().accountStatusProp },
    set accountStatusProp(value) { store.setState({ accountStatusProp: value }); },
    get thinkingModelKey() { return store.getState().thinkingModelKey },
    set thinkingModelKey(value) { store.setState({ thinkingModelKey: value }); },
    get windowModelKey() { return store.getState().windowModelKey },
    set windowModelKey(value) { store.setState({ windowModelKey: value }); },
    get codingToolSkills() { return store.getState().codingToolSkills },
    set codingToolSkills(value) { store.setState({ codingToolSkills: value }); },
    get codingToolSetupBusy() { return store.getState().codingToolSetupBusy },
    set codingToolSetupBusy(value) { store.setState({ codingToolSetupBusy: value }); },
    get userSkillCatalog() { return store.getState().userSkillCatalog },
    set userSkillCatalog(value) { store.setState({ userSkillCatalog: value }); },
    get userSkillBusy() { return store.getState().userSkillBusy },
    set userSkillBusy(value) { store.setState({ userSkillBusy: value }); },
    get userSkillError() { return store.getState().userSkillError },
    set userSkillError(value) { store.setState({ userSkillError: value }); },
    get editingBuiltinSkill() { return store.getState().editingBuiltinSkill },
    set editingBuiltinSkill(value) { store.setState({ editingBuiltinSkill: value }); },
    get builtinSkillDocument() { return store.getState().builtinSkillDocument },
    set builtinSkillDocument(value) { store.setState({ builtinSkillDocument: value }); },
    get builtinSkillCustomized() { return store.getState().builtinSkillCustomized },
    set builtinSkillCustomized(value) { store.setState({ builtinSkillCustomized: value }); },
    get debugModeOn() { return store.getState().debugModeOn },
    set debugModeOn(value) { store.setState({ debugModeOn: value }); }
  }
  function touchWorking() {
    const current = store.getState().working
    if (current) store.setState({ working: { ...current } })
  }
  function patchWorking(mutator: (value: AppSettings) => void) {
    if (!s.working) return
    mutator(s.working)
    touchWorking()
  }
  function syncInstalledSettingsSafe() { try { syncInstalledSettings() } catch { /* later */ } }
  function syncSkillsCategorySafe() { try { syncSkillsCategory() } catch { /* later */ } }


  let unlistenCodingToolSetup: (() => void) | undefined

  const settingsCategories = () => [
    { value: 'general' as const, label: t('通用', 'General') },
    { value: 'apikeys' as const, label: t('模型', 'Models') },
    { value: 'ctf' as const, label: 'CTF' },
    { value: 'cve' as const, label: 'CVE' },
    { value: 'lab' as const, label: 'Lab' },
    { value: 'skills' as const, label: 'Skills' },
    { value: 'mcp' as const, label: 'MCP' },
    { value: 'chats' as const, label: t('归档聊天', 'Archived chats') },
    { value: 'browser' as const, label: t('浏览器控制', 'Browser') },
    { value: 'eval' as const, label: t('评测', 'Eval') },
    { value: 'plugins' as const, label: t('插件', 'Plugins') },
  ]

  const serviceCatalog = readModelCatalog(() => ({
    providers: s.working?.providers ?? {},
    relay: s.working?.relay,
    includeUnconfigured: true,
  }))
  const pickerCatalog = readModelCatalog(() => ({
    providers: s.working?.providers ?? {},
    relay: s.working?.relay,
  }))
  const modelProviders = () => serviceCatalog.providers
  const availablePickerGroups = () => pickerCatalog.pickerGroups
  const modelCatalogSnapshot = () => pickerCatalog.snapshot
  const providerModelLabel = serviceCatalog.providerModelLabel
  const availableProviderModelLabel = pickerCatalog.providerModelLabel
  const availablePickerModelLabel = pickerCatalog.pickerModelLabel

  const account = () => s.accountStatusProp ?? ({ configured: false, authenticated: false, state: 'unconfigured' })
  const accountStateLabel = () => ({
    unconfigured: t('未配置', 'Not configured'),
    signed_out: t('未登录', 'Signed out'),
    authorizing: t('等待授权', 'Waiting for authorization'),
    active: t('已登录', 'Signed in'),
    suspended: t('访问已暂停', 'Access paused'),
    invitation_required: t('等待邀请', 'Invitation required'),
    unavailable: t('暂时不可用', 'Temporarily unavailable'),
  }[account().state])

  const databaseStateLabels = (): Record<DatabaseCompatibilityState, string> => ({
    compatible: t('兼容', 'Compatible'),
    missing: t('尚未创建', 'Not created yet'),
    newer: t('数据库较新', 'Database is newer'),
    corrupt: t('损坏或不可读', 'Corrupt or unreadable'),
    remaining: t('尚未纳入迁移', 'Not yet migrated'),
  })

  function databaseVersionText(database: DatabaseCompatibilityStatus): string {
    const parts: string[] = []
    if (database.current !== undefined) parts.push(t(`当前 v${database.current}`, `current v${database.current}`))
    if (database.supported !== undefined) parts.push(t(`支持 v${database.supported}`, `supported v${database.supported}`))
    return parts.join(' · ')
  }

  function cloneSettings(value: AppSettings): AppSettings {
    return JSON.parse(JSON.stringify(value)) as AppSettings
  }

  function applySettings(value: AppSettings | null) {
    s.working = value ? cloneSettings(withAppSettingsDefaults(value)) : null
    if (s.working) {
      ensureAccountRoute()
      alignDefaultModelToEnabledServices()
      applyUiLocale(s.working.locale)
    }
  }

  function applyInitialCategory(value: SettingsCategory) {
    s.category = normalizeSettingsCategory(value)
    s.notice = null
  }

  function syncInstalledSettings() {
    if (s.working) installAppModelSettings(s.working)
  }

  const provider = () => (
    s.working ? s.working.providers[s.working.active_provider] : undefined
  )
  const accountRoute = () => s.working?.relay

  function matchPickerGroup(providerId: string, model: string): PickerServiceGroup | undefined {
    return availablePickerGroups().find(group => (
      group.providerId === providerId && group.models.includes(model)
    ))
  }

  function modelSelectionKey(providerId: string, model: string) {
    return encodePickerSelection(providerId, model, 'service')
  }

  function parseModelSelectionKey(value: string): [string, string] | null {
    const selection = parsePickerSelection(value)
    if (!selection) return null
    return [selection.providerId, selection.model]
  }

  function defaultModelKey() {
    if (!s.working) return ''
    const match = matchPickerGroup(s.working.active_provider, s.working.active_model)
    return encodePickerSelection(
      s.working.active_provider,
      s.working.active_model,
      match?.source ?? 'service',
    )
  }

  function setDefaultModelKey(value: string) {
    patchWorking(working => {
      const selection = parsePickerSelection(String(value ?? ''))
      if (!selection) return
      working.active_provider = selection.providerId
      working.active_model = selection.model
      if (selection.source === 'account') {
        working.model_routing = { ...working.model_routing, source_order: ['account', 'personal'] }
      } else if (selection.source === 'personal') {
        working.model_routing = { ...working.model_routing, source_order: ['personal', 'account'] }
      }
    })
  }

  const defaultModelAvailable = () => {
    if (!s.working) return false
    return availablePickerGroups().some(group => (
      group.providerId === s.working?.active_provider
      && group.models.includes(s.working.active_model)
    ))
  }

  const availableModelCount = () => availablePickerGroups().reduce(
    (total, group) => total + group.models.length,
    0,
  )

  const defaultModelLabel = () => {
    if (!s.working) return ''
    const match = matchPickerGroup(s.working.active_provider, s.working.active_model)
    if (match) return availablePickerModelLabel(match, s.working.active_model)
    return availableProviderModelLabel(
      s.working.active_provider,
      s.working.active_model,
    )
  }

  const thinkingModelSelection = () => parsePickerSelection(s.thinkingModelKey)
  const thinkingModelProvider = () => thinkingModelSelection()?.providerId ?? ''
  const thinkingModelID = () => thinkingModelSelection()?.model ?? ''
  const thinkingModelLabel = () => {
    const selection = thinkingModelSelection()
    if (!selection) return t('选择模型', 'Select a model')
    const group = availablePickerGroups().find(item => (
      item.providerId === selection.providerId && item.models.includes(selection.model)
    ))
    return group
      ? availablePickerModelLabel(group, selection.model)
      : availableProviderModelLabel(selection.providerId, selection.model)
  }
  const thinkingOverride = () => (
    s.working?.model_thinking?.[thinkingModelProvider()]?.[thinkingModelID()]
  )
  const thinkingProfile = () => resolveModelThinking(
    s.working,
    thinkingModelProvider(),
    thinkingModelID(),
  )

  function syncPickerDerived1() {
    const current = thinkingModelSelection()
    const stillAvailable = current && availablePickerGroups().some(group => (
      group.providerId === current.providerId && group.models.includes(current.model)
    ))
    if (stillAvailable) return
    const active = s.working
      ? matchPickerGroup(s.working.active_provider, s.working.active_model)
      : undefined
    const fallback = active ?? availablePickerGroups()[0]
    const model = active
      ? s.working?.active_model
      : fallback?.models[0]
    s.thinkingModelKey = fallback && model
      ? encodePickerSelection(fallback.providerId, model, fallback.source)
      : ''
  }


  const windowModelSelection = () => parsePickerSelection(s.windowModelKey)
  const windowModelProvider = () => windowModelSelection()?.providerId ?? ''
  const windowModelID = () => windowModelSelection()?.model ?? ''
  const windowModelLabel = () => {
    const selection = windowModelSelection()
    if (!selection) return t('选择模型', 'Select a model')
    const group = availablePickerGroups().find(item => (
      item.providerId === selection.providerId && item.models.includes(selection.model)
    ))
    return group
      ? availablePickerModelLabel(group, selection.model)
      : availableProviderModelLabel(selection.providerId, selection.model)
  }
  const windowOverride = () => {
    const stored = s.working?.model_context_windows?.[windowModelProvider()]?.[windowModelID()]
    const parsed = Number(stored)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
  }
  const windowCatalogValue = () => {
    const id = windowModelID()
    if (!id) return 0
    const catalog = Number(modelCatalogSnapshot()?.models.find(entry => entry.id === id)?.context_window)
    return Number.isFinite(catalog) && catalog > 0 ? Math.floor(catalog) : 0
  }
  const effectiveWindow = () => resolveModelContextWindow(
    windowModelID(),
    windowCatalogValue(),
    windowOverride(),
  )

  function syncPickerDerived2() {
    const current = windowModelSelection()
    const stillAvailable = current && availablePickerGroups().some(group => (
      group.providerId === current.providerId && group.models.includes(current.model)
    ))
    if (stillAvailable) return
    const active = s.working
      ? matchPickerGroup(s.working.active_provider, s.working.active_model)
      : undefined
    const fallback = active ?? availablePickerGroups()[0]
    const model = active
      ? s.working?.active_model
      : fallback?.models[0]
    s.windowModelKey = fallback && model
      ? encodePickerSelection(fallback.providerId, model, fallback.source)
      : ''
  }


  function setModelContextWindowOverride(value: unknown) {
    if (!windowModelProvider() || !windowModelID()) return
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed) || parsed <= 0) return
    const providerId = windowModelProvider()
    const modelId = windowModelID()
    patchWorking(working => {
      working.model_context_windows = {
        ...(working.model_context_windows ?? {}),
        [providerId]: {
          ...(working.model_context_windows?.[providerId] ?? {}),
          [modelId]: parsed,
        },
      }
    })
  }

  function resetModelContextWindowOverride() {
    if (!s.working?.model_context_windows?.[windowModelProvider()]) return
    const providerId = windowModelProvider()
    const modelId = windowModelID()
    patchWorking(working => {
      if (!working.model_context_windows?.[providerId]) return
      const models = { ...working.model_context_windows[providerId] }
      delete models[modelId]
      const windows = { ...working.model_context_windows }
      if (Object.keys(models).length) windows[providerId] = models
      else delete windows[providerId]
      working.model_context_windows = Object.keys(windows).length ? windows : undefined
    })
  }

  function setThinkingOverride(config: ModelThinkingConfig) {
    if (!thinkingModelProvider() || !thinkingModelID()) return
    const providerId = thinkingModelProvider()
    const modelId = thinkingModelID()
    patchWorking(working => {
      working.model_thinking = {
        ...(working.model_thinking ?? {}),
        [providerId]: {
          ...(working.model_thinking?.[providerId] ?? {}),
          [modelId]: normalizeModelThinkingConfig(config),
        },
      }
    })
  }

  function thinkingConfigForEdit(): ModelThinkingConfig {
    if (thinkingOverride()) return normalizeModelThinkingConfig(thinkingOverride())
    const preset = builtInModelThinking(thinkingModelID())
    return normalizeModelThinkingConfig(preset ?? {
      enabled: true,
      levels: ['low', 'medium', 'high'],
      default_level: 'medium',
    })
  }

  function setModelThinkingEnabled(enabled: boolean) {
    const config = thinkingConfigForEdit()
    setThinkingOverride({ ...config, enabled })
  }

  function toggleModelThinkingLevel(level: ModelThinkingLevel) {
    const config = thinkingConfigForEdit()
    const selected = new Set(config.levels)
    if (selected.has(level)) {
      if (selected.size === 1) return
      selected.delete(level)
    } else {
      selected.add(level)
    }
    setThinkingOverride({
      ...config,
      enabled: true,
      levels: MODEL_THINKING_LEVELS.filter(item => selected.has(item)),
    })
  }

  function setModelThinkingDefault(level: string) {
    if (!MODEL_THINKING_LEVELS.includes(level as ModelThinkingLevel)) return
    const config = thinkingConfigForEdit()
    setThinkingOverride({
      ...config,
      enabled: true,
      default_level: level as ModelThinkingLevel,
    })
  }

  function resetModelThinkingOverride() {
    if (!s.working?.model_thinking?.[thinkingModelProvider()]) return
    const providerId = thinkingModelProvider()
    const modelId = thinkingModelID()
    patchWorking(working => {
      if (!working.model_thinking?.[providerId]) return
      const models = { ...working.model_thinking[providerId] }
      delete models[modelId]
      const modelThinking = { ...working.model_thinking }
      if (Object.keys(models).length) modelThinking[providerId] = models
      else delete modelThinking[providerId]
      working.model_thinking = Object.keys(modelThinking).length ? modelThinking : undefined
    })
  }

  function alignDefaultModelToEnabledServices() {
    patchWorking(working => {
      if (
        working.active_provider !== 'tokenflux'
        && !working.providers[working.active_provider]?.custom
      ) {
        working.active_provider = 'tokenflux'
      }
      const groups = availablePickerGroups()
      if (groups.length === 0) {
        if (working.active_provider !== 'tokenflux') {
          working.active_provider = 'tokenflux'
        }
        return
      }
      const current = groups.find(group => (
        group.providerId === working.active_provider
        && group.models.includes(working.active_model)
      ))
      if (current) return
      const sameProvider = groups.find(group => group.providerId === working.active_provider)
      if (sameProvider?.models[0]) {
        working.active_model = sameProvider.models[0]
        return
      }
      working.active_provider = groups[0].providerId
      working.active_model = groups[0].models[0] ?? ''
      if (groups[0].source === 'account') {
        working.model_routing = { ...working.model_routing, source_order: ['account', 'personal'] }
      } else if (groups[0].source === 'personal') {
        working.model_routing = { ...working.model_routing, source_order: ['personal', 'account'] }
      }
    })
  }

  function skillEnabled(name: string): boolean {
    return skillIsEnabled(
      name,
      s.working?.disabled_skills ?? [],
      s.working?.enabled_optional_skills ?? [],
    )
  }

  function setSkillEnabled(name: string, enabled: boolean) {
    patchWorking(working => {
      if (isOptionalCodingSkill(name)) {
        const selected = new Set(working.enabled_optional_skills ?? [])
        if (enabled) selected.add(name)
        else selected.delete(name)
        working.enabled_optional_skills = [...selected]
      } else {
        const disabled = new Set(working.disabled_skills ?? [])
        if (enabled) disabled.delete(name)
        else disabled.add(name)
        working.disabled_skills = [...disabled]
      }
    })
    void save()
  }

  function workerModelKey() {
    if (!s.working?.worker_provider || !s.working.worker_model) {
      return WORKER_MODEL_INHERIT
    }
    const match = matchPickerGroup(s.working.worker_provider, s.working.worker_model)
    return encodePickerSelection(
      s.working.worker_provider,
      s.working.worker_model,
      s.working.worker_source || match?.source || 'service',
    )
  }

  function setWorkerModelKey(value: string) {
    const key = String(value ?? '')
    patchWorking(working => {
      if (!key || key === WORKER_MODEL_INHERIT) {
        working.worker_provider = ''
        working.worker_model = ''
        working.worker_source = ''
        return
      }
      const selection = parsePickerSelection(key)
      if (!selection) return
      working.worker_provider = selection.providerId
      working.worker_model = selection.model
      working.worker_source = selection.source
    })
    void save()
  }

  const workerModelAvailable = () => {
    if (!s.working?.worker_provider || !s.working.worker_model) return true
    return availablePickerGroups().some(group => (
      group.providerId === s.working?.worker_provider
      && group.models.includes(s.working.worker_model ?? '')
    ))
  }

  const workerModelLabel = () => {
    if (!s.working?.worker_provider || !s.working.worker_model) {
      return t('跟随当前对话', 'Follow current conversation')
    }
    const match = matchPickerGroup(s.working.worker_provider, s.working.worker_model)
    if (match) return availablePickerModelLabel(match, s.working.worker_model)
    return availableProviderModelLabel(
      s.working.worker_provider,
      s.working.worker_model,
    )
  }

  function syncPickerDerived3() {
    if (!s.working?.worker_provider || !s.working.worker_model) return
    if (!availablePickerGroups().length) return
    if (workerModelAvailable()) return
    patchWorking(working => {
      working.worker_provider = ''
      working.worker_model = ''
      working.worker_source = ''
    })
    void save()
  }


  function codingToolSkill(name: string): CodingToolSkillSnapshot | undefined {
    return s.codingToolSkills.find(item => item.name === name)
  }

  function codingToolStatusLabel(skill: CodingToolSkillSnapshot): string {
    if (skill.status === 'found') {
      return skill.version
        ? t(`已找到 ${skill.version}`, `Found ${skill.version}`)
        : t('已找到', 'Found')
    }
    if (skill.status === 'needs_setup') return t('可准备', 'Can prepare')
    if (skill.status === 'configuring') return t('正在准备', 'Preparing')
    if (skill.status === 'failed') return t('准备失败', 'Prepare failed')
    return t('未找到', 'Not found')
  }

  async function loadCodingToolSkills() {
    try {
      s.codingToolSkills = await invokeCommand<CodingToolSkillSnapshot[]>('list_coding_tool_skills')
    } catch {
      s.codingToolSkills = []
    }
  }

  async function prepareCodingToolSkill(name: string) {
    s.codingToolSetupBusy = name
    try {
      await invokeCommand('start_coding_tool_skill_setup', { name })
      await loadCodingToolSkills()
    } catch (reason) {
      s.userSkillError = desktopErrorMessage(reason)
    } finally {
      s.codingToolSetupBusy = ''
    }
  }

  const userSkills = () => s.userSkillCatalog.skills

  function skillOverlay(name: string) {
    return (s.userSkillCatalog.builtinSkills ?? []).find(item => item.name === name)
  }

  async function loadUserSkills() {
    if (!hasDesktopRuntime()) {
      s.userSkillError = ''
      s.userSkillCatalog = emptyAgentResourceCatalog()
      return
    }
    try {
      s.userSkillCatalog = await invokeCommand<AgentResourceCatalog>('list_agent_resource_catalog')
      s.userSkillError = ''
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) s.userSkillError = desktopErrorMessage(reason)
      s.userSkillCatalog = emptyAgentResourceCatalog()
    }
  }

  async function importUserSkill() {
    s.userSkillBusy = true
    try {
      s.userSkillCatalog = await invokeCommand<AgentResourceCatalog>('import_user_skill')
      s.userSkillError = ''
    } catch (reason) {
      s.userSkillError = desktopErrorMessage(reason)
    } finally {
      s.userSkillBusy = false
    }
  }

  async function setUserSkillEnabled(skill: AgentResourceSkill, enabled: boolean) {
    s.userSkillBusy = true
    try {
      s.userSkillCatalog = await invokeCommand<AgentResourceCatalog>('set_user_skill_enabled', {
        name: skill.name,
        enabled,
      })
      s.userSkillError = ''
    } catch (reason) {
      s.userSkillError = desktopErrorMessage(reason)
    } finally {
      s.userSkillBusy = false
    }
  }

  async function deleteUserSkill(name: string) {
    s.userSkillBusy = true
    try {
      s.userSkillCatalog = await invokeCommand<AgentResourceCatalog>('delete_user_skill', { name })
      s.userSkillError = ''
    } catch (reason) {
      s.userSkillError = desktopErrorMessage(reason)
    } finally {
      s.userSkillBusy = false
    }
  }

  async function startEditBuiltinSkill(name: string) {
    s.userSkillBusy = true
    try {
      const document = await invokeCommand<BuiltinSkillDocument>('get_builtin_skill_document', { name })
      s.editingBuiltinSkill = document.name
      s.builtinSkillDocument = document.document
      s.builtinSkillCustomized = document.customized
      s.userSkillError = ''
    } catch (reason) {
      s.userSkillError = desktopErrorMessage(reason)
    } finally {
      s.userSkillBusy = false
    }
  }

  function closeBuiltinSkillEditor() {
    s.editingBuiltinSkill = ''
    s.builtinSkillDocument = ''
    s.builtinSkillCustomized = false
  }

  async function saveBuiltinSkill() {
    if (!s.editingBuiltinSkill) return
    s.userSkillBusy = true
    try {
      s.userSkillCatalog = await invokeCommand<AgentResourceCatalog>('set_builtin_skill_document', {
        name: s.editingBuiltinSkill,
        document: s.builtinSkillDocument,
      })
      s.builtinSkillCustomized = true
      s.userSkillError = ''
      closeBuiltinSkillEditor()
    } catch (reason) {
      s.userSkillError = desktopErrorMessage(reason)
    } finally {
      s.userSkillBusy = false
    }
  }

  async function restoreBuiltinSkill(name: string) {
    s.userSkillBusy = true
    try {
      s.userSkillCatalog = await invokeCommand<AgentResourceCatalog>('restore_builtin_skill', { name })
      if (s.editingBuiltinSkill === name) closeBuiltinSkillEditor()
      s.userSkillError = ''
    } catch (reason) {
      s.userSkillError = desktopErrorMessage(reason)
    } finally {
      s.userSkillBusy = false
    }
  }

  async function openBuiltinSkillConversation(name: string) {
    s.userSkillBusy = true
    try {
      callbacks.current.onSecurityToolCodingHandoff?.(await invokeCommand<BuiltinConfigHandoff>('prepare_builtin_config_handoff', {
        kind: 'skill',
        name,
      }))
      s.userSkillError = ''
    } catch (reason) {
      s.userSkillError = desktopErrorMessage(reason)
    } finally {
      s.userSkillBusy = false
    }
  }

  function syncSkillsCategory() {
    if (s.category === 'skills') {
      void loadUserSkills()
      void loadCodingToolSkills()
    }
  }

  function ensureProviderConfig(id: string): ProviderConfig | undefined {
    if (!s.working) return undefined
    const info = modelProviders().find(item => item.id === id)
    if (!s.working.providers[id]) {
      s.working.providers[id] = {
        api_key: '',
        has_api_key: false,
        base_url: info?.defaultBaseUrl,
        enabled: true,
      }
    } else if (!s.working.providers[id].base_url && info?.defaultBaseUrl) {
      s.working.providers[id].base_url = info.defaultBaseUrl
    }
    return s.working.providers[id]
  }

  function ensureProvider(id: string) {
    if (!s.working) return
    const providerChanged = s.working.active_provider !== id
    const info = modelProviders().find(item => item.id === id)
    ensureProviderConfig(id)
    s.working.active_provider = id
    if (info && (providerChanged || !s.working.active_model) && info.models[0]) {
      s.working.active_model = info.models[0]
    }
  }

  function customRelayID() {
    const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
      ?? Math.random().toString(36).slice(2, 14)
    return `custom-relay-${random}`
  }

  function addModelService() {
    if (!s.working) return
    const count = Object.values(s.working.providers).filter(item => item.custom).length
    if (count >= 8) {
      s.notice = { tone: 'error', text: t('最多可以添加 8 个自定义中转站。', 'You can add up to 8 custom relays.') }
      return
    }
    const id = customRelayID()
    s.pendingCustomRelay = {
      id,
      config: {
        api_key: '',
        has_api_key: false,
        base_url: '',
        enabled: true,
        custom: true,
        name: t('我的中转站', 'My relay'),
        models: [],
      },
    }
    s.editingProviderID = id
    s.customModelInput = ''
    s.notice = null
  }

  function tokenfluxCatalogModels(): string[] {
    return modelProviders().find(item => item.id === 'tokenflux')?.models ?? []
  }

  function rehomeDefaultAfterCustomServiceChange(serviceId: string, serviceModels: string[]) {
    if (!s.working) return
    alignDefaultModelToEnabledServices()
    const leaked = new Set(serviceModels.map(model => String(model ?? '').trim()).filter(Boolean))
    const stillOnService = s.working.active_provider === serviceId
    const parkedOnTokenflux = s.working.active_provider === 'tokenflux'
      && leaked.has(s.working.active_model)
    if (!stillOnService && !parkedOnTokenflux) return
    patchWorking(working => {
      working.active_provider = 'tokenflux'
      working.active_model = tokenfluxCatalogModels()[0] ?? ''
    })
  }

  function removeModelService(id: string) {
    if (!s.working) return
    const config = s.working.providers[id] ?? ensureProviderConfig(id)
    if (!config) return
    const removedModels = [...(config.models ?? [])]
    const custom = Boolean(config.custom)
    if (config.custom) {
      delete s.working.providers[id]
      if (s.working.model_thinking) delete s.working.model_thinking[id]
      if (s.working.model_context_windows) delete s.working.model_context_windows[id]
      if (id === PRESET_DEEPSEEK_SERVICE_ID) {
        s.working.removed_preset_services = [...new Set([
          ...(s.working.removed_preset_services ?? []),
          PRESET_DEEPSEEK_SERVICE_ID,
        ])]
      }
    } else {
      s.working.providers[id] = {
        ...config,
        api_key: '',
        has_api_key: false,
        remove_api_key: true,
        enabled: false,
        session_only: false,
      }
    }
    if (custom) {
      rehomeDefaultAfterCustomServiceChange(id, removedModels)
    } else if (s.working.active_provider === id) {
      ensureProvider('tokenflux')
      alignDefaultModelToEnabledServices()
    }
    s.editingProviderID = null
    s.customModelInput = ''
    touchWorking()
  }

  function addCustomRelayModel() {
    const { editingProviderID, pendingCustomRelay, customModelInput, working } = store.getState()
    const model = customModelInput.trim()
    if (!model) return
    const target = pendingCustomRelay?.id === editingProviderID
      ? pendingCustomRelay.config
      : working && editingProviderID
        ? working.providers[editingProviderID]
        : provider()
    if (!target?.custom) return
    const models = target.models ?? []
    if (models.includes(model)) {
      store.setState({ customModelInput: '' })
      return
    }
    if (models.length >= 32) {
      store.setState({ notice: { tone: 'error', text: t('每个中转站最多可以添加 32 个模型。', 'Each relay can have up to 32 models.') } })
      return
    }
    if (pendingCustomRelay?.id === editingProviderID) {
      store.setState({
        pendingCustomRelay: {
          ...pendingCustomRelay,
          config: { ...pendingCustomRelay.config, models: [...models, model] },
        },
        customModelInput: '',
      })
      return
    }
    patchWorking(value => {
      if (!editingProviderID || !value.providers[editingProviderID]) return
      value.providers = {
        ...value.providers,
        [editingProviderID]: { ...value.providers[editingProviderID], models: [...models, model] },
      }
      if (value.active_provider === editingProviderID && !value.active_model) {
        value.active_model = model
      }
    })
    store.setState({ customModelInput: '' })
  }

  function removeCustomRelayModel(model: string) {
    const { editingProviderID, pendingCustomRelay } = store.getState()
    if (pendingCustomRelay?.id === editingProviderID && pendingCustomRelay.config.custom) {
      store.setState({
        pendingCustomRelay: {
          ...pendingCustomRelay,
          config: {
            ...pendingCustomRelay.config,
            models: (pendingCustomRelay.config.models ?? []).filter(item => item !== model),
          },
        },
      })
      return
    }
    patchWorking(working => {
      if (!editingProviderID) return
      const current = working.providers[editingProviderID]
      if (!current?.custom) return
      const models = (current.models ?? []).filter(item => item !== model)
      working.providers = { ...working.providers, [editingProviderID]: { ...current, models } }
      if (working.model_thinking?.[editingProviderID]) {
        const nextThinking = { ...working.model_thinking[editingProviderID] }
        delete nextThinking[model]
        working.model_thinking = { ...working.model_thinking, [editingProviderID]: nextThinking }
      }
      if (working.model_context_windows?.[editingProviderID]) {
        const nextWindows = { ...working.model_context_windows[editingProviderID] }
        delete nextWindows[model]
        working.model_context_windows = { ...working.model_context_windows, [editingProviderID]: nextWindows }
      }
      if (working.active_provider === editingProviderID && working.active_model === model) {
        working.active_model = models[0] ?? ''
      }
    })
  }

  function ensureAccountRoute() {
    if (!s.working) return
    if (!s.working.relay) {
      s.working.relay = {
        enabled: account().state === 'active' && account().tokenFluxLinked === true,
        url: 'https://tokenflux.dev/v1',
        key: '',
        has_key: false,
      }
    }
    if (!s.working.relay.url) s.working.relay.url = 'https://tokenflux.dev/v1'
  }

  const accountModelSourceReady = () => Boolean(
    account().state === 'active'
    && account().tokenFluxLinked === true,
  )

  const modelServiceRows = () => {
    if (!s.working) return []
    const rows: ModelServiceRow[] = [
      { key: 'account', source: 'account' },
    ]
    for (const item of modelProviders()) {
      rows.push({ key: `provider:${item.id}`, source: 'personal', provider: item })
    }
    return rows
  }

  const accountProviderInfo = () => modelProviders().find(item => item.id === 'tokenflux')
  const editingProviderInfo = () => {
    if (s.pendingCustomRelay?.id === s.editingProviderID) {
      return customProviderInfo(s.pendingCustomRelay.id, s.pendingCustomRelay.config) ?? undefined
    }
    return modelProviders().find(item => item.id === s.editingProviderID)
  }
  const editingProvider = () => {
    if (!s.editingProviderID) return undefined
    if (s.pendingCustomRelay?.id === s.editingProviderID) {
      return s.pendingCustomRelay.config
    }
    return s.working?.providers[s.editingProviderID]
  }
  const editingProviderModel = () => {
    const info = editingProviderInfo()
    if (!info || !s.working) return ''
    const models = info.models ?? []
    if (
      s.editingProviderID === s.working.active_provider
      && models.includes(s.working.active_model)
    ) {
      return s.working.active_model
    }
    return models[0] ?? ''
  }
  const editingProviderModels = () => editingProviderInfo()?.models ?? []
  function providerEditorOpen() {
    return Boolean(s.editingProviderID)
  }

  function setProviderEditorOpen(value: boolean) {
    if (!value) {
      store.setState({
        pendingCustomRelay: null,
        editingProviderID: null,
        customModelInput: '',
      })
    }
  }

  function patchEditingProvider(mutator: (config: ProviderConfig) => void) {
    const { editingProviderID, pendingCustomRelay, working } = store.getState()
    if (!editingProviderID) return
    if (pendingCustomRelay?.id === editingProviderID) {
      const config = { ...pendingCustomRelay.config }
      mutator(config)
      store.setState({ pendingCustomRelay: { ...pendingCustomRelay, config } })
      return
    }
    if (!working?.providers[editingProviderID]) return
    patchWorking(value => {
      const current = value.providers[editingProviderID]
      if (!current) return
      const next = { ...current }
      mutator(next)
      value.providers = { ...value.providers, [editingProviderID]: next }
    })
  }

  function providerConfig(id: string): ProviderConfig | undefined {
    return s.working?.providers[id]
  }

  function providerModelsText(info: ProviderInfo): string {
    if (providerConfig(info.id)?.custom) return t(`${info.models.length} 个模型`, `${info.models.length} models`)
    if (!info.models.length) return t('等待模型目录', 'Waiting for model catalog')
    return info.models.slice(0, 3).map(model => {
      const label = providerModelLabel(info.id, model)
      return label.split(' · ').at(-1) ?? label
    }).join(' · ')
  }

  function modelDisplayLabel(providerID: string, model: string): string {
    const label = providerModelLabel(providerID, model)
    return label.split(' · ').at(-1) ?? label
  }

  function accountModelsText(): string {
    const info = accountProviderInfo()
    return info?.models.length ? providerModelsText(info) : t('管理员分配的模型', 'Models assigned by an admin')
  }

  function providerServiceName(info: ProviderInfo): string {
    if (providerConfig(info.id)?.custom) return info.name
    if (info.id === 'tokenflux') return t('TokenFlux 中转站', 'TokenFlux relay')
    return info.name
  }

  function serviceStatus(row: ModelServiceRow): string {
    if (row.source === 'account') {
      if (!accountModelSourceReady()) return t('未连接', 'Not connected')
      return accountRoute()?.enabled ? t('已启用', 'Enabled') : t('已停用', 'Disabled')
    }
    const config = providerConfig(row.provider.id)
    if (!config || !(config.has_api_key || config.api_key)) return t('未配置', 'Not configured')
    if (!config.enabled) return t('已停用', 'Disabled')
    return t('已启用', 'Enabled')
  }

  function openProviderEditor(id: string) {
    ensureProviderConfig(id)
    s.editingProviderID = id
    s.customModelInput = ''
    s.notice = null
  }

  function providerHasConfiguredKey(config?: ProviderConfig): boolean {
    return Boolean(config?.has_api_key || String(config?.api_key ?? '').trim())
  }

  function activateConfiguredModelService(config: ProviderConfig | undefined, id: string): boolean {
    if (!config) return false
    if (id === 'tokenflux') {
      if (!providerHasConfiguredKey(config) && !accountModelSourceReady()) return false
      config.enabled = true
      return true
    }
    if (
      config.custom
      && providerHasConfiguredKey(config)
      && String(config.base_url ?? '').trim()
      && (config.models ?? []).length > 0
    ) {
      config.enabled = true
      return true
    }
    return false
  }

  function setEditingProviderModel(value: string) {
    const editingID = s.editingProviderID
    if (!editingID || !value) return
    patchWorking(working => {
      working.active_provider = editingID
      working.active_model = value
    })
  }

  function setModelServiceEnabled(row: ModelServiceRow, enabled: boolean) {
    if (!s.working) return
    if (row.source === 'account') {
      ensureAccountRoute()
      patchWorking(working => {
        if (!working.relay) return
        if (enabled && !accountModelSourceReady()) {
          working.relay = { ...working.relay, enabled: false }
          return
        }
        working.relay = { ...working.relay, enabled }
        if (enabled && working.active_provider !== 'tokenflux') {
          working.active_provider = 'tokenflux'
        }
      })
      alignDefaultModelToEnabledServices()
      return
    }
    const config = ensureProviderConfig(row.provider.id)
    if (!config) return
    patchWorking(working => {
      const current = working.providers[row.provider.id]
      if (!current) return
      working.providers = { ...working.providers, [row.provider.id]: { ...current, enabled } }
      if (enabled) {
        working.active_provider = row.provider.id
        if (row.provider.models[0] && !row.provider.models.includes(working.active_model)) {
          working.active_model = row.provider.models[0]
        }
      }
    })
    if (!enabled && row.provider.id !== 'tokenflux') {
      rehomeDefaultAfterCustomServiceChange(row.provider.id, row.provider.models ?? config.models ?? [])
      return
    }
    alignDefaultModelToEnabledServices()
  }

  function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let amount = value
    let unit = 0
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024
      unit++
    }
    return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
  }

  async function loadLocalData() {
    if (!hasDesktopRuntime()) {
      s.localDataLoading = false
      return
    }
    s.localDataLoading = true
    try {
      s.localData = await invokeCommand<LocalDataStatus>('get_local_data_status')
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) {
        s.notice = { tone: 'error', text: t(`无法读取本地数据状态：${String(reason)}`, `Could not read local data status: ${String(reason)}`) }
      }
    } finally {
      s.localDataLoading = false
    }
  }

  async function loadBuildTracking() {
    try {
      s.buildTracking = await invokeCommand<BuildTracking>('get_build_tracking')
    } catch {
      s.buildTracking = null
    }
  }

  function formatBuildTrackingText(tracking: BuildTracking) {
    const treeLabel = tracking.development
      ? 'development/unpackaged'
      : (tracking.dirty ? 'dirty' : 'clean')
    const lines = [
      `channel: ${tracking.channel}`,
      `product: ${tracking.productName}`,
      `appId: ${tracking.appId}`,
      `provenanceSource: ${tracking.provenanceSource || (tracking.packaged ? 'packaged' : 'development/unpackaged')}`,
      `gitBranch: ${tracking.gitBranch || '(unavailable)'}`,
      `gitCommit: ${tracking.gitCommit || '(unavailable)'}`,
      `tree: ${treeLabel}`,
    ]
    if (tracking.dirty && tracking.sourceFingerprint) {
      lines.push(`sourceFingerprint: ${tracking.sourceFingerprint}`)
    }
    lines.push(`buildTime: ${tracking.buildTime || '(unavailable)'}`)
    lines.push(`trackingId: ${tracking.trackingId || '(unavailable)'}`)
    lines.push('note: trackingId is a canonical-field integrity digest, not a package authenticity signature')
    if (tracking.missing || tracking.development) {
      lines.push('warning: sealed build-tracking.json is not available in this shell')
    }
    if (tracking.validationIssues?.length) {
      lines.push(`validation: ${tracking.validationIssues.join('; ')}`)
    }
    return lines.join('\n')
  }

  async function copyDebugDiagnostics() {
    const text = buildDiagnosticText()
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const area = document.createElement('textarea')
      area.value = text
      document.body.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    s.notice = { tone: 'ok', text: t('调试诊断已复制到剪贴板。', 'Debug diagnostics copied to the clipboard.') }
  }

  async function copyBuildTracking() {
    if (!s.buildTracking) return
    s.buildTrackingCopying = true
    try {
      const text = formatBuildTrackingText(s.buildTracking)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const area = document.createElement('textarea')
        area.value = text
        document.body.append(area)
        area.select()
        document.execCommand('copy')
        area.remove()
      }
      s.notice = { tone: 'ok', text: t('已复制构建追踪信息', 'Build tracking copied') }
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`无法复制构建追踪：${String(reason)}`, `Could not copy build tracking: ${String(reason)}`) }
    } finally {
      s.buildTrackingCopying = false
    }
  }

  const computerUsePermissionsReady = () => Boolean(
    s.computerUseStatus?.permissions.accessibility
    && s.computerUseStatus.permissions.screenRecording,
  )

  const browserUseDescription = () => {
    if (s.browserUseRuntime?.found) {
      return t(
        `已找到 ${s.browserUseRuntime.name || 'Chromium'}。操作你选中的标签页。`,
        `Found ${s.browserUseRuntime.name || 'Chromium'}. Acts on the tabs you select.`,
      )
    }
    return t(
      '没有找到 Chrome、Chromium 或 Edge。请安装后再检测。Linux 从软件源安装 Chromium；Omarchy 默认已有。',
      'Chrome, Chromium or Edge was not found. Install one, then recheck. On Linux install Chromium from the distro; Omarchy already ships it.',
    )
  }

  async function refreshBrowserUseRuntime(options: { silent?: boolean } = {}) {
    s.browserUseRuntimeLoading = true
    try {
      s.browserUseRuntime = await invokeCommand<BrowserUseRuntime>('get_browser_use_runtime')
      if (!options.silent) {
        s.notice = {
          tone: s.browserUseRuntime.found ? 'ok' : 'error',
          text: s.browserUseRuntime.found
            ? t('已找到本机浏览器。', 'Found a local browser.')
            : t(
              '没有找到 Chrome、Chromium 或 Edge。请安装后再检测。',
              'Chrome, Chromium or Edge was not found. Install one, then recheck.',
            ),
        }
      }
    } catch (reason) {
      s.browserUseRuntime = null
      if (!options.silent) {
        s.notice = {
          tone: 'error',
          text: t(`无法检测浏览器：${String(reason)}`, `Could not detect a browser: ${String(reason)}`),
        }
      }
    } finally {
      s.browserUseRuntimeLoading = false
    }
  }

  const browserBridgeConnected = () => Boolean(s.browserBridgeStatus?.bridge.connected)
  const browserPairingReady = () => Boolean(s.browserBridgeStatus?.bridge.pairingCode)
  const browserExtensionReady = () => Boolean(s.browserBridgeStatus?.bridge.extensionPath)

  async function refreshBrowserBridgeStatus(options: { silent?: boolean } = {}) {
    s.browserBridgeLoading = true
    try {
      s.browserBridgeStatus = await invokeCommand<NSSCTFWebBridgeStatus>('get_nssctf_web_bridge_status')
      if (!options.silent) {
        s.notice = { tone: 'ok', text: t('连接已重新检测。', 'Connection rechecked.') }
      }
    } catch (reason) {
      s.browserBridgeStatus = null
      if (!options.silent) {
        s.notice = { tone: 'error', text: t(`无法检测连接：${String(reason)}`, `Could not check the connection: ${String(reason)}`) }
      }
    } finally {
      s.browserBridgeLoading = false
    }
  }

  async function prepareBrowserExtension() {
    s.browserSetupBusy = true
    try {
      await invokeCommand('open_chrome_extension_manager')
      await invokeCommand('reveal_browser_extension')
      s.notice = {
        tone: 'ok',
        text: t('已打开扩展安装入口。', 'Opened the extension installer.'),
      }
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`无法打开浏览器扩展安装入口：${String(reason)}`, `Could not open the browser extension installer: ${String(reason)}`) }
    } finally {
      s.browserSetupBusy = false
    }
  }

  async function openPlaywrightBrowserExtension() {
    s.browserUseOpening = true
    try {
      await invokeCommand('open_playwright_browser_extension')
      s.notice = {
        tone: 'ok',
        text: t('已打开扩展页面。', 'Opened the extension page.'),
      }
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`无法打开扩展页面：${String(reason)}`, `Could not open the extension page: ${String(reason)}`) }
    } finally {
      s.browserUseOpening = false
    }
  }

  async function copyBrowserPairingCode() {
    const pairingCode = s.browserBridgeStatus?.bridge.pairingCode
    if (!pairingCode) return
    try {
      await navigator.clipboard.writeText(pairingCode)
      s.notice = { tone: 'ok', text: t('配对码已复制。', 'Pairing code copied.') }
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`无法复制浏览器配对码：${String(reason)}`, `Could not copy the browser pairing code: ${String(reason)}`) }
    }
  }

  async function refreshComputerUseStatus(options: { silent?: boolean } = {}) {
    s.computerUseLoading = true
    try {
      s.computerUseStatus = await invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status')
      if (!options.silent) {
        s.notice = { tone: 'ok', text: t('Computer Use 权限已重新检测。', 'Computer Use permissions rechecked.') }
      }
    } catch (reason) {
      s.computerUseStatus = null
      if (!options.silent) {
        s.notice = { tone: 'error', text: t(`无法重新检测 Computer Use：${String(reason)}`, `Could not recheck Computer Use: ${String(reason)}`) }
      }
    } finally {
      s.computerUseLoading = false
    }
  }

  async function requestComputerUsePermission(permission: CodingComputerUsePermission) {
    s.computerUseRequesting = permission
    try {
      s.computerUseStatus = await invokeCommand<CodingComputerUseStatus>(
        'request_coding_computer_use_permissions',
        { permission },
      )
      const label = permission === 'accessibility' ? t('辅助功能', 'Accessibility') : t('屏幕录制', 'Screen Recording')
      s.notice = {
        tone: 'ok',
        text: t(`已打开${label}设置。`, `Opened ${label} settings.`),
      }
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`无法打开 Computer Use 系统权限设置：${String(reason)}`, `Could not open Computer Use system settings: ${String(reason)}`) }
    } finally {
      s.computerUseRequesting = null
    }
  }

  async function relaunchDesktopApp() {
    s.computerUseRestarting = true
    try {
      await invokeCommand<boolean>('relaunch_desktop_app')
    } catch (reason) {
      s.computerUseRestarting = false
      s.notice = { tone: 'error', text: t(`无法重新打开 MilkSU：${String(reason)}`, `Could not reopen MilkSU: ${String(reason)}`) }
    }
  }

  async function revealLocalData() {
    try {
      await invokeCommand('reveal_local_data_directory')
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`无法打开本地数据目录：${String(reason)}`, `Could not open the local data folder: ${String(reason)}`) }
    }
  }

  async function exportLocalDataBackup() {
    s.backupExporting = true
    s.notice = null
    try {
      const exported = await invokeCommand<LocalDataBackupExport>('export_local_data_backup')
      if (exported.cancelled) return
      s.notice = {
        tone: 'ok',
        text: t(`已导出 ${exported.fileCount} 个文件（${formatBytes(exported.bytes)}）；凭据库、浏览器配对令牌和 PI 认证文件未写入备份。`, `Exported ${exported.fileCount} files (${formatBytes(exported.bytes)}). Credentials, browser pairing tokens, and Pi auth files are not in the backup.`),
      }
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`备份导出失败：${String(reason)}`, `Backup export failed: ${String(reason)}`) }
    } finally {
      s.backupExporting = false
    }
  }

  async function scheduleLocalDataRestore() {
    s.restoreScheduling = true
    s.notice = null
    try {
      const restore = await invokeCommand<LocalDataBackupRestore>('schedule_local_data_restore')
      if (restore.cancelled) return
      s.notice = {
        tone: 'ok',
        text: t(`已验证并暂存 ${restore.fileCount} 个文件（${formatBytes(restore.bytes)}）。重新打开 MilkSU 后应用。`, `Verified and staged ${restore.fileCount} files (${formatBytes(restore.bytes)}). They apply the next time you reopen MilkSU.`),
      }
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`备份恢复失败：${String(reason)}`, `Backup restore failed: ${String(reason)}`) }
    } finally {
      s.restoreScheduling = false
    }
  }

  async function exportLocalDiagnostics() {
    s.diagnosticExporting = true
    s.notice = null
    try {
      const exported = await invokeCommand<LocalDiagnosticExport>('export_local_diagnostics')
      if (exported.cancelled) return
      s.notice = {
        tone: 'ok',
        text: t(`诊断包已导出（${formatBytes(exported.bytes)}，${exported.eventCount} 条脱敏运行事件）；不包含会话正文、附件或凭据。`, `Diagnostics exported (${formatBytes(exported.bytes)}, ${exported.eventCount} redacted runtime events). Session text, attachments, and credentials are not included.`),
      }
    } catch (reason) {
      s.notice = { tone: 'error', text: t(`诊断包导出失败：${String(reason)}`, `Diagnostics export failed: ${String(reason)}`) }
    } finally {
      s.diagnosticExporting = false
    }
  }

  async function refreshCallableModels() {
    await loadModelCatalog()
    alignDefaultModelToEnabledServices()
  }

  function submittedServiceReady(settings: AppSettings): boolean {
    const active = settings.providers[settings.active_provider]
    const hasProviderKey = Boolean(active?.has_api_key || String(active?.api_key ?? '').trim())
    if (settings.active_provider === 'tokenflux') {
      return Boolean(
        (settings.relay?.enabled && (settings.relay.has_key || String(settings.relay.key ?? '').trim()))
        || (active?.enabled && hasProviderKey),
      )
    }
    if (active?.custom) {
      return hasProviderKey
        && Boolean(String(active.base_url ?? '').trim())
        && Boolean((active.models ?? []).length)
    }
    return Boolean(active?.enabled && hasProviderKey)
  }

  async function save(options?: { quiet?: boolean }): Promise<boolean> {
    if (!s.working) return false
    const incompleteCustomProvider = Object.values(s.working.providers).find(item => (
      item.custom && (!item.name?.trim() || !item.base_url?.trim() || !(item.models ?? []).length)
    ))
    if (incompleteCustomProvider) {
      if (!incompleteCustomProvider.name?.trim()) {
        s.notice = { tone: 'error', text: t('请填写中转站名称。', 'Enter a relay name.') }
        return false
      }
      if (!incompleteCustomProvider.base_url?.trim()) {
        s.notice = { tone: 'error', text: t('请填写 API 端点（Base URL）。', 'Enter an API endpoint (base URL).') }
        return false
      }
      if (!(incompleteCustomProvider.models ?? []).length) {
        s.notice = { tone: 'error', text: t('请至少添加一个模型 ID 或关键词前缀。', 'Add at least one model ID or keyword prefix.') }
        return false
      }
    }
    s.saving = true
    s.notice = null
    const submitted = cloneSettings(s.working)
    if (submitted.active_provider !== 'tokenflux') {
      activateConfiguredModelService(
        submitted.providers[submitted.active_provider],
        submitted.active_provider,
      )
    }
    try {
      await invokeCommand('save_settings_cmd', { newSettings: submitted })
      if (s.category !== 'apikeys') {
        const refreshed = await invokeCommand<AppSettings>('get_settings')
        s.working = cloneSettings(refreshed)
        callbacks.current.onSettingsChange?.(refreshed)
        await refreshCallableModels()
        if (!options?.quiet) {
          s.notice = {
            tone: 'ok',
            text: t('设置已保存。', 'Settings saved.'),
          }
        }
        return true
      }
      if (!submittedServiceReady(submitted)) {
        const refreshed = await invokeCommand<AppSettings>('get_settings')
        s.working = cloneSettings(refreshed)
        callbacks.current.onSettingsChange?.(refreshed)
        await refreshCallableModels()
        s.notice = {
          tone: 'ok',
          text: t('设置已保存。当前没有已启用且可用的模型服务，请启用账户或填写已配置的模型服务后再验证。', 'Settings saved. No enabled model service is ready yet. Enable the account or add a configured model service, then verify.'),
        }
        return true
      }
      s.verifying = true
      try {
        const result = await invokeCommand<ModelProbeResult>('test_agent_model', { settings: submitted })
        const verifiedSettings = await invokeCommand<AppSettings>('get_settings')
        s.working = cloneSettings(verifiedSettings)
        callbacks.current.onSettingsChange?.(verifiedSettings)
        await refreshCallableModels()
        s.notice = {
          tone: 'ok',
          text: t(`已保存并验证 ${result.provider}/${result.model}，PI 响应 ${result.latencyMs} ms。`, `Saved and verified ${result.provider}/${result.model}. Pi responded in ${result.latencyMs} ms.`),
        }
        return true
      } catch (reason) {
        const refreshed = await invokeCommand<AppSettings>('get_settings').catch(() => submitted)
        if (refreshed) {
          s.working = cloneSettings(refreshed)
          callbacks.current.onSettingsChange?.(refreshed)
        }
        await refreshCallableModels()
        const raw = desktopErrorMessage(reason)
        s.notice = {
          tone: 'error',
          text: t(`凭据已保存。${explainModelVerificationFailure(raw, submitted.active_provider)}`, `Credentials saved. ${explainModelVerificationFailure(raw, submitted.active_provider)}`),
        }
        return true
      } finally {
        s.verifying = false
      }
    } catch (reason) {
      const refreshed = await invokeCommand<AppSettings>('get_settings').catch(() => s.working)
      if (refreshed) {
        s.working = cloneSettings(refreshed)
        callbacks.current.onSettingsChange?.(refreshed)
      }
      await refreshCallableModels().catch(() => undefined)
      const sessionOnly = refreshed && (
        Object.values(refreshed.providers).some(item => item.session_only)
        || refreshed.relay?.session_only
        || refreshed.nssctf_arena?.session_only
      )
      s.notice = { tone: 'error', text: sessionOnly
        ? t(`${desktopErrorMessage(reason)} 当前密钥仅保留在本次运行内，退出应用后需要重新输入。`, `${desktopErrorMessage(reason)} The current key stays in this session only and must be entered again after you quit.`)
        : t(`设置未保存：${desktopErrorMessage(reason)}`, `Settings were not saved: ${desktopErrorMessage(reason)}`) }
      return false
    } finally {
      s.saving = false
    }
  }

  async function saveProviderEditor(closeAfterSave: boolean) {
    if (!s.working || !s.editingProviderID) {
      await save()
      return
    }
    const editingID = s.editingProviderID
    const pending = s.pendingCustomRelay?.id === editingID ? s.pendingCustomRelay : null
    if (pending) {
      s.working.providers[pending.id] = pending.config
    }
    const editing = s.working.providers[editingID]
    if (editing && (editing.has_api_key || String(editing.api_key ?? '').trim() || editingID === 'tokenflux')) {
      s.working.active_provider = editingID
      if (editing.custom && editing.models?.[0]) {
        s.working.active_model = editing.models[0]
      }
      if (editingID === 'tokenflux') {
        s.working.model_routing.source_order = ['personal', 'account']
        s.working.model_routing.auto_fallback = false
      }
      if (activateConfiguredModelService(editing, editingID)) {
        alignDefaultModelToEnabledServices()
      }
    }
    const persisted = await save()
    alignDefaultModelToEnabledServices()
    if (persisted) {
      s.pendingCustomRelay = null
      if (closeAfterSave && s.notice?.tone === 'ok') {
        setProviderEditorOpen(false)
      }
      return
    }
    if (pending) {
      delete s.working.providers[pending.id]
      s.pendingCustomRelay = pending
    }
  }

  function refreshComputerUseAfterSettings() {
    if (s.category !== 'browser' || computerUsePermissionsReady()) return
    void refreshComputerUseStatus({ silent: true })
  }

  function selectCategory(value: SettingsCategory) {
    s.category = normalizeSettingsCategory(value)
    s.notice = null
  }

  async function changeLocale(value: unknown) {
    const locale = normalizeUiLocale(value)
    patchWorking(working => { working.locale = locale })
    applyUiLocale(locale)
    await save()
  }

  async function loadUserArtifactDirectory() {
    if (!hasDesktopRuntime()) return
    try {
      s.userArtifacts = await invokeCommand<UserArtifactDirectoryStatus>('get_user_artifact_directory_status')
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) {
        s.notice = { tone: 'error', text: t(`无法读取文档目录：${String(reason)}`, `Could not read the documents folder: ${String(reason)}`) }
      }
    }
  }

  function start() {
    syncInstalledSettings()
    syncSkillsCategory()
    syncPickerDerived1()
    syncPickerDerived2()
    syncPickerDerived3()
    void loadLocalData()
    void loadUserArtifactDirectory()
    void loadBuildTracking()
    void refreshComputerUseStatus({ silent: true })
    void refreshBrowserUseRuntime({ silent: true })
    void refreshBrowserBridgeStatus({ silent: true })
    window.addEventListener('focus', refreshComputerUseAfterSettings)
    void listenEvent<{ toolId: string; state: string }>('coding-tool-setup', () => {
      void loadCodingToolSkills()
    }).then(unlisten => {
      unlistenCodingToolSetup = unlisten
    })
  }

  function stop() {
    window.removeEventListener('focus', refreshComputerUseAfterSettings)
    unlistenCodingToolSetup?.()
  }

  function setAccountStatusProp(value: AccountStatus | undefined) {
    store.setState({ accountStatusProp: value })
  }
  function setDebugModeOn(value: boolean) {
    store.setState({ debugModeOn: value })
  }
  function setBuiltinSkillDocument(value: string) {
    store.setState({ builtinSkillDocument: value })
  }
  function setThinkingModelKey(value: string) {
    store.setState({ thinkingModelKey: value })
  }
  function setWindowModelKey(value: string) {
    store.setState({ windowModelKey: value })
  }
  function setCustomModelInput(value: string) {
    store.setState({ customModelInput: value })
  }

  const actions = {
    applySettings,
    applyInitialCategory,
    setAccountStatusProp,
    patchWorking,
    patchEditingProvider,
    setDefaultModelKey,
    setWorkerModelKey,
    setProviderEditorOpen,
    setDebugModeOn,
    setBuiltinSkillDocument,
    setThinkingModelKey,
    setWindowModelKey,
    setCustomModelInput,
    selectCategory,
    changeLocale,
    formatBytes,
    databaseVersionText,
    formatBuildTrackingText,
    copyBuildTracking,
    copyDebugDiagnostics,
    save,
    codingToolSkill,
    codingToolStatusLabel,
    skillOverlay,
    skillEnabled,
    setSkillEnabled,
    prepareCodingToolSkill,
    startEditBuiltinSkill,
    closeBuiltinSkillEditor,
    saveBuiltinSkill,
    restoreBuiltinSkill,
    openBuiltinSkillConversation,
    importUserSkill,
    deleteUserSkill,
    setUserSkillEnabled,
    refreshBrowserUseRuntime,
    openPlaywrightBrowserExtension,
    refreshBrowserBridgeStatus,
    prepareBrowserExtension,
    copyBrowserPairingCode,
    refreshComputerUseStatus,
    requestComputerUsePermission,
    relaunchDesktopApp,
    revealLocalData,
    exportLocalDataBackup,
    scheduleLocalDataRestore,
    exportLocalDiagnostics,
    availablePickerModelLabel,
    addModelService,
    providerServiceName,
    accountModelsText,
    providerModelsText,
    serviceStatus,
    openProviderEditor,
    removeModelService,
    providerConfig,
    setModelServiceEnabled,
    resetModelThinkingOverride,
    setModelThinkingEnabled,
    toggleModelThinkingLevel,
    setModelThinkingDefault,
    resetModelContextWindowOverride,
    setModelContextWindowOverride,
    addCustomRelayModel,
    removeCustomRelayModel,
    modelSelectionKey,
    parseModelSelectionKey,
    setEditingProviderModel,
    modelDisplayLabel,
    saveProviderEditor,
    availablePickerGroups,
    account,
    accountStateLabel,
    databaseStateLabels,
    defaultModelKey,
    defaultModelAvailable,
    availableModelCount,
    defaultModelLabel,
    thinkingModelID,
    thinkingModelLabel,
    thinkingOverride,
    thinkingProfile,
    windowModelID,
    windowModelLabel,
    windowOverride,
    effectiveWindow,
    workerModelKey,
    workerModelLabel,
    userSkills,
    accountRoute,
    modelServiceRows,
    editingProviderInfo,
    editingProvider,
    editingProviderModel,
    editingProviderModels,
    providerEditorOpen,
    computerUsePermissionsReady,
    browserUseDescription,
    browserBridgeConnected,
    browserPairingReady,
    browserExtensionReady,
    settingsCategories,
  }

  return {
    store,
    start,
    stop,
    actions,
    ...actions,
  }
}

const settingsPageCss = `
.settings-page-header {
  --shell-window-control-gutter: 1.25rem;
}
.settings-nav-surface { border-color: var(--border); background-color: var(--sidebar); }
.settings-page .settings-notice {
  border-radius: 8px;
}
.settings-page .settings-notice.settings-notice--ok {
  background-color: color-mix(in srgb, var(--success) 22%, var(--card));
  border-color: var(--success-border);
  color: var(--success-foreground);
}
.settings-page .settings-notice.settings-notice--error {
  background-color: color-mix(in srgb, var(--destructive) 18%, var(--card));
  border-color: var(--destructive-border);
  color: var(--destructive);
}
.settings-nav-item { position: relative; display: flex; min-height: 2rem; width: auto; align-items: center; justify-content: flex-start; border: 0; border-radius: 8px; background: transparent; padding: 0 0.5rem; color: var(--foreground); text-align: left; cursor: pointer; text-transform: none; letter-spacing: 0; font-size: 14px; font-weight: 500; }
.settings-nav-item:hover { color: var(--foreground); background: var(--hover-2); }
.settings-nav-item.active {
  color: var(--foreground);
  background: var(--hover-2);
  box-shadow: none;
}
.model-service-row { transition: background-color 120ms ease, border-color 120ms ease; }
.model-service-row:hover { background: var(--overlay-hover-light); }
.model-service-icon { box-shadow: inset 0 0 18px color-mix(in srgb, var(--brand) 5%, transparent); }
.provider-editor-field { display: grid; grid-template-columns: 7rem minmax(0, 1fr); align-items: center; gap: 1rem; font-size: var(--text-body); }
@media (max-width: 1080px) {
  .model-service-row { grid-template-columns: 44px minmax(150px, 1fr) 90px auto auto; }
  .model-service-row > p { display: none; }
}
@media (max-width: 850px) {
  .settings-nav { width: 10.5rem; }
  .model-service-row { grid-template-columns: 40px minmax(110px, 1fr) auto auto; }
  .model-service-row > :nth-child(4),
  .model-service-row > :nth-child(5),
  .model-service-row > p { display: none; }
  .provider-editor-field { grid-template-columns: 1fr; gap: .5rem; }
}
`