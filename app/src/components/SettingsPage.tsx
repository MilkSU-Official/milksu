import { createStore, useStore, useStoreRuntime } from '@/lib/reactStore'
import { useEffect, useRef } from 'react'
import {
  AlertCircle,
  Check,
  LogOut,
  Plus,
  Trash2,
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
  SettingsGhostPicker,
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
import SearchableModelPicker from '@/components/SearchableModelPicker'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'
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
  applyUiEmphasis,
  normalizeUiEmphasisPreset,
  UI_EMPHASIS_PRESET_IDS,
  UI_EMPHASIS_SWATCH,
  type UiEmphasisPreset,
} from '@/lib/uiEmphasis'
import {
  applyUiFonts,
  normalizeUiFontPreset,
  normalizeUiFontSize,
  UI_FONT_PRESET_IDS,
  UI_FONT_SIZE_IDS,
  type UiFontPreset,
} from '@/lib/uiFonts'
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
import {
  normalizeSettingsCategory,
  settingsCategoryLabel,
  type NormalizedSettingsCategory,
  type SettingsCategory,
} from '@/lib/settingsNavigation'

function uiFontPresetLabel(id: UiFontPreset) {
  switch (id) {
    case 'inter':
      return t('Inter', 'Inter')
    case 'noto-sc':
      return t('Noto Sans SC（思源黑体）', 'Noto Sans SC')
    case 'ibm-plex':
      return t('IBM Plex Sans', 'IBM Plex Sans')
    case 'source-sans':
      return t('Source Sans 3', 'Source Sans 3')
    case 'geist':
      return t('Geist', 'Geist')
    case 'nunito-sans':
      return t('Nunito Sans', 'Nunito Sans')
    case 'noto-serif-sc':
      return t('Noto Serif SC（思源宋体）', 'Noto Serif SC')
    case 'zcool-xiaowei':
      return t('站酷小薇', 'ZCOOL XiaoWei')
    case 'zcool-qingke':
      return t('站酷庆科黄油体', 'ZCOOL QingKe HuangYou')
    case 'system':
      return t('操作系统界面（苹方 / 微软雅黑）', 'OS interface (PingFang / YaHei / system UI)')
    default:
      return t('Inter + Noto Sans SC（产品默认）', 'Inter + Noto Sans SC (product default)')
  }
}

function uiEmphasisPresetLabel(id: UiEmphasisPreset) {
  switch (id) {
    case 'blue':
      return t('蓝色', 'Blue')
    case 'violet':
      return t('紫色', 'Violet')
    case 'teal':
      return t('青色', 'Teal')
    case 'amber':
      return t('琥珀', 'Amber')
    case 'rose':
      return t('玫红', 'Rose')
    default:
      return t('默认', 'Default')
  }
}

