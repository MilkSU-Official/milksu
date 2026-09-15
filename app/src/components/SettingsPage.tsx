import { computed, ref, watch } from '@/lib/reactiveStore'
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
  useModelCatalog,
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
import { useVulnerabilityDashboard, type VulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
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
import { useVue, useVueStore } from '@/hooks/useVueStore'
import { useT } from '@/hooks/useUiLocale'

type SettingsCategory = 'general' | 'apikeys' | 'ctf' | 'cve' | 'lab' | 'coding' | 'skills' | 'mcp' | 'chats' | 'browser' | 'security-tools' | 'eval' | 'plugins'
type NormalizedSettingsCategory = Exclude<SettingsCategory, 'security-tools' | 'coding'>

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

  const store = useVueStore(() => createSettingsStore(callbacks, vulnerabilityDashboard))

  useEffect(() => {
    store.applySettings(settings)
  }, [settings, store])

  useEffect(() => {
    store.applyInitialCategory(initialCategory)
  }, [initialCategory, store])

  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])

  const category = useVue(() => store.category.value)
  const working = useVue(() => store.working.value)
  const saving = useVue(() => store.saving.value)
  const verifying = useVue(() => store.verifying.value)
  const localDataLoading = useVue(() => store.localDataLoading.value)
  const computerUseLoading = useVue(() => store.computerUseLoading.value)
  const computerUseRequesting = useVue(() => store.computerUseRequesting.value)
  const computerUseRestarting = useVue(() => store.computerUseRestarting.value)
  const browserBridgeLoading = useVue(() => store.browserBridgeLoading.value)
  const browserSetupBusy = useVue(() => store.browserSetupBusy.value)
  const browserUseOpening = useVue(() => store.browserUseOpening.value)
  const browserUseRuntimeLoading = useVue(() => store.browserUseRuntimeLoading.value)
  const browserUseRuntime = useVue(() => store.browserUseRuntime.value)
  const backupExporting = useVue(() => store.backupExporting.value)
  const restoreScheduling = useVue(() => store.restoreScheduling.value)
  const diagnosticExporting = useVue(() => store.diagnosticExporting.value)
  const localData = useVue(() => store.localData.value)
  const userArtifacts = useVue(() => store.userArtifacts.value)
  const computerUseStatus = useVue(() => store.computerUseStatus.value)
  const browserBridgeStatus = useVue(() => store.browserBridgeStatus.value)
  const buildTracking = useVue(() => store.buildTracking.value)
  const buildTrackingCopying = useVue(() => store.buildTrackingCopying.value)
  const notice = useVue(() => store.notice.value)
  const customModelInput = useVue(() => store.customModelInput.value)
  const availablePickerGroups = useVue(() => store.availablePickerGroups.value)
  const account = useVue(() => store.account.value)
  const accountStateLabel = useVue(() => store.accountStateLabel.value)
  const databaseStateLabels = useVue(() => store.databaseStateLabels.value)
  const defaultModelKey = useVue(() => store.defaultModelKey.value)
  const defaultModelAvailable = useVue(() => store.defaultModelAvailable.value)
  const availableModelCount = useVue(() => store.availableModelCount.value)
  const defaultModelLabel = useVue(() => store.defaultModelLabel.value)
  const thinkingModelKey = useVue(() => store.thinkingModelKey.value)
  const thinkingModelID = useVue(() => store.thinkingModelID.value)
  const thinkingModelLabel = useVue(() => store.thinkingModelLabel.value)
  const thinkingOverride = useVue(() => store.thinkingOverride.value)
  const thinkingProfile = useVue(() => store.thinkingProfile.value)
  const windowModelKey = useVue(() => store.windowModelKey.value)
  const windowModelID = useVue(() => store.windowModelID.value)
  const windowModelLabel = useVue(() => store.windowModelLabel.value)
  const windowOverride = useVue(() => store.windowOverride.value)
  const effectiveWindow = useVue(() => store.effectiveWindow.value)
  const workerModelKey = useVue(() => store.workerModelKey.value)
  const workerModelLabel = useVue(() => store.workerModelLabel.value)
  const codingToolSetupBusy = useVue(() => store.codingToolSetupBusy.value)
  const userSkillBusy = useVue(() => store.userSkillBusy.value)
  const userSkillError = useVue(() => store.userSkillError.value)
  const userSkills = useVue(() => store.userSkills.value)
  const editingBuiltinSkill = useVue(() => store.editingBuiltinSkill.value)
  const builtinSkillDocument = useVue(() => store.builtinSkillDocument.value)
  const accountRoute = useVue(() => store.accountRoute.value)
  const modelServiceRows = useVue(() => store.modelServiceRows.value)
  const editingProviderInfo = useVue(() => store.editingProviderInfo.value)
  const editingProvider = useVue(() => store.editingProvider.value)
  const editingProviderModel = useVue(() => store.editingProviderModel.value)
  const editingProviderModels = useVue(() => store.editingProviderModels.value)
  const providerEditorOpen = useVue(() => store.providerEditorOpen.value)
  const debugModeOn = useVue(() => store.debugModeOn.value)
  const computerUsePermissionsReady = useVue(() => store.computerUsePermissionsReady.value)
  const browserUseDescription = useVue(() => store.browserUseDescription.value)
  const browserBridgeConnected = useVue(() => store.browserBridgeConnected.value)
  const browserPairingReady = useVue(() => store.browserPairingReady.value)
  const browserExtensionReady = useVue(() => store.browserExtensionReady.value)
  const settingsCategories = useVue(() => store.settingsCategories.value)
  const dashboard = store.dashboard

  store.accountStatusProp.value = accountStatus

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
                            store.working.value!.preferred_external_editor = String(event.target.value)
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
                            store.debugModeOn.value = Boolean(value)
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
                          onChange={event => { store.builtinSkillDocument.value = event.target.value }}
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
                      <Select value={defaultModelKey} onValueChange={value => { store.defaultModelKey.value = value }}>
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
                      <Select value={workerModelKey} onValueChange={value => { store.workerModelKey.value = value }}>
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
                      <Select value={thinkingModelKey} onValueChange={value => { store.thinkingModelKey.value = value }}>
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
                      <Select value={windowModelKey} onValueChange={value => { store.windowModelKey.value = value }}>
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

                <Dialog open={providerEditorOpen} onOpenChange={open => { store.providerEditorOpen.value = open }}>
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
                              onChange={event => { store.editingProvider.value!.base_url = event.target.value.trim() }}
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
                              onChange={event => { store.editingProvider.value!.name = event.target.value }}
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
                                  onChange={event => { store.customModelInput.value = event.target.value }}
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
                              store.editingProvider.value!.api_key = event.target.value
                              if (event.target.value) store.editingProvider.value!.session_only = false
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
                        store.working.value!.nssctf_arena = {
                          token: event.target.value,
                          has_token: store.working.value!.nssctf_arena?.has_token ?? false,
                          session_only: event.target.value ? false : store.working.value!.nssctf_arena?.session_only,
                        }
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
            ) : category === 'cve' ? (
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
  vulnerabilityDashboard?: VulnerabilityDashboard,
) {
  const category = ref<NormalizedSettingsCategory>('general')
  const dashboard = vulnerabilityDashboard ?? useVulnerabilityDashboard()
  const working = ref<AppSettings | null>(null)
  const saving = ref(false)
  const verifying = ref(false)
  const localDataLoading = ref(false)
  const computerUseLoading = ref(false)
  const computerUseRequesting = ref<CodingComputerUsePermission | null>(null)
  const computerUseRestarting = ref(false)
  const browserBridgeLoading = ref(false)
  const browserSetupBusy = ref(false)
  const browserUseOpening = ref(false)
  const browserUseRuntimeLoading = ref(false)
  const browserUseRuntime = ref<BrowserUseRuntime | null>(null)
  const backupExporting = ref(false)
  const restoreScheduling = ref(false)
  const diagnosticExporting = ref(false)
  const localData = ref<LocalDataStatus | null>(null)
  const userArtifacts = ref<UserArtifactDirectoryStatus | null>(null)
  const computerUseStatus = ref<CodingComputerUseStatus | null>(null)
  const browserBridgeStatus = ref<NSSCTFWebBridgeStatus | null>(null)
  const buildTracking = ref<BuildTracking | null>(null)
  const buildTrackingCopying = ref(false)
  const notice = ref<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const editingProviderID = ref<string | null>(null)
  const customModelInput = ref('')
  const pendingCustomRelay = ref<{ id: string; config: ProviderConfig } | null>(null)
  const accountStatusProp = ref<AccountStatus | undefined>(undefined)
  const thinkingModelKey = ref('')
  const windowModelKey = ref('')
  const codingToolSkills = ref<CodingToolSkillSnapshot[]>([])
  const codingToolSetupBusy = ref('')
  const userSkillCatalog = ref<AgentResourceCatalog>(emptyAgentResourceCatalog())
  const userSkillBusy = ref(false)
  const userSkillError = ref('')
  const editingBuiltinSkill = ref('')
  const builtinSkillDocument = ref('')
  const builtinSkillCustomized = ref(false)
  const debugModeOn = ref(isDebugMode())
  let unlistenCodingToolSetup: (() => void) | undefined

  const settingsCategories = computed(() => [
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
  ])

  const pickerSettings = computed(() => ({
    providers: working.value?.providers ?? {},
    relay: working.value?.relay,
  }))
  const serviceSettings = computed(() => ({
    providers: working.value?.providers ?? {},
    relay: working.value?.relay,
    includeUnconfigured: true,
  }))
  const {
    providers: modelProviders,
    providerModelLabel,
  } = useModelCatalog(serviceSettings)
  const {
    pickerGroups: availablePickerGroups,
    providerModelLabel: availableProviderModelLabel,
    pickerModelLabel: availablePickerModelLabel,
    snapshot: modelCatalogSnapshot,
  } = useModelCatalog(pickerSettings)

  const account = computed<AccountStatus>(() => accountStatusProp.value ?? ({ configured: false, authenticated: false, state: 'unconfigured' }))
  const accountStateLabel = computed(() => ({
    unconfigured: t('未配置', 'Not configured'),
    signed_out: t('未登录', 'Signed out'),
    authorizing: t('等待授权', 'Waiting for authorization'),
    active: t('已登录', 'Signed in'),
    suspended: t('访问已暂停', 'Access paused'),
    invitation_required: t('等待邀请', 'Invitation required'),
    unavailable: t('暂时不可用', 'Temporarily unavailable'),
  }[account.value.state]))

  const databaseStateLabels = computed<Record<DatabaseCompatibilityState, string>>(() => ({
    compatible: t('兼容', 'Compatible'),
    missing: t('尚未创建', 'Not created yet'),
    newer: t('数据库较新', 'Database is newer'),
    corrupt: t('损坏或不可读', 'Corrupt or unreadable'),
    remaining: t('尚未纳入迁移', 'Not yet migrated'),
  }))

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
    working.value = value ? cloneSettings(withAppSettingsDefaults(value)) : null
    if (working.value) {
      ensureAccountRoute()
      alignDefaultModelToEnabledServices()
      applyUiLocale(working.value.locale)
    }
  }

  function applyInitialCategory(value: SettingsCategory) {
    category.value = normalizeSettingsCategory(value)
    notice.value = null
  }

  watch(working, value => {
    if (value) installAppModelSettings(value)
  }, { deep: true })

  const provider = computed(() => (
    working.value ? working.value.providers[working.value.active_provider] : undefined
  ))
  const accountRoute = computed(() => working.value?.relay)

  function matchPickerGroup(providerId: string, model: string): PickerServiceGroup | undefined {
    return availablePickerGroups.value.find(group => (
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

  const defaultModelKey = computed({
    get: () => {
      if (!working.value) return ''
      const match = matchPickerGroup(working.value.active_provider, working.value.active_model)
      return encodePickerSelection(
        working.value.active_provider,
        working.value.active_model,
        match?.source ?? 'service',
      )
    },
    set: value => {
      if (!working.value) return
      const selection = parsePickerSelection(String(value ?? ''))
      if (!selection) return
      working.value.active_provider = selection.providerId
      working.value.active_model = selection.model
      if (selection.source === 'account') {
        working.value.model_routing.source_order = ['account', 'personal']
      } else if (selection.source === 'personal') {
        working.value.model_routing.source_order = ['personal', 'account']
      }
    },
  })

  const defaultModelAvailable = computed(() => {
    if (!working.value) return false
    return availablePickerGroups.value.some(group => (
      group.providerId === working.value?.active_provider
      && group.models.includes(working.value.active_model)
    ))
  })

  const availableModelCount = computed(() => availablePickerGroups.value.reduce(
    (total, group) => total + group.models.length,
    0,
  ))

  const defaultModelLabel = computed(() => {
    if (!working.value) return ''
    const match = matchPickerGroup(working.value.active_provider, working.value.active_model)
    if (match) return availablePickerModelLabel(match, working.value.active_model)
    return availableProviderModelLabel(
      working.value.active_provider,
      working.value.active_model,
    )
  })

  const thinkingModelSelection = computed(() => parsePickerSelection(thinkingModelKey.value))
  const thinkingModelProvider = computed(() => thinkingModelSelection.value?.providerId ?? '')
  const thinkingModelID = computed(() => thinkingModelSelection.value?.model ?? '')
  const thinkingModelLabel = computed(() => {
    const selection = thinkingModelSelection.value
    if (!selection) return t('选择模型', 'Select a model')
    const group = availablePickerGroups.value.find(item => (
      item.providerId === selection.providerId && item.models.includes(selection.model)
    ))
    return group
      ? availablePickerModelLabel(group, selection.model)
      : availableProviderModelLabel(selection.providerId, selection.model)
  })
  const thinkingOverride = computed(() => (
    working.value?.model_thinking?.[thinkingModelProvider.value]?.[thinkingModelID.value]
  ))
  const thinkingProfile = computed(() => resolveModelThinking(
    working.value,
    thinkingModelProvider.value,
    thinkingModelID.value,
  ))

  watch([working, availablePickerGroups], () => {
    const current = thinkingModelSelection.value
    const stillAvailable = current && availablePickerGroups.value.some(group => (
      group.providerId === current.providerId && group.models.includes(current.model)
    ))
    if (stillAvailable) return
    const active = working.value
      ? matchPickerGroup(working.value.active_provider, working.value.active_model)
      : undefined
    const fallback = active ?? availablePickerGroups.value[0]
    const model = active
      ? working.value?.active_model
      : fallback?.models[0]
    thinkingModelKey.value = fallback && model
      ? encodePickerSelection(fallback.providerId, model, fallback.source)
      : ''
  }, { immediate: true })

  const windowModelSelection = computed(() => parsePickerSelection(windowModelKey.value))
  const windowModelProvider = computed(() => windowModelSelection.value?.providerId ?? '')
  const windowModelID = computed(() => windowModelSelection.value?.model ?? '')
  const windowModelLabel = computed(() => {
    const selection = windowModelSelection.value
    if (!selection) return t('选择模型', 'Select a model')
    const group = availablePickerGroups.value.find(item => (
      item.providerId === selection.providerId && item.models.includes(selection.model)
    ))
    return group
      ? availablePickerModelLabel(group, selection.model)
      : availableProviderModelLabel(selection.providerId, selection.model)
  })
  const windowOverride = computed(() => {
    const stored = working.value?.model_context_windows?.[windowModelProvider.value]?.[windowModelID.value]
    const parsed = Number(stored)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
  })
  const windowCatalogValue = computed(() => {
    const id = windowModelID.value
    if (!id) return 0
    const catalog = Number(modelCatalogSnapshot.value?.models.find(entry => entry.id === id)?.context_window)
    return Number.isFinite(catalog) && catalog > 0 ? Math.floor(catalog) : 0
  })
  const effectiveWindow = computed(() => resolveModelContextWindow(
    windowModelID.value,
    windowCatalogValue.value,
    windowOverride.value,
  ))

  watch([working, availablePickerGroups], () => {
    const current = windowModelSelection.value
    const stillAvailable = current && availablePickerGroups.value.some(group => (
      group.providerId === current.providerId && group.models.includes(current.model)
    ))
    if (stillAvailable) return
    const active = working.value
      ? matchPickerGroup(working.value.active_provider, working.value.active_model)
      : undefined
    const fallback = active ?? availablePickerGroups.value[0]
    const model = active
      ? working.value?.active_model
      : fallback?.models[0]
    windowModelKey.value = fallback && model
      ? encodePickerSelection(fallback.providerId, model, fallback.source)
      : ''
  }, { immediate: true })

  function setModelContextWindowOverride(value: unknown) {
    if (!working.value || !windowModelProvider.value || !windowModelID.value) return
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed) || parsed <= 0) return
    const providerId = windowModelProvider.value
    working.value.model_context_windows = {
      ...(working.value.model_context_windows ?? {}),
      [providerId]: {
        ...(working.value.model_context_windows?.[providerId] ?? {}),
        [windowModelID.value]: parsed,
      },
    }
  }

  function resetModelContextWindowOverride() {
    if (!working.value?.model_context_windows?.[windowModelProvider.value]) return
    const providerId = windowModelProvider.value
    const models = { ...working.value.model_context_windows[providerId] }
    delete models[windowModelID.value]
    const windows = { ...working.value.model_context_windows }
    if (Object.keys(models).length) windows[providerId] = models
    else delete windows[providerId]
    working.value.model_context_windows = Object.keys(windows).length ? windows : undefined
  }

  function setThinkingOverride(config: ModelThinkingConfig) {
    if (!working.value || !thinkingModelProvider.value || !thinkingModelID.value) return
    const providerId = thinkingModelProvider.value
    working.value.model_thinking = {
      ...(working.value.model_thinking ?? {}),
      [providerId]: {
        ...(working.value.model_thinking?.[providerId] ?? {}),
        [thinkingModelID.value]: normalizeModelThinkingConfig(config),
      },
    }
  }

  function thinkingConfigForEdit(): ModelThinkingConfig {
    if (thinkingOverride.value) return normalizeModelThinkingConfig(thinkingOverride.value)
    const preset = builtInModelThinking(thinkingModelID.value)
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
    if (!working.value?.model_thinking?.[thinkingModelProvider.value]) return
    const providerId = thinkingModelProvider.value
    const models = { ...working.value.model_thinking[providerId] }
    delete models[thinkingModelID.value]
    const modelThinking = { ...working.value.model_thinking }
    if (Object.keys(models).length) modelThinking[providerId] = models
    else delete modelThinking[providerId]
    working.value.model_thinking = Object.keys(modelThinking).length ? modelThinking : undefined
  }

  function alignDefaultModelToEnabledServices() {
    if (!working.value) return
    if (
      working.value.active_provider !== 'tokenflux'
      && !working.value.providers[working.value.active_provider]?.custom
    ) {
      working.value.active_provider = 'tokenflux'
    }
    const groups = availablePickerGroups.value
    if (groups.length === 0) {
      if (working.value.active_provider !== 'tokenflux') {
        working.value.active_provider = 'tokenflux'
      }
      return
    }
    const current = groups.find(group => (
      group.providerId === working.value?.active_provider
      && group.models.includes(working.value.active_model)
    ))
    if (current) return
    const sameProvider = groups.find(group => group.providerId === working.value?.active_provider)
    if (sameProvider?.models[0]) {
      working.value.active_model = sameProvider.models[0]
      return
    }
    working.value.active_provider = groups[0].providerId
    working.value.active_model = groups[0].models[0] ?? ''
    if (groups[0].source === 'account') {
      working.value.model_routing.source_order = ['account', 'personal']
    } else if (groups[0].source === 'personal') {
      working.value.model_routing.source_order = ['personal', 'account']
    }
  }

  function skillEnabled(name: string): boolean {
    return skillIsEnabled(
      name,
      working.value?.disabled_skills ?? [],
      working.value?.enabled_optional_skills ?? [],
    )
  }

  function setSkillEnabled(name: string, enabled: boolean) {
    if (!working.value) return
    if (isOptionalCodingSkill(name)) {
      const selected = new Set(working.value.enabled_optional_skills ?? [])
      if (enabled) selected.add(name)
      else selected.delete(name)
      working.value.enabled_optional_skills = [...selected]
    } else {
      const disabled = new Set(working.value.disabled_skills ?? [])
      if (enabled) disabled.delete(name)
      else disabled.add(name)
      working.value.disabled_skills = [...disabled]
    }
    void save()
  }

  const workerModelKey = computed({
    get: () => {
      if (!working.value?.worker_provider || !working.value.worker_model) {
        return WORKER_MODEL_INHERIT
      }
      const match = matchPickerGroup(working.value.worker_provider, working.value.worker_model)
      return encodePickerSelection(
        working.value.worker_provider,
        working.value.worker_model,
        working.value.worker_source || match?.source || 'service',
      )
    },
    set: value => {
      if (!working.value) return
      const key = String(value ?? '')
      if (!key || key === WORKER_MODEL_INHERIT) {
        working.value.worker_provider = ''
        working.value.worker_model = ''
        working.value.worker_source = ''
        void save()
        return
      }
      const selection = parsePickerSelection(key)
      if (!selection) return
      working.value.worker_provider = selection.providerId
      working.value.worker_model = selection.model
      working.value.worker_source = selection.source
      void save()
    },
  })

  const workerModelAvailable = computed(() => {
    if (!working.value?.worker_provider || !working.value.worker_model) return true
    return availablePickerGroups.value.some(group => (
      group.providerId === working.value?.worker_provider
      && group.models.includes(working.value.worker_model ?? '')
    ))
  })

  const workerModelLabel = computed(() => {
    if (!working.value?.worker_provider || !working.value.worker_model) {
      return t('跟随当前对话', 'Follow current conversation')
    }
    const match = matchPickerGroup(working.value.worker_provider, working.value.worker_model)
    if (match) return availablePickerModelLabel(match, working.value.worker_model)
    return availableProviderModelLabel(
      working.value.worker_provider,
      working.value.worker_model,
    )
  })

  watch([working, availablePickerGroups], () => {
    if (!working.value?.worker_provider || !working.value.worker_model) return
    if (!availablePickerGroups.value.length) return
    if (workerModelAvailable.value) return
    working.value.worker_provider = ''
    working.value.worker_model = ''
    working.value.worker_source = ''
    void save()
  })

  function codingToolSkill(name: string): CodingToolSkillSnapshot | undefined {
    return codingToolSkills.value.find(item => item.name === name)
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
      codingToolSkills.value = await invokeCommand<CodingToolSkillSnapshot[]>('list_coding_tool_skills')
    } catch {
      codingToolSkills.value = []
    }
  }

  async function prepareCodingToolSkill(name: string) {
    codingToolSetupBusy.value = name
    try {
      await invokeCommand('start_coding_tool_skill_setup', { name })
      await loadCodingToolSkills()
    } catch (reason) {
      userSkillError.value = desktopErrorMessage(reason)
    } finally {
      codingToolSetupBusy.value = ''
    }
  }

  const userSkills = computed(() => userSkillCatalog.value.skills)

  function skillOverlay(name: string) {
    return (userSkillCatalog.value.builtinSkills ?? []).find(item => item.name === name)
  }

  async function loadUserSkills() {
    if (!hasDesktopRuntime()) {
      userSkillError.value = ''
      userSkillCatalog.value = emptyAgentResourceCatalog()
      return
    }
    try {
      userSkillCatalog.value = await invokeCommand<AgentResourceCatalog>('list_agent_resource_catalog')
      userSkillError.value = ''
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) userSkillError.value = desktopErrorMessage(reason)
      userSkillCatalog.value = emptyAgentResourceCatalog()
    }
  }

  async function importUserSkill() {
    userSkillBusy.value = true
    try {
      userSkillCatalog.value = await invokeCommand<AgentResourceCatalog>('import_user_skill')
      userSkillError.value = ''
    } catch (reason) {
      userSkillError.value = desktopErrorMessage(reason)
    } finally {
      userSkillBusy.value = false
    }
  }

  async function setUserSkillEnabled(skill: AgentResourceSkill, enabled: boolean) {
    userSkillBusy.value = true
    try {
      userSkillCatalog.value = await invokeCommand<AgentResourceCatalog>('set_user_skill_enabled', {
        name: skill.name,
        enabled,
      })
      userSkillError.value = ''
    } catch (reason) {
      userSkillError.value = desktopErrorMessage(reason)
    } finally {
      userSkillBusy.value = false
    }
  }

  async function deleteUserSkill(name: string) {
    userSkillBusy.value = true
    try {
      userSkillCatalog.value = await invokeCommand<AgentResourceCatalog>('delete_user_skill', { name })
      userSkillError.value = ''
    } catch (reason) {
      userSkillError.value = desktopErrorMessage(reason)
    } finally {
      userSkillBusy.value = false
    }
  }

  async function startEditBuiltinSkill(name: string) {
    userSkillBusy.value = true
    try {
      const document = await invokeCommand<BuiltinSkillDocument>('get_builtin_skill_document', { name })
      editingBuiltinSkill.value = document.name
      builtinSkillDocument.value = document.document
      builtinSkillCustomized.value = document.customized
      userSkillError.value = ''
    } catch (reason) {
      userSkillError.value = desktopErrorMessage(reason)
    } finally {
      userSkillBusy.value = false
    }
  }

  function closeBuiltinSkillEditor() {
    editingBuiltinSkill.value = ''
    builtinSkillDocument.value = ''
    builtinSkillCustomized.value = false
  }

  async function saveBuiltinSkill() {
    if (!editingBuiltinSkill.value) return
    userSkillBusy.value = true
    try {
      userSkillCatalog.value = await invokeCommand<AgentResourceCatalog>('set_builtin_skill_document', {
        name: editingBuiltinSkill.value,
        document: builtinSkillDocument.value,
      })
      builtinSkillCustomized.value = true
      userSkillError.value = ''
      closeBuiltinSkillEditor()
    } catch (reason) {
      userSkillError.value = desktopErrorMessage(reason)
    } finally {
      userSkillBusy.value = false
    }
  }

  async function restoreBuiltinSkill(name: string) {
    userSkillBusy.value = true
    try {
      userSkillCatalog.value = await invokeCommand<AgentResourceCatalog>('restore_builtin_skill', { name })
      if (editingBuiltinSkill.value === name) closeBuiltinSkillEditor()
      userSkillError.value = ''
    } catch (reason) {
      userSkillError.value = desktopErrorMessage(reason)
    } finally {
      userSkillBusy.value = false
    }
  }

  async function openBuiltinSkillConversation(name: string) {
    userSkillBusy.value = true
    try {
      callbacks.current.onSecurityToolCodingHandoff?.(await invokeCommand<BuiltinConfigHandoff>('prepare_builtin_config_handoff', {
        kind: 'skill',
        name,
      }))
      userSkillError.value = ''
    } catch (reason) {
      userSkillError.value = desktopErrorMessage(reason)
    } finally {
      userSkillBusy.value = false
    }
  }

  watch(category, value => {
    if (value === 'skills') {
      void loadUserSkills()
      void loadCodingToolSkills()
    }
  }, { immediate: true })

  function ensureProviderConfig(id: string): ProviderConfig | undefined {
    if (!working.value) return undefined
    const info = modelProviders.value.find(item => item.id === id)
    if (!working.value.providers[id]) {
      working.value.providers[id] = {
        api_key: '',
        has_api_key: false,
        base_url: info?.defaultBaseUrl,
        enabled: true,
      }
    } else if (!working.value.providers[id].base_url && info?.defaultBaseUrl) {
      working.value.providers[id].base_url = info.defaultBaseUrl
    }
    return working.value.providers[id]
  }

  function ensureProvider(id: string) {
    if (!working.value) return
    const providerChanged = working.value.active_provider !== id
    const info = modelProviders.value.find(item => item.id === id)
    ensureProviderConfig(id)
    working.value.active_provider = id
    if (info && (providerChanged || !working.value.active_model) && info.models[0]) {
      working.value.active_model = info.models[0]
    }
  }

  function customRelayID() {
    const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
      ?? Math.random().toString(36).slice(2, 14)
    return `custom-relay-${random}`
  }

  function addModelService() {
    if (!working.value) return
    const count = Object.values(working.value.providers).filter(item => item.custom).length
    if (count >= 8) {
      notice.value = { tone: 'error', text: t('最多可以添加 8 个自定义中转站。', 'You can add up to 8 custom relays.') }
      return
    }
    const id = customRelayID()
    pendingCustomRelay.value = {
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
    editingProviderID.value = id
    customModelInput.value = ''
    notice.value = null
  }

  function tokenfluxCatalogModels(): string[] {
    return modelProviders.value.find(item => item.id === 'tokenflux')?.models ?? []
  }

  function rehomeDefaultAfterCustomServiceChange(serviceId: string, serviceModels: string[]) {
    if (!working.value) return
    alignDefaultModelToEnabledServices()
    const leaked = new Set(serviceModels.map(model => String(model ?? '').trim()).filter(Boolean))
    const stillOnService = working.value.active_provider === serviceId
    const parkedOnTokenflux = working.value.active_provider === 'tokenflux'
      && leaked.has(working.value.active_model)
    if (!stillOnService && !parkedOnTokenflux) return
    working.value.active_provider = 'tokenflux'
    working.value.active_model = tokenfluxCatalogModels()[0] ?? ''
  }

  function removeModelService(id: string) {
    if (!working.value) return
    const config = working.value.providers[id] ?? ensureProviderConfig(id)
    if (!config) return
    const removedModels = [...(config.models ?? [])]
    const custom = Boolean(config.custom)
    if (config.custom) {
      delete working.value.providers[id]
      if (working.value.model_thinking) delete working.value.model_thinking[id]
      if (working.value.model_context_windows) delete working.value.model_context_windows[id]
      if (id === PRESET_DEEPSEEK_SERVICE_ID) {
        working.value.removed_preset_services = [...new Set([
          ...(working.value.removed_preset_services ?? []),
          PRESET_DEEPSEEK_SERVICE_ID,
        ])]
      }
    } else {
      working.value.providers[id] = {
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
    } else if (working.value.active_provider === id) {
      ensureProvider('tokenflux')
      alignDefaultModelToEnabledServices()
    }
    editingProviderID.value = null
    customModelInput.value = ''
  }

  function addCustomRelayModel() {
    const target = editingProvider.value?.custom ? editingProvider.value : provider.value
    if (!working.value || !target?.custom) return
    const model = customModelInput.value.trim()
    if (!model) return
    const models = target.models ?? []
    if (models.includes(model)) {
      customModelInput.value = ''
      return
    }
    if (models.length >= 32) {
      notice.value = { tone: 'error', text: t('每个中转站最多可以添加 32 个模型。', 'Each relay can have up to 32 models.') }
      return
    }
    target.models = [...models, model]
    if (working.value.active_provider === editingProviderID.value && !working.value.active_model) {
      working.value.active_model = model
    }
    customModelInput.value = ''
  }

  function removeCustomRelayModel(model: string) {
    const target = editingProvider.value?.custom ? editingProvider.value : provider.value
    if (!working.value || !target?.custom) return
    target.models = (target.models ?? []).filter(item => item !== model)
    if (editingProviderID.value && working.value.model_thinking?.[editingProviderID.value]) {
      delete working.value.model_thinking[editingProviderID.value][model]
    }
    if (editingProviderID.value && working.value.model_context_windows?.[editingProviderID.value]) {
      delete working.value.model_context_windows[editingProviderID.value][model]
    }
    if (working.value.active_provider === editingProviderID.value && working.value.active_model === model) {
      working.value.active_model = target.models[0] ?? ''
    }
  }

  function ensureAccountRoute() {
    if (!working.value) return
    if (!working.value.relay) {
      working.value.relay = {
        enabled: account.value.state === 'active' && account.value.tokenFluxLinked === true,
        url: 'https://tokenflux.dev/v1',
        key: '',
        has_key: false,
      }
    }
    if (!working.value.relay.url) working.value.relay.url = 'https://tokenflux.dev/v1'
  }

  const accountModelSourceReady = computed(() => Boolean(
    account.value.state === 'active'
    && account.value.tokenFluxLinked === true,
  ))

  const modelServiceRows = computed<ModelServiceRow[]>(() => {
    if (!working.value) return []
    const rows: ModelServiceRow[] = [
      { key: 'account', source: 'account' },
    ]
    for (const item of modelProviders.value) {
      rows.push({ key: `provider:${item.id}`, source: 'personal', provider: item })
    }
    return rows
  })

  const accountProviderInfo = computed(() => modelProviders.value.find(item => item.id === 'tokenflux'))
  const editingProviderInfo = computed(() => {
    if (pendingCustomRelay.value?.id === editingProviderID.value) {
      return customProviderInfo(pendingCustomRelay.value.id, pendingCustomRelay.value.config) ?? undefined
    }
    return modelProviders.value.find(item => item.id === editingProviderID.value)
  })
  const editingProvider = computed(() => {
    if (!editingProviderID.value) return undefined
    if (pendingCustomRelay.value?.id === editingProviderID.value) {
      return pendingCustomRelay.value.config
    }
    return working.value?.providers[editingProviderID.value]
  })
  const editingProviderModel = computed(() => {
    if (!editingProviderInfo.value || !working.value) return ''
    const models = editingProviderInfo.value.models
    if (
      editingProviderID.value === working.value.active_provider
      && models.includes(working.value.active_model)
    ) {
      return working.value.active_model
    }
    return models[0] ?? ''
  })
  const editingProviderModels = computed(() => editingProviderInfo.value?.models ?? [])
  const providerEditorOpen = computed({
    get: () => Boolean(editingProviderID.value),
    set: value => {
      if (!value) {
        pendingCustomRelay.value = null
        editingProviderID.value = null
        customModelInput.value = ''
      }
    },
  })

  function providerConfig(id: string): ProviderConfig | undefined {
    return working.value?.providers[id]
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
    const info = accountProviderInfo.value
    return info?.models.length ? providerModelsText(info) : t('管理员分配的模型', 'Models assigned by an admin')
  }

  function providerServiceName(info: ProviderInfo): string {
    if (providerConfig(info.id)?.custom) return info.name
    if (info.id === 'tokenflux') return t('TokenFlux 中转站', 'TokenFlux relay')
    return info.name
  }

  function serviceStatus(row: ModelServiceRow): string {
    if (row.source === 'account') {
      if (!accountModelSourceReady.value) return t('未连接', 'Not connected')
      return accountRoute.value?.enabled ? t('已启用', 'Enabled') : t('已停用', 'Disabled')
    }
    const config = providerConfig(row.provider.id)
    if (!config || !(config.has_api_key || config.api_key)) return t('未配置', 'Not configured')
    if (!config.enabled) return t('已停用', 'Disabled')
    return t('已启用', 'Enabled')
  }

  function openProviderEditor(id: string) {
    ensureProviderConfig(id)
    editingProviderID.value = id
    customModelInput.value = ''
    notice.value = null
  }

  function providerHasConfiguredKey(config?: ProviderConfig): boolean {
    return Boolean(config?.has_api_key || String(config?.api_key ?? '').trim())
  }

  function activateConfiguredModelService(config: ProviderConfig | undefined, id: string): boolean {
    if (!config) return false
    if (id === 'tokenflux') {
      if (!providerHasConfiguredKey(config) && !accountModelSourceReady.value) return false
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
    if (!working.value || !editingProviderID.value || !value) return
    working.value.active_provider = editingProviderID.value
    working.value.active_model = value
  }

  function setModelServiceEnabled(row: ModelServiceRow, enabled: boolean) {
    if (!working.value) return
    if (row.source === 'account') {
      ensureAccountRoute()
      if (enabled && !accountModelSourceReady.value) {
        working.value.relay!.enabled = false
        return
      }
      working.value.relay!.enabled = enabled
      if (enabled && working.value.active_provider !== 'tokenflux') {
        working.value.active_provider = 'tokenflux'
      }
      alignDefaultModelToEnabledServices()
      return
    }
    const config = ensureProviderConfig(row.provider.id)
    if (!config) return
    config.enabled = enabled
    if (enabled) {
      working.value.active_provider = row.provider.id
      if (row.provider.models[0] && !row.provider.models.includes(working.value.active_model)) {
        working.value.active_model = row.provider.models[0]
      }
      alignDefaultModelToEnabledServices()
      return
    }
    if (row.provider.id !== 'tokenflux') {
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
      localDataLoading.value = false
      return
    }
    localDataLoading.value = true
    try {
      localData.value = await invokeCommand<LocalDataStatus>('get_local_data_status')
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) {
        notice.value = { tone: 'error', text: t(`无法读取本地数据状态：${String(reason)}`, `Could not read local data status: ${String(reason)}`) }
      }
    } finally {
      localDataLoading.value = false
    }
  }

  async function loadBuildTracking() {
    try {
      buildTracking.value = await invokeCommand<BuildTracking>('get_build_tracking')
    } catch {
      buildTracking.value = null
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
    notice.value = { tone: 'ok', text: t('调试诊断已复制到剪贴板。', 'Debug diagnostics copied to the clipboard.') }
  }

  async function copyBuildTracking() {
    if (!buildTracking.value) return
    buildTrackingCopying.value = true
    try {
      const text = formatBuildTrackingText(buildTracking.value)
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
      notice.value = { tone: 'ok', text: t('已复制构建追踪信息', 'Build tracking copied') }
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`无法复制构建追踪：${String(reason)}`, `Could not copy build tracking: ${String(reason)}`) }
    } finally {
      buildTrackingCopying.value = false
    }
  }

  const computerUsePermissionsReady = computed(() => Boolean(
    computerUseStatus.value?.permissions.accessibility
    && computerUseStatus.value.permissions.screenRecording,
  ))

  const browserUseDescription = computed(() => {
    if (browserUseRuntime.value?.found) {
      return t(
        `已找到 ${browserUseRuntime.value.name || 'Chromium'}。操作你选中的标签页。`,
        `Found ${browserUseRuntime.value.name || 'Chromium'}. Acts on the tabs you select.`,
      )
    }
    return t(
      '没有找到 Chrome、Chromium 或 Edge。请安装后再检测。Linux 从软件源安装 Chromium；Omarchy 默认已有。',
      'Chrome, Chromium or Edge was not found. Install one, then recheck. On Linux install Chromium from the distro; Omarchy already ships it.',
    )
  })

  async function refreshBrowserUseRuntime(options: { silent?: boolean } = {}) {
    browserUseRuntimeLoading.value = true
    try {
      browserUseRuntime.value = await invokeCommand<BrowserUseRuntime>('get_browser_use_runtime')
      if (!options.silent) {
        notice.value = {
          tone: browserUseRuntime.value.found ? 'ok' : 'error',
          text: browserUseRuntime.value.found
            ? t('已找到本机浏览器。', 'Found a local browser.')
            : t(
              '没有找到 Chrome、Chromium 或 Edge。请安装后再检测。',
              'Chrome, Chromium or Edge was not found. Install one, then recheck.',
            ),
        }
      }
    } catch (reason) {
      browserUseRuntime.value = null
      if (!options.silent) {
        notice.value = {
          tone: 'error',
          text: t(`无法检测浏览器：${String(reason)}`, `Could not detect a browser: ${String(reason)}`),
        }
      }
    } finally {
      browserUseRuntimeLoading.value = false
    }
  }

  const browserBridgeConnected = computed(() => Boolean(browserBridgeStatus.value?.bridge.connected))
  const browserPairingReady = computed(() => Boolean(browserBridgeStatus.value?.bridge.pairingCode))
  const browserExtensionReady = computed(() => Boolean(browserBridgeStatus.value?.bridge.extensionPath))

  async function refreshBrowserBridgeStatus(options: { silent?: boolean } = {}) {
    browserBridgeLoading.value = true
    try {
      browserBridgeStatus.value = await invokeCommand<NSSCTFWebBridgeStatus>('get_nssctf_web_bridge_status')
      if (!options.silent) {
        notice.value = { tone: 'ok', text: t('连接已重新检测。', 'Connection rechecked.') }
      }
    } catch (reason) {
      browserBridgeStatus.value = null
      if (!options.silent) {
        notice.value = { tone: 'error', text: t(`无法检测连接：${String(reason)}`, `Could not check the connection: ${String(reason)}`) }
      }
    } finally {
      browserBridgeLoading.value = false
    }
  }

  async function prepareBrowserExtension() {
    browserSetupBusy.value = true
    try {
      await invokeCommand('open_chrome_extension_manager')
      await invokeCommand('reveal_browser_extension')
      notice.value = {
        tone: 'ok',
        text: t('已打开扩展安装入口。', 'Opened the extension installer.'),
      }
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`无法打开浏览器扩展安装入口：${String(reason)}`, `Could not open the browser extension installer: ${String(reason)}`) }
    } finally {
      browserSetupBusy.value = false
    }
  }

  async function openPlaywrightBrowserExtension() {
    browserUseOpening.value = true
    try {
      await invokeCommand('open_playwright_browser_extension')
      notice.value = {
        tone: 'ok',
        text: t('已打开扩展页面。', 'Opened the extension page.'),
      }
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`无法打开扩展页面：${String(reason)}`, `Could not open the extension page: ${String(reason)}`) }
    } finally {
      browserUseOpening.value = false
    }
  }

  async function copyBrowserPairingCode() {
    const pairingCode = browserBridgeStatus.value?.bridge.pairingCode
    if (!pairingCode) return
    try {
      await navigator.clipboard.writeText(pairingCode)
      notice.value = { tone: 'ok', text: t('配对码已复制。', 'Pairing code copied.') }
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`无法复制浏览器配对码：${String(reason)}`, `Could not copy the browser pairing code: ${String(reason)}`) }
    }
  }

  async function refreshComputerUseStatus(options: { silent?: boolean } = {}) {
    computerUseLoading.value = true
    try {
      computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status')
      if (!options.silent) {
        notice.value = { tone: 'ok', text: t('Computer Use 权限已重新检测。', 'Computer Use permissions rechecked.') }
      }
    } catch (reason) {
      computerUseStatus.value = null
      if (!options.silent) {
        notice.value = { tone: 'error', text: t(`无法重新检测 Computer Use：${String(reason)}`, `Could not recheck Computer Use: ${String(reason)}`) }
      }
    } finally {
      computerUseLoading.value = false
    }
  }

  async function requestComputerUsePermission(permission: CodingComputerUsePermission) {
    computerUseRequesting.value = permission
    try {
      computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>(
        'request_coding_computer_use_permissions',
        { permission },
      )
      const label = permission === 'accessibility' ? t('辅助功能', 'Accessibility') : t('屏幕录制', 'Screen Recording')
      notice.value = {
        tone: 'ok',
        text: t(`已打开${label}设置。`, `Opened ${label} settings.`),
      }
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`无法打开 Computer Use 系统权限设置：${String(reason)}`, `Could not open Computer Use system settings: ${String(reason)}`) }
    } finally {
      computerUseRequesting.value = null
    }
  }

  async function relaunchDesktopApp() {
    computerUseRestarting.value = true
    try {
      await invokeCommand<boolean>('relaunch_desktop_app')
    } catch (reason) {
      computerUseRestarting.value = false
      notice.value = { tone: 'error', text: t(`无法重新打开 MilkSU：${String(reason)}`, `Could not reopen MilkSU: ${String(reason)}`) }
    }
  }

  async function revealLocalData() {
    try {
      await invokeCommand('reveal_local_data_directory')
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`无法打开本地数据目录：${String(reason)}`, `Could not open the local data folder: ${String(reason)}`) }
    }
  }

  async function exportLocalDataBackup() {
    backupExporting.value = true
    notice.value = null
    try {
      const exported = await invokeCommand<LocalDataBackupExport>('export_local_data_backup')
      if (exported.cancelled) return
      notice.value = {
        tone: 'ok',
        text: t(`已导出 ${exported.fileCount} 个文件（${formatBytes(exported.bytes)}）；凭据库、浏览器配对令牌和 PI 认证文件未写入备份。`, `Exported ${exported.fileCount} files (${formatBytes(exported.bytes)}). Credentials, browser pairing tokens, and Pi auth files are not in the backup.`),
      }
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`备份导出失败：${String(reason)}`, `Backup export failed: ${String(reason)}`) }
    } finally {
      backupExporting.value = false
    }
  }

  async function scheduleLocalDataRestore() {
    restoreScheduling.value = true
    notice.value = null
    try {
      const restore = await invokeCommand<LocalDataBackupRestore>('schedule_local_data_restore')
      if (restore.cancelled) return
      notice.value = {
        tone: 'ok',
        text: t(`已验证并暂存 ${restore.fileCount} 个文件（${formatBytes(restore.bytes)}）。重新打开 MilkSU 后应用。`, `Verified and staged ${restore.fileCount} files (${formatBytes(restore.bytes)}). They apply the next time you reopen MilkSU.`),
      }
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`备份恢复失败：${String(reason)}`, `Backup restore failed: ${String(reason)}`) }
    } finally {
      restoreScheduling.value = false
    }
  }

  async function exportLocalDiagnostics() {
    diagnosticExporting.value = true
    notice.value = null
    try {
      const exported = await invokeCommand<LocalDiagnosticExport>('export_local_diagnostics')
      if (exported.cancelled) return
      notice.value = {
        tone: 'ok',
        text: t(`诊断包已导出（${formatBytes(exported.bytes)}，${exported.eventCount} 条脱敏运行事件）；不包含会话正文、附件或凭据。`, `Diagnostics exported (${formatBytes(exported.bytes)}, ${exported.eventCount} redacted runtime events). Session text, attachments, and credentials are not included.`),
      }
    } catch (reason) {
      notice.value = { tone: 'error', text: t(`诊断包导出失败：${String(reason)}`, `Diagnostics export failed: ${String(reason)}`) }
    } finally {
      diagnosticExporting.value = false
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
    if (!working.value) return false
    const incompleteCustomProvider = Object.values(working.value.providers).find(item => (
      item.custom && (!item.name?.trim() || !item.base_url?.trim() || !(item.models ?? []).length)
    ))
    if (incompleteCustomProvider) {
      if (!incompleteCustomProvider.name?.trim()) {
        notice.value = { tone: 'error', text: t('请填写中转站名称。', 'Enter a relay name.') }
        return false
      }
      if (!incompleteCustomProvider.base_url?.trim()) {
        notice.value = { tone: 'error', text: t('请填写 API 端点（Base URL）。', 'Enter an API endpoint (base URL).') }
        return false
      }
      if (!(incompleteCustomProvider.models ?? []).length) {
        notice.value = { tone: 'error', text: t('请至少添加一个模型 ID 或关键词前缀。', 'Add at least one model ID or keyword prefix.') }
        return false
      }
    }
    saving.value = true
    notice.value = null
    const submitted = cloneSettings(working.value)
    if (submitted.active_provider !== 'tokenflux') {
      activateConfiguredModelService(
        submitted.providers[submitted.active_provider],
        submitted.active_provider,
      )
    }
    try {
      await invokeCommand('save_settings_cmd', { newSettings: submitted })
      if (category.value !== 'apikeys') {
        const refreshed = await invokeCommand<AppSettings>('get_settings')
        working.value = cloneSettings(refreshed)
        callbacks.current.onSettingsChange?.(refreshed)
        await refreshCallableModels()
        if (!options?.quiet) {
          notice.value = {
            tone: 'ok',
            text: t('设置已保存。', 'Settings saved.'),
          }
        }
        return true
      }
      if (!submittedServiceReady(submitted)) {
        const refreshed = await invokeCommand<AppSettings>('get_settings')
        working.value = cloneSettings(refreshed)
        callbacks.current.onSettingsChange?.(refreshed)
        await refreshCallableModels()
        notice.value = {
          tone: 'ok',
          text: t('设置已保存。当前没有已启用且可用的模型服务，请启用账户或填写已配置的模型服务后再验证。', 'Settings saved. No enabled model service is ready yet. Enable the account or add a configured model service, then verify.'),
        }
        return true
      }
      verifying.value = true
      try {
        const result = await invokeCommand<ModelProbeResult>('test_agent_model', { settings: submitted })
        const verifiedSettings = await invokeCommand<AppSettings>('get_settings')
        working.value = cloneSettings(verifiedSettings)
        callbacks.current.onSettingsChange?.(verifiedSettings)
        await refreshCallableModels()
        notice.value = {
          tone: 'ok',
          text: t(`已保存并验证 ${result.provider}/${result.model}，PI 响应 ${result.latencyMs} ms。`, `Saved and verified ${result.provider}/${result.model}. Pi responded in ${result.latencyMs} ms.`),
        }
        return true
      } catch (reason) {
        const refreshed = await invokeCommand<AppSettings>('get_settings').catch(() => submitted)
        if (refreshed) {
          working.value = cloneSettings(refreshed)
          callbacks.current.onSettingsChange?.(refreshed)
        }
        await refreshCallableModels()
        const raw = desktopErrorMessage(reason)
        notice.value = {
          tone: 'error',
          text: t(`凭据已保存。${explainModelVerificationFailure(raw, submitted.active_provider)}`, `Credentials saved. ${explainModelVerificationFailure(raw, submitted.active_provider)}`),
        }
        return true
      } finally {
        verifying.value = false
      }
    } catch (reason) {
      const refreshed = await invokeCommand<AppSettings>('get_settings').catch(() => working.value)
      if (refreshed) {
        working.value = cloneSettings(refreshed)
        callbacks.current.onSettingsChange?.(refreshed)
      }
      await refreshCallableModels().catch(() => undefined)
      const sessionOnly = refreshed && (
        Object.values(refreshed.providers).some(item => item.session_only)
        || refreshed.relay?.session_only
        || refreshed.nssctf_arena?.session_only
      )
      notice.value = { tone: 'error', text: sessionOnly
        ? t(`${desktopErrorMessage(reason)} 当前密钥仅保留在本次运行内，退出应用后需要重新输入。`, `${desktopErrorMessage(reason)} The current key stays in this session only and must be entered again after you quit.`)
        : t(`设置未保存：${desktopErrorMessage(reason)}`, `Settings were not saved: ${desktopErrorMessage(reason)}`) }
      return false
    } finally {
      saving.value = false
    }
  }

  async function saveProviderEditor(closeAfterSave: boolean) {
    if (!working.value || !editingProviderID.value) {
      await save()
      return
    }
    const editingID = editingProviderID.value
    const pending = pendingCustomRelay.value?.id === editingID ? pendingCustomRelay.value : null
    if (pending) {
      working.value.providers[pending.id] = pending.config
    }
    const editing = working.value.providers[editingID]
    if (editing && (editing.has_api_key || String(editing.api_key ?? '').trim() || editingID === 'tokenflux')) {
      working.value.active_provider = editingID
      if (editing.custom && editing.models?.[0]) {
        working.value.active_model = editing.models[0]
      }
      if (editingID === 'tokenflux') {
        working.value.model_routing.source_order = ['personal', 'account']
        working.value.model_routing.auto_fallback = false
      }
      if (activateConfiguredModelService(editing, editingID)) {
        alignDefaultModelToEnabledServices()
      }
    }
    const persisted = await save()
    alignDefaultModelToEnabledServices()
    if (persisted) {
      pendingCustomRelay.value = null
      if (closeAfterSave && notice.value?.tone === 'ok') {
        providerEditorOpen.value = false
      }
      return
    }
    if (pending) {
      delete working.value.providers[pending.id]
      pendingCustomRelay.value = pending
    }
  }

  function refreshComputerUseAfterSettings() {
    if (category.value !== 'browser' || computerUsePermissionsReady.value) return
    void refreshComputerUseStatus({ silent: true })
  }

  function selectCategory(value: SettingsCategory) {
    category.value = normalizeSettingsCategory(value)
    notice.value = null
  }

  async function changeLocale(value: unknown) {
    if (!working.value) return
    working.value.locale = normalizeUiLocale(value)
    applyUiLocale(working.value.locale)
    await save()
  }

  async function loadUserArtifactDirectory() {
    if (!hasDesktopRuntime()) return
    try {
      userArtifacts.value = await invokeCommand<UserArtifactDirectoryStatus>('get_user_artifact_directory_status')
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) {
        notice.value = { tone: 'error', text: t(`无法读取文档目录：${String(reason)}`, `Could not read the documents folder: ${String(reason)}`) }
      }
    }
  }

  function start() {
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

  return {
    accountStatusProp,
    category,
    dashboard,
    working,
    saving,
    verifying,
    localDataLoading,
    computerUseLoading,
    computerUseRequesting,
    computerUseRestarting,
    browserBridgeLoading,
    browserSetupBusy,
    browserUseOpening,
    browserUseRuntimeLoading,
    browserUseRuntime,
    backupExporting,
    restoreScheduling,
    diagnosticExporting,
    localData,
    userArtifacts,
    computerUseStatus,
    browserBridgeStatus,
    buildTracking,
    buildTrackingCopying,
    notice,
    customModelInput,
    availablePickerGroups,
    account,
    accountStateLabel,
    databaseStateLabels,
    defaultModelKey,
    defaultModelAvailable,
    availableModelCount,
    defaultModelLabel,
    thinkingModelKey,
    thinkingModelID,
    thinkingModelLabel,
    thinkingOverride,
    thinkingProfile,
    windowModelKey,
    windowModelID,
    windowModelLabel,
    windowOverride,
    effectiveWindow,
    workerModelKey,
    workerModelLabel,
    codingToolSetupBusy,
    userSkillBusy,
    userSkillError,
    userSkills,
    editingBuiltinSkill,
    builtinSkillDocument,
    accountRoute,
    modelServiceRows,
    editingProviderInfo,
    editingProvider,
    editingProviderModel,
    editingProviderModels,
    providerEditorOpen,
    debugModeOn,
    computerUsePermissionsReady,
    browserUseDescription,
    browserBridgeConnected,
    browserPairingReady,
    browserExtensionReady,
    settingsCategories,
    applySettings,
    applyInitialCategory,
    start,
    stop,
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