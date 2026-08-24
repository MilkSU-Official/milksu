<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
} from '@felinic/ui'
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Plus,
  Search,
} from 'lucide-vue-next'
import CollectionPicker from '@/components-vue/CollectionPicker.vue'
import CollectionViewFilter from '@/components-vue/CollectionViewFilter.vue'
import ConversationDock from '@/components-vue/ConversationDock.vue'
import RelatedCvePanel from '@/components-vue/RelatedCvePanel.vue'
import ResearchReportPanel from '@/components-vue/ResearchReportPanel.vue'
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
import { relatedDomainConversations } from '@/lib/workspaceSessionRouting'
import { presentVulnerabilityVendorProduct } from '@/lib/vulnerabilityFeedImport'

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
  consumePendingDraft: []
  compactContext: []
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation']
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
}>()

const dashboard = props.dashboard ?? useVulnerabilityDashboard()
const showCveSearch = ref(false)
const showLearningTopics = ref(false)
const cveSearchQuery = ref('')
const cveSearchError = ref('')
const cveSearchLoading = ref(false)
const cveSearchResults = ref<VulnerabilitySearchCandidate[]>([])
const cveSearchAttempted = ref(false)
const cveCollections = createItemCollectionStore('milksu.cve.collections.v1')
const collectionView = ref(ALL_COLLECTIONS_ID)
const statusFilter = ref<'all' | VulnerabilityStatus>('all')
const kevFilter = ref<'all' | 'kev' | 'other'>('all')
const vendorFilter = ref('')
const yearFilter = ref('')
const page = ref(1)
const pageSize = 20

const statusOptions: Array<{ value: VulnerabilityStatus; label: string }> = [
  { value: '待复现', label: '想研究' },
  { value: '研究中', label: '研究中' },
  { value: '已验证', label: '已验证' },
  { value: '已分流', label: '已归档' },
]

const learningTopics = [
  { title: '命令与参数注入', query: 'command injection' },
  { title: '反序列化与协议边界', query: 'deserialization' },
  { title: '供应链与组件信任', query: 'supply chain' },
] as const

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
  )).sort((left, right) => right.createdAt - left.createdAt)
}

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

const dossierConversations = computed(() => relatedDomainConversations(
  props.conversations,
  props.conversation ?? relatedConversations(selectedItem.value?.id ?? '')[0] ?? null,
))

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
}

function confirmStartEnv() {
  const item = selectedItem.value
  showStartEnv.value = false
  if (!item) return
  pendingOpen.value = true
  void startEnv(cvePackageId.value)
  emit('run', item)
}

function reportOnly() {
  const item = selectedItem.value
  showStartEnv.value = false
  if (!item) return
  emit('run', item)
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
  const status = statusOptions.find(option => option.value === raw)?.value
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
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
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

function openCveSearch() {
  showLearningTopics.value = false
  showCveSearch.value = true
  cveSearchError.value = ''
  cveSearchResults.value = []
  cveSearchAttempted.value = false
  cveSearchQuery.value = ''
}

async function openLearningTopic(query: string) {
  showLearningTopics.value = false
  showCveSearch.value = true
  cveSearchQuery.value = query
  cveSearchError.value = ''
  cveSearchResults.value = []
  cveSearchAttempted.value = false
  await searchCves()
}

function readableCveSearchError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/HTTP\s*(429|502|503|504)|timeout|timed out|deadline exceeded|network|fetch failed/i.test(message)) {
    return '公开 CVE 服务暂时繁忙，请稍后重试。'
  }
  if (/请输入至少 2 个字符/.test(message)) return '请至少输入 2 个字符。'
  return '暂时无法读取公开 CVE，请稍后重试。'
}

async function searchCves() {
  cveSearchError.value = ''
  cveSearchResults.value = []
  cveSearchAttempted.value = true
  cveSearchLoading.value = true
  try {
    cveSearchResults.value = await dashboard.searchNvdCves(cveSearchQuery.value)
    if (!cveSearchResults.value.length) cveSearchError.value = '没有找到匹配的公开 CVE。'
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
      title: `${directCveId.value} · 待补公开资料`,
      vendor: '',
      product: '',
      affected: '',
      summary: 'NVD 暂未返回公开记录；已按 CVE 编号加入。',
    })
    showCveSearch.value = false
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
    showCveSearch.value = false
  } catch (cause) {
    cveSearchError.value = readableCveSearchError(cause)
  }
}

</script>

<template>
  <main v-if="!selectedItem" class="tactical-page flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <WorkspaceModuleTopBar module="cve" title="漏洞">
      <template #actions>
        <Button
          variant="ghost"
          size="sm"
          :aria-expanded="showLearningTopics"
          @click="showLearningTopics = !showLearningTopics"
        >
          <BookOpen class="size-4" />
          学习专题
        </Button>
        <Button variant="brand" size="sm" @click="openCveSearch">
          <Plus class="size-4" />
          添加 CVE
        </Button>
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
              placeholder="搜索我添加的 CVE…"
              aria-label="搜索 CVE"
            />
          </label>
          <NativeSelect v-model="statusFilter" size="sm" class="w-40" aria-label="按我的状态筛选">
            <NativeSelectOption value="all">我的状态：全部</NativeSelectOption>
            <NativeSelectOption v-for="option in statusOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </NativeSelectOption>
          </NativeSelect>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <NativeSelect v-model="dashboard.severity.value" size="sm" class="w-40" aria-label="严重性">
              <NativeSelectOption value="all">严重性：全部</NativeSelectOption>
              <NativeSelectOption value="critical">严重</NativeSelectOption>
              <NativeSelectOption value="high">高</NativeSelectOption>
              <NativeSelectOption value="medium">中</NativeSelectOption>
            </NativeSelect>
            <NativeSelect v-model="kevFilter" size="sm" class="w-40" aria-label="KEV">
              <NativeSelectOption value="all">KEV：全部</NativeSelectOption>
              <NativeSelectOption value="kev">在 KEV</NativeSelectOption>
              <NativeSelectOption value="other">不在 KEV</NativeSelectOption>
            </NativeSelect>
            <NativeSelect v-model="vendorFilter" size="sm" class="w-44" aria-label="厂商">
              <NativeSelectOption value="">厂商：全部</NativeSelectOption>
              <NativeSelectOption v-for="vendor in vendorOptions" :key="vendor" :value="vendor">
                {{ vendor }}
              </NativeSelectOption>
            </NativeSelect>
            <NativeSelect v-model="yearFilter" size="sm" class="w-36" aria-label="年份">
              <NativeSelectOption value="">年份：全部</NativeSelectOption>
              <NativeSelectOption v-for="year in yearOptions" :key="year" :value="year">
                {{ year }}
              </NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
      </template>
    </WorkspaceModuleTopBar>

    <section v-if="showLearningTopics" class="grid shrink-0 gap-3 border-b border-border bg-card/40 px-6 py-4 md:grid-cols-3" aria-label="CVE 学习专题">
      <button
        v-for="topic in learningTopics"
        :key="topic.title"
        type="button"
        class="tactical-command-surface flex items-center justify-between gap-4 border border-border px-4 py-3 text-left transition-colors hover:border-primary/50"
        @click="openLearningTopic(topic.query)"
      >
        <span class="text-control font-semibold">{{ topic.title }}</span>
        <Search class="size-4 shrink-0 text-primary" />
      </button>
    </section>

    <Dialog v-model:open="showCveSearch">
      <DialogContent class="cve-search-dialog sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>查找公开 CVE</DialogTitle>
          <DialogDescription>输入 CVE 编号、产品名或关键词，从 NVD 公开资料中选择。</DialogDescription>
        </DialogHeader>

        <form class="flex gap-2" @submit.prevent="searchCves">
          <label class="relative min-w-0 flex-1">
            <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="cveSearchQuery"
              class="pl-9"
              autofocus
              aria-label="搜索公开 CVE"
              placeholder="例如 CVE-2024-3400、ActiveMQ、Android deserialization"
            />
          </label>
          <Button type="submit" variant="brand" :disabled="cveSearchLoading || cveSearchQuery.trim().length < 2">
            <LoaderCircle v-if="cveSearchLoading" class="size-4 animate-spin" />
            <Search v-else class="size-4" />
            搜索
          </Button>
        </form>

        <p v-if="cveSearchError" class="text-caption text-destructive" role="alert">{{ cveSearchError }}</p>

        <div v-if="canAddDirectCve" class="flex flex-wrap items-center justify-between gap-3 border border-border bg-muted/30 px-4 py-3">
          <p class="font-mono text-caption">{{ directCveId }}</p>
          <Button size="sm" variant="outline" @click="addDirectCve">仅按编号加入</Button>
        </div>

        <div v-if="cveSearchResults.length" class="cve-search-results divide-y divide-border border border-border" aria-label="公开 CVE 搜索结果">
          <article v-for="candidate in cveSearchResults" :key="candidate.id" class="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="font-mono text-control text-primary">{{ candidate.id }}</strong>
                <Badge v-if="candidate.cvss > 0" :variant="severityVariant(candidate.severity)" font="mono">{{ candidate.cvss.toFixed(1) }}</Badge>
              </div>
              <p class="mt-1 line-clamp-2 text-body font-medium">{{ candidate.title }}</p>
              <p class="mt-1 text-caption text-muted-foreground">{{ candidate.updated || 'NVD 公开记录' }}</p>
            </div>
            <Button
              size="sm"
              :disabled="dashboard.watched.value.includes(candidate.id)"
              @click="addSearchResult(candidate)"
            >
              {{ dashboard.watched.value.includes(candidate.id) ? '已在列表' : '加入研究' }}
            </Button>
          </article>
        </div>
      </DialogContent>
    </Dialog>

    <section class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" aria-label="CVE 列表">
      <div class="min-w-[1120px]">
        <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[170px_minmax(240px,1.2fr)_minmax(160px,.9fr)_88px_132px_42px_minmax(7rem,1fr)_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
          <span class="whitespace-nowrap">CVE</span>
          <span class="whitespace-nowrap">漏洞</span>
          <span class="whitespace-nowrap">厂商/产品</span>
          <span class="whitespace-nowrap">严重性</span>
          <span class="whitespace-nowrap">我的状态</span>
          <span class="sr-only">收藏</span>
          <span class="whitespace-nowrap">最近研究</span>
          <span class="sr-only">打开</span>
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
            <Button size="sm" variant="outline" data-testid="open-item" @click="selectItem(item.id)">打开</Button>
          </article>
        </template>

        <div v-if="!visibleItems.length" class="grid min-h-64 place-items-center px-8 text-center">
          <div>
            <p v-if="dashboard.tracked.value.length" class="text-control font-medium">没有匹配的 CVE</p>
          </div>
        </div>
      </div>
    </section>

    <footer class="flex h-14 shrink-0 items-center justify-between border-t border-border px-6">
      <span class="text-caption text-muted-foreground">共 {{ filteredItems.length }} 条</span>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" :disabled="page <= 1" aria-label="上一页" @click="page -= 1"><ChevronLeft class="size-4" /></Button>
        <Button variant="outline" size="icon-sm">{{ page }}</Button>
        <Button variant="ghost" size="icon-sm" :disabled="page >= pageCount" aria-label="下一页" @click="page += 1"><ChevronRight class="size-4" /></Button>
      </div>
    </footer>
  </main>

  <main v-else class="tactical-page flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <WorkspaceModuleTopBar module="cve" :title="selectedItem.id" :subtitle="selectedItem.title">
      <template #leading>
        <Button variant="ghost" size="icon-sm" aria-label="返回漏洞列表" @click="clearSelection">
          <ArrowLeft class="size-4" />
        </Button>
      </template>
      <template #actions>
        <NativeSelect
          :model-value="selectedItem.status"
          size="sm"
          class="w-32"
          :aria-label="`${selectedItem.id} 状态`"
          @change="setStatus(selectedItem.id, $event)"
        >
          <NativeSelectOption v-for="option in statusOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </NativeSelectOption>
        </NativeSelect>
        <Button variant="brand" size="sm" @click="startReproduction">开始复现</Button>
      </template>
    </WorkspaceModuleTopBar>
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col" :class="targetOpen ? 'max-w-md border-r border-border' : ''">
        <div class="min-h-0 flex-1 overflow-auto">
        <div class="space-y-5 px-6 py-6" :class="targetOpen ? '' : 'mx-auto max-w-5xl'">
          <section class="rounded-xl border border-border bg-card p-6">
            <p class="text-body leading-6 text-muted-foreground">{{ selectedItem.summary }}</p>
            <div v-if="selectedItem.references.length" class="mt-4 flex flex-wrap gap-2">
              <Button
                v-for="reference in keyReferences(selectedItem)"
                :key="reference.href"
                as="a"
                :href="reference.href"
                target="_blank"
                rel="noreferrer"
                variant="outline"
                size="sm"
              >
                {{ referenceLabel(reference.label, reference.href) }}<ExternalLink class="size-3" />
              </Button>
            </div>
          </section>
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
          />
          <section class="rounded-xl border border-border bg-card p-6">
            <h2 class="text-label font-medium">关联 CVE</h2>
            <RelatedCvePanel
              class="mt-4"
              :workspace-path="conversation?.workspacePath ?? workspacePath"
              :refresh-key="running ? 'run' : conversation?.messages.length"
            />
          </section>
          <section class="rounded-xl border border-border bg-card p-6">
            <h2 class="text-label font-medium">报告</h2>
            <ResearchReportPanel
              class="mt-4"
              :workspace-path="conversation?.workspacePath ?? ''"
              :refresh-key="running ? 'run' : conversation?.messages.length"
            />
          </section>
        </div>
        </div>
        <ConversationDock
          v-if="targetOpen"
          placement="column"
          :conversation="conversation ?? null"
          :conversations="dossierConversations"
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
          @create="$emit('createConversation')"
          @expand="$emit('expand')"
          @consume-pending-draft="$emit('consumePendingDraft')"
          @compact-context="$emit('compactContext')"
          @control-goal="$emit('controlGoal', $event)"
          @respond-approval="(requestId, approved, scope) => $emit('respondApproval', requestId, approved, scope)"
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
      </div>
      <TargetLivePane
        v-if="targetOpen && envLease.state === 'ready'"
        :lease="envLease"
        :conversation-id="conversation?.id"
      />
    </div>
    <ConversationDock
      v-if="!targetOpen"
      :conversation="conversation ?? null"
      :conversations="dossierConversations"
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
      @create="$emit('createConversation')"
      @expand="$emit('expand')"
      @consume-pending-draft="$emit('consumePendingDraft')"
      @compact-context="$emit('compactContext')"
      @control-goal="$emit('controlGoal', $event)"
      @respond-approval="(requestId, approved, scope) => $emit('respondApproval', requestId, approved, scope)"
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

    <Dialog v-model:open="showStartEnv">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>这个洞有练习包。先启动？</DialogTitle>
          <DialogDescription>启动后右侧打开活靶面。也可以只写报告。</DialogDescription>
        </DialogHeader>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" data-testid="repro-report-only" @click="reportOnly">只写报告</Button>
          <Button type="button" variant="brand" data-testid="repro-start-env" @click="confirmStartEnv">启动并复现</Button>
        </div>
      </DialogContent>
    </Dialog>
  </main>
</template>

<style scoped>
.vuln-row { position: relative; cursor: default; transition: background-color 140ms ease; }
.vuln-row-selected { background: var(--focus-panel); box-shadow: inset 4px 0 0 var(--signal-gold); }
.tactical-table-head { font-family: 'SFMono-Regular', monospace; letter-spacing: .08em; text-transform: uppercase; }
.cve-search-dialog { max-height: min(760px, calc(100vh - 3rem)); overflow: hidden; }
.cve-search-results { max-height: min(470px, calc(100vh - 17rem)); overflow: auto; }
</style>
