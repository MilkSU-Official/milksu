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
} from '@/types'
import {
  customProviderInfo,
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
import VulnerabilityIntelSettingsPanel from '@/components-vue/VulnerabilityIntelSettingsPanel.vue'
import SecurityToolsSettingsPanel from '@/components-vue/SecurityToolsSettingsPanel.vue'
import ModelVendorIcon from '@/components-vue/ModelVendorIcon.vue'
import type { SecurityToolCodingHandoff } from '@/securityToolsTypes'
import { useVulnerabilityDashboard, type VulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import { CODING_SKILLS } from '@/codingSkills'
import { buildDiagnosticText, isDebugMode, setDebugMode } from '@/lib/debugMode'

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
const buildTracking = ref<BuildTracking | null>(null)
const buildTrackingCopying = ref(false)
const notice = ref<{ tone: 'ok' | 'error'; text: string } | null>(null)
const editingProviderID = ref<string | null>(null)
const customModelInput = ref('')
const pendingCustomRelay = ref<{ id: string; config: ProviderConfig } | null>(null)
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
  pickerGroups: availablePickerGroups,
  providerModelLabel: availableProviderModelLabel,
  pickerModelLabel: availablePickerModelLabel,
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

function matchPickerGroup(providerId: string, model: string): PickerServiceGroup | undefined {
  return availablePickerGroups.value.find(group => (
    group.providerId === providerId && group.models.includes(model)
  ))
}

/** Editor dialog selection key (provider + model only). */
function modelSelectionKey(provider: string, model: string) {
  return encodePickerSelection(provider, model, 'service')
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
    // Selecting a flat group also records which TokenFlux credential path to prefer.
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

/** Keep active_provider/model on an enabled callable service after toggles. */
function alignDefaultModelToEnabledServices() {
  if (!working.value) return
  // Retired official providers (deepseek, …) must never remain the active path.
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

function addModelService() {
  if (!working.value) return
  const count = Object.values(working.value.providers).filter(item => item.custom).length
  if (count >= 8) {
    notice.value = { tone: 'error', text: '最多可以添加 8 个自定义中转站。' }
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
      name: '我的中转站',
      models: [],
    },
  }
  editingProviderID.value = id
  customModelInput.value = ''
  notice.value = null
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
  account.value.state === 'active'
  && account.value.tokenFluxLinked === true,
))
type ModelServiceRow =
  | { key: 'account'; source: 'account'; provider?: undefined }
  | { key: string; source: 'personal'; provider: ProviderInfo }

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
  if (info.id === 'tokenflux') return 'TokenFlux 中转站'
  return info.name
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
  // Highlight rows that currently contribute models to the default picker.
  if (row.source === 'account') {
    return Boolean(accountRoute.value?.enabled && accountModelSourceReady.value)
  }
  return Boolean(providerConfig(row.provider.id)?.enabled
    && (providerConfig(row.provider.id)?.has_api_key || String(providerConfig(row.provider.id)?.api_key ?? '').trim()
      || row.provider.id !== 'tokenflux'))
}

function openProviderEditor(id: string) {
  ensureProviderConfig(id)
  editingProviderID.value = id
  customModelInput.value = ''
  notice.value = null
}

function setEditingProviderModel(value: string) {
  if (!working.value || !editingProviderID.value || !value) return
  // Selecting a model in the service editor also makes that service the default.
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
    // Enabling a service only expands the flat picker; do not force priority order.
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
    localData.value = await invokeCommand<LocalDataStatus>('get_local_data_status')
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

const debugModeOn = ref(isDebugMode())

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
  notice.value = { tone: 'ok', text: '调试诊断已复制到剪贴板。' }
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
const computerUseSigningUnstable = computed(() => Boolean(
  computerUseSigning.value && !computerUseSigning.value.stableIdentity,
))
const computerUsePermissionSummary = computed(() => {
  const status = computerUseStatus.value
  if (!status) return '尚未检测'
  if (!status.available) return status.problem || '当前不可用'
  if (computerUsePermissionsReady.value) return '辅助功能与屏幕录制已授权'
  const missing = computerUseMissingPermissions.value.join('、') || '系统权限'
  if (computerUseSigningUnstable.value) {
    return `${missing} 未生效；当前构建身份不稳定，授权后请重新检测`
  }
  return `${missing} 未授权`
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
      text: `已验证并暂存 ${restore.fileCount} 个文件（${formatBytes(restore.bytes)}）。重新打开 MilkSU 后应用。`,
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

async function refreshCallableModels() {
  await loadModelCatalog()
  alignDefaultModelToEnabledServices()
}

async function save(): Promise<boolean> {
  if (!working.value) return false
  const incompleteCustomProvider = Object.values(working.value.providers).find(item => (
    item.custom && (!item.name?.trim() || !item.base_url?.trim() || !(item.models ?? []).length)
  ))
  if (incompleteCustomProvider) {
    if (!incompleteCustomProvider.name?.trim()) {
      notice.value = { tone: 'error', text: '请填写中转站名称。' }
      return false
    }
    if (!incompleteCustomProvider.base_url?.trim()) {
      notice.value = { tone: 'error', text: '请填写 API 端点（Base URL）。' }
      return false
    }
    if (!(incompleteCustomProvider.models ?? []).length) {
      notice.value = { tone: 'error', text: '请至少添加一个模型 ID 或关键词前缀。' }
      return false
    }
  }
  saving.value = true
  notice.value = null
  try {
    await invokeCommand('save_settings_cmd', { newSettings: working.value })
    const refreshed = await invokeCommand<AppSettings>('get_settings')
    working.value = cloneSettings(refreshed)
    emit('settingsChange', refreshed)
    await refreshCallableModels()
    if (category.value !== 'apikeys') {
      notice.value = {
        tone: 'ok',
        text: category.value === 'coding' ? 'Skills 设置已保存。' : '设置已保存。',
      }
      return true
    }
    // Only probe when the active service can actually start (enabled + key).
    const active = working.value.providers[working.value.active_provider]
    const activeReady = working.value.active_provider === 'tokenflux'
      ? (
        (working.value.relay?.enabled && working.value.relay.has_key)
        || (active?.enabled && (active.has_api_key || String(active.api_key ?? '').trim()))
      )
      : Boolean(active?.enabled && (active.has_api_key || String(active.api_key ?? '').trim()))
    if (!activeReady) {
      notice.value = {
        tone: 'ok',
        text: '设置已保存。当前没有已启用且可用的模型服务，请启用账户或填写 TokenFlux / 自定义中转站后再验证。',
      }
      return true
    }
    verifying.value = true
    try {
      const result = await invokeCommand<ModelProbeResult>('test_agent_model')
      const verifiedSettings = await invokeCommand<AppSettings>('get_settings')
      working.value = cloneSettings(verifiedSettings)
      emit('settingsChange', verifiedSettings)
      await refreshCallableModels()
      notice.value = {
        tone: 'ok',
        text: `已保存并验证 ${result.provider}/${result.model}，PI 响应 ${result.latencyMs} ms。`,
      }
      return true
    } catch (reason) {
      await refreshCallableModels()
      const raw = String(reason)
      const friendly = /both model sources are unavailable|enable the personal API key/i.test(raw)
        ? '凭据已保存，但当前没有可用的账户或个人模型来源。请启用 MilkSU 账户或 TokenFlux 个人 Key 后重试。'
        : `凭据已保存，但 PI 模型验证失败：${raw}`
      notice.value = { tone: 'error', text: friendly }
      return true
    } finally {
      verifying.value = false
    }
  } catch (reason) {
    const refreshed = await invokeCommand<AppSettings>('get_settings').catch(() => working.value)
    if (refreshed) {
      working.value = cloneSettings(refreshed)
      emit('settingsChange', refreshed)
    }
    await refreshCallableModels().catch(() => undefined)
    const sessionOnly = refreshed && (
      Object.values(refreshed.providers).some(item => item.session_only)
      || refreshed.relay?.session_only
      || refreshed.nssctf_arena?.session_only
    )
    notice.value = { tone: 'error', text: sessionOnly
      ? `${String(reason)} 当前密钥仅保留在本次运行内，退出应用后需要重新输入。`
      : `设置未保存：${String(reason)}` }
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
  // Probe the service being edited, not a stale active_provider from old official keys.
  const editing = working.value.providers[editingID]
  if (editing && (editing.has_api_key || String(editing.api_key ?? '').trim() || editingID === 'tokenflux')) {
    working.value.active_provider = editingID
    if (editing.custom && editing.models?.[0]) {
      working.value.active_model = editing.models[0]
    }
    if (editingID === 'tokenflux') {
      // Prefer personal TokenFlux while testing/saving this editor.
      working.value.model_routing.source_order = ['personal', 'account']
      working.value.model_routing.auto_fallback = false
      editing.enabled = true
      if (String(editing.api_key ?? '').trim() || editing.has_api_key) {
        // Keep personal route ready so /v1/models refresh can populate the picker.
        editing.enabled = true
      }
    }
  }
  const persisted = await save()
  // Catalog refresh happens inside save(); re-align default model to new list.
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

</script>

<template>
  <main class="settings-page tactical-page flex min-w-0 flex-1 flex-col bg-background">
    <header class="app-drag settings-page-header flex h-14 shrink-0 items-center border-b border-border bg-[var(--tactical-ink-2)] px-5 text-white">
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
          <SettingsSection title="调试">
            <SettingsRow
              stack="always"
              label="调试模式"
              description="开启后在本机记录应用操作日志与状态（RPC 命令、页面切换、CTF 详情），用于排查偶发问题。日志不出设备，不含 API 密钥等信息。"
            >
              <Switch
                :model-value="debugModeOn"
                :aria-label="'开启调试模式'"
                @update:model-value="value => { debugModeOn = value; setDebugMode(Boolean(value)) }"
              />
            </SettingsRow>
            <div v-if="debugModeOn" class="mt-3">
              <Button variant="outline" size="sm" @click="copyDebugDiagnostics">复制诊断</Button>
            </div>
          </SettingsSection>
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
            <SettingsRow label="界面语言" description="默认简体中文">
              <NativeSelect v-model="working.locale" size="sm" aria-label="界面语言">
                <NativeSelectOption value="zh">简体中文</NativeSelectOption>
                <NativeSelectOption value="en">English</NativeSelectOption>
              </NativeSelect>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection title="产物" class="mt-6">
            <SettingsRow
              stack="always"
              label="工作产物"
              description="Coding、CTF 和 CVE 生成的文件"
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
            </SettingsRow>
            <SettingsRow
              v-if="localData?.databases?.length"
              stack="always"
              label="数据库兼容性"
            >
              <ul class="flex min-w-0 flex-col gap-3">
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
            </SettingsRow>
          </SettingsSection>

          <div class="mt-6 flex justify-end">
            <Button :loading="saving" @click="save">保存设置</Button>
          </div>

          <!-- Bottom of Settings: sealed/package provenance only; never a fake signature. -->
          <SettingsSection title="构建追踪" class="mt-10 border-t border-border pt-6">
            <SettingsRow
              stack="always"
              label="可复制构建追踪"
              description="channel、branch、commit 与 tracking ID"
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
                未能读取构建追踪。
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

          <div class="mt-6 flex justify-end">
            <Button :loading="saving" @click="save">保存设置</Button>
          </div>
        </template>

        <template v-else-if="working && category === 'browser'">
          <SettingsSection title="Browser Use（真实用户浏览器）">
            <SettingsRow
              stack="always"
              label="Playwright MCP 官方扩展"
              description="连接 Chrome/Edge 中你选择的标签页"
            >
              <div class="flex flex-wrap gap-2">
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
              description="NSSCTF / CTFshow 题面、附件与 Judge"
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
              <p
                v-if="!browserBridgeConnected"
                class="mt-3 text-caption leading-5 text-muted-foreground"
              >
                在目标页面打开扩展并粘贴配对码（已复制到剪贴板）。
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
              <p
                v-if="!computerUsePermissionsReady && computerUseSigningLabel"
                class="mt-3 break-all text-caption leading-5 text-muted-foreground"
              >
                {{ computerUseSigningLabel }}
              </p>
              <div
                v-if="!computerUsePermissionsReady"
                class="mt-4 grid gap-3 sm:grid-cols-2"
                aria-label="Computer Use 权限设置"
              >
                <div class="rounded-lg border border-border bg-background/60 p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-body font-medium">辅助功能</p>
                      <p
                        v-if="!computerUseStatus?.permissions.accessibility"
                        class="mt-1 text-caption leading-5 text-muted-foreground"
                      >
                        在系统设置中开启 MilkSU
                      </p>
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
                      <p
                        v-if="!computerUseStatus?.permissions.screenRecording"
                        class="mt-1 text-caption leading-5 text-muted-foreground"
                      >
                        列表没有 MilkSU 时，添加 /Applications/MilkSU.app
                      </p>
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
                  <SelectValue>
                    <span class="inline-flex min-w-0 items-center gap-2">
                      <ModelVendorIcon
                        :model="working?.active_model ?? ''"
                        :label="defaultModelLabel"
                      />
                      <span class="min-w-0 truncate">{{ defaultModelLabel }}</span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent size="sm" align="start" class="min-w-96">
                  <SelectGroup v-if="!defaultModelAvailable && defaultModelKey">
                    <SelectLabel>当前选择</SelectLabel>
                    <SelectItem :value="defaultModelKey" disabled>
                      <span class="inline-flex min-w-0 items-center gap-2">
                        <ModelVendorIcon
                          :model="working?.active_model ?? ''"
                          :label="defaultModelLabel"
                        />
                        <span class="min-w-0 truncate">{{ defaultModelLabel }}（当前不可用）</span>
                      </span>
                    </SelectItem>
                  </SelectGroup>
                  <SelectSeparator v-if="!defaultModelAvailable && availablePickerGroups.length" />
                  <template
                    v-for="(group, groupIndex) in availablePickerGroups"
                    :key="group.key"
                  >
                    <SelectSeparator v-if="groupIndex > 0 || (!defaultModelAvailable && defaultModelKey)" />
                    <SelectGroup>
                      <SelectLabel>{{ group.label }}</SelectLabel>
                      <SelectItem
                        v-for="model in group.models"
                        :key="`${group.key}:${model}`"
                        :value="encodePickerSelection(group.providerId, model, group.source)"
                      >
                        <span class="inline-flex min-w-0 items-center gap-2">
                          <ModelVendorIcon
                            :model="model"
                            :label="availablePickerModelLabel(group, model)"
                          />
                          <span class="min-w-0 truncate">{{ availablePickerModelLabel(group, model) }}</span>
                        </span>
                      </SelectItem>
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
                  <p
                    v-if="row.source === 'account'"
                    class="mt-0.5 text-caption text-muted-foreground"
                  >
                    登录后由管理员分配的 TokenFlux 配额
                  </p>
                  <p
                    v-else-if="row.provider.id === 'tokenflux'"
                    class="mt-0.5 text-caption text-muted-foreground"
                  >
                    你自己的 TokenFlux API Key
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
                <label class="provider-editor-field">
                  <span>API 端点</span>
                  <Input
                    :model-value="editingProvider.base_url ?? editingProviderInfo.defaultBaseUrl"
                    type="url"
                    autocomplete="url"
                    :placeholder="editingProviderInfo.defaultBaseUrl || 'https://example.com/v1'"
                    aria-label="API 端点"
                    @update:model-value="value => { editingProvider!.base_url = String(value).trim() }"
                  />
                </label>

                <label v-if="editingProvider.custom" class="provider-editor-field">
                  <span>自定义名字</span>
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

                <div v-if="editingProvider.custom" class="provider-editor-field items-start">
                  <span class="pt-2">模型 / 前缀</span>
                  <div class="min-w-0">
                    <div class="flex gap-2">
                      <Input
                        v-model="customModelInput"
                        autocomplete="off"
                        placeholder="例如：grok-4.5 或 openai/gpt-5"
                        aria-label="模型 ID 或关键词前缀"
                        @keydown.enter.prevent="addCustomRelayModel"
                      />
                      <Button variant="outline" @click="addCustomRelayModel">添加</Button>
                    </div>
                    <p class="mt-1 text-caption text-muted-foreground">
                      填写完整模型 ID，或可匹配的关键词前缀。
                    </p>
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

                <label v-if="!editingProvider.custom" class="provider-editor-field items-start">
                  <span class="pt-2">可用模型</span>
                  <div class="min-w-0">
                    <Select
                      :model-value="editingProviderModels.length
                        ? modelSelectionKey(editingProviderInfo.id, editingProviderModel || editingProviderModels[0] || '')
                        : ''"
                      @update:model-value="value => {
                        const selection = parseModelSelectionKey(String(value ?? ''))
                        if (!selection) return
                        setEditingProviderModel(selection[1])
                      }"
                    >
                      <SelectTrigger
                        size="sm"
                        class="min-w-72"
                        :disabled="!editingProviderModels.length"
                        aria-label="可用模型"
                      >
                        <SelectValue>
                          {{ editingProviderModels.length
                            ? modelDisplayLabel(
                              editingProviderInfo.id,
                              editingProviderModel || editingProviderModels[0] || '',
                            )
                            : '测试连接后显示可用模型' }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent size="sm" align="start" class="min-w-96">
                        <SelectGroup>
                          <SelectLabel>{{ providerServiceName(editingProviderInfo) }}</SelectLabel>
                          <SelectItem
                            v-for="model in editingProviderModels"
                            :key="modelSelectionKey(editingProviderInfo.id, model)"
                            :value="modelSelectionKey(editingProviderInfo.id, model)"
                          >
                            {{ modelDisplayLabel(editingProviderInfo.id, model) }}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <p
                      v-if="!editingProviderModels.length"
                      class="mt-1 text-caption text-muted-foreground"
                    >
                      填写 API Key 后点「测试连接」，可用模型会与默认模型列表同步刷新。
                    </p>
                  </div>
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
