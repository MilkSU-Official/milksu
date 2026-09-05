<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  SettingsRow,
  SettingsSection,
} from '@felinic/ui'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Search,
} from 'lucide-vue-next'
import CollectionPicker from '@/components-vue/CollectionPicker.vue'
import CollectionViewFilter from '@/components-vue/CollectionViewFilter.vue'
import ConversationDock from '@/components-vue/ConversationDock.vue'
import RelatedCvePanel from '@/components-vue/RelatedCvePanel.vue'
import ResearchReportPanel from '@/components-vue/ResearchReportPanel.vue'
import WorkspaceCatalogActions from '@/components-vue/WorkspaceCatalogActions.vue'
import WorkspaceCatalogHistoryItem from '@/components-vue/WorkspaceCatalogHistoryItem.vue'
import WorkspaceImportDialog from '@/components-vue/WorkspaceImportDialog.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import EnvironmentStrip from '@/components-vue/lab-env/EnvironmentStrip.vue'
import TargetLivePane from '@/components-vue/lab-env/TargetLivePane.vue'
import { invokeCommand } from '@/desktop'
import { toStripLease, useEnvLease } from '@/composables/useEnvLease'
import type { EnvPackage } from '@/envbroker'
import { useVulnerabilityDashboard, type VulnerabilityCodingTask, type VulnerabilityDashboard, type VulnerabilitySearchCandidate } from '@/composables/useVulnerabilityDashboard'
import type { Conversation } from '@/types'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
import { vulnerabilityStatusLabel, type VulnerabilityIntel, type VulnerabilitySeverity, type VulnerabilityStatus } from '@/vulnerabilityIntel'
import { ALL_COLLECTIONS_ID, createItemCollectionStore } from '@/lib/itemCollections'
import { conversationActivityAt } from '@/lib/workspaceSessionRouting'
import { presentVulnerabilityVendorProduct } from '@/lib/vulnerabilityFeedImport'
import { useDossierSplit } from '@/lib/useDossierSplit'
import { t } from '@/lib/uiLocale'

defineOptions({ name: 'VulnPage' })

const props = withDefaults(defineProps<{
  dashboard?: VulnerabilityDashboard
  codingWorkspacePath?: string
  navigationEpoch?: number
  conversations?: Conversation[]
  conversation?: Conversation | null
  running?: boolean
  aborting?: boolean
  settings?: CodingAgentSurfaceBind['settings']
  workspacePath?: string
  messageQueue?: CodingAgentSurfaceBind['messageQueue']
  sessionReady?: boolean
  resumed?: boolean
  compacting?: boolean
  compactedAt?: number
  compactionError?: string
  turnStatus?: CodingAgentSurfaceBind['turnStatus']
  ctfSession?: boolean
  vulnerabilitySession?: boolean
  ctfMode?: Conversation['ctfMode']
  ctfRole?: Conversation['ctfRole']
  modelMode?: Conversation['modelMode']
  modelProvider?: string
  modelId?: string
  modelSourcePreference?: CodingAgentSurfaceBind['modelSourcePreference']
  executionMode?: CodingAgentSurfaceBind['executionMode']
  approvalPolicy?: CodingAgentSurfaceBind['approvalPolicy']
  mcpServers?: string[]
  mcpConfigDigest?: string
  pendingComposerDraft?: CodingAgentSurfaceBind['pendingComposerDraft']
  ensureConversation?: (title?: string) => string
  chatMaximized?: boolean
  chatDockOpen?: boolean
}>(), {
  codingWorkspacePath: '',
  navigationEpoch: 0,
  conversations: () => [],
  conversation: null,
  running: false,
  aborting: false,
  settings: null,
  workspacePath: '',
  sessionReady: false,
  resumed: false,
  compacting: false,
  ctfSession: false,
  vulnerabilitySession: false,
  mcpServers: () => [],
  pendingComposerDraft: null,
  ensureConversation: () => '',
  chatMaximized: false,
  chatDockOpen: true,
})

const emit = defineEmits<{
  chooseCodingWorkspace: []
  startCodingTask: [task: VulnerabilityCodingTask, recordHandoff: (workspacePath: string) => void]
  openCodingConversation: [id: string]
  enter: [item: VulnerabilityIntel]
  run: [item: VulnerabilityIntel]
  send: CodingAgentSendArgs
  abort: []
  selectConversation: [id: string]
  createConversation: []
  expand: []
  closeDock: []
  consumePendingDraft: []
  compactContext: []
  rewindContext: []
  handoffContext: []
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string]
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  changeModelSource: [preference: 'auto' | 'account' | 'personal']
  changeCodingPolicy: [
    executionMode: NonNullable<CodingAgentSurfaceBind['executionMode']>,
    approvalPolicy: NonNullable<CodingAgentSurfaceBind['approvalPolicy']>,
  ]
  changeMcpServers: [servers: string[], configDigest: string]
  chooseWorkspace: []
  chooseWorkspaceForNewTask: []
  selectWorkspace: [path: string]
  forgetWorkspace: [path: string]
  clearWorkspace: []
  cancelQueuedGuidance: [index: number]
  editQueuedGuidance: [index: number]
  openSettings: []
  openLabSettings: []
}>()

const dashboard = props.dashboard ?? useVulnerabilityDashboard()
const showImport = ref(false)
const catalogActions = ref<{ closeHistoryMenu: () => void } | null>(null)
const cveSearchQuery = ref('')
const cveSearchError = ref('')
const cveSearchLoading = ref(false)
const cveSearchResults = ref<VulnerabilitySearchCandidate[]>([])
const cveSearchAttempted = ref(false)
const importNotice = ref('')
const importError = ref('')
const importSyncing = ref(false)
const cveCollections = createItemCollectionStore('milksu.cve.collections.v1')
const collectionView = ref(ALL_COLLECTIONS_ID)
const statusFilter = ref<'all' | VulnerabilityStatus>('all')
const kevFilter = ref<'all' | 'kev' | 'other'>('all')
const vendorFilter = ref('')
const yearFilter = ref('')
const page = ref(1)
const pageSize = 20

const statusOptions = computed(() => [
  { value: '待复现' as const, label: t('想研究', 'Want to research') },
  { value: '研究中' as const, label: t('研究中', 'In research') },
  { value: '已验证' as const, label: t('已验证', 'Verified') },
  { value: '已分流' as const, label: t('已归档', 'Archived') },
])

const vendorOptions = computed(() => (
  [...new Set(dashboard.tracked.value.map(item => presentVendorProduct(item).vendor).filter(Boolean))].sort((left, right) => (
    left.localeCompare(right, 'zh-CN')
  ))
))
const yearOptions = computed(() => (
  [...new Set(dashboard.tracked.value.map(item => item.id.match(/^CVE-(\d{4})-/i)?.[1] ?? '').filter(Boolean))].sort((left, right) => (
    right.localeCompare(left)
  ))
))
const filteredItems = computed(() => {
  const allowed = collectionView.value === ALL_COLLECTIONS_ID
    ? null
    : new Set(cveCollections.itemKeysFor(collectionView.value))
  return dashboard.tracked.value.filter(item => (
    (statusFilter.value === 'all' || item.status === statusFilter.value)
    && (kevFilter.value === 'all' || (kevFilter.value === 'kev' ? item.kev : !item.kev))
    && (!vendorFilter.value || presentVendorProduct(item).vendor === vendorFilter.value)
    && (!yearFilter.value || item.id.toUpperCase().startsWith(`CVE-${yearFilter.value}-`))
    && (!allowed || allowed.has(item.id))
  ))
})
const pageCount = computed(() => Math.max(1, Math.ceil(filteredItems.value.length / pageSize)))
const visibleItems = computed(() => filteredItems.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const directCveId = computed(() => cveSearchQuery.value.trim().toUpperCase())
const canAddDirectCve = computed(() => (
  cveSearchAttempted.value
  && !cveSearchLoading.value
  && !cveSearchResults.value.length
  && /^CVE-\d{4}-\d{4,}$/.test(directCveId.value)
  && !dashboard.watched.value.includes(directCveId.value)
))

watch([() => dashboard.query.value, statusFilter, () => dashboard.severity.value, kevFilter, vendorFilter, yearFilter], () => { page.value = 1 })
watch(pageCount, count => { if (page.value > count) page.value = count })
watch(
  () => filteredItems.value.map(item => item.id).join('|'),
  () => {
    if (!dashboard.selectedId.value) return
    if (!filteredItems.value.some(item => item.id === dashboard.selectedId.value)) {
      dashboard.selectedId.value = ''
    }
  },
  { flush: 'sync' },
)

function relatedConversations(cveId: string) {
  return props.conversations.filter(conversation => (
    conversation.domainTaskContext?.kind === 'cve'
    && conversation.domainTaskContext.cveId === cveId
  )).sort((left, right) => conversationActivityAt(right) - conversationActivityAt(left))
}

const cveHistory = computed(() => {
  const seen = new Set<string>()
  return props.conversations
    .filter(conversation => conversation.domainTaskContext?.kind === 'cve')
    .sort((left, right) => conversationActivityAt(right) - conversationActivityAt(left))
    .flatMap(conversation => {
      if (conversation.domainTaskContext?.kind !== 'cve') return []
      const cveId = conversation.domainTaskContext.cveId.trim()
      if (!cveId || seen.has(cveId)) return []
      seen.add(cveId)
      return [{
        cveId,
        title: conversation.domainTaskContext.title || conversation.title,
        at: conversationActivityAt(conversation),
      }]
    })
})

const selectedItem = computed(() => (
  dashboard.tracked.value.find(item => item.id === dashboard.selectedId.value) ?? null
))
const targetOpen = ref(false)
const pendingOpen = ref(false)
const showStartEnv = ref(false)
const cveOwnerKind = computed(() => 'cve' as const)
const cveOwnerId = computed(() => selectedItem.value?.id ?? '')
const cvePackageId = ref<string | undefined>(undefined)
const cveBoundPackage = ref<EnvPackage | undefined>(undefined)
const {
  lease: envLease,
  start: startEnv,
  stop: stopEnv,
  reset: resetEnv,
} = useEnvLease(cveOwnerKind, cveOwnerId, cvePackageId)
const stripLease = computed(() => toStripLease(envLease.value, cveBoundPackage.value
  ? { name: cveBoundPackage.value.name, provider: cveBoundPackage.value.provider }
  : undefined))
const { width: briefWidth, startResize: startBriefResize } = useDossierSplit('milksu.cve-split.v1', 400)
const liveTargetVisible = computed(() => targetOpen.value && envLease.value.state === 'ready')
const conversationDock = ref<{ revealAndFocus: () => Promise<void> } | null>(null)



function selectItem(id: string) {
  const item = dashboard.tracked.value.find(candidate => candidate.id === id)
  if (!item) return
  dashboard.selectedId.value = id
}

watch(
  () => selectedItem.value?.id,
  (id) => {
    targetOpen.value = false
    pendingOpen.value = false
    showStartEnv.value = false
    const item = selectedItem.value
    if (!item || !id) return
    emit('enter', item)
    void invokeCommand<{ found: boolean; package: EnvPackage }>('get_env_package_for_cve', { cveId: id })
      .then(lookup => {
        cveBoundPackage.value = lookup.found ? lookup.package : undefined
        cvePackageId.value = lookup.found ? lookup.package.id : undefined
      })
      .catch(() => {
        cveBoundPackage.value = undefined
        cvePackageId.value = undefined
      })
  },
  { immediate: true },
)

function clearSelection() {
  dashboard.selectedId.value = ''
}

watch(() => props.navigationEpoch, (epoch) => {
  if (epoch) clearSelection()
})

function parseOccupyOwner(value?: string) {
  const raw = String(value || '')
  const index = raw.indexOf(':')
  if (index <= 0) return { kind: '', id: '' }
  return { kind: raw.slice(0, index), id: raw.slice(index + 1) }
}

function occupyGo() {
  const occupy = parseOccupyOwner(envLease.value.occupyOwner)
  if (occupy.kind === 'cve' && occupy.id) selectItem(occupy.id)
}

async function occupyStop() {
  const occupy = parseOccupyOwner(envLease.value.occupyOwner)
  if (!occupy.kind || !occupy.id) return
  await invokeCommand('stop_env_lease', { ownerKind: occupy.kind, ownerId: occupy.id }).catch(() => undefined)
  await startEnv(cvePackageId.value || envLease.value.packageId)
}

function openTarget() {
  if (envLease.value.state !== 'ready') return
  targetOpen.value = true
  const conversationId = props.conversation?.id || props.ensureConversation?.(selectedItem.value?.id)
  if (conversationId && envLease.value.surface === 'browser' && envLease.value.address) {
    void invokeCommand('start_coding_browser', {
      conversationId,
      initialUrl: `http://${envLease.value.address}`,
    }).catch(() => undefined)
  }
}

function openDocker() {
  void invokeCommand('open_docker_desktop').catch(() => undefined)
}

async function revealConversationComposer() {
  await nextTick()
  await conversationDock.value?.revealAndFocus()
}

function startReproduction() {
  const item = selectedItem.value
  if (!item) return
  if (cvePackageId.value && envLease.value.state !== 'ready' && envLease.value.state !== 'pulling') {
    showStartEnv.value = true
    return
  }
  pendingOpen.value = true
  if (envLease.value.state === 'ready') openTarget()
  emit('run', item)
  void revealConversationComposer()
}

function confirmStartEnv() {
  const item = selectedItem.value
  showStartEnv.value = false
  if (!item) return
  pendingOpen.value = true
  void startEnv(cvePackageId.value)
  emit('run', item)
  void revealConversationComposer()
}

function reportOnly() {
  const item = selectedItem.value
  showStartEnv.value = false
  if (!item) return
  emit('run', item)
  void revealConversationComposer()
}

watch(() => envLease.value.state, state => {
  if (state === 'ready' && pendingOpen.value) {
    pendingOpen.value = false
    openTarget()
  }
})

function presentVendorProduct(item: VulnerabilityIntel) {
  return presentVulnerabilityVendorProduct({
    vendor: item.vendor,
    product: item.product,
    title: item.title,
    summary: item.summary,
  })
}

function setStatus(id: string, event: Event) {
  const raw = (event.target as HTMLSelectElement | null)?.value
  const status = statusOptions.value.find(option => option.value === raw)?.value
  if (!status) return
  dashboard.setStatus(id, status)
}

function severityVariant(severity: VulnerabilitySeverity) {
  return severity === 'critical' ? 'destructive' : severity === 'high' ? 'warning' : 'info'
}

function severityTag(severity: VulnerabilitySeverity) {
  if (severity === 'critical' || severity === 'high') return 'ak-tag--danger'
  if (severity === 'medium') return 'ak-tag--advanced'
  return ''
}

function statusTag(status: VulnerabilityStatus) {
  if (status === '研究中') return 'ak-tag--advanced'
  if (status === '待复现') return 'ak-tag--danger'
  return 'ak-tag--neutral'
}

function recentResearch(item: VulnerabilityIntel) {
  const latest = relatedConversations(item.id)[0]
  if (!latest) return item.updated
  const date = new Date(latest.createdAt)
  if (Number.isNaN(date.getTime())) return item.updated
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return t(
      `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      `Today ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    )
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function referenceOrganization(href: string) {
  try {
    const hostname = new URL(href).hostname.replace(/^www\./, '')
    const parts = hostname.split('.')
    return parts.length > 2 ? parts.slice(-2).join('.') : hostname
  } catch {
    return href
  }
}

function referenceLabel(label: string, href: string) {
  const organization = referenceOrganization(href)
  const knownLabels: Record<string, string> = {
    'nist.gov': 'NVD',
    'cisa.gov': 'CISA',
    'redhat.com': 'Red Hat',
    'github.com': 'GitHub',
    'openwall.com': 'Openwall',
    'debian.org': 'Debian',
    'ubuntu.com': 'Ubuntu',
  }
  if (knownLabels[organization]) return knownLabels[organization]
  if (label.includes('@') || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(label)) return organization
  return label
}

function keyReferences(item: VulnerabilityIntel) {
  const seen = new Set<string>()
  return item.references.filter(reference => {
    const organization = referenceOrganization(reference.href)
    if (seen.has(organization)) return false
    seen.add(organization)
    return true
  }).slice(0, 4)
}

function openImport() {
  catalogActions.value?.closeHistoryMenu()
  showImport.value = true
  cveSearchError.value = ''
  cveSearchResults.value = []
  cveSearchAttempted.value = false
  cveSearchQuery.value = ''
  importNotice.value = ''
  importError.value = ''
}

function resumeFromHistory(cveId: string) {
  catalogActions.value?.closeHistoryMenu()
  selectItem(cveId)
}

async function syncPublicSources() {
  importNotice.value = ''
  importError.value = ''
  importSyncing.value = true
  try {
    const failures: string[] = []
    try {
      await dashboard.syncCisaKevFeed()
    } catch (cause) {
      failures.push(cause instanceof Error ? cause.message : String(cause))
    }
    try {
      await dashboard.syncVulhubPracticeCatalog()
    } catch (cause) {
      failures.push(cause instanceof Error ? cause.message : String(cause))
    }
    if (failures.length) {
      importError.value = failures.join(t('；', '; '))
      return
    }
    importNotice.value = t('已同步公开源。', 'Public sources synced.')
  } finally {
    importSyncing.value = false
  }
}

function readableCveSearchError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/HTTP\s*(429|502|503|504)|timeout|timed out|deadline exceeded|network|fetch failed/i.test(message)) {
    return t('公开 CVE 服务暂时繁忙，请稍后重试。', 'Public CVE service is busy. Try again later.')
  }
  if (/请输入至少 2 个字符/.test(message)) return t('请至少输入 2 个字符。', 'Enter at least 2 characters.')
  return t('暂时无法读取公开 CVE，请稍后重试。', 'Unable to load public CVEs. Try again later.')
}