function EmphasisSwatchPicker({
  value,
  onChange,
}: {
  value: UiEmphasisPreset
  onChange: (value: UiEmphasisPreset) => void
}) {
  return (
    <div
      className="flex h-7 items-center gap-1.5"
      role="radiogroup"
      aria-label={t('强调色', 'Accent color')}
    >
      {UI_EMPHASIS_PRESET_IDS.map(id => {
        const selected = value === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={uiEmphasisPresetLabel(id)}
            title={uiEmphasisPresetLabel(id)}
            className={`size-5 shrink-0 rounded-full border transition-shadow ${
              selected
                ? 'border-transparent ring-2 ring-emphasis ring-offset-2 ring-offset-card'
                : 'border-border'
            }`}
            style={{ background: UI_EMPHASIS_SWATCH[id] }}
            onClick={() => onChange(id)}
          />
        )
      })}
    </div>
  )
}

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
  const searchablePickerGroups: SearchableModelGroup[] = availablePickerGroups.map(group => ({
    key: group.key,
    label: group.label,
    models: group.models.map(model => ({
      value: encodePickerSelection(group.providerId, model, group.source),
      label: store.availablePickerModelLabel(group, model),
      model,
    })),
  }))
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
  const dashboard = vulnerabilityDashboard

  return (
    <main className="settings-page flex min-w-0 flex-1 flex-col bg-background">
      <header className="app-drag settings-page-header shell-window-control-safe-x flex h-14 shrink-0 items-center border-b border-border bg-background px-5 text-foreground">
        <p className="text-lg font-semibold tracking-[-0.02em]">
          {settingsCategoryLabel(category)}
        </p>
      </header>

      <div className="settings-layout flex min-h-0 flex-1">
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
                      <SettingsGhostPicker
                        value={working.locale ?? 'zh'}
                        ariaLabel={t('界面语言', 'Interface language')}
                        options={[
                          { value: 'zh', label: t('简体中文', 'Simplified Chinese') },
                          { value: 'en', label: 'English' },
                        ]}
                        onChange={value => void store.changeLocale(value)}
                      />
                    )}
                  />
                  <SettingsRow
                    label={t('强调色', 'Accent color')}
                    trailing={(
                      <EmphasisSwatchPicker
                        value={normalizeUiEmphasisPreset(working.ui_emphasis)}
                        onChange={value => void store.changeUiEmphasis(value)}
                      />
                    )}
                  />
                </SettingsSection>
                <SettingsSection title={t('字体', 'Fonts')}>
                  <SettingsRow
                    label={t('界面字体', 'Interface font')}
                    trailing={(
                      <SettingsGhostPicker
                        value={normalizeUiFontPreset(working.ui_font)}
                        ariaLabel={t('界面字体', 'Interface font')}
                        wide
                        options={UI_FONT_PRESET_IDS.map(id => ({
                          value: id,
                          label: uiFontPresetLabel(id),
                        }))}
                        onChange={value => void store.changeUiFont(value)}
                      />
                    )}
                  />
                  <SettingsRow
                    label={t('界面字号', 'Interface size')}
                    trailing={(
                      <SettingsGhostPicker
                        value={normalizeUiFontSize(working.ui_font_size)}
                        ariaLabel={t('界面字号', 'Interface size')}
                        options={UI_FONT_SIZE_IDS.map(id => ({
                          value: id,
                          label: id,
                        }))}
                        onChange={value => void store.changeUiFontSize(value)}
                      />
                    )}
                  />
                  <SettingsRow
                    label={t('对话字体', 'Conversation font')}
                    trailing={(
                      <SettingsGhostPicker
                        value={normalizeUiFontPreset(working.conversation_font)}
                        ariaLabel={t('对话字体', 'Conversation font')}
                        wide
                        options={UI_FONT_PRESET_IDS.map(id => ({
                          value: id,
                          label: uiFontPresetLabel(id),
                        }))}
                        onChange={value => void store.changeConversationFont(value)}
                      />
                    )}
                  />
                  <SettingsRow
                    label={t('对话字号', 'Conversation size')}
                    divider={false}
                    trailing={(
                      <SettingsGhostPicker
                        value={normalizeUiFontSize(working.conversation_font_size)}
                        ariaLabel={t('对话字号', 'Conversation size')}
                        options={UI_FONT_SIZE_IDS.map(id => ({
                          value: id,
                          label: id,
                        }))}
                        onChange={value => void store.changeConversationFontSize(value)}
                      />
                    )}
                  />
                </SettingsSection>
                <SettingsSection title={t('编辑器', 'Editor')}>
                  <SettingsRow
                    label={t('打开文件', 'Open files')}
                    divider={false}
                    trailing={(
                      <SettingsGhostPicker
                        value={normalizePreferredExternalEditor(working.preferred_external_editor)}
                        ariaLabel={t('打开文件的编辑器', 'Editor for opening files')}
                        options={EXTERNAL_EDITORS.map(editor => ({
                          value: editor.id,
                          label: editor.label,
                          leading: <ExternalEditorIcon editor={editor.id} decorative />,
                        }))}
                        onChange={value => {
                          store.patchWorking(next => { next.preferred_external_editor = value })
                          void store.save()
                        }}
                      />
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
                    label={t('数据目录', 'Data folder')}
                    description={localDataLoading
                      ? t('正在统计', 'Counting')
                      : localData
                        ? t(`${localData.fileCount} 个文件 · ${store.formatBytes(localData.bytes)}`, `${localData.fileCount} files · ${store.formatBytes(localData.bytes)}`)
                        : ''}
                    trailing={(
                      <Button variant="outline" size="sm" onClick={() => void store.revealLocalData()}>
                        {t('打开', 'Open')}
                      </Button>
                    )}
                  />
                  <SettingsRow
                    label={t('备份', 'Backup')}
                    description={t('导出或恢复本地数据，不含 Provider Key。', 'Export or restore local data. Provider keys are not included.')}
                    trailing={(
                      <>
                        <Button variant="outline" size="sm" disabled={backupExporting} onClick={() => void store.exportLocalDataBackup()}>
                          {t('导出', 'Export')}
                        </Button>
                        <Button variant="outline" size="sm" disabled={restoreScheduling} onClick={() => void store.scheduleLocalDataRestore()}>
                          {t('恢复', 'Restore')}
                        </Button>
                      </>
                    )}
                  />
                  <SettingsRow
                    label={t('诊断', 'Diagnostics')}
                    description={t('给排障用的日志包。', 'A log bundle for troubleshooting.')}
                    divider={Boolean(localData?.databases?.some(database => database.state !== 'compatible'))}
                    trailing={(
                      <Button variant="outline" size="sm" disabled={diagnosticExporting} onClick={() => void store.exportLocalDiagnostics()}>
                        {t('导出', 'Export')}
                      </Button>
                    )}
                  />
                  {(localData?.databases ?? []).filter(database => database.state !== 'compatible').map((database, index, list) => (
                    <SettingsRow
                      key={database.relativePath}
                      label={database.logicalName}
                      description={database.error || store.databaseVersionText(database)}
                      divider={index < list.length - 1}
                      trailing={(
                        <Badge variant={databaseStateVariants[database.state]}>
                          {databaseStateLabels[database.state]}
                        </Badge>
                      )}
                    />
                  ))}
                </SettingsSection>

                <SettingsSection title={t('构建', 'Build')}>
                  <SettingsRow
                    label={t('构建追踪', 'Build tracking')}
                    description={buildTracking
                      ? `${buildTracking.gitBranch || '—'} · ${(buildTracking.gitCommit || '').slice(0, 7) || '—'} · ${
                        buildTracking.development ? 'development'
                          : buildTracking.missing ? t('缺失', 'missing')
                            : buildTracking.dirty ? 'dirty'
                              : 'clean'
                      }`
                      : t('未能读取构建追踪。', 'Could not read build tracking.')}
                    trailing={(
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!buildTracking || buildTrackingCopying}
                        data-testid="build-tracking"
                        onClick={() => void store.copyBuildTracking()}
                      >
                        {t('复制', 'Copy')}
                      </Button>
                    )}
                  />
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
                    actions={(
                      <Button type="button" variant="ghost" size="sm" disabled={userSkillBusy} onClick={() => store.closeBuiltinSkillEditor()}>
                        {t('关闭', 'Close')}
                      </Button>
                    )}
                  >
                    <SettingsRow
                      label={t('SKILL.md', 'SKILL.md')}
                      divider={false}
                      trailing={(
                        <Textarea
                          value={builtinSkillDocument}
                          onChange={event => { store.setBuiltinSkillDocument(event.target.value) }}
                          onBlur={() => void store.saveBuiltinSkill()}
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
                      <SearchableModelPicker
                        value={defaultModelKey}
                        triggerClassName="settings-control h-7 px-2"
                        ariaLabel={t('默认模型', 'Default model')}
                        align="end"
                        trigger={(
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <ModelVendorIcon model={working?.active_model ?? ''} label={defaultModelLabel} />
                            <span className="min-w-0 truncate">{defaultModelLabel}</span>
                          </span>
                        )}
                        leading={!defaultModelAvailable && defaultModelKey ? [{
                          value: defaultModelKey,
                          label: t(`${defaultModelLabel}（当前不可用）`, `${defaultModelLabel} (unavailable)`),
                          model: working?.active_model ?? '',
                          disabled: true,
                        }] : undefined}
                        groups={searchablePickerGroups}
                        onChange={value => store.setDefaultModelKey(value)}
                      />
                    )}
                  />
                  <SettingsRow
                    label={t('默认运行时', 'Default runtime')}
                    trailing={(
                      <SettingsGhostPicker
                        value={working?.default_kernel === 'dsh' ? 'dsh' : 'pi'}
                        ariaLabel={t('默认运行时', 'Default runtime')}
                        options={[
                          { value: 'pi', label: 'Pi' },
                          { value: 'dsh', label: 'DSH' },
                        ]}
                        onChange={store.setDefaultKernel}
                      />
                    )}
                  />
                  <SettingsRow
                    label={t('忙碌时发送', 'Busy send')}
                    description={t('仅 DeepSeek Harness', 'DeepSeek Harness only')}
                    trailing={(
                      <SettingsGhostPicker
                        value={working?.busy_send === 'queue' ? 'queue' : 'interrupt'}
                        ariaLabel={t('忙碌时发送', 'Busy send')}
                        options={[
                          { value: 'interrupt', label: t('插话', 'Interrupt') },
                          { value: 'queue', label: t('排队', 'Queue') },
                        ]}
                        onChange={store.setBusySend}
                      />
                    )}
                  />
                  <SettingsRow
                    label={t('subagent', 'subagent')}
                    divider={false}
                    trailing={(
                      <SearchableModelPicker
                        value={workerModelKey}
                        triggerClassName="settings-control h-7 px-2"
                        ariaLabel={t('subagent', 'subagent')}
                        align="end"
                        trigger={<span className="min-w-0 truncate">{workerModelLabel}</span>}
                        leading={[{
                          value: WORKER_MODEL_INHERIT,
                          label: t('跟随当前对话', 'Follow current conversation'),
                          model: '',
                        }]}
                        groups={searchablePickerGroups}
                        onChange={value => store.setWorkerModelKey(value)}
                      />
                    )}
                  />
                </SettingsSection>

                <SettingsSection
                  title={t('模型服务', 'Model services')}
                  actions={(
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t('新增模型服务', 'Add a model service')}
                      title={t('新增自定义中转站', 'Add a custom relay')}
                      onClick={() => store.addModelService()}
                    >
                      <Plus className="size-4" />
                    </Button>
                  )}
                >
                  {modelServiceRows.map((row, index) => (
                    <SettingsRow
                      key={row.key}
                      label={row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : store.providerServiceName(row.provider)}
                      description={row.source === 'account'
                        ? t('登录后由管理员分配的 TokenFlux 配额', 'TokenFlux quota assigned by an admin after sign-in')
                        : row.provider.id === 'tokenflux'
                          ? t('你自己的 TokenFlux API Key', 'Your own TokenFlux API key')
                          : store.providerModelsText(row.provider)}
                      divider={index < modelServiceRows.length - 1}
                      trailing={(
                        <>
                          <span className="text-xs text-muted-foreground">{store.serviceStatus(row)}</span>
                          {row.source === 'personal' ? (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => store.openProviderEditor(row.provider.id)}>
                                {t('编辑', 'Edit')}
                              </Button>
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => store.removeModelService(row.provider.id)}>
                                {t('删除', 'Delete')}
                              </Button>
                            </>
                          ) : null}
                          <Switch
                            checked={row.source === 'account' ? Boolean(accountRoute?.enabled) : Boolean(store.providerConfig(row.provider.id)?.enabled)}
                            aria-label={t(`启用${row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : store.providerServiceName(row.provider)}`, `Enable ${row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : store.providerServiceName(row.provider)}`)}
                            onCheckedChange={value => store.setModelServiceEnabled(row, Boolean(value))}
                          />
                        </>
                      )}
                    />
                  ))}
                </SettingsSection>

                <SettingsSection title={t('模型能力', 'Model capabilities')}>
                  <SettingsRow
                    label={t('思考层级', 'Thinking levels')}
                    description={thinkingProfile.source === 'preset'
                      ? t('使用内置预设', 'Uses the built-in preset')
                      : thinkingProfile.source === 'manual'
                        ? t('手动配置', 'Custom')
                        : t('未启用', 'Off')}
                    trailing={(
                      <>
                        <SearchableModelPicker
                          value={thinkingModelKey}
                          triggerClassName="settings-control h-7 px-2"
                          ariaLabel={t('配置思考层级的模型', 'Model for thinking levels')}
                          align="end"
                          trigger={(
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <ModelVendorIcon model={thinkingModelID} label={thinkingModelLabel} />
                              <span className="min-w-0 truncate">{thinkingModelLabel}</span>
                            </span>
                          )}
                          groups={searchablePickerGroups}
                          onChange={value => store.setThinkingModelKey(value)}
                        />
                        {thinkingOverride ? (
                          <button type="button" className="text-xs text-link hover:underline" onClick={() => store.resetModelThinkingOverride()}>
                            {t('恢复预设', 'Restore preset')}
                          </button>
                        ) : null}
                        <Switch
                          checked={thinkingProfile.enabled}
                          disabled={!thinkingModelID}
                          aria-label={t('启用模型思考层级', 'Enable model thinking levels')}
                          onCheckedChange={value => store.setModelThinkingEnabled(Boolean(value))}
                        />
                      </>
                    )}
                  />
                  {thinkingProfile.enabled ? (
                    <SettingsRow
                      label={t('支持档位', 'Supported levels')}
                      trailing={(
                        <>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {MODEL_THINKING_LEVELS.map(level => (
                              <button
                                key={level}
                                type="button"
                                className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[length:var(--text-label)] transition-colors ${thinkingProfile.levels.includes(level) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50'}`}
                                aria-pressed={thinkingProfile.levels.includes(level)}
                                onClick={() => store.toggleModelThinkingLevel(level)}
                              >
                                {thinkingProfile.levels.includes(level) ? <Check className="size-3" /> : null}
                                {MODEL_THINKING_LEVEL_LABELS[level]}
                              </button>
                            ))}
                          </div>
                          <SettingsGhostPicker
                            value={thinkingProfile.defaultLevel ?? ''}
                            ariaLabel={t('默认思考层级', 'Default thinking level')}
                            options={thinkingProfile.levels.map(level => ({
                              value: level,
                              label: MODEL_THINKING_LEVEL_LABELS[level],
                            }))}
                            onChange={store.setModelThinkingDefault}
                          />
                        </>
                      )}
                    />
                  ) : null}
                  <SettingsRow
                    label={t('上下文窗口', 'Context window')}
                    description={t('目录会自动填充，中转站可覆盖。', 'Filled from the catalog. Override it for relays.')}
                    divider={false}
                    trailing={(
                      <>
                        <SearchableModelPicker
                          value={windowModelKey}
                          triggerClassName="settings-control h-7 px-2"
                          ariaLabel={t('配置上下文窗口的模型', 'Model for context window')}
                          align="end"
                          trigger={(
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <ModelVendorIcon model={windowModelID} label={windowModelLabel} />
                              <span className="min-w-0 truncate">{windowModelLabel}</span>
                            </span>
                          )}
                          groups={searchablePickerGroups}
                          onChange={value => store.setWindowModelKey(value)}
                        />
                        {windowOverride ? (
                          <button type="button" className="text-xs text-link hover:underline" onClick={() => store.resetModelContextWindowOverride()}>
                            {t('恢复自动', 'Restore automatic')}
                          </button>
                        ) : null}
                        <Input
                          type="number"
                          className="settings-control w-28"
                          value={effectiveWindow || ''}
                          min={1024}
                          max={10000000}
                          disabled={!windowModelID}
                          aria-label={t('上下文窗口 token 数', 'Context window tokens')}
                          onChange={event => store.setModelContextWindowOverride(event.target.value)}
                          onBlur={() => void store.save()}
                        />
                      </>
                    )}
                  />
                </SettingsSection>

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
                              onBlur={() => void store.save()}
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
                              onBlur={() => void store.save()}
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
                                <Button variant="outline" size="sm" onClick={() => store.addCustomRelayModel()}>{t('添加', 'Add')}</Button>
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
                            onBlur={() => void store.save()}
                          />
                        </label>
                        {!editingProvider.custom ? (
                          <label className="provider-editor-field items-start">
                            <span className="pt-2">{t('可用模型', 'Available models')}</span>
                            <div className="min-w-0">
                              <SearchableModelPicker
                                value={editingProviderModels.length
                                  ? store.modelSelectionKey(editingProviderInfo.id, editingProviderModel || editingProviderModels[0] || '')
                                  : ''}
                                disabled={!editingProviderModels.length}
                                triggerClassName="h-7 min-w-72 px-2"
                                ariaLabel={t('可用模型', 'Available models')}
                                align="start"
                                trigger={(
                                  <span className="min-w-0 truncate">
                                    {editingProviderModels.length
                                      ? store.modelDisplayLabel(editingProviderInfo.id, editingProviderModel || editingProviderModels[0] || '')
                                      : ''}
                                  </span>
                                )}
                                groups={[{
                                  key: editingProviderInfo.id,
                                  label: store.providerServiceName(editingProviderInfo),
                                  models: editingProviderModels.map(model => ({
                                    value: store.modelSelectionKey(editingProviderInfo.id, model),
                                    label: store.modelDisplayLabel(editingProviderInfo.id, model),
                                    model,
                                  })),
                                }]}
                                onChange={value => {
                                  const selection = store.parseModelSelectionKey(String(value ?? ''))
                                  if (!selection) return
                                  store.setEditingProviderModel(selection[1])
                                }}
                              />
                            </div>
                          </label>
                        ) : null}
                        {notice ? <p className={`text-caption ${notice.tone === 'error' ? 'text-destructive' : 'text-primary'}`}>{notice.text}</p> : null}
                      </div>
                    ) : null}
                    <DialogFooter>
                      <Button variant="outline" size="sm" disabled={saving || verifying} onClick={() => void store.saveProviderEditor(false)}>
                        {verifying ? t('正在测试', 'Testing') : t('测试连接', 'Test connection')}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            ) : working && category === 'ctf' ? (
              <>
                <SettingsSection title="NSSCTF Agent Arena">
                  <SettingsRow
                    label="Arena Token"
                    description={working.nssctf_arena?.session_only ? t('仅本次运行可用', 'Only available in this run') : ''}
                    trailing={(
                      <Input
                        className="settings-control"
                        value={working.nssctf_arena?.token ?? ''}
                        type="password"
                        autoComplete="off"
                        placeholder="Token"
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
                    )}
                  />
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
      applyUiFonts({
        uiFont: s.working.ui_font,
        conversationFont: s.working.conversation_font,
        uiFontSize: s.working.ui_font_size,
        conversationFontSize: s.working.conversation_font_size,
      })
      applyUiEmphasis({ preset: s.working.ui_emphasis })
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
    persist()
  }

  function setDefaultKernel(value: string) {
    patchWorking(working => {
      working.default_kernel = value === 'dsh' ? 'dsh' : 'pi'
    })
    persist()
  }

  function setBusySend(value: string) {
    patchWorking(working => {
      working.busy_send = value === 'queue' ? 'queue' : 'interrupt'
    })
    persist()
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
    persist()
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
    persist()
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
    persist()
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
    persist()
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
    persist()
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
      if (!s.pendingCustomRelay) persist()
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
    persist()
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
      persist()
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
      persist()
      return
    }
    alignDefaultModelToEnabledServices()
    persist()
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

  function persist() {
    void save({ quiet: true })
  }

  async function save(options?: { quiet?: boolean; verify?: boolean }): Promise<boolean> {
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
    if (!options?.quiet || options.verify) s.notice = null
    const submitted = cloneSettings(s.working)
    if (submitted.active_provider !== 'tokenflux') {
      activateConfiguredModelService(
        submitted.providers[submitted.active_provider],
        submitted.active_provider,
      )
    }
    try {
      await invokeCommand('save_settings_cmd', { newSettings: submitted })
      const refreshed = await invokeCommand<AppSettings>('get_settings')
      s.working = cloneSettings(refreshed)
      callbacks.current.onSettingsChange?.(refreshed)
      await refreshCallableModels()
      if (options?.verify) {
        if (!submittedServiceReady(submitted)) {
          s.notice = {
            tone: 'error',
            text: t('当前没有已启用且可用的模型服务。', 'No enabled model service is ready.'),
          }
          return true
        }
        s.verifying = true
        try {
          const result = await invokeCommand<ModelProbeResult>('test_agent_model', { settings: submitted })
          s.notice = {
            tone: 'ok',
            text: t(`连接正常 ${result.provider}/${result.model}，${result.latencyMs} ms。`, `Connected ${result.provider}/${result.model} in ${result.latencyMs} ms.`),
          }
        } catch (reason) {
          const raw = desktopErrorMessage(reason)
          s.notice = {
            tone: 'error',
            text: explainModelVerificationFailure(raw, submitted.active_provider),
          }
        } finally {
          s.verifying = false
        }
        return true
      }
      return true
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

  async function saveProviderEditor(_closeAfterSave: boolean) {
    if (!s.working || !s.editingProviderID) {
      await save({ verify: true })
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
    const persisted = await save({ verify: true })
    alignDefaultModelToEnabledServices()
    if (persisted) {
      s.pendingCustomRelay = null
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

  async function changeUiFont(value: unknown) {
    const uiFont = normalizeUiFontPreset(value)
    patchWorking(working => { working.ui_font = uiFont })
    applyUiFonts({ uiFont })
    await save()
  }

  async function changeConversationFont(value: unknown) {
    const conversationFont = normalizeUiFontPreset(value)
    patchWorking(working => { working.conversation_font = conversationFont })
    applyUiFonts({ conversationFont })
    await save()
  }

  async function changeUiFontSize(value: unknown) {
    const uiFontSize = normalizeUiFontSize(value)
    patchWorking(working => { working.ui_font_size = uiFontSize })
    applyUiFonts({ uiFontSize })
    await save()
  }

  async function changeConversationFontSize(value: unknown) {
    const conversationFontSize = normalizeUiFontSize(value)
    patchWorking(working => { working.conversation_font_size = conversationFontSize })
    applyUiFonts({ conversationFontSize })
    await save()
  }

  async function changeUiEmphasis(value: unknown) {
    const uiEmphasis = normalizeUiEmphasisPreset(value)
    patchWorking(working => { working.ui_emphasis = uiEmphasis })
    applyUiEmphasis({ preset: uiEmphasis })
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
    changeUiFont,
    changeConversationFont,
    changeUiFontSize,
    changeConversationFontSize,
    changeUiEmphasis,
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
    setDefaultKernel,
    setBusySend,
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
.settings-page .page-column {
  max-width: 42rem;
}
.settings-page [data-slot='button'],
.settings-page [data-slot='input'],
.settings-page [data-slot='native-select'],
.settings-page [data-slot='select-trigger'] {
  height: 1.75rem;
  min-height: 1.75rem;
  padding-block: 0;
  font-family: var(--font-sans);
  font-size: var(--text-label);
  font-weight: var(--font-weight-medium);
  line-height: var(--text-label--line-height);
  letter-spacing: var(--text-label--letter-spacing);
}
.settings-page .settings-row-type,
.settings-page .settings-control,
.settings-picker-menu,
.settings-picker-menu .settings-row-type {
  font-family: var(--font-sans);
  font-size: var(--text-label) !important;
  font-weight: var(--font-weight-medium);
  line-height: var(--text-label--line-height) !important;
  letter-spacing: var(--text-label--letter-spacing);
}
.settings-page [data-slot='button'][data-size='icon'],
.settings-page [data-slot='button'][data-size='icon-sm'] {
  width: 1.75rem;
  padding-inline: 0;
}
.settings-page .settings-control {
  width: 14rem;
}
.provider-editor-field { display: grid; grid-template-columns: 7rem minmax(0, 1fr); align-items: center; gap: 1rem; font-size: var(--text-label); }
@media (max-width: 850px) {
  .provider-editor-field { grid-template-columns: 1fr; gap: .5rem; }
}
`