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
  Archive,
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
  FlaskConical,
  FolderOpen,
  Gauge,
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
import { desktopErrorMessage, invokeCommand } from '@/desktop'
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
  ModelThinkingConfig,
  ModelThinkingLevel,
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
import EvalSettingsPanel from '@/components-vue/EvalSettingsPanel.vue'
import LabSettingsPanel from '@/components-vue/LabSettingsPanel.vue'
import ModelVendorIcon from '@/components-vue/ModelVendorIcon.vue'
import ArchivedConversationsSettings from '@/components-vue/ArchivedConversationsSettings.vue'
import type { SecurityToolCodingHandoff } from '@/securityToolsTypes'
import { useVulnerabilityDashboard, type VulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import { CODING_SKILLS } from '@/codingSkills'
import {
  EXTERNAL_EDITORS,
  normalizePreferredExternalEditor,
} from '@/lib/externalEditor'
import ExternalEditorIcon from '@/components-vue/ExternalEditorIcon.vue'
import { buildDiagnosticText, isDebugMode, setDebugMode } from '@/lib/debugMode'
import { applyUiLocale, normalizeUiLocale, t } from '@/lib/uiLocale'
import {
  builtInModelThinking,
  MODEL_THINKING_LEVEL_LABELS,
  MODEL_THINKING_LEVELS,
  normalizeModelThinkingConfig,
  resolveModelThinking,
} from '@/lib/modelThinking'

type SettingsCategory = 'general' | 'apikeys' | 'ctf' | 'cve' | 'lab' | 'coding' | 'chats' | 'browser' | 'security-tools' | 'eval'

const settingsCategories = computed(() => [
  { value: 'general' as const, label: t('通用', 'General'), icon: Settings2 },
  { value: 'apikeys' as const, label: t('模型', 'Models'), icon: Box },
  { value: 'ctf' as const, label: 'CTF', icon: Flag },
  { value: 'cve' as const, label: 'CVE', icon: Bug },
  { value: 'lab' as const, label: 'Lab', icon: FlaskConical },
  { value: 'coding' as const, label: 'Coding', icon: Code2 },
  { value: 'chats' as const, label: t('归档聊天', 'Archived chats'), icon: Archive },
  { value: 'browser' as const, label: t('浏览器控制', 'Browser'), icon: Globe2 },
  { value: 'security-tools' as const, label: t('安全工具', 'Security tools'), icon: ShieldCheck },
  { value: 'eval' as const, label: t('评测', 'Eval'), icon: Gauge },
])

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
  conversationsChanged: []
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

const databaseStateVariants: Record<DatabaseCompatibilityState, 'secondary' | 'destructive' | 'outline'> = {
  compatible: 'secondary',
  missing: 'outline',
  newer: 'destructive',
  corrupt: 'destructive',
  remaining: 'outline',
}

function databaseVersionText(database: DatabaseCompatibilityStatus): string {
  const parts: string[] = []
  if (database.current !== undefined) parts.push(t(`当前 v${database.current}`, `current v${database.current}`))
  if (database.supported !== undefined) parts.push(t(`支持 v${database.supported}`, `supported v${database.supported}`))
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
    applyUiLocale(working.value.locale)
  }
}, { immediate: true })
watch(() => props.initialCategory, value => {
  category.value = value
  notice.value = null
})
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

function selectCategory(value: SettingsCategory) {
  category.value = value
  notice.value = null
}

async function changeLocale(value: unknown) {
  if (!working.value) return
  working.value.locale = normalizeUiLocale(value)
  applyUiLocale(working.value.locale)
  await save()
}

