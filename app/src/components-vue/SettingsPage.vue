<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
} from '@felinic/ui'
import {
  AlertCircle,
  ArrowLeft,
  Box,
  Bug,
  Cable,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileWarning,
  Flag,
  FolderOpen,
  Github,
  Globe2,
  KeyRound,
  LogOut,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  WalletCards,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import type {
  CodingComputerUsePermission,
  CodingComputerUseStatus,
  CodingComputerUseSigning,
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
  ProviderConfig,
  ProviderInfo,
  PreviousExitState,
  StartupRecoveryStatus,
} from '@/types'
import {
  withAppSettingsDefaults,
} from '@/types'
import { installAppModelSettings, useModelCatalog } from '@/modelCatalog'
import VulnerabilityIntelSettingsPanel from '@/components-vue/VulnerabilityIntelSettingsPanel.vue'
import SecurityToolsSettingsPanel from '@/components-vue/SecurityToolsSettingsPanel.vue'
import type { SecurityToolCodingHandoff } from '@/securityToolsTypes'
import { useVulnerabilityDashboard, type VulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import { CODING_SKILLS } from '@/codingSkills'

type SettingsCategory = 'general' | 'apikeys' | 'ctf' | 'cve' | 'coding' | 'browser' | 'security-tools'

const settingsCategories = [
  { value: 'general', label: '通用', icon: Settings2 },
  { value: 'apikeys', label: '模型', icon: Box },
  { value: 'ctf', label: 'CTF', icon: Flag },
  { value: 'cve', label: 'CVE', icon: Bug },
  { value: 'coding', label: 'Coding', icon: Code2 },
  { value: 'browser', label: '浏览器控制', icon: Globe2 },
  { value: 'security-tools', label: '安全工具', icon: ShieldCheck },
] as const

const props = defineProps<{
  settings: AppSettings | null
  initialCategory: SettingsCategory
  accountStatus?: AccountStatus
  vulnerabilityDashboard?: VulnerabilityDashboard
}>()

const emit = defineEmits<{
  close: []
  settingsChange: [value: AppSettings]
  accountLogin: []
  accountLogout: []
  securityToolCodingHandoff: [handoff: SecurityToolCodingHandoff]
}>()

const category = ref(props.initialCategory)
const dashboard = props.vulnerabilityDashboard ?? useVulnerabilityDashboard()
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
const backupExporting = ref(false)
const restoreScheduling = ref(false)
const diagnosticExporting = ref(false)
const localData = ref<LocalDataStatus | null>(null)
const userArtifacts = ref<UserArtifactDirectoryStatus | null>(null)
const computerUseStatus = ref<CodingComputerUseStatus | null>(null)
const browserBridgeStatus = ref<NSSCTFWebBridgeStatus | null>(null)
const recoveryStatus = ref<StartupRecoveryStatus | null>(null)
const buildTracking = ref<BuildTracking | null>(null)
const buildTrackingCopying = ref(false)
const notice = ref<{ tone: 'ok' | 'error'; text: string } | null>(null)
const editingProviderID = ref<string | null>(null)
const customModelInput = ref('')
// Same callable-model surface as Coding composer (enabled services only).
const pickerSettings = computed(() => ({
  providers: working.value?.providers ?? {},
  relay: working.value?.relay,
}))
// Service rows still need unconfigured built-ins so the user can enable them.
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
  providers: availableProviders,
  providerGroups: availableProviderGroups,
  providerModelLabel: availableProviderModelLabel,
} = useModelCatalog(pickerSettings)
const account = computed<AccountStatus>(() => props.accountStatus ?? ({ configured: false, authenticated: false, state: 'unconfigured' }))
const accountStateLabel = computed(() => ({
  unconfigured: '未配置',
  signed_out: '未登录',
  authorizing: '等待授权',
  active: '已登录',
  suspended: '访问已暂停',
  invitation_required: '等待邀请',
  unavailable: '暂时不可用',
}[account.value.state]))

const databaseStateLabels: Record<DatabaseCompatibilityState, string> = {
  compatible: '兼容',
  missing: '尚未创建',
  newer: '数据库较新',
  corrupt: '损坏或不可读',
  remaining: '尚未纳入迁移',
}

const previousExitLabels: Record<PreviousExitState, string> = {
  none: '首次启动',
  clean: '正常退出',
  abnormal: '异常退出',
}

const previousExitVariants: Record<PreviousExitState, 'secondary' | 'destructive' | 'outline'> = {
  none: 'outline',
  clean: 'secondary',
  abnormal: 'destructive',
}

const databaseStateVariants: Record<DatabaseCompatibilityState, 'secondary' | 'destructive' | 'outline'> = {
  compatible: 'secondary',
  missing: 'outline',
  newer: 'destructive',
  corrupt: 'destructive',
  remaining: 'outline',
}

function databaseVersionText(database: DatabaseCompatibilityStatus): string {
  const parts: string[] = []
  if (database.current !== undefined) parts.push(`当前 v${database.current}`)
  if (database.supported !== undefined) parts.push(`支持 v${database.supported}`)
  return parts.join(' · ')
}

function cloneSettings(value: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(value)) as AppSettings
}

watch(() => props.settings, value => {
  working.value = value ? cloneSettings(withAppSettingsDefaults(value)) : null
  if (working.value) {
    ensureAccountRoute()
    alignDefaultModelToEnabledServices()
  }
}, { immediate: true })
watch(() => props.initialCategory, value => { category.value = value })
// Draft edits should drive the shared picker the same way Coding reads saved settings.
watch(working, value => {
  if (value) installAppModelSettings(value)
}, { deep: true })
onMounted(() => {
  void loadLocalData()
  void loadUserArtifactDirectory()
  void loadBuildTracking()
  void refreshComputerUseStatus({ silent: true })
  void refreshBrowserBridgeStatus({ silent: true })
  window.addEventListener('focus', refreshComputerUseAfterSettings)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshComputerUseAfterSettings)
})

function refreshComputerUseAfterSettings() {
  if (category.value !== 'browser' || computerUsePermissionsReady.value) return
  void refreshComputerUseStatus({ silent: true })
}

async function loadUserArtifactDirectory() {
  try {
    userArtifacts.value = await invokeCommand<UserArtifactDirectoryStatus>('get_user_artifact_directory_status')
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法读取产物目录：${String(reason)}` }
  }
}

const provider = computed(() => (
  working.value ? working.value.providers[working.value.active_provider] : undefined
))
const accountRoute = computed(() => working.value?.relay)
function modelSelectionKey(provider: string, model: string) {
  return JSON.stringify([provider, model])
}

function parseModelSelectionKey(value: string): [string, string] | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      !Array.isArray(parsed)
      || parsed.length !== 2
      || typeof parsed[0] !== 'string'
      || typeof parsed[1] !== 'string'
      || !parsed[0]
      || !parsed[1]
    ) return null
    return [parsed[0], parsed[1]]
  } catch {
    return null
  }
}

const defaultModelKey = computed({
  get: () => working.value
    ? modelSelectionKey(working.value.active_provider, working.value.active_model)
    : '',
  set: value => {
    if (!working.value) return
    const selection = parseModelSelectionKey(String(value ?? ''))
    if (!selection) return
    working.value.active_provider = selection[0]
    working.value.active_model = selection[1]
  },
})

const defaultModelAvailable = computed(() => {
  if (!working.value) return false
  return availableProviders.value.some(provider => (
    provider.id === working.value?.active_provider
    && provider.models.includes(working.value.active_model)
  ))
})

const availableModelCount = computed(() => availableProviders.value.reduce(
  (total, provider) => total + provider.models.length,
  0,
))

const defaultModelLabel = computed(() => {
  if (!working.value) return ''
  return availableProviderModelLabel(
    working.value.active_provider,
    working.value.active_model,
  )
})

/** Keep active_provider/model on an enabled callable service after toggles. */
function alignDefaultModelToEnabledServices() {
  if (!working.value) return
  const callable = availableProviders.value
  if (callable.length === 0) return
  const current = callable.find(provider => (
    provider.id === working.value?.active_provider
    && provider.models.includes(working.value.active_model)
  ))
  if (current) return
  const sameProvider = callable.find(provider => provider.id === working.value?.active_provider)
  if (sameProvider?.models[0]) {
    working.value.active_model = sameProvider.models[0]
    return
  }
  working.value.active_provider = callable[0].id
  working.value.active_model = callable[0].models[0] ?? ''
}

function skillEnabled(name: string): boolean {
  return !working.value?.disabled_skills?.includes(name)
}

function setSkillEnabled(name: string, enabled: boolean) {
  if (!working.value) return
  const disabled = new Set(working.value.disabled_skills ?? [])
  if (enabled) disabled.delete(name)
  else disabled.add(name)
  working.value.disabled_skills = [...disabled]
}

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

function addCustomRelay() {
  if (!working.value) return
  const count = Object.values(working.value.providers).filter(item => item.custom).length
  if (count >= 8) {
    notice.value = { tone: 'error', text: '最多可以添加 8 个自定义中转站。' }
    return
  }
  const id = customRelayID()
  working.value.providers[id] = {
    api_key: '',
    has_api_key: false,
    base_url: '',
    enabled: true,
    custom: true,
    name: '我的中转站',
    models: [],
  }
  working.value.active_provider = id
  working.value.active_model = ''
  customModelInput.value = ''
  notice.value = null
}

function addModelService() {
  const previousProvider = working.value?.active_provider
  addCustomRelay()
  if (
    working.value?.active_provider !== previousProvider
    && working.value?.active_provider.startsWith('custom-relay-')
  ) {
    editingProviderID.value = working.value.active_provider
  }
}

function removeModelService(id: string) {
  if (!working.value) return
  const config = working.value.providers[id] ?? ensureProviderConfig(id)
  if (!config) return
  if (config.custom) {
    delete working.value.providers[id]
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
  if (working.value.active_provider === id) ensureProvider('tokenflux')
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
    notice.value = { tone: 'error', text: '每个中转站最多可以添加 32 个模型。' }
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
  !provider.value?.custom
  &&
  account.value.state === 'active'
  && account.value.tokenFluxLinked === true,
))
type ModelServiceRow =
  | { key: 'account'; source: 'account'; provider?: undefined }
  | { key: string; source: 'personal'; provider: ProviderInfo }

const modelServiceRows = computed<ModelServiceRow[]>(() => {
  if (!working.value) return []
  const rows: ModelServiceRow[] = []
  // Account first when TokenFlux is the product model route; then every provider service.
  if (!provider.value?.custom) {
    rows.push({ key: 'account', source: 'account' })
  }
  for (const item of modelProviders.value) {
    rows.push({ key: `provider:${item.id}`, source: 'personal', provider: item })
  }
  return rows
})

const accountProviderInfo = computed(() => modelProviders.value.find(item => item.id === 'tokenflux'))
const editingProviderInfo = computed(() => (
  modelProviders.value.find(item => item.id === editingProviderID.value)
))
const editingProvider = computed(() => (
  editingProviderID.value ? working.value?.providers[editingProviderID.value] : undefined
))
const editingProviderModel = computed(() => {
  if (!editingProviderInfo.value || !working.value) return ''
  if (editingProviderID.value === working.value.active_provider) return working.value.active_model
  return editingProviderInfo.value.models[0] ?? ''
})
const editingProviderModels = computed(() => {
  const models = editingProviderInfo.value?.models ?? []
  if (models.length || editingProviderID.value !== working.value?.active_provider || !working.value.active_model) return models
  return [working.value.active_model]
})
const providerEditorOpen = computed({
  get: () => Boolean(editingProviderID.value),
  set: value => {
    if (!value) {
      editingProviderID.value = null
      customModelInput.value = ''
    }
  },
})

function providerConfig(id: string): ProviderConfig | undefined {
  return working.value?.providers[id]
}

function providerModelsText(info: ProviderInfo): string {
  if (providerConfig(info.id)?.custom) return `${info.models.length} 个模型`
  if (!info.models.length) return '等待模型目录'
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
  return info?.models.length ? providerModelsText(info) : '管理员分配的模型'
}

function providerServiceName(info: ProviderInfo): string {
  if (providerConfig(info.id)?.custom) return info.name
  if (info.id === 'tokenflux') return 'TokenFlux 个人'
  return `${info.name} 官方`
}

function serviceStatus(row: ModelServiceRow): string {
  if (row.source === 'account') {
    if (!accountModelSourceReady.value) return '未连接'
    return accountRoute.value?.enabled ? '已启用' : '已停用'
  }
  const config = providerConfig(row.provider.id)
  if (!config || !(config.has_api_key || config.api_key)) return '未配置'
  if (!config.enabled) return '已停用'
  return '已启用'
}

function serviceStatusClass(row: ModelServiceRow): string {
  const status = serviceStatus(row)
  if (status === '已启用') return 'text-primary'
  if (status === '未配置' || status === '未连接') return 'text-warning'
  return 'text-muted-foreground'
}

function serviceIsActiveDefault(row: ModelServiceRow): boolean {
  if (!working.value) return false
  if (row.source === 'account') {
    return working.value.active_provider === 'tokenflux'
      && Boolean(accountRoute.value?.enabled)
      && accountModelSourceReady.value
  }
  return working.value.active_provider === row.provider.id
    && Boolean(providerConfig(row.provider.id)?.enabled)
}

function openProviderEditor(id: string) {
  ensureProviderConfig(id)
  editingProviderID.value = id
  customModelInput.value = ''
  notice.value = null
}

function setEditingProviderModel(value: string) {
  if (!working.value || !editingProviderID.value || !value) return
  if (working.value.active_provider !== editingProviderID.value) return
  working.value.active_model = value
}

function setModelServiceEnabled(row: ModelServiceRow, enabled: boolean) {
  if (!working.value) return
  if (row.source === 'account') {
    if (provider.value?.custom) return
    ensureAccountRoute()
    if (enabled && !accountModelSourceReady.value) {
      working.value.relay!.enabled = false
      return
    }
    working.value.relay!.enabled = enabled
    // Prefer account TokenFlux when it is turned on; otherwise leave personal order.
    if (enabled) {
      working.value.model_routing.source_order = ['account', 'personal']
      working.value.model_routing.auto_fallback = false
      if (working.value.active_provider !== 'tokenflux') {
        working.value.active_provider = 'tokenflux'
      }
    }
    alignDefaultModelToEnabledServices()
    return
  }
  const config = ensureProviderConfig(row.provider.id)
  if (!config) return
  config.enabled = enabled
  if (enabled) {
    // Enabling a personal service makes it the active path for that provider.
    working.value.active_provider = row.provider.id
    if (row.provider.id === 'tokenflux') {
      working.value.model_routing.source_order = ['personal', 'account']
    }
    working.value.model_routing.auto_fallback = false
    if (row.provider.models[0] && !row.provider.models.includes(working.value.active_model)) {
      working.value.active_model = row.provider.models[0]
    }
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
  localDataLoading.value = true
  try {
    const [status, recovery] = await Promise.all([
      invokeCommand<LocalDataStatus>('get_local_data_status'),
      invokeCommand<StartupRecoveryStatus>('get_startup_recovery_status').catch(() => null),
    ])
    localData.value = status
    recoveryStatus.value = recovery
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法读取本地数据状态：${String(reason)}` }
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
    notice.value = { tone: 'ok', text: '已复制构建追踪信息' }
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法复制构建追踪：${String(reason)}` }
  } finally {
    buildTrackingCopying.value = false
  }
}

function formatLocalTimestamp(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const recoveryDescription = computed(() => {
  const status = recoveryStatus.value
  if (!status) return ''
  const parts: string[] = []
  if (status.previousExit === 'abnormal' && status.previousStartedAt) {
    parts.push(`上次启动于 ${formatLocalTimestamp(status.previousStartedAt)}`)
  }
  if (status.lastCleanExitAt) {
    parts.push(`上次正常退出 ${formatLocalTimestamp(status.lastCleanExitAt)}`)
  }
  if (status.previousPid) {
    parts.push(`上次进程 ${status.previousPid}`)
  }
  if (status.consecutiveAbnormalExits > 0) {
    parts.push(`连续 ${status.consecutiveAbnormalExits} 次异常退出`)
  }
  if (status.previousExit === 'none') {
    parts.push('尚无历史启动记录')
  }
  if (status.startedAt) {
    parts.push(`本次启动 ${formatLocalTimestamp(status.startedAt)}`)
  }
  return parts.join(' · ')
})

const computerUsePermissionsReady = computed(() => Boolean(
  computerUseStatus.value?.permissions.accessibility
  && computerUseStatus.value.permissions.screenRecording,
))
const computerUseMissingPermissions = computed(() => {
  const missing: string[] = []
  if (!computerUseStatus.value?.permissions.accessibility) missing.push('辅助功能')
  if (!computerUseStatus.value?.permissions.screenRecording) missing.push('屏幕录制')
  return missing
})
const computerUseSigning = computed<CodingComputerUseSigning | null>(() => (
  computerUseStatus.value?.signing ?? null
))
const computerUseSigningLabel = computed(() => {
  const signing = computerUseSigning.value
  if (!signing) return '当前构建身份：未检测'
  const signature = signing.signature === 'adhoc'
    ? 'ad-hoc'
    : signing.signature === 'signed'
      ? '已签名'
      : signing.signature || '未知签名'
  const team = signing.teamIdentifier && signing.teamIdentifier !== 'not set'
    ? signing.teamIdentifier
    : '未设置'
  return `当前构建身份：${signature} · Team ${team}`
})
const computerUseSigningDiagnostic = computed(() => {
  const signing = computerUseSigning.value
  if (!signing) return ''
  if (signing.stableIdentity) return '权限绑定到稳定 App 身份；正式版本更新会继续复用同一次授权。'
  return signing.problem || '当前构建身份不稳定，macOS 可能无法稳定复用辅助功能/屏幕录制授权。'
})
const computerUseSigningUnstable = computed(() => Boolean(
  computerUseSigning.value && !computerUseSigning.value.stableIdentity,
))
const computerUsePermissionSummary = computed(() => {
  const status = computerUseStatus.value
  if (!status) return '尚未检测 Computer Use 权限。'
  if (!status.available) return status.problem || 'Computer Use 当前不可用。'
  if (computerUsePermissionsReady.value) return '辅助功能与屏幕录制已授权。'
  const missing = computerUseMissingPermissions.value.join('、') || '系统权限'
  if (computerUseSigningUnstable.value) {
    return `${missing} 缺少或未对当前构建生效；当前构建身份不稳定（如 ad-hoc）。仍可显式打开系统权限设置做授权，授权后必须“重新检测”；Start 只接受真实 TCC 探针，不会伪造权限。`
  }
  return `${missing} 缺少或未对当前构建生效；App 管理权限不能替代 Computer Use。`
})
const computerUsePermissionBadge = computed(() => {
  if (!computerUseStatus.value) return { label: '未检测', variant: 'outline' as const }
  if (!computerUseStatus.value.available) return { label: '不可用', variant: 'destructive' as const }
  if (computerUsePermissionsReady.value) return { label: '已授权', variant: 'secondary' as const }
  return { label: '需处理', variant: 'outline' as const }
})

const browserBridgeConnected = computed(() => Boolean(browserBridgeStatus.value?.bridge.connected))
const browserPairingReady = computed(() => Boolean(browserBridgeStatus.value?.bridge.pairingCode))
const browserExtensionReady = computed(() => Boolean(browserBridgeStatus.value?.bridge.extensionPath))

async function refreshBrowserBridgeStatus(options: { silent?: boolean } = {}) {
  browserBridgeLoading.value = true
  try {
    browserBridgeStatus.value = await invokeCommand<NSSCTFWebBridgeStatus>('get_nssctf_web_bridge_status')
    if (!options.silent) {
      notice.value = { tone: 'ok', text: '浏览器 Bridge 状态已重新检测。' }
    }
  } catch (reason) {
    browserBridgeStatus.value = null
    if (!options.silent) {
      notice.value = { tone: 'error', text: `无法检测浏览器 Bridge：${String(reason)}` }
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
      text: 'Chrome 扩展页和 MilkSU 扩展目录已打开；加载后回到这里复制配对码。',
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法打开浏览器扩展安装入口：${String(reason)}` }
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
      text: '已在浏览器打开 Playwright MCP 官方扩展页面。',
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法打开 Playwright MCP 官方扩展：${String(reason)}` }
  } finally {
    browserUseOpening.value = false
  }
}

async function copyBrowserPairingCode() {
  const pairingCode = browserBridgeStatus.value?.bridge.pairingCode
  if (!pairingCode) return
  try {
    await navigator.clipboard.writeText(pairingCode)
    notice.value = { tone: 'ok', text: '本机浏览器配对码已复制。' }
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法复制浏览器配对码：${String(reason)}` }
  }
}

async function refreshComputerUseStatus(options: { silent?: boolean } = {}) {
  computerUseLoading.value = true
  try {
    computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status')
    if (!options.silent) {
      notice.value = { tone: 'ok', text: 'Computer Use 权限状态已重新检测；未操作任何外部 App。' }
    }
  } catch (reason) {
    computerUseStatus.value = null
    if (!options.silent) {
      notice.value = { tone: 'error', text: `无法重新检测 Computer Use：${String(reason)}` }
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
    const label = permission === 'accessibility' ? '辅助功能' : '屏幕录制'
    notice.value = {
      tone: 'ok',
      text: permission === 'screen-recording'
        ? '已打开“屏幕录制”设置；若列表没有 MilkSU，点列表下方“+”并选择 /Applications/MilkSU.app，再开启并按系统提示重新打开。'
        : `已打开“${label}”设置；开启 MilkSU 后回到应用，状态会在重新检测时更新。`,
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法打开 Computer Use 系统权限设置：${String(reason)}` }
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
    notice.value = { tone: 'error', text: `无法重新打开 MilkSU：${String(reason)}` }
  }
}

async function revealLocalData() {
  try {
    await invokeCommand('reveal_local_data_directory')
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法打开本地数据目录：${String(reason)}` }
  }
}

async function revealUserArtifacts() {
  try {
    await invokeCommand('reveal_user_artifact_directory')
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法打开产物目录：${String(reason)}` }
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
      text: `已导出 ${exported.fileCount} 个文件（${formatBytes(exported.bytes)}）；凭据库、浏览器配对令牌和 PI 认证文件未写入备份。`,
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: `备份导出失败：${String(reason)}` }
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
      text: `已验证并暂存 ${restore.fileCount} 个文件（${formatBytes(restore.bytes)}）。关闭并重新打开 MilkSU 后应用；当前数据会保留为回滚快照，凭据与浏览器配对不会被覆盖。`,
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: `备份恢复失败：${String(reason)}` }
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
      text: `诊断包已导出（${formatBytes(exported.bytes)}，${exported.eventCount} 条脱敏运行事件）；不包含会话正文、附件或凭据。`,
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: `诊断包导出失败：${String(reason)}` }
  } finally {
    diagnosticExporting.value = false
  }
}

async function save() {
  if (!working.value) return
  const incompleteCustomProvider = Object.values(working.value.providers).find(item => (
    item.custom && (!item.name?.trim() || !item.base_url?.trim() || !(item.models ?? []).length)
  ))
  if (incompleteCustomProvider) {
    if (!incompleteCustomProvider.name?.trim()) {
      notice.value = { tone: 'error', text: '请填写中转站名称。' }
      return
    }
    if (!incompleteCustomProvider.base_url?.trim()) {
      notice.value = { tone: 'error', text: '请填写中转站 Base URL。' }
      return
    }
    if (!(incompleteCustomProvider.models ?? []).length) {
      notice.value = { tone: 'error', text: '请至少添加一个模型 ID。' }
      return
    }
  }
  saving.value = true
  notice.value = null
  try {
    await invokeCommand('save_settings_cmd', { newSettings: working.value })
    const refreshed = await invokeCommand<AppSettings>('get_settings')
    working.value = cloneSettings(refreshed)
    emit('settingsChange', refreshed)
    if (category.value !== 'apikeys') {
      notice.value = {
        tone: 'ok',
        text: category.value === 'coding' ? 'Skills 设置已保存。' : '设置已保存。',
      }
      return
    }
    verifying.value = true
    try {
      const result = await invokeCommand<ModelProbeResult>('test_agent_model')
      const verifiedSettings = await invokeCommand<AppSettings>('get_settings')
      working.value = cloneSettings(verifiedSettings)
      emit('settingsChange', verifiedSettings)
      notice.value = {
        tone: 'ok',
        text: `已保存并验证 ${result.provider}/${result.model}，PI 响应 ${result.latencyMs} ms。`,
      }
    } catch (reason) {
      notice.value = {
        tone: 'error',
        text: `凭据已保存，但 PI 模型验证失败：${String(reason)}`,
      }
    } finally {
      verifying.value = false
    }
  } catch (reason) {
    const refreshed = await invokeCommand<AppSettings>('get_settings').catch(() => working.value)
    if (refreshed) {
      working.value = cloneSettings(refreshed)
      emit('settingsChange', refreshed)
    }
    const sessionOnly = refreshed && (
      Object.values(refreshed.providers).some(item => item.session_only)
      || refreshed.relay?.session_only
      || refreshed.nssctf_arena?.session_only
    )
    notice.value = { tone: 'error', text: sessionOnly
      ? `${String(reason)} 当前密钥仅保留在本次运行内，退出应用后需要重新输入。`
      : `设置未保存：${String(reason)}` }
  } finally {
    saving.value = false
  }
}

async function saveProviderEditor(closeAfterSave: boolean) {
  await save()
  if (closeAfterSave && notice.value?.tone === 'ok') {
    providerEditorOpen.value = false
  }
}

</script>

<template>
  <main class="settings-page tactical-page flex min-w-0 flex-1 flex-col bg-background">
    <header class="app-drag tactical-command-surface mx-3 mt-3 flex h-16 shrink-0 items-center px-5 text-white">
      <Button variant="ghost" size="icon-sm" class="app-no-drag mr-3" aria-label="返回" @click="$emit('close')">
        <ArrowLeft class="size-4" />
      </Button>
      <p class="text-lg font-semibold tracking-[-0.02em]">
        {{ settingsCategories.find(item => item.value === category)?.label }}
      </p>
    </header>

    <div class="settings-layout flex min-h-0 flex-1">
      <nav class="settings-nav settings-nav-surface tactical-dark-surface app-no-drag w-56 shrink-0 border-r px-3 py-5" aria-label="设置分类">
        <button
          v-for="item in settingsCategories"
          :key="item.value"
          type="button"
          class="settings-nav-item"
          :class="category === item.value ? 'active' : ''"
          :aria-current="category === item.value ? 'page' : undefined"
          @click="category = item.value"
        >
          <component :is="item.icon" class="mr-3 size-4 shrink-0" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-8">
      <div :class="category === 'cve' || category === 'security-tools' ? 'mx-auto w-full max-w-6xl' : category === 'apikeys' ? 'mx-auto w-full max-w-5xl' : 'mx-auto max-w-3xl'">

        <Alert v-if="notice" :variant="notice.tone === 'error' ? 'destructive' : 'default'" class="mb-5">
          <AlertCircle v-if="notice.tone === 'error'" class="size-4" />
          <Check v-else class="size-4" />
          <AlertDescription>{{ notice.text }}</AlertDescription>
        </Alert>

        <template v-if="working && category === 'general'">
          <SettingsSection title="账户">
            <SettingsRow
              label="GitHub 账户"
              :description="account.state === 'active'
                ? `@${account.user?.githubLogin || 'GitHub'} · 内测用户`
                : '登录后可使用管理员分配的模型；不登录也能继续使用自己的 API Key'"
            >
              <div class="flex items-center gap-3">
                <Badge :variant="account.state === 'active' ? 'secondary' : 'outline'">{{ accountStateLabel }}</Badge>
                <Button v-if="account.state === 'active'" variant="ghost" size="sm" @click="$emit('accountLogout')">
                  <LogOut class="size-4" />退出
                </Button>
                <Button v-else-if="account.configured" variant="outline" size="sm" @click="$emit('accountLogin')">
                  <Github class="size-4" />GitHub 登录
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="应用" class="mt-6">
            <SettingsRow label="界面语言" description="M3 MVP 默认使用简体中文">
              <NativeSelect v-model="working.locale" size="sm" aria-label="界面语言">
                <NativeSelectOption value="zh">简体中文</NativeSelectOption>
                <NativeSelectOption value="en">English</NativeSelectOption>
              </NativeSelect>
            </SettingsRow>
            <SettingsRow label="本地优先" description="会话与研究记录保留在本机，凭据不写入设置文件">
              <ShieldCheck class="size-4 text-muted-foreground" />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection title="产物" class="mt-6">
            <SettingsRow
              stack="always"
              label="工作产物"
              description="Coding、CTF 和 CVE 生成的文件放在这里；会话、凭据和运行日志仍保存在应用数据目录"
            >
              <p
                v-if="userArtifacts?.directory"
                class="mb-3 truncate font-mono text-caption text-muted-foreground"
                :title="userArtifacts.directory"
                data-testid="user-artifact-directory"
              >
                {{ userArtifacts.directory }}
              </p>
              <Button variant="outline" size="sm" @click="revealUserArtifacts">
                <FolderOpen class="size-3.5" />
                打开产物目录
              </Button>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection title="本地数据" class="mt-6">
            <SettingsRow
              v-if="recoveryStatus"
              label="启动与退出状态"
              :description="recoveryDescription || '异常退出时会在下次启动提供恢复与诊断入口'"
            >
              <Badge :variant="previousExitVariants[recoveryStatus.previousExit]">
                {{ previousExitLabels[recoveryStatus.previousExit] }}
              </Badge>
            </SettingsRow>
            <SettingsRow
              stack="always"
              label="数据与备份"
              :description="localDataLoading
                ? '正在统计本地数据'
                : localData
                  ? `${localData.fileCount} 个文件 · ${formatBytes(localData.bytes)}`
                  : '会话、训练记录与附件保存在当前用户目录'"
            >
              <p
                v-if="localData?.directory"
                class="mb-3 truncate font-mono text-caption text-muted-foreground"
                :title="localData.directory"
              >
                {{ localData.directory }}
              </p>
              <div class="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" @click="revealLocalData">
                  <FolderOpen class="size-3.5" />
                  打开数据目录
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="backupExporting"
                  @click="exportLocalDataBackup"
                >
                  <Download class="size-3.5" />
                  导出安全备份
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="restoreScheduling"
                  @click="scheduleLocalDataRestore"
                >
                  <RotateCcw class="size-3.5" />
                  从备份恢复
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="diagnosticExporting"
                  @click="exportLocalDiagnostics"
                >
                  <FileWarning class="size-3.5" />
                  导出诊断包
                </Button>
              </div>
              <p class="mt-3 text-caption leading-5 text-muted-foreground">
                备份包含会话、训练记录、附件和一致的 SQLite 快照；恢复会在下次启动前应用，并先保留当前数据的回滚快照。凭据库、浏览器配对令牌和 PI 认证文件不会被导出或覆盖。
              </p>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                诊断包只包含版本、运行状态、数据库健康检查和脱敏错误事件，便于排查启动与连接问题。
              </p>
            </SettingsRow>
            <div v-if="localData?.databases?.length" class="mt-4 min-w-0">
              <p class="text-control font-medium">数据库兼容性</p>
              <ul class="mt-2 flex flex-col gap-3">
                <li
                  v-for="database in localData.databases"
                  :key="database.relativePath"
                  class="min-w-0 rounded-lg border border-border p-3"
                >
                  <div class="flex min-w-0 flex-col items-start gap-y-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
                    <span class="min-w-0 text-control font-medium">{{ database.logicalName }}</span>
                    <Badge :variant="databaseStateVariants[database.state]" class="min-w-0">
                      {{ databaseStateLabels[database.state] }}
                    </Badge>
                    <span
                      v-if="databaseVersionText(database)"
                      class="min-w-0 text-caption text-muted-foreground"
                    >
                      {{ databaseVersionText(database) }}
                    </span>
                  </div>
                  <p
                    class="mt-0.5 break-all font-mono text-caption text-muted-foreground"
                    :title="database.relativePath"
                  >
                    {{ database.relativePath }}
                  </p>
                  <p v-if="database.error" class="break-words text-caption text-destructive">
                    {{ database.error }}
                  </p>
                </li>
              </ul>
            </div>
          </SettingsSection>

          <div class="mt-6 flex justify-end">
            <Button :loading="saving" @click="save">保存设置</Button>
          </div>

          <!-- Bottom of Settings: sealed/package provenance only; never a fake signature. -->
          <SettingsSection title="构建追踪" class="mt-10 border-t border-border pt-6">
            <SettingsRow
              stack="always"
              label="可复制构建追踪"
              description="channel、真实 git branch、完整 40 位 commit、clean/dirty、fingerprint、build time 与 tracking ID。tracking ID 是字段完整性摘要，不是包签名或真实性证明。"
            >
              <div
                v-if="buildTracking"
                class="rounded-xl border border-border bg-muted/30 p-3 font-mono text-caption leading-5 text-foreground"
                aria-label="构建追踪"
                data-testid="build-tracking"
              >
                <pre class="whitespace-pre-wrap break-all">{{ formatBuildTrackingText(buildTracking) }}</pre>
                <div class="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    :loading="buildTrackingCopying"
                    @click="copyBuildTracking"
                  >
                    <Copy class="size-3.5" />
                    复制完整追踪
                  </Button>
                  <Badge
                    v-if="buildTracking.channel === 'beta' && !buildTracking.development"
                    variant="secondary"
                  >
                    BETA
                  </Badge>
                  <Badge v-if="buildTracking.development" variant="outline">development/unpackaged</Badge>
                  <Badge v-else-if="buildTracking.missing" variant="destructive">sealed provenance 缺失</Badge>
                  <Badge v-else-if="buildTracking.dirty" variant="outline">dirty</Badge>
                  <Badge v-else variant="outline">clean</Badge>
                </div>
              </div>
              <p v-else class="text-caption text-muted-foreground">
                未能读取构建追踪。打包检查器应拒绝缺少 sealed provenance 的发行包；开发壳会显示 development/unpackaged。
              </p>
            </SettingsRow>
          </SettingsSection>
        </template>

        <template v-else-if="working && category === 'coding'">
          <SettingsSection title="Skills">
            <SettingsRow
              v-for="skill in CODING_SKILLS"
              :key="skill.name"
              :label="skill.label"
              :description="skill.description"
            >
              <Switch
                :model-value="skillEnabled(skill.name)"
                :aria-label="`启用${skill.label}`"
                @update:model-value="setSkillEnabled(skill.name, Boolean($event))"
              />
            </SettingsRow>
          </SettingsSection>

          <p class="mt-3 text-caption leading-5 text-muted-foreground">
            Pi 只常驻已启用 Skill 的名称和用途，任务匹配或你主动选择后才读取完整内容。保存后从下一条 Coding 消息生效。
          </p>

          <div class="mt-6 flex justify-end">
            <Button :loading="saving" @click="save">保存设置</Button>
          </div>
        </template>

        <template v-else-if="working && category === 'browser'">
          <SettingsSection title="Browser Use（真实用户浏览器）">
            <SettingsRow
              stack="always"
              label="Playwright MCP 官方扩展"
              description="用于 /browser-use；连接现有 Chrome/Edge，并由你在官方连接页选择准确标签页"
            >
              <p class="text-caption leading-5 text-muted-foreground">
                MilkSU 直接复用项目已固定的 Playwright MCP，不保存扩展 Token，也不会把这个入口降级成截图坐标点击。每次新连接仍由浏览器扩展显示可见的标签页授权。
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :loading="browserUseOpening"
                  @click="openPlaywrightBrowserExtension"
                >
                  <ExternalLink class="size-3.5" />
                  安装官方扩展
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="CTF 平台 Bridge" class="mt-6">
            <SettingsRow
              stack="always"
              label="MilkSU 本地扩展连接"
              description="只负责 NSSCTF / CTFshow 的题面、附件和 Judge；不承担通用 Browser Use"
            >
              <div class="flex flex-wrap items-center gap-2">
                <Badge :variant="browserBridgeConnected ? 'secondary' : 'outline'">
                  {{ browserBridgeConnected ? '已连接' : '等待连接' }}
                </Badge>
                <Badge variant="outline">
                  扩展 {{ browserExtensionReady ? '已就绪' : '未就绪' }}
                </Badge>
                <Badge variant="outline">
                  配对码 {{ browserPairingReady ? '已就绪' : '未就绪' }}
                </Badge>
              </div>
              <p class="mt-3 text-caption leading-5 text-muted-foreground">
                安装扩展后，在要授权的浏览器页面点击 MilkSU 并粘贴配对码。配对码仅复制到剪贴板，不在界面显示明文。
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :loading="browserSetupBusy"
                  :disabled="!browserExtensionReady"
                  @click="prepareBrowserExtension"
                >
                  <FolderOpen class="size-3.5" />
                  安装本地扩展
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!browserPairingReady"
                  @click="copyBrowserPairingCode"
                >
                  <Copy class="size-3.5" />
                  复制配对码
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="browserBridgeLoading"
                  @click="refreshBrowserBridgeStatus()"
                >
                  <Cable class="size-3.5" />
                  检测连接
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Computer Use" class="mt-6">
            <SettingsRow
              stack="always"
              label="外部 App 权限"
              :description="computerUsePermissionSummary"
            >
              <div class="flex flex-wrap items-center gap-2">
                <Badge :variant="computerUsePermissionBadge.variant">
                  {{ computerUsePermissionBadge.label }}
                </Badge>
                <Badge variant="outline">
                  辅助功能 {{ computerUseStatus?.permissions.accessibility ? '已授权' : '未授权' }}
                </Badge>
                <Badge variant="outline">
                  屏幕录制 {{ computerUseStatus?.permissions.screenRecording ? '已授权' : '未授权' }}
                </Badge>
              </div>
              <p class="mt-3 break-all text-caption leading-5 text-muted-foreground">
                {{ computerUseSigningLabel }}<template v-if="computerUseSigningDiagnostic">；{{ computerUseSigningDiagnostic }}</template>
              </p>
              <div class="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Computer Use 权限设置">
                <div class="rounded-lg border border-border bg-background/60 p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-body font-medium">辅助功能</p>
                      <p class="mt-1 text-caption leading-5 text-muted-foreground">打开准确设置后开启 MilkSU；系统会记住正式签名身份。</p>
                    </div>
                    <Badge :variant="computerUseStatus?.permissions.accessibility ? 'secondary' : 'outline'">
                      {{ computerUseStatus?.permissions.accessibility ? '已授权' : '待授权' }}
                    </Badge>
                  </div>
                  <Button
                    v-if="!computerUseStatus?.permissions.accessibility"
                    variant="outline"
                    size="sm"
                    class="mt-3"
                    :loading="computerUseRequesting === 'accessibility'"
                    :disabled="!computerUseStatus?.available || Boolean(computerUseRequesting)"
                    @click="requestComputerUsePermission('accessibility')"
                  >
                    <KeyRound class="size-3.5" />
                    打开辅助功能设置
                  </Button>
                </div>
                <div class="rounded-lg border border-border bg-background/60 p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-body font-medium">屏幕录制</p>
                      <p class="mt-1 text-caption leading-5 text-muted-foreground">若列表没有 MilkSU，点下方“+”并选择 /Applications/MilkSU.app；开启后按系统提示重新打开。</p>
                    </div>
                    <Badge :variant="computerUseStatus?.permissions.screenRecording ? 'secondary' : 'outline'">
                      {{ computerUseStatus?.permissions.screenRecording ? '已授权' : '待授权' }}
                    </Badge>
                  </div>
                  <Button
                    v-if="!computerUseStatus?.permissions.screenRecording"
                    variant="outline"
                    size="sm"
                    class="mt-3"
                    :loading="computerUseRequesting === 'screen-recording'"
                    :disabled="!computerUseStatus?.available || Boolean(computerUseRequesting)"
                    @click="requestComputerUsePermission('screen-recording')"
                  >
                    <KeyRound class="size-3.5" />
                    打开屏幕录制设置
                  </Button>
                </div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :loading="computerUseLoading"
                  @click="refreshComputerUseStatus()"
                >
                  <RotateCcw class="size-3.5" />
                  重新检测
                </Button>
                <Button
                  v-if="computerUseStatus && computerUsePermissionsReady"
                  variant="outline"
                  size="sm"
                  :loading="computerUseRestarting"
                  @click="relaunchDesktopApp"
                >
                  <RotateCcw class="size-3.5" />
                  重新打开 MilkSU
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>
        </template>

        <template v-else-if="working && category === 'apikeys'">
          <section class="model-default-row flex items-start gap-8">
            <label for="default-model" class="w-24 shrink-0 text-body font-medium">默认模型</label>
            <div>
              <Select
                id="default-model"
                v-model="defaultModelKey"
              >
                <SelectTrigger
                  id="default-model"
                  size="sm"
                  class="min-w-72"
                  aria-label="默认模型"
                >
                  <SelectValue>{{ defaultModelLabel }}</SelectValue>
                </SelectTrigger>
                <SelectContent size="sm" align="start" class="min-w-96">
                  <SelectGroup v-if="!defaultModelAvailable">
                    <SelectLabel>当前选择</SelectLabel>
                    <SelectItem :value="defaultModelKey" disabled>
                      {{ defaultModelLabel }}（当前不可用）
                    </SelectItem>
                  </SelectGroup>
                  <SelectSeparator v-if="!defaultModelAvailable && availableProviderGroups.length" />
                  <template
                    v-for="(group, groupIndex) in availableProviderGroups"
                    :key="group.kind"
                  >
                    <SelectSeparator v-if="groupIndex > 0" />
                    <SelectGroup>
                      <SelectLabel>{{ group.label }}</SelectLabel>
                      <template v-for="availableProvider in group.providers" :key="availableProvider.id">
                        <SelectItem
                          v-for="model in availableProvider.models"
                          :key="modelSelectionKey(availableProvider.id, model)"
                          :value="modelSelectionKey(availableProvider.id, model)"
                        >
                          {{ availableProviderModelLabel(availableProvider.id, model) }}
                        </SelectItem>
                      </template>
                    </SelectGroup>
                  </template>
                </SelectContent>
              </Select>
              <p v-if="availableModelCount === 0" class="mt-1 text-caption text-muted-foreground">
                没有可用模型；请先连接账户或配置个人 API Key。
              </p>
              <p v-else-if="!defaultModelAvailable" class="mt-1 text-caption text-warning">
                当前默认模型不可用，请选择一个已配置来源的模型。
              </p>
            </div>
          </section>

          <section class="mt-8">
            <div class="flex items-center justify-between gap-4">
              <h2 class="text-title font-semibold">模型服务</h2>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="新增模型服务"
                title="新增自定义中转站"
                @click="addModelService"
              >
                <Plus class="size-4" />
              </Button>
            </div>

            <p class="mt-1 text-caption text-muted-foreground">
              默认模型列表来自下方已启用的服务；Coding 输入框使用同一套列表。
            </p>

            <div class="model-service-list mt-4 overflow-hidden rounded-lg border border-border bg-card">
              <article
                v-for="row in modelServiceRows"
                :key="row.key"
                class="model-service-row grid min-h-20 grid-cols-[48px_minmax(170px,1fr)_minmax(180px,1.1fr)_90px_auto_auto] items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
                :class="serviceIsActiveDefault(row) ? 'model-service-row-primary' : ''"
              >
                <span
                  class="model-service-icon grid size-11 place-items-center rounded-lg border border-border bg-muted/40"
                  :class="serviceIsActiveDefault(row) ? 'text-primary' : 'text-foreground'"
                >
                  <WalletCards v-if="row.source === 'account'" class="size-5" />
                  <Box v-else-if="row.provider.kind === 'relay'" class="size-5" />
                  <KeyRound v-else class="size-5" />
                </span>

                <div class="min-w-0">
                  <p class="truncate font-medium">
                    {{ row.source === 'account' ? 'MilkSU 账户' : providerServiceName(row.provider) }}
                  </p>
                  <p v-if="serviceIsActiveDefault(row)" class="text-caption text-primary">
                    当前默认服务
                  </p>
                </div>

                <p
                  class="truncate text-caption text-muted-foreground"
                  :title="row.source === 'account' ? accountModelsText() : providerModelsText(row.provider)"
                >
                  {{ row.source === 'account' ? accountModelsText() : providerModelsText(row.provider) }}
                </p>

                <span class="text-caption font-medium" :class="serviceStatusClass(row)">
                  {{ serviceStatus(row) }}
                </span>

                <div class="flex items-center justify-end gap-2 whitespace-nowrap text-caption">
                  <template v-if="row.source === 'personal'">
                    <button
                      type="button"
                      class="text-link hover:underline"
                      @click="openProviderEditor(row.provider.id)"
                    >
                      编辑
                    </button>
                    <span class="text-muted-foreground">/</span>
                    <button
                      type="button"
                      class="text-destructive hover:underline"
                      @click="removeModelService(row.provider.id)"
                    >
                      删除
                    </button>
                  </template>
                  <span v-else class="text-muted-foreground">—</span>
                </div>

                <Switch
                  :model-value="row.source === 'account' ? Boolean(accountRoute?.enabled) : Boolean(providerConfig(row.provider.id)?.enabled)"
                  :aria-label="`启用${row.source === 'account' ? 'MilkSU 账户' : providerServiceName(row.provider)}`"
                  @update:model-value="setModelServiceEnabled(row, Boolean($event))"
                />
              </article>
            </div>
          </section>

          <div class="mt-6 flex justify-end">
            <Button :loading="saving || verifying" @click="save">
              {{ verifying ? '正在验证 PI' : '保存并验证' }}
            </Button>
          </div>

          <Dialog v-model:open="providerEditorOpen">
            <DialogContent class="provider-editor-dialog sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>编辑 {{ editingProviderInfo ? providerServiceName(editingProviderInfo) : '模型服务' }}</DialogTitle>
                <DialogDescription class="sr-only">配置这个模型服务的接口地址、凭据和可用模型。</DialogDescription>
              </DialogHeader>

              <div v-if="editingProvider && editingProviderInfo" class="grid gap-4">
                <label v-if="editingProvider.custom" class="provider-editor-field">
                  <span>名称</span>
                  <Input
                    :model-value="editingProvider.name ?? ''"
                    autocomplete="off"
                    placeholder="例如：我的中转站"
                    aria-label="中转站名称"
                    @update:model-value="value => { editingProvider!.name = String(value) }"
                  />
                </label>
                <label v-else class="provider-editor-field">
                  <span>名称</span>
                  <Input :model-value="providerServiceName(editingProviderInfo)" readonly aria-label="名称" />
                </label>

                <label class="provider-editor-field">
                  <span>Base URL</span>
                  <Input
                    :model-value="editingProvider.base_url ?? editingProviderInfo.defaultBaseUrl"
                    type="url"
                    autocomplete="url"
                    :placeholder="editingProviderInfo.defaultBaseUrl"
                    aria-label="Base URL"
                    @update:model-value="value => { editingProvider!.base_url = String(value).trim() }"
                  />
                </label>

                <label class="provider-editor-field">
                  <span>API Key</span>
                  <Input
                    :model-value="editingProvider.api_key"
                    type="password"
                    autocomplete="off"
                    :placeholder="editingProviderInfo.placeholder"
                    aria-label="API Key"
                    @update:model-value="value => {
                      editingProvider!.api_key = String(value)
                      if (value) editingProvider!.session_only = false
                    }"
                  />
                </label>

                <div v-if="editingProvider.custom" class="provider-editor-field items-start">
                  <span class="pt-2">模型 ID</span>
                  <div class="min-w-0">
                    <div class="flex gap-2">
                      <Input
                        v-model="customModelInput"
                        autocomplete="off"
                        placeholder="例如：x-ai/grok-4.6"
                        aria-label="自定义模型 ID"
                        @keydown.enter.prevent="addCustomRelayModel"
                      />
                      <Button variant="outline" @click="addCustomRelayModel">添加</Button>
                    </div>
                    <div v-if="editingProvider.models?.length" class="mt-2 flex flex-wrap gap-2">
                      <span
                        v-for="model in editingProvider.models"
                        :key="model"
                        class="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 font-mono text-caption"
                      >
                        {{ model }}
                        <button type="button" class="text-muted-foreground hover:text-destructive" :aria-label="`移除模型 ${model}`" @click="removeCustomRelayModel(model)">
                          <Trash2 class="size-3.5" />
                        </button>
                      </span>
                    </div>
                  </div>
                </div>

                <label class="provider-editor-field">
                  <span>可用模型</span>
                  <NativeSelect
                    :model-value="editingProviderModel"
                    size="sm"
                    :disabled="editingProviderID !== working.active_provider"
                    aria-label="可用模型"
                    @update:model-value="setEditingProviderModel(String($event))"
                  >
                    <NativeSelectOption v-for="model in editingProviderModels" :key="model" :value="model">
                      {{ modelDisplayLabel(editingProviderInfo.id, model) }}
                    </NativeSelectOption>
                  </NativeSelect>
                </label>

                <p v-if="notice" class="text-caption" :class="notice.tone === 'error' ? 'text-destructive' : 'text-primary'">{{ notice.text }}</p>
              </div>

              <DialogFooter>
                <Button variant="outline" :loading="saving || verifying" @click="saveProviderEditor(false)">测试连接</Button>
                <Button :loading="saving || verifying" @click="saveProviderEditor(true)">保存</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </template>

        <template v-else-if="working && category === 'ctf'">
          <SettingsSection title="NSSCTF Agent Arena">
            <SettingsRow
              stack="always"
              label="Arena Token"
              :description="working.nssctf_arena?.session_only ? '本地数据库写入失败；当前仅在本次运行可用' : working.nssctf_arena?.has_token ? '已保存在本机 SQLite 凭据库' : '保存在本机 SQLite 凭据库，用于真实限时题获取与 Flag 提交'"
            >
              <Input
                :model-value="working.nssctf_arena?.token ?? ''"
                type="password"
                autocomplete="off"
                placeholder="NSSCTF Agent Token"
                @update:model-value="value => {
                  working!.nssctf_arena = {
                    token: String(value),
                    has_token: working!.nssctf_arena?.has_token ?? false,
                    session_only: value ? false : working!.nssctf_arena?.session_only,
                  }
                }"
              />
            </SettingsRow>
          </SettingsSection>
          <div class="mt-6 flex justify-end">
            <Button :loading="saving" @click="save">保存设置</Button>
          </div>
        </template>

        <template v-else-if="category === 'security-tools'">
          <SecurityToolsSettingsPanel
            @coding-handoff="$emit('securityToolCodingHandoff', $event)"
          />
        </template>

        <template v-else-if="category === 'cve'">
          <VulnerabilityIntelSettingsPanel :dashboard="dashboard" />
        </template>
      </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.settings-nav-surface { border-color: color-mix(in srgb, var(--border-hairline) 72%, transparent); background-color: rgb(17 18 15 / .68); background-image: var(--tactical-carbon-image); background-size: 640px 640px; box-shadow: inset -1px 0 0 rgb(255 255 255 / .025); }
.settings-nav-item { position: relative; display: flex; min-height: 3rem; width: 100%; align-items: center; border: 0; background: transparent; padding: 0 1rem; color: var(--muted-foreground); text-align: left; cursor: pointer; }
.settings-nav-item:hover { color: var(--foreground); background: var(--overlay-hover-light); }
.settings-nav-item.active { color: var(--brand); background: var(--focus-panel); }
.settings-nav-item.active::before { position: absolute; inset-block: .55rem; left: 0; width: 3px; background: var(--brand); box-shadow: 0 0 12px color-mix(in srgb, var(--brand) 45%, transparent); content: ''; }
.settings-page :deep([data-slot="settings-section"]),
.settings-page :deep(.rounded-menu-shell) { border-radius: .45rem; }
.model-default-row { min-height: 3.25rem; }
.model-service-row { transition: background-color 120ms ease, border-color 120ms ease; }
.model-service-row:hover { background: var(--overlay-hover-light); }
.model-service-row-primary { box-shadow: inset 3px 0 0 var(--brand); }
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
</style>
