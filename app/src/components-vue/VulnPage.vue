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
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Link2,
  LoaderCircle,
  Plus,
  Search,
} from 'lucide-vue-next'
import CollectionPicker from '@/components-vue/CollectionPicker.vue'
import CollectionViewFilter from '@/components-vue/CollectionViewFilter.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import { useVulnerabilityDashboard, type VulnerabilityCodingTask, type VulnerabilityDashboard, type VulnerabilitySearchCandidate } from '@/composables/useVulnerabilityDashboard'
import type { Conversation } from '@/types'
import { vulnerabilityStatusLabel, type VulnerabilityIntel, type VulnerabilitySeverity, type VulnerabilityStatus } from '@/vulnerabilityIntel'
import { ALL_COLLECTIONS_ID, createItemCollectionStore } from '@/lib/itemCollections'

defineOptions({ name: 'VulnPage' })

const props = withDefaults(defineProps<{
  dashboard?: VulnerabilityDashboard
  codingWorkspacePath?: string
  navigationEpoch?: number
  conversations?: Conversation[]
}>(), {
  codingWorkspacePath: '',
  navigationEpoch: 0,
  conversations: () => [],
})

const emit = defineEmits<{
  chooseCodingWorkspace: []
  startCodingTask: [task: VulnerabilityCodingTask, recordHandoff: (workspacePath: string) => void]
  openCodingConversation: [id: string]
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

const filteredItems = computed(() => {
  const allowed = collectionView.value === ALL_COLLECTIONS_ID
    ? null
    : new Set(cveCollections.itemKeysFor(collectionView.value))
  return dashboard.tracked.value.filter(item => (
    (statusFilter.value === 'all' || item.status === statusFilter.value)
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

watch([() => dashboard.query.value, statusFilter], () => { page.value = 1 })
watch(pageCount, count => { if (page.value > count) page.value = count })
watch(
  () => filteredItems.value.map(item => item.id).join('|'),
  () => {
    if (!filteredItems.value.length) return
    if (!filteredItems.value.some(item => item.id === dashboard.selectedId.value)) {
      dashboard.selectedId.value = filteredItems.value[0].id
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

function selectItem(id: string) {
  dashboard.selectedId.value = id
}

function startCoding(item: VulnerabilityIntel) {
  selectItem(item.id)
  const task = dashboard.codingTaskForSelected.value
  if (!task) return
  emit('startCodingTask', task, workspacePath => {
    dashboard.recordCodingHandoff(item.id, task, workspacePath)
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

function statusVariant(status: VulnerabilityStatus) {
  if (status === '已验证') return 'success'
  if (status === '研究中') return 'info'
  if (status === '待复现') return 'warning'
  return 'secondary'
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
      summary: 'NVD 暂未返回公开记录；已按 CVE 编号加入，后续可重新搜索或交给 Coding 核对公开材料。',
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
  <main class="tactical-page flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
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
          <p class="text-caption text-muted-foreground">NVD 暂无结果，可以先只记录 {{ directCveId }}，其他资料以后再补。</p>
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
      <div class="min-w-[1040px]">
        <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[170px_minmax(260px,1.2fr)_minmax(190px,.9fr)_100px_150px_42px_120px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
          <span>CVE</span><span>漏洞</span><span>厂商/产品</span><span>严重性</span><span>我的状态</span><span class="sr-only">收藏</span><span>最近研究</span>
        </div>

        <template v-for="item in visibleItems" :key="item.id">
          <button
            type="button"
            class="vuln-row tactical-row grid min-h-[72px] w-full grid-cols-[170px_minmax(260px,1.2fr)_minmax(190px,.9fr)_100px_150px_42px_120px] items-center gap-4 px-6 text-left"
            :class="item.id === dashboard.selectedId.value ? 'vuln-row-selected' : ''"
            :aria-expanded="item.id === dashboard.selectedId.value"
            @click="selectItem(item.id)"
          >
            <span class="font-mono text-body" :class="item.id === dashboard.selectedId.value ? 'text-primary' : ''">{{ item.id }}</span>
            <span class="min-w-0 truncate text-control font-medium">{{ item.title }}</span>
            <span class="min-w-0">
              <span class="block truncate text-body">{{ item.vendor }}</span>
              <span class="mt-0.5 block truncate text-caption text-muted-foreground">{{ item.product }}</span>
            </span>
            <span><Badge :variant="severityVariant(item.severity)" font="mono">{{ item.cvss.toFixed(1) }}</Badge></span>
            <span><Badge :variant="statusVariant(item.status)">{{ vulnerabilityStatusLabel(item.status) }}</Badge></span>
            <CollectionPicker :item-key="item.id" :store="cveCollections" @click.stop />
            <span class="text-caption text-muted-foreground">{{ recentResearch(item) }}</span>
          </button>

          <div v-if="item.id === dashboard.selectedId.value" class="game-focus-panel tactical-acid-panel border-b px-6 py-5">
            <div class="flex flex-wrap items-start justify-between gap-5">
              <div class="min-w-0 flex-1">
                <p class="max-w-4xl text-body leading-6 text-muted-foreground">{{ item.summary }}</p>
                <div class="mt-4 flex flex-wrap items-center gap-5 text-caption">
                  <span class="inline-flex items-center gap-2"><Link2 class="size-4" />公开来源 {{ item.references.length }}</span>
                  <span class="inline-flex items-center gap-2 text-info"><Code2 class="size-4" />关联对话 {{ relatedConversations(item.id).length }}</span>
                </div>
                <div v-if="item.references.length" class="mt-3 flex flex-wrap gap-2">
                  <Button
                    v-for="reference in keyReferences(item)"
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
                  <Button
                    v-if="item.references.length > 5"
                    as="a"
                    :href="`https://nvd.nist.gov/vuln/detail/${item.id}`"
                    target="_blank"
                    rel="noreferrer"
                    variant="outline"
                    size="sm"
                  >
                    在 NVD 查看全部<ExternalLink class="size-3" />
                  </Button>
                </div>
              </div>
              <div class="flex shrink-0 items-end gap-3">
                <label class="min-w-40 text-caption text-muted-foreground">我的状态
                  <NativeSelect
                    :model-value="item.status"
                    size="sm"
                    class="mt-2 w-full"
                    :aria-label="`${item.id} 状态`"
                    @change="setStatus(item.id, $event)"
                  >
                    <NativeSelectOption v-for="option in statusOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </NativeSelectOption>
                  </NativeSelect>
                </label>
                <Button variant="brand" @click="startCoding(item)">
                  <Code2 class="size-4" />
                  交给 Coding
                  <ArrowRight class="size-4" />
                </Button>
              </div>
            </div>

            <div v-if="relatedConversations(item.id).length" class="mt-4 border border-border bg-background/40">
              <p class="border-b border-border px-4 py-3 text-caption font-medium text-muted-foreground">关联的 Coding 对话</p>
              <button
                v-for="conversation in relatedConversations(item.id)"
                :key="conversation.id"
                type="button"
                class="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/30"
                @click="emit('openCodingConversation', conversation.id)"
              >
                <Code2 class="size-4 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate text-body">{{ conversation.title }}</span>
                <span class="text-caption text-muted-foreground">{{ recentResearch(item) }}</span>
              </button>
            </div>
          </div>
        </template>

        <div v-if="!visibleItems.length" class="grid min-h-64 place-items-center px-8 text-center">
          <div>
            <p class="text-control font-medium">{{ dashboard.tracked.value.length ? '没有匹配的 CVE' : '还没有添加 CVE' }}</p>
            <p class="mt-2 text-caption text-muted-foreground">{{ dashboard.tracked.value.length ? (collectionView === ALL_COLLECTIONS_ID ? '换个关键词或状态试试。' : '这个收藏夹还是空的。') : '添加一个你想研究的公开 CVE。' }}</p>
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
</template>

<style scoped>
.vuln-row { position: relative; transition: background-color 140ms ease; }
.vuln-row-selected { background: var(--focus-panel); box-shadow: inset 3px 0 0 var(--brand); }
.tactical-table-head { font-family: 'SFMono-Regular', monospace; letter-spacing: .08em; text-transform: uppercase; }
.cve-search-dialog { max-height: min(760px, calc(100vh - 3rem)); overflow: hidden; }
.cve-search-results { max-height: min(470px, calc(100vh - 17rem)); overflow: auto; }
</style>