async function loadUserArtifactDirectory() {
  try {
    userArtifacts.value = await invokeCommand<UserArtifactDirectoryStatus>('get_user_artifact_directory_status')
  } catch (reason) {
    notice.value = { tone: 'error', text: t(`无法读取产物目录：${String(reason)}`, `Could not read the artifacts folder: ${String(reason)}`) }
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

const thinkingModelKey = ref('')
const thinkingModelSelection = computed(() => (
  parsePickerSelection(thinkingModelKey.value)
))
const thinkingModelProvider = computed(() => thinkingModelSelection.value?.providerId ?? '')
const thinkingModelID = computed(() => thinkingModelSelection.value?.model ?? '')
const thinkingModelLabel = computed(() => {
  const selection = thinkingModelSelection.value
  if (!selection) return t('选择模型', 'Select a model')
  const group = availablePickerGroups.value.find(item => (
    item.providerId === selection.providerId
    && item.models.includes(selection.model)
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

function setThinkingOverride(config: ModelThinkingConfig) {
  if (!working.value || !thinkingModelProvider.value || !thinkingModelID.value) return
  const provider = thinkingModelProvider.value
  working.value.model_thinking = {
    ...(working.value.model_thinking ?? {}),
    [provider]: {
      ...(working.value.model_thinking?.[provider] ?? {}),
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
  const provider = thinkingModelProvider.value
  const models = { ...working.value.model_thinking[provider] }
  delete models[thinkingModelID.value]
  const modelThinking = { ...working.value.model_thinking }
  if (Object.keys(models).length) modelThinking[provider] = models
  else delete modelThinking[provider]
  working.value.model_thinking = Object.keys(modelThinking).length ? modelThinking : undefined
}

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
  void save()
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

/** After a custom relay is removed or disabled, do not park its model IDs on TokenFlux. */
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

function serviceStatusClass(row: ModelServiceRow): string {
  const status = serviceStatus(row)
  if (status === t('已启用', 'Enabled')) return 'text-primary'
  if (status === t('未配置', 'Not configured') || status === t('未连接', 'Not connected')) return 'text-warning'
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
  localDataLoading.value = true
  try {
    localData.value = await invokeCommand<LocalDataStatus>('get_local_data_status')
  } catch (reason) {
    notice.value = { tone: 'error', text: t(`无法读取本地数据状态：${String(reason)}`, `Could not read local data status: ${String(reason)}`) }
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
const computerUseMissingPermissions = computed(() => {
  const missing: string[] = []
  if (!computerUseStatus.value?.permissions.accessibility) missing.push(t('辅助功能', 'Accessibility'))
  if (!computerUseStatus.value?.permissions.screenRecording) missing.push(t('屏幕录制', 'Screen Recording'))
  return missing
})
const computerUseSigning = computed<CodingComputerUseSigning | null>(() => (
  computerUseStatus.value?.signing ?? null
))
const computerUseSigningLabel = computed(() => {
  const signing = computerUseSigning.value
  if (!signing) return t('当前构建身份：未检测', 'Current build identity: not detected')
  const signature = signing.signature === 'adhoc'
    ? 'ad-hoc'
    : signing.signature === 'signed'
      ? t('已签名', 'signed')
      : signing.signature || t('未知签名', 'unknown signature')
  const team = signing.teamIdentifier && signing.teamIdentifier !== 'not set'
    ? signing.teamIdentifier
    : t('未设置', 'not set')
  return t(`当前构建身份：${signature} · Team ${team}`, `Current build identity: ${signature} · Team ${team}`)
})
const computerUseSigningUnstable = computed(() => Boolean(
  computerUseSigning.value && !computerUseSigning.value.stableIdentity,
))
const computerUsePermissionSummary = computed(() => {
  const status = computerUseStatus.value
  if (!status) return t('尚未检测', 'Not checked yet')
  if (!status.available) return status.problem || t('当前不可用', 'Currently unavailable')
  if (computerUsePermissionsReady.value) return t('辅助功能与屏幕录制已授权', 'Accessibility and Screen Recording are granted')
  const missing = computerUseMissingPermissions.value.join(t('、', ', ')) || t('系统权限', 'system permissions')
  if (computerUseSigningUnstable.value) {
    return t(`${missing} 未生效；当前构建身份不稳定，授权后请重新检测`, `${missing} not in effect; this build identity is unstable. Recheck after granting access`)
  }
  return t(`${missing} 未授权`, `${missing} not granted`)
})
const computerUsePermissionBadge = computed(() => {
  if (!computerUseStatus.value) return { label: t('未检测', 'Not checked'), variant: 'outline' as const }
  if (!computerUseStatus.value.available) return { label: t('不可用', 'Unavailable'), variant: 'destructive' as const }
  if (computerUsePermissionsReady.value) return { label: t('已授权', 'Granted'), variant: 'secondary' as const }
  return { label: t('需处理', 'Needs attention'), variant: 'outline' as const }
})

const browserBridgeConnected = computed(() => Boolean(browserBridgeStatus.value?.bridge.connected))
const browserPairingReady = computed(() => Boolean(browserBridgeStatus.value?.bridge.pairingCode))
const browserExtensionReady = computed(() => Boolean(browserBridgeStatus.value?.bridge.extensionPath))

async function refreshBrowserBridgeStatus(options: { silent?: boolean } = {}) {
  browserBridgeLoading.value = true
  try {
    browserBridgeStatus.value = await invokeCommand<NSSCTFWebBridgeStatus>('get_nssctf_web_bridge_status')
    if (!options.silent) {
      notice.value = { tone: 'ok', text: t('浏览器 Bridge 状态已重新检测。', 'Browser bridge status rechecked.') }
    }
  } catch (reason) {
    browserBridgeStatus.value = null
    if (!options.silent) {
      notice.value = { tone: 'error', text: t(`无法检测浏览器 Bridge：${String(reason)}`, `Could not check the browser bridge: ${String(reason)}`) }
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
      text: t('Chrome 扩展页和 MilkSU 扩展目录已打开；加载后回到这里复制配对码。', 'Chrome extensions and the MilkSU extension folder are open. Load the extension, then come back here to copy the pairing code.'),
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
      text: t('已在浏览器打开 Playwright MCP 官方扩展页面。', 'Opened the official Playwright MCP extension page in the browser.'),
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: t(`无法打开 Playwright MCP 官方扩展：${String(reason)}`, `Could not open the official Playwright MCP extension: ${String(reason)}`) }
  } finally {
    browserUseOpening.value = false
  }
}

async function copyBrowserPairingCode() {
  const pairingCode = browserBridgeStatus.value?.bridge.pairingCode
  if (!pairingCode) return
  try {
    await navigator.clipboard.writeText(pairingCode)
    notice.value = { tone: 'ok', text: t('本机浏览器配对码已复制。', 'Browser pairing code copied.') }
  } catch (reason) {
    notice.value = { tone: 'error', text: t(`无法复制浏览器配对码：${String(reason)}`, `Could not copy the browser pairing code: ${String(reason)}`) }
  }
}

async function refreshComputerUseStatus(options: { silent?: boolean } = {}) {
  computerUseLoading.value = true
  try {
    computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status')
    if (!options.silent) {
      notice.value = { tone: 'ok', text: t('Computer Use 权限状态已重新检测；未操作任何外部 App。', 'Computer Use permission status rechecked. No external app was controlled.') }
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
      text: permission === 'screen-recording'
        ? t('已打开“屏幕录制”设置；若列表没有 MilkSU，点列表下方“+”并选择 /Applications/MilkSU.app，再开启并按系统提示重新打开。', 'Opened Screen Recording settings. If MilkSU is missing, click + under the list, choose /Applications/MilkSU.app, enable it, then reopen when macOS asks.')
        : t(`已打开“${label}”设置；开启 MilkSU 后回到应用，状态会在重新检测时更新。`, `Opened ${label} settings. Enable MilkSU, then return here; status updates on the next check.`),
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

async function revealUserArtifacts() {
  try {
    await invokeCommand('reveal_user_artifact_directory')
  } catch (reason) {
    notice.value = { tone: 'error', text: t(`无法打开产物目录：${String(reason)}`, `Could not open the artifacts folder: ${String(reason)}`) }
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
  try {
    await invokeCommand('save_settings_cmd', { newSettings: working.value })
    const refreshed = await invokeCommand<AppSettings>('get_settings')
    working.value = cloneSettings(refreshed)
    emit('settingsChange', refreshed)
    await refreshCallableModels()
    if (category.value !== 'apikeys') {
      if (!options?.quiet) {
        notice.value = {
          tone: 'ok',
          text: t('设置已保存。', 'Settings saved.'),
        }
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
        text: t('设置已保存。当前没有已启用且可用的模型服务，请启用账户或填写 TokenFlux / 自定义中转站后再验证。', 'Settings saved. No enabled model service is ready yet. Enable the account or add a TokenFlux / custom relay, then verify.'),
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
        text: t(`已保存并验证 ${result.provider}/${result.model}，PI 响应 ${result.latencyMs} ms。`, `Saved and verified ${result.provider}/${result.model}. Pi responded in ${result.latencyMs} ms.`),
      }
      return true
    } catch (reason) {
      await refreshCallableModels()
      const raw = desktopErrorMessage(reason)
      const friendly = /both model sources are unavailable|enable the personal API key/i.test(raw)
        ? t('凭据已保存，但当前没有可用的账户或个人模型来源。请启用 MilkSU 账户或 TokenFlux 个人 Key 后重试。', 'Credentials saved, but no account or personal model source is available. Enable the MilkSU account or a personal TokenFlux key, then try again.')
        : t(`凭据已保存，但 PI 模型验证失败：${raw}`, `Credentials saved, but Pi model verification failed: ${raw}`)
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
    <header class="app-drag settings-page-header flex h-14 shrink-0 items-center border-b border-border bg-background px-5 text-foreground">
      <Button variant="ghost" size="icon-sm" class="app-no-drag mr-3" :aria-label="t('返回', 'Back')" @click="$emit('close')">
        <ArrowLeft class="size-4" />
      </Button>
      <p class="text-lg font-semibold tracking-[-0.02em]">
        {{ settingsCategories.find(item => item.value === category)?.label }}
      </p>
    </header>

    <div class="settings-layout flex min-h-0 flex-1">
      <nav class="settings-nav settings-nav-surface app-no-drag w-56 shrink-0 border-r px-3 py-5" :aria-label="t('设置分类', 'Settings categories')">
        <div class="ak-tabs settings-ak-tabs">
          <div class="ak-tabs__list">
            <button
              v-for="item in settingsCategories"
              :key="item.value"
              type="button"
              class="ak-tabs__tab settings-nav-item"
              :class="category === item.value ? 'active' : ''"
              :aria-selected="category === item.value"
              :aria-current="category === item.value ? 'page' : undefined"
              @click="selectCategory(item.value)"
            >
              <component :is="item.icon" class="mr-3 size-4 shrink-0" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </div>
      </nav>

      <div class="page-scroll min-w-0 flex-1">
      <div class="page-column page-stack">

        <Alert v-if="notice" :variant="notice.tone === 'error' ? 'destructive' : 'default'">
          <AlertCircle v-if="notice.tone === 'error'" class="size-4" />
          <Check v-else class="size-4" />
          <AlertDescription>{{ notice.text }}</AlertDescription>
        </Alert>

        <template v-if="working && category === 'general'">
          <SettingsSection :title="t('账户', 'Account')">
            <SettingsRow
              :label="t('GitHub 账户', 'GitHub account')"
              :description="account.state === 'active'
                ? `@${account.user?.githubLogin || 'GitHub'} · ${t('内测用户', 'beta user')}`
                : ''"
            >
              <div class="flex items-center gap-3">
                <Badge :variant="account.state === 'active' ? 'secondary' : 'outline'">{{ accountStateLabel }}</Badge>
                <Button v-if="account.state === 'active'" variant="ghost" size="sm" @click="$emit('accountLogout')">
                  <LogOut class="size-4" />{{ t('退出', 'Sign out') }}
                </Button>
                <Button v-else-if="account.configured" variant="outline" size="sm" @click="$emit('accountLogin')">
                  <Github class="size-4" />{{ t('GitHub 登录', 'GitHub sign-in') }}
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection :title="t('应用', 'App')">
            <SettingsRow :label="t('界面语言', 'Interface language')">
              <NativeSelect
                :model-value="working.locale ?? 'zh'"
                size="sm"
                :aria-label="t('界面语言', 'Interface language')"
                @update:model-value="changeLocale($event)"
              >
                <NativeSelectOption value="zh">{{ t('简体中文', 'Simplified Chinese') }}</NativeSelectOption>
                <NativeSelectOption value="en">English</NativeSelectOption>
              </NativeSelect>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection :title="t('产物', 'Artifacts')">
            <SettingsRow
              stack="always"
              :label="t('工作产物', 'Work artifacts')"
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
                {{ t('打开产物目录', 'Open artifacts folder') }}
              </Button>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection :title="t('本地数据', 'Local data')">
            <SettingsRow
              stack="always"
              :label="t('数据与备份', 'Data and backups')"
              :description="localDataLoading
                ? t('正在统计本地数据', 'Counting local data')
                : localData
                  ? t(`${localData.fileCount} 个文件 · ${formatBytes(localData.bytes)}`, `${localData.fileCount} files · ${formatBytes(localData.bytes)}`)
                  : ''"
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
                  {{ t('打开数据目录', 'Open data folder') }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="backupExporting"
                  @click="exportLocalDataBackup"
                >
                  <Download class="size-3.5" />
                  {{ t('导出安全备份', 'Export a safe backup') }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="restoreScheduling"
                  @click="scheduleLocalDataRestore"
                >
                  <RotateCcw class="size-3.5" />
                  {{ t('从备份恢复', 'Restore from backup') }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="diagnosticExporting"
                  @click="exportLocalDiagnostics"
                >
                  <FileWarning class="size-3.5" />
                  {{ t('导出诊断包', 'Export diagnostics') }}
                </Button>
              </div>
            </SettingsRow>
            <SettingsRow
              v-if="localData?.databases?.length"
              stack="always"
              :label="t('数据库兼容性', 'Database compatibility')"
            >
              <ul class="flex min-w-0 flex-col gap-3">
                <li
                  v-for="database in localData.databases"
                  :key="database.relativePath"
                  class="min-w-0 rounded-lg border border-border bg-muted/30 p-3"
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

          <!-- Bottom of Settings: sealed/package provenance only; never a fake signature. -->
          <SettingsSection :title="t('构建追踪', 'Build tracking')" class="border-t border-border pt-6">
            <SettingsRow
              stack="always"
              :label="t('可复制构建追踪', 'Copyable build tracking')"
            >
              <div
                v-if="buildTracking"
                class="rounded-xl border border-border bg-muted/30 p-3 font-mono text-caption leading-5 text-foreground"
                :aria-label="t('构建追踪', 'Build tracking')"
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
                    {{ t('复制完整追踪', 'Copy full tracking') }}
                  </Button>
                  <Badge
                    v-if="buildTracking.channel === 'beta' && !buildTracking.development"
                    variant="secondary"
                  >
                    BETA
                  </Badge>
                  <Badge v-if="buildTracking.development" variant="outline">development/unpackaged</Badge>
                  <Badge v-else-if="buildTracking.missing" variant="destructive">{{ t('sealed provenance 缺失', 'sealed provenance missing') }}</Badge>
                  <Badge v-else-if="buildTracking.dirty" variant="outline">dirty</Badge>
                  <Badge v-else variant="outline">clean</Badge>
                </div>
              </div>
              <p v-else class="text-caption text-muted-foreground">
                {{ t('未能读取构建追踪。', 'Could not read build tracking.') }}
              </p>
            </SettingsRow>
            <SettingsRow
              :label="t('调试模式', 'Debug mode')"
              :divider="false"
            >
              <div class="flex items-center gap-2">
                <Button
                  v-if="debugModeOn"
                  variant="ghost"
                  size="sm"
                  @click="copyDebugDiagnostics"
                >
                  {{ t('复制诊断', 'Copy diagnostics') }}
                </Button>
                <Switch
                  :model-value="debugModeOn"
                  :aria-label="t('开启调试模式', 'Turn on debug mode')"
                  @update:model-value="value => { debugModeOn = value; setDebugMode(Boolean(value)) }"
                />
              </div>
            </SettingsRow>
          </SettingsSection>
        </template>

        <template v-else-if="working && category === 'coding'">
          <SettingsSection :title="t('编辑器', 'Editor')">
            <SettingsRow :label="t('打开文件', 'Open files')">
              <div class="flex items-center gap-2">
                <ExternalEditorIcon :editor="working.preferred_external_editor" />
                <NativeSelect
                  :model-value="normalizePreferredExternalEditor(working.preferred_external_editor)"
                  size="sm"
                  :aria-label="t('打开文件的编辑器', 'Editor for opening files')"
                  @update:model-value="working.preferred_external_editor = String($event); void save()"
                >
                  <NativeSelectOption
                    v-for="editor in EXTERNAL_EDITORS"
                    :key="editor.id"
                    :value="editor.id"
                  >
                    {{ editor.label }}
                  </NativeSelectOption>
                </NativeSelect>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Skills">
            <SettingsRow
              v-for="skill in CODING_SKILLS"
              :key="skill.name"
              :label="skill.label"
              :description="skill.description"
            >
              <Switch
                :model-value="skillEnabled(skill.name)"
                :aria-label="t(`启用${skill.label}`, `Enable ${skill.label}`)"
                @update:model-value="setSkillEnabled(skill.name, Boolean($event))"
              />
            </SettingsRow>
          </SettingsSection>
        </template>

        <template v-else-if="category === 'chats'">
          <SettingsSection :title="t('归档聊天', 'Archived chats')">
            <ArchivedConversationsSettings @changed="$emit('conversationsChanged')" />
          </SettingsSection>
        </template>

        <template v-else-if="working && category === 'browser'">
          <SettingsSection :title="t('Browser Use（真实用户浏览器）', 'Browser Use (your real browser)')">
            <SettingsRow
              stack="always"
              :label="t('Playwright MCP 官方扩展', 'Official Playwright MCP extension')"
            >
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :loading="browserUseOpening"
                  @click="openPlaywrightBrowserExtension"
                >
                  <ExternalLink class="size-3.5" />
                  {{ t('安装官方扩展', 'Install the official extension') }}
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection :title="t('CTF 平台 Bridge', 'CTF platform bridge')">
            <SettingsRow
              stack="always"
              :label="t('MilkSU 本地扩展连接', 'MilkSU local extension connection')"
            >
              <div class="flex flex-wrap items-center gap-2">
                <Badge :variant="browserBridgeConnected ? 'secondary' : 'outline'">
                  {{ browserBridgeConnected ? t('已连接', 'Connected') : t('等待连接', 'Waiting to connect') }}
                </Badge>
                <Badge variant="outline">
                  {{ t('扩展', 'Extension') }} {{ browserExtensionReady ? t('已就绪', 'ready') : t('未就绪', 'not ready') }}
                </Badge>
                <Badge variant="outline">
                  {{ t('配对码', 'Pairing code') }} {{ browserPairingReady ? t('已就绪', 'ready') : t('未就绪', 'not ready') }}
                </Badge>
              </div>
              <p
                v-if="!browserBridgeConnected"
                class="mt-3 text-caption leading-5 text-muted-foreground"
              >
                {{ t('在目标页面打开扩展并粘贴配对码（已复制到剪贴板）。', 'Open the extension on the target page and paste the pairing code (already copied).') }}
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
                  {{ t('安装本地扩展', 'Install the local extension') }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!browserPairingReady"
                  @click="copyBrowserPairingCode"
                >
                  <Copy class="size-3.5" />
                  {{ t('复制配对码', 'Copy pairing code') }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="browserBridgeLoading"
                  @click="refreshBrowserBridgeStatus()"
                >
                  <Cable class="size-3.5" />
                  {{ t('检测连接', 'Check connection') }}
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Computer Use">
            <SettingsRow
              stack="always"
              :label="t('外部 App 权限', 'External app permissions')"
              :description="computerUsePermissionSummary"
            >
              <div class="flex flex-wrap items-center gap-2">
                <Badge :variant="computerUsePermissionBadge.variant">
                  {{ computerUsePermissionBadge.label }}
                </Badge>
                <Badge variant="outline">
                  {{ t('辅助功能', 'Accessibility') }} {{ computerUseStatus?.permissions.accessibility ? t('已授权', 'granted') : t('未授权', 'not granted') }}
                </Badge>
                <Badge variant="outline">
                  {{ t('屏幕录制', 'Screen Recording') }} {{ computerUseStatus?.permissions.screenRecording ? t('已授权', 'granted') : t('未授权', 'not granted') }}
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
                :aria-label="t('Computer Use 权限设置', 'Computer Use permission settings')"
              >
                <div class="rounded-lg border border-border bg-muted/30 p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-body font-medium">{{ t('辅助功能', 'Accessibility') }}</p>
                      <p
                        v-if="!computerUseStatus?.permissions.accessibility"
                        class="mt-1 text-caption leading-5 text-muted-foreground"
                      >
                        {{ t('在系统设置中开启 MilkSU', 'Enable MilkSU in System Settings') }}
                      </p>
                    </div>
                    <Badge :variant="computerUseStatus?.permissions.accessibility ? 'secondary' : 'outline'">
                      {{ computerUseStatus?.permissions.accessibility ? t('已授权', 'Granted') : t('待授权', 'Needs access') }}
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
                    {{ t('打开辅助功能设置', 'Open Accessibility settings') }}
                  </Button>
                </div>
                <div class="rounded-lg border border-border bg-muted/30 p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-body font-medium">{{ t('屏幕录制', 'Screen Recording') }}</p>
                      <p
                        v-if="!computerUseStatus?.permissions.screenRecording"
                        class="mt-1 text-caption leading-5 text-muted-foreground"
                      >
                        {{ t('列表没有 MilkSU 时，添加 /Applications/MilkSU.app', 'If MilkSU is missing from the list, add /Applications/MilkSU.app') }}
                      </p>
                    </div>
                    <Badge :variant="computerUseStatus?.permissions.screenRecording ? 'secondary' : 'outline'">
                      {{ computerUseStatus?.permissions.screenRecording ? t('已授权', 'Granted') : t('待授权', 'Needs access') }}
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
                    {{ t('打开屏幕录制设置', 'Open Screen Recording settings') }}
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
                  {{ t('重新检测', 'Recheck') }}
                </Button>
                <Button
                  v-if="computerUseStatus && computerUsePermissionsReady"
                  variant="outline"
                  size="sm"
                  :loading="computerUseRestarting"
                  @click="relaunchDesktopApp"
                >
                  <RotateCcw class="size-3.5" />
                  {{ t('重新打开 MilkSU', 'Reopen MilkSU') }}
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>
        </template>

        <template v-else-if="working && category === 'apikeys'">
          <SettingsSection :title="t('调用', 'Invocation')">
            <div class="settings-focus-row">
              <SettingsRow
                :label="t('默认模型', 'Default model')"
                :description="!defaultModelAvailable && availableModelCount > 0
                  ? t('当前默认模型不可用', 'The current default model is unavailable')
                  : ''"
              >
              <Select
                id="default-model"
                v-model="defaultModelKey"
              >
                <SelectTrigger
                  id="default-model"
                  size="sm"
                  class="w-72 max-w-full"
                  :aria-label="t('默认模型', 'Default model')"
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
                    <SelectLabel>{{ t('当前选择', 'Current selection') }}</SelectLabel>
                    <SelectItem :value="defaultModelKey" disabled>
                      <span class="inline-flex min-w-0 items-center gap-2">
                        <ModelVendorIcon
                          :model="working?.active_model ?? ''"
                          :label="defaultModelLabel"
                        />
                        <span class="min-w-0 truncate">{{ t(`${defaultModelLabel}（当前不可用）`, `${defaultModelLabel} (unavailable)`) }}</span>
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
              </SettingsRow>
            </div>
          </SettingsSection>

          <section>
            <div class="flex items-center justify-between gap-4">
              <h2 class="text-title font-semibold">{{ t('模型服务', 'Model services') }}</h2>
              <Button
                variant="outline"
                size="icon-sm"
                :aria-label="t('新增模型服务', 'Add a model service')"
                :title="t('新增自定义中转站', 'Add a custom relay')"
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
                    {{ row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : providerServiceName(row.provider) }}
                  </p>
                  <p
                    v-if="row.source === 'account'"
                    class="mt-0.5 text-caption text-muted-foreground"
                  >
                    {{ t('登录后由管理员分配的 TokenFlux 配额', 'TokenFlux quota assigned by an admin after sign-in') }}
                  </p>
                  <p
                    v-else-if="row.provider.id === 'tokenflux'"
                    class="mt-0.5 text-caption text-muted-foreground"
                  >
                    {{ t('你自己的 TokenFlux API Key', 'Your own TokenFlux API key') }}
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
                      {{ t('编辑', 'Edit') }}
                    </button>
                    <span class="text-muted-foreground">/</span>
                    <button
                      type="button"
                      class="text-destructive hover:underline"
                      @click="removeModelService(row.provider.id)"
                    >
                      {{ t('删除', 'Delete') }}
                    </button>
                  </template>
                  <span v-else class="text-muted-foreground">—</span>
                </div>

                <Switch
                  :model-value="row.source === 'account' ? Boolean(accountRoute?.enabled) : Boolean(providerConfig(row.provider.id)?.enabled)"
                  :aria-label="t(`启用${row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : providerServiceName(row.provider)}`, `Enable ${row.source === 'account' ? t('MilkSU 账户', 'MilkSU account') : providerServiceName(row.provider)}`)"
                  @update:model-value="setModelServiceEnabled(row, Boolean($event))"
                />
              </article>
            </div>
          </section>

          <SettingsSection
            :title="t('模型能力', 'Model capabilities')"
          >
            <div class="rounded-lg border border-border bg-muted/30 p-4">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <p class="font-medium">{{ t('思考层级', 'Thinking levels') }}</p>
                  <p class="mt-1 text-caption text-muted-foreground">
                    {{ t('GPT 与 Claude Opus、Sonnet、Fable 使用内置预设；其他模型需要手动启用并选择实际支持的档位', 'GPT and Claude Opus, Sonnet, and Fable use built-in presets. Other models need thinking enabled by hand, with the levels they actually support.') }}
                  </p>
                </div>
                <Badge variant="outline">
                  {{ thinkingProfile.source === 'preset'
                    ? t('内置预设', 'Built-in preset')
                    : thinkingProfile.source === 'manual'
                      ? t('手动配置', 'Custom')
                      : t('未启用', 'Off') }}
                </Badge>
              </div>

              <div class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <Select v-model="thinkingModelKey">
                  <SelectTrigger
                    size="sm"
                    class="w-full"
                    :aria-label="t('配置思考层级的模型', 'Model for thinking levels')"
                  >
                    <SelectValue>
                      <span class="inline-flex min-w-0 items-center gap-2">
                        <ModelVendorIcon
                          :model="thinkingModelID"
                          :label="thinkingModelLabel"
                        />
                        <span class="min-w-0 truncate">{{ thinkingModelLabel }}</span>
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent size="sm" align="start" class="min-w-96">
                    <template
                      v-for="(group, groupIndex) in availablePickerGroups"
                      :key="`thinking:${group.key}`"
                    >
                      <SelectSeparator v-if="groupIndex > 0" />
                      <SelectGroup>
                        <SelectLabel>{{ group.label }}</SelectLabel>
                        <SelectItem
                          v-for="model in group.models"
                          :key="`thinking:${group.key}:${model}`"
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

                <div class="flex items-center justify-end gap-3">
                  <button
                    v-if="thinkingOverride"
                    type="button"
                    class="text-caption text-link hover:underline"
                    @click="resetModelThinkingOverride"
                  >
                    {{ t('恢复预设', 'Restore preset') }}
                  </button>
                  <Switch
                    :model-value="thinkingProfile.enabled"
                    :disabled="!thinkingModelID"
                    :aria-label="t('启用模型思考层级', 'Enable model thinking levels')"
                    @update:model-value="setModelThinkingEnabled(Boolean($event))"
                  />
                </div>
              </div>

              <div v-if="thinkingProfile.enabled" class="mt-4 border-t border-border pt-4">
                <p class="text-label font-medium text-muted-foreground">{{ t('支持档位', 'Supported levels') }}</p>
                <div class="mt-2 flex flex-wrap gap-2">
                  <button
                    v-for="level in MODEL_THINKING_LEVELS"
                    :key="level"
                    type="button"
                    class="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-caption transition-colors"
                    :class="thinkingProfile.levels.includes(level)
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/50'"
                    :aria-pressed="thinkingProfile.levels.includes(level)"
                    @click="toggleModelThinkingLevel(level)"
                  >
                    <Check v-if="thinkingProfile.levels.includes(level)" class="size-3.5" />
                    {{ MODEL_THINKING_LEVEL_LABELS[level] }}
                  </button>
                </div>

                <label class="mt-4 flex items-center justify-between gap-4 text-caption">
                  <span class="text-muted-foreground">{{ t('默认档位', 'Default level') }}</span>
                  <NativeSelect
                    :model-value="thinkingProfile.defaultLevel"
                    size="sm"
                    :aria-label="t('默认思考层级', 'Default thinking level')"
                    @update:model-value="setModelThinkingDefault(String($event))"
                  >
                    <NativeSelectOption
                      v-for="level in thinkingProfile.levels"
                      :key="level"
                      :value="level"
                    >
                      {{ MODEL_THINKING_LEVEL_LABELS[level] }}
                    </NativeSelectOption>
                  </NativeSelect>
                </label>
              </div>
            </div>
          </SettingsSection>

          <div class="mt-6 flex justify-end">
            <Button :loading="saving || verifying" @click="save">
              {{ verifying ? t('正在验证', 'Verifying') : t('保存并验证', 'Save and verify') }}
            </Button>
          </div>

          <Dialog v-model:open="providerEditorOpen">
            <DialogContent class="provider-editor-dialog sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{{ t(`编辑 ${editingProviderInfo ? providerServiceName(editingProviderInfo) : t('模型服务', 'model service')}`, `Edit ${editingProviderInfo ? providerServiceName(editingProviderInfo) : t('模型服务', 'model service')}`) }}</DialogTitle>
                <DialogDescription class="sr-only">{{ t('配置这个模型服务的接口地址、凭据和可用模型。', 'Configure this model service endpoint, credentials, and available models.') }}</DialogDescription>
              </DialogHeader>

              <div v-if="editingProvider && editingProviderInfo" class="grid gap-4">
                <label class="provider-editor-field">
                  <span>{{ t('API 端点', 'API endpoint') }}</span>
                  <Input
                    :model-value="editingProvider.base_url ?? editingProviderInfo.defaultBaseUrl"
                    type="url"
                    autocomplete="url"
                    :placeholder="editingProviderInfo.defaultBaseUrl || 'https://example.com/v1'"
                    :aria-label="t('API 端点', 'API endpoint')"
                    @update:model-value="value => { editingProvider!.base_url = String(value).trim() }"
                  />
                </label>

                <label v-if="editingProvider.custom" class="provider-editor-field">
                  <span>{{ t('自定义名字', 'Custom name') }}</span>
                  <Input
                    :model-value="editingProvider.name ?? ''"
                    autocomplete="off"
                    :placeholder="t('例如：我的中转站', 'e.g. My relay')"
                    :aria-label="t('中转站名称', 'Relay name')"
                    @update:model-value="value => { editingProvider!.name = String(value) }"
                  />
                </label>
                <label v-else class="provider-editor-field">
                  <span>{{ t('名称', 'Name') }}</span>
                  <Input :model-value="providerServiceName(editingProviderInfo)" readonly :aria-label="t('名称', 'Name')" />
                </label>

                <div v-if="editingProvider.custom" class="provider-editor-field items-start">
                  <span class="pt-2">{{ t('模型 / 前缀', 'Models / prefixes') }}</span>
                  <div class="min-w-0">
                    <div class="flex gap-2">
                      <Input
                        v-model="customModelInput"
                        autocomplete="off"
                        :placeholder="t('例如：grok-4.5 或 openai/gpt-5', 'e.g. grok-4.5 or openai/gpt-5')"
                        :aria-label="t('模型 ID 或关键词前缀', 'Model ID or keyword prefix')"
                        @keydown.enter.prevent="addCustomRelayModel"
                      />
                      <Button variant="outline" @click="addCustomRelayModel">{{ t('添加', 'Add') }}</Button>
                    </div>
                    <div v-if="editingProvider.models?.length" class="mt-2 flex flex-wrap gap-2">
                      <span
                        v-for="model in editingProvider.models"
                        :key="model"
                        class="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 font-mono text-caption"
                      >
                        {{ model }}
                        <button type="button" class="text-muted-foreground hover:text-destructive" :aria-label="t(`移除模型 ${model}`, `Remove model ${model}`)" @click="removeCustomRelayModel(model)">
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
                  <span class="pt-2">{{ t('可用模型', 'Available models') }}</span>
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
                        :aria-label="t('可用模型', 'Available models')"
                      >
                        <SelectValue>
                          {{ editingProviderModels.length
                            ? modelDisplayLabel(
                              editingProviderInfo.id,
                              editingProviderModel || editingProviderModels[0] || '',
                            )
                            : '' }}
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
                  </div>
                </label>

                <p v-if="notice" class="text-caption" :class="notice.tone === 'error' ? 'text-destructive' : 'text-primary'">{{ notice.text }}</p>
              </div>

              <DialogFooter>
                <Button variant="outline" :loading="saving || verifying" @click="saveProviderEditor(false)">{{ t('测试连接', 'Test connection') }}</Button>
                <Button :loading="saving || verifying" @click="saveProviderEditor(true)">{{ t('保存', 'Save') }}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </template>

        <template v-else-if="working && category === 'ctf'">
          <SettingsSection title="NSSCTF Agent Arena">
            <SettingsRow
              stack="always"
              label="Arena Token"
              :description="working.nssctf_arena?.session_only ? t('本地数据库写入失败；当前仅在本次运行可用', 'Could not write the local database; this value is only available in the current session.') : ''"
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
                @blur="save"
              />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection :title="t('题目浏览器扩展', 'Challenge browser extension')">
            <SettingsRow
              :label="t('连接', 'Connection')"
              :description="browserBridgeConnected ? t('已连接', 'Connected') : t('未连接', 'Not connected')"
            >
              <Button variant="outline" size="sm" :loading="browserBridgeLoading" @click="refreshBrowserBridgeStatus()">
                {{ t('检测', 'Check') }}
              </Button>
            </SettingsRow>
          </SettingsSection>
        </template>

        <template v-else-if="category === 'security-tools'">
          <SecurityToolsSettingsPanel
            @coding-handoff="$emit('securityToolCodingHandoff', $event)"
          />
        </template>

        <template v-else-if="working && category === 'lab'">
          <LabSettingsPanel :settings="working" @persist="save" />
        </template>

        <template v-else-if="category === 'cve'">
          <VulnerabilityIntelSettingsPanel :dashboard="dashboard" />
        </template>

        <template v-else-if="category === 'eval'">
          <EvalSettingsPanel :settings="working" />
        </template>
      </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.settings-nav-surface { border-color: var(--border); background-color: var(--background); }
.settings-ak-tabs { width: 100%; border: 0; background: transparent; }
.settings-ak-tabs .ak-tabs__list { display: grid; grid-auto-flow: row; border-bottom: 0; }
.settings-ak-tabs .ak-tabs__tab + .ak-tabs__tab { border-left: 0; border-top: 1px solid var(--border); }
.settings-nav-item { position: relative; display: flex; min-height: 3rem; width: 100%; align-items: center; justify-content: flex-start; border: 0; background: transparent; padding: 0 1rem; color: var(--muted-foreground); text-align: left; cursor: pointer; text-transform: none; letter-spacing: 0.02em; }
.settings-nav-item:hover { color: var(--foreground); background: var(--overlay-hover); }
.settings-nav-item.active,
.settings-ak-tabs .ak-tabs__tab[aria-selected='true'] {
  color: #111315;
  background: #05a7dc;
  box-shadow: 0 0 1.4rem color-mix(in srgb, #05a7dc 45%, transparent);
}
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