async function searchCves() {
  cveSearchError.value = ''
  cveSearchResults.value = []
  cveSearchAttempted.value = true
  cveSearchLoading.value = true
  try {
    cveSearchResults.value = await dashboard.searchNvdCves(cveSearchQuery.value)
    if (!cveSearchResults.value.length) cveSearchError.value = t('没有找到匹配的公开 CVE。', 'No matching public CVE found.')
  } catch (cause) {
    cveSearchError.value = readableCveSearchError(cause)
  } finally {
    cveSearchLoading.value = false
  }
}

function addDirectCve() {
  cveSearchError.value = ''
  try {
    dashboard.addTrackingItem({
      id: directCveId.value,
      title: t(`${directCveId.value} · 待补公开资料`, `${directCveId.value} · public details pending`),
      vendor: '',
      product: '',
      affected: '',
      summary: t('NVD 暂未返回公开记录；已按 CVE 编号加入。', 'NVD has no public record yet. Added by CVE ID.'),
    })
    showImport.value = false
  } catch (cause) {
    cveSearchError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function addSearchResult(candidate: VulnerabilitySearchCandidate) {
  cveSearchError.value = ''
  try {
    dashboard.addNvdSearchResult(candidate)
    dashboard.query.value = ''
    statusFilter.value = 'all'
    showImport.value = false
  } catch (cause) {
    cveSearchError.value = readableCveSearchError(cause)
  }
}

</script>

<template>
  <main v-if="!selectedItem" class="tactical-page flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <WorkspaceModuleTopBar module="cve" :title="t('漏洞', 'CVE')">
      <template #actions>
        <WorkspaceCatalogActions
          ref="catalogActions"
          :history-count="cveHistory.length"
          :history-aria-label="t('打开研究历史', 'Open research history')"
          :history-menu-label="t('研究历史', 'Research history')"
          :action-aria-label="t('导入 CVE', 'Import CVE')"
          @action="openImport"
        >
          <template #history>
            <WorkspaceCatalogHistoryItem
              v-for="entry in cveHistory"
              :key="entry.cveId"
              :title="entry.cveId"
              :subtitle="entry.title"
              :time="entry.at"
              title-mono
              :current="dashboard.selectedId.value === entry.cveId"
              @select="resumeFromHistory(entry.cveId)"
            />
          </template>
        </WorkspaceCatalogActions>
      </template>

      <template #filters>
        <div class="flex flex-col gap-3">
          <CollectionViewFilter v-model="collectionView" :store="cveCollections" />
          <div class="flex flex-wrap items-center gap-3">
          <label class="relative min-w-64 flex-1 max-w-md">
            <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="dashboard.query.value"
              size="sm"
              class="pl-9"
              :placeholder="t('搜索我添加的 CVE…', 'Search CVEs I added…')"
              :aria-label="t('搜索 CVE', 'Search CVE')"
            />
          </label>
          <NativeSelect v-model="statusFilter" size="sm" class="w-40" :aria-label="t('按我的状态筛选', 'Filter by my status')">
            <NativeSelectOption value="all">{{ t('我的状态：全部', 'My status: all') }}</NativeSelectOption>
            <NativeSelectOption v-for="option in statusOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </NativeSelectOption>
          </NativeSelect>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <NativeSelect v-model="dashboard.severity.value" size="sm" class="w-40" :aria-label="t('严重性', 'Severity')">
              <NativeSelectOption value="all">{{ t('严重性：全部', 'Severity: all') }}</NativeSelectOption>
              <NativeSelectOption value="critical">{{ t('严重', 'Critical') }}</NativeSelectOption>
              <NativeSelectOption value="high">{{ t('高', 'High') }}</NativeSelectOption>
              <NativeSelectOption value="medium">{{ t('中', 'Medium') }}</NativeSelectOption>
            </NativeSelect>
            <NativeSelect v-model="kevFilter" size="sm" class="w-40" :aria-label="t('KEV', 'KEV')">
              <NativeSelectOption value="all">{{ t('KEV：全部', 'KEV: all') }}</NativeSelectOption>
              <NativeSelectOption value="kev">{{ t('在 KEV', 'In KEV') }}</NativeSelectOption>
              <NativeSelectOption value="other">{{ t('不在 KEV', 'Not in KEV') }}</NativeSelectOption>
            </NativeSelect>
            <NativeSelect v-model="vendorFilter" size="sm" class="w-44" :aria-label="t('厂商', 'Vendor')">
              <NativeSelectOption value="">{{ t('厂商：全部', 'Vendor: all') }}</NativeSelectOption>
              <NativeSelectOption v-for="vendor in vendorOptions" :key="vendor" :value="vendor">
                {{ vendor }}
              </NativeSelectOption>
            </NativeSelect>
            <NativeSelect v-model="yearFilter" size="sm" class="w-36" :aria-label="t('年份', 'Year')">
              <NativeSelectOption value="">{{ t('年份：全部', 'Year: all') }}</NativeSelectOption>
              <NativeSelectOption v-for="year in yearOptions" :key="year" :value="year">
                {{ year }}
              </NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
      </template>
    </WorkspaceModuleTopBar>

    <WorkspaceImportDialog
      v-model:open="showImport"
      :description="t('同步公开源，或按编号、产品名查找 CVE。', 'Sync public sources, or find a CVE by ID or product name.')"
    >
      <SettingsSection :title="t('同步公开源', 'Public sources')">
        <SettingsRow
          :label="t('CISA KEV / Vulhub', 'CISA KEV / Vulhub')"
          :description="dashboard.sourceRefreshSummary.value.label"
          :divider="false"
        >
          <Button
            variant="outline"
            size="sm"
            :loading="importSyncing"
            :aria-label="t('同步公开源', 'Sync public sources')"
            @click="syncPublicSources"
          >
            {{ t('同步', 'Sync') }}
          </Button>
        </SettingsRow>
        <p v-if="importNotice" class="px-4 pb-3 text-caption text-muted-foreground">{{ importNotice }}</p>
        <p v-if="importError" class="px-4 pb-3 text-caption text-destructive" role="alert">{{ importError }}</p>
      </SettingsSection>

      <SettingsSection :title="t('查找公开 CVE', 'Find public CVE')">
        <div class="grid gap-3 px-4 py-4">
        <form class="flex gap-2" @submit.prevent="searchCves">
          <label class="relative min-w-0 flex-1">
            <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="cveSearchQuery"
              class="pl-9"
              autofocus
              :aria-label="t('搜索公开 CVE', 'Search public CVE')"
              :placeholder="t('例如 CVE-2024-3400、ActiveMQ、Android deserialization', 'e.g. CVE-2024-3400, ActiveMQ, Android deserialization')"
            />
          </label>
          <Button type="submit" variant="brand" :disabled="cveSearchLoading || cveSearchQuery.trim().length < 2">
            <LoaderCircle v-if="cveSearchLoading" class="size-4 animate-spin" />
            <Search v-else class="size-4" />
            {{ t('搜索', 'Search') }}
          </Button>
        </form>

        <p v-if="cveSearchError" class="text-caption text-destructive" role="alert">{{ cveSearchError }}</p>

        <div v-if="canAddDirectCve" class="flex flex-wrap items-center justify-between gap-3 border border-border bg-muted/30 px-4 py-3">
          <p class="font-mono text-caption">{{ directCveId }}</p>
          <Button size="sm" variant="outline" @click="addDirectCve">{{ t('仅按编号加入', 'Add by ID only') }}</Button>
        </div>

        <div v-if="cveSearchResults.length" class="cve-search-results divide-y divide-border border border-border" :aria-label="t('公开 CVE 搜索结果', 'Public CVE search results')">
          <article v-for="candidate in cveSearchResults" :key="candidate.id" class="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="font-mono text-control text-primary">{{ candidate.id }}</strong>
                <Badge v-if="candidate.cvss > 0" :variant="severityVariant(candidate.severity)" font="mono">{{ candidate.cvss.toFixed(1) }}</Badge>
              </div>
              <p class="mt-1 line-clamp-2 text-body font-medium">{{ candidate.title }}</p>
              <p class="mt-1 text-caption text-muted-foreground">{{ candidate.updated || t('NVD 公开记录', 'NVD public record') }}</p>
            </div>
            <Button
              size="sm"
              :disabled="dashboard.watched.value.includes(candidate.id)"
              @click="addSearchResult(candidate)"
            >
              {{ dashboard.watched.value.includes(candidate.id) ? t('已在列表', 'Already listed') : t('加入研究', 'Add to research') }}
            </Button>
          </article>
        </div>
        </div>
      </SettingsSection>
    </WorkspaceImportDialog>

    <section class="min-h-0 flex-1 overflow-auto bg-background" :aria-label="t('CVE 列表', 'CVE list')">
      <div class="min-w-[1120px]">
        <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[170px_minmax(240px,1.2fr)_minmax(160px,.9fr)_88px_132px_42px_minmax(7rem,1fr)_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
          <span class="whitespace-nowrap">CVE</span>
          <span class="whitespace-nowrap">{{ t('漏洞', 'Title') }}</span>
          <span class="whitespace-nowrap">{{ t('厂商/产品', 'Vendor / product') }}</span>
          <span class="whitespace-nowrap">{{ t('严重性', 'Severity') }}</span>
          <span class="whitespace-nowrap">{{ t('我的状态', 'My status') }}</span>
          <span class="sr-only">{{ t('收藏', 'Collection') }}</span>
          <span class="whitespace-nowrap">{{ t('最近研究', 'Recent research') }}</span>
          <span class="sr-only">{{ t('打开', 'Open') }}</span>
        </div>

        <template v-for="item in visibleItems" :key="item.id">
          <article
            class="vuln-row tactical-row grid min-h-[72px] w-full grid-cols-[170px_minmax(240px,1.2fr)_minmax(160px,.9fr)_88px_132px_42px_minmax(7rem,1fr)_72px] items-center gap-4 px-6 text-left"
            data-testid="catalog-row"
          >
            <span class="font-mono text-body select-text">{{ item.id }}</span>
            <span class="min-w-0 truncate text-control font-medium select-text">{{ item.title }}</span>
            <span class="min-w-0">
              <span class="block truncate text-body">{{ presentVendorProduct(item).vendor }}</span>
              <span class="mt-0.5 block truncate text-caption text-muted-foreground">{{ presentVendorProduct(item).product }}</span>
            </span>
            <span class="ak-tag ak-tag--compact" :class="severityTag(item.severity)">{{ item.cvss.toFixed(1) }}</span>
            <span class="ak-tag ak-tag--compact" :class="statusTag(item.status)">{{ vulnerabilityStatusLabel(item.status) }}</span>
            <CollectionPicker :item-key="item.id" :store="cveCollections" />
            <span class="text-caption text-muted-foreground">{{ recentResearch(item) }}</span>
            <Button size="sm" variant="outline" data-testid="open-item" @click="selectItem(item.id)">{{ t('打开', 'Open') }}</Button>
          </article>
        </template>

        <div v-if="!visibleItems.length" class="grid min-h-64 place-items-center px-8 text-center">
          <div>
            <p v-if="dashboard.tracked.value.length" class="text-control font-medium">{{ t('没有匹配的 CVE', 'No matching CVE') }}</p>
          </div>
        </div>
      </div>
    </section>

    <footer class="flex h-14 shrink-0 items-center justify-between border-t border-border px-6">
      <span class="text-caption text-muted-foreground">{{ t(`共 ${filteredItems.length} 条`, `${filteredItems.length} items`) }}</span>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" :disabled="page <= 1" :aria-label="t('上一页', 'Previous page')" @click="page -= 1"><ChevronLeft class="size-4" /></Button>
        <Button variant="outline" size="icon-sm">{{ page }}</Button>
        <Button variant="ghost" size="icon-sm" :disabled="page >= pageCount" :aria-label="t('下一页', 'Next page')" @click="page += 1"><ChevronRight class="size-4" /></Button>
      </div>
    </footer>
  </main>

  <main v-else class="tactical-page flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <WorkspaceModuleTopBar module="cve" :title="selectedItem.id" :subtitle="selectedItem.title">
      <template #leading>
        <Button variant="ghost" size="icon-sm" :aria-label="t('返回漏洞列表', 'Back to CVE list')" @click="clearSelection">
          <ArrowLeft class="size-4" />
        </Button>
      </template>
      <template #actions>
        <Button variant="brand" size="sm" @click="startReproduction">{{ t('开始复现', 'Start reproduction') }}</Button>
      </template>
    </WorkspaceModuleTopBar>
    <div class="flex min-h-0 flex-1 overflow-hidden" data-dossier-split>
      <div
        class="flex min-h-0 min-w-0 flex-col"
        :class="liveTargetVisible ? '' : 'flex-1'"
        :style="liveTargetVisible ? { width: `${briefWidth}px`, flex: 'none' } : undefined"
      >
        <div class="page-scroll flex-1">
        <div class="page-stack" :class="liveTargetVisible ? 'page-stack--flush' : 'page-column'">
          <SettingsSection :title="t('摘要', 'Summary')">
            <p class="px-4 py-3 text-body leading-6">{{ selectedItem.summary }}</p>
            <SettingsRow v-if="selectedItem.references.length" :label="t('原文', 'Source')">
              <div class="flex min-w-0 flex-col items-end gap-1">
                <Button
                  v-for="reference in keyReferences(selectedItem)"
                  :key="reference.href"
                  as="a"
                  :href="reference.href"
                  target="_blank"
                  rel="noreferrer"
                  variant="link"
                  size="text"
                >
                  {{ referenceLabel(reference.label, reference.href) }}
                  <ExternalLink class="size-3" />
                </Button>
              </div>
            </SettingsRow>
            <SettingsRow :label="t('状态', 'Status')" :divider="false">
              <NativeSelect
                :model-value="selectedItem.status"
                size="sm"
                class="w-32"
                :aria-label="t(`${selectedItem.id} 状态`, `${selectedItem.id} status`)"
                @change="setStatus(selectedItem.id, $event)"
              >
                <NativeSelectOption v-for="option in statusOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </NativeSelectOption>
              </NativeSelect>
            </SettingsRow>
          </SettingsSection>
          <EnvironmentStrip
            :lease="stripLease"
            @start="startEnv(cvePackageId || envLease.packageId)"
            @stop="stopEnv"
            @reset="resetEnv"
            @open-target="openTarget"
            @retry="startEnv(cvePackageId || envLease.packageId)"
            @open-docker="openDocker"
            @occupy-go="occupyGo"
            @occupy-stop="occupyStop"
            @open-lab-settings="$emit('openLabSettings')"
          />
          <SettingsSection :title="t('关联 CVE', 'Related CVE')">
            <RelatedCvePanel
              class="px-4 py-3 text-body leading-6"
              :workspace-path="conversation?.workspacePath ?? workspacePath"
              :refresh-key="running ? 'run' : conversation?.messages.length"
            />
          </SettingsSection>
          <SettingsSection :title="t('报告', 'Report')">
            <ResearchReportPanel
              class="px-4 py-3 text-body leading-6"
              :workspace-path="conversation?.workspacePath ?? ''"
              :refresh-key="running ? 'run' : conversation?.messages.length"
            />
          </SettingsSection>
        </div>
        </div>
      </div>
      <div v-if="liveTargetVisible" class="relative flex min-h-0 min-w-0 flex-1">
        <div
          class="dossier-split-handle app-no-drag"
          role="separator"
          aria-orientation="vertical"
          data-testid="dossier-split"
          :aria-label="t('调节档案宽度', 'Resize the dossier pane')"
          @pointerdown="startBriefResize"
        />
        <TargetLivePane
          :lease="envLease"
          :conversation-id="conversation?.id"
        />
      </div>
    </div>
    <Dialog v-model:open="showStartEnv">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('这个洞有练习包。先启动？', 'This CVE has a practice package. Start it first?') }}</DialogTitle>
          <DialogDescription>{{ t('启动后右侧打开活靶面。也可以只写报告。', 'Starting opens the live target on the right. You can also write the report only.') }}</DialogDescription>
        </DialogHeader>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" data-testid="repro-report-only" @click="reportOnly">{{ t('只写报告', 'Report only') }}</Button>
          <Button type="button" variant="brand" data-testid="repro-start-env" @click="confirmStartEnv">{{ t('启动并复现', 'Start and reproduce') }}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </main>
  <ConversationDock
    v-if="!chatMaximized && chatDockOpen"
    ref="conversationDock"
    :conversation="conversation ?? null"
    :running="running"
    :aborting="aborting"
    :settings="settings"
    :workspace-path="workspacePath"
    :message-queue="messageQueue"
    :session-ready="sessionReady"
    :resumed="resumed"
    :compacting="compacting"
    :compacted-at="compactedAt"
    :compaction-error="compactionError"
    :turn-status="turnStatus"
    :ctf-session="ctfSession"
    :vulnerability-session="vulnerabilitySession"
    :ctf-mode="ctfMode"
    :ctf-role="ctfRole"
    :model-mode="modelMode"
    :model-provider="modelProvider"
    :model-id="modelId"
    :model-source-preference="modelSourcePreference"
    :execution-mode="executionMode"
    :approval-policy="approvalPolicy"
    :mcp-servers="mcpServers"
    :mcp-config-digest="mcpConfigDigest"
    :ensure-conversation="ensureConversation"
    :pending-composer-draft="pendingComposerDraft"
    @send="(...args) => $emit('send', ...args)"
    @abort="$emit('abort')"
    @select="$emit('selectConversation', $event)"
    @close="$emit('closeDock')"
    @expand="$emit('expand')"
    @consume-pending-draft="$emit('consumePendingDraft')"
    @compact-context="$emit('compactContext')"
    @rewind-context="$emit('rewindContext')"
    @handoff-context="$emit('handoffContext')"
    @control-goal="$emit('controlGoal', $event)"
    @respond-approval="(requestId, approved, scope, choice) => $emit('respondApproval', requestId, approved, scope, choice)"
    @change-model="(mode, provider, model) => $emit('changeModel', mode, provider, model)"
    @change-model-source="$emit('changeModelSource', $event)"
    @change-coding-policy="(mode, policy) => $emit('changeCodingPolicy', mode, policy)"
    @change-mcp-servers="(servers, digest) => $emit('changeMcpServers', servers, digest)"
    @choose-workspace="$emit('chooseWorkspace')"
    @choose-workspace-for-new-task="$emit('chooseWorkspaceForNewTask')"
    @select-workspace="$emit('selectWorkspace', $event)"
    @forget-workspace="$emit('forgetWorkspace', $event)"
    @clear-workspace="$emit('clearWorkspace')"
    @cancel-queued-guidance="$emit('cancelQueuedGuidance', $event)"
    @edit-queued-guidance="$emit('editQueuedGuidance', $event)"
    @open-settings="$emit('openSettings')"
  />
</template>

<style scoped>
.vuln-row { position: relative; cursor: default; transition: background-color 140ms ease; }
.vuln-row-selected { background: var(--hover-2); }
.tactical-table-head { font-family: 'SFMono-Regular', monospace; letter-spacing: .08em; text-transform: uppercase; }
.cve-search-dialog { max-height: min(760px, calc(100vh - 3rem)); overflow: hidden; }
.cve-search-results { max-height: min(470px, calc(100vh - 17rem)); overflow: auto; }
.dossier-split-handle {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 2;
  width: 8px;
  margin-left: -3px;
  cursor: col-resize;
  touch-action: none;
  border: 0;
  padding: 0;
  background: transparent;
}
.dossier-split-handle::after {
  position: absolute;
  inset: 0 3px;
  background: transparent;
  content: '';
}
.dossier-split-handle:hover::after,
.dossier-split-handle:focus-visible::after {
  background: var(--brand);
  opacity: .55;
}
</style>
