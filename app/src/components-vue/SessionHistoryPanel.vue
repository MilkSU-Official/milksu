<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@felinic/ui'
import {
  GitFork,
  History,
  List,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-vue-next'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import { redactProviderCredentials } from '@/lib/redaction'
import type {
  SessionHistoryGraphNode,
  SessionHistoryGraphResponse,
  SessionHistorySearchRequest,
  SessionHistorySearchResult,
  SessionHistorySearchResponse,
  SessionIndexRefreshResult,
  SessionIndexStatus,
} from '@/sessionIndexTypes'

const SessionHistoryGraph = defineAsyncComponent(
  () => import('@/components-vue/SessionHistoryGraph.vue'),
)

defineOptions({ name: 'SessionHistoryPanel' })

const props = withDefaults(defineProps<{
  module: 'coding' | 'ctf' | 'cve'
  defaultQuery?: string
  compact?: boolean
  confirmActionLabel?: string
}>(), {
  defaultQuery: '',
  compact: false,
  confirmActionLabel: '',
})

const emit = defineEmits<{
  confirmResult: [result: SessionHistorySearchResult]
  openSession: [conversationId: string]
}>()

type HistoryModuleFilter = '__all__' | 'coding' | 'ctf' | 'cve'
type HistoryTimeRange = 'all' | '7d' | '30d' | '90d'

const desktopRuntime = hasDesktopRuntime()
const query = ref('')
const status = ref<SessionIndexStatus | null>(null)
const response = ref<SessionHistorySearchResponse | null>(null)
const graphResponse = ref<SessionHistoryGraphResponse | null>(null)
const refreshResult = ref<SessionIndexRefreshResult | null>(null)
const searchLoading = ref(false)
const graphLoading = ref(false)
const refreshing = ref(false)
const error = ref('')
const viewMode = ref<'list' | 'graph'>('list')
const moduleFilter = ref<HistoryModuleFilter>(props.module)
const project = ref('__all__')
const timeRange = ref<HistoryTimeRange>('all')

const loading = computed(() => searchLoading.value || graphLoading.value || refreshing.value)
const moduleLabel = computed(() => ({ coding: 'Coding', ctf: 'CTF', cve: 'CVE' })[props.module])
const suggestedQueries = computed(() => {
  if (props.module === 'ctf') return ['Judge correct=true', 'Endpoint 授权', 'Tool Builder']
  if (props.module === 'cve') return ['CVE-2024-3400', 'NVD 同步', 'Vulhub']
  return ['Computer Use', 'Browser 授权', 'm3:release-check']
})
const statusLine = computed(() => {
  if (!desktopRuntime) return '打包 App 中可查看本机历史'
  if (!status.value) return '准备索引'
  if (!status.value.available) return status.value.reason || '索引准备中'
  return `${status.value.sessionCount} 会话 · ${status.value.messageCount} 消息 · ${status.value.toolCallCount} 工具调用`
})
const since = computed(() => {
  const days = { all: 0, '7d': 7, '30d': 30, '90d': 90 }[timeRange.value]
  if (!days) return ''
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
})
const projects = computed(() => graphResponse.value?.projects ?? [])

function sourceLabel(source = '') {
  if (source === 'milksu-ctf') return 'CTF'
  if (source === 'milksu-cve') return 'CVE'
  if (source === 'milksu-coding') return 'Coding'
  if (source === 'milksu') return 'MilkSU'
  return source || '历史'
}

function redacted(value?: string) {
  return redactProviderCredentials(value || '')
}

function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function filters(): Pick<SessionHistorySearchRequest, 'module' | 'project' | 'since'> {
  return {
    ...(moduleFilter.value !== '__all__' ? { module: moduleFilter.value } : {}),
    ...(project.value !== '__all__' ? { project: project.value } : {}),
    ...(since.value ? { since: since.value } : {}),
  }
}

function changeModule(value: unknown) {
  const next = String(value || '')
  if (!['__all__', 'coding', 'ctf', 'cve'].includes(next)) return
  moduleFilter.value = next as HistoryModuleFilter
  project.value = '__all__'
  void applyFilters()
}

function changeProject(value: unknown) {
  project.value = String(value || '__all__')
  void applyFilters()
}

function changeTimeRange(value: unknown) {
  const next = String(value || '')
  if (!['all', '7d', '30d', '90d'].includes(next)) return
  timeRange.value = next as HistoryTimeRange
  void applyFilters()
}

async function loadStatus() {
  if (!desktopRuntime) return
  error.value = ''
  try {
    status.value = await invokeCommand<SessionIndexStatus>('get_session_index_status')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function runSearch(nextQuery = query.value) {
  const normalized = nextQuery.trim()
  if (!desktopRuntime || !normalized) return
  error.value = ''
  searchLoading.value = true
  query.value = normalized
  try {
    response.value = await invokeCommand<SessionHistorySearchResponse>('search_session_history', {
      request: {
        query: normalized,
        ...filters(),
        limit: props.compact ? 4 : 20,
      },
    })
    status.value = response.value.status
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    searchLoading.value = false
  }
}

async function loadGraph() {
  if (!desktopRuntime || props.compact) return
  error.value = ''
  graphLoading.value = true
  try {
    graphResponse.value = await invokeCommand<SessionHistoryGraphResponse>('get_session_history_graph', {
      request: {
        query: query.value.trim(),
        ...filters(),
        maxNodes: 120,
        maxEdges: 200,
      },
    })
    status.value = graphResponse.value.status
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    graphLoading.value = false
  }
}

async function applyFilters(nextQuery = query.value) {
  await runSearch(nextQuery)
  await loadGraph()
}

async function refreshIndex() {
  if (!desktopRuntime) return
  error.value = ''
  refreshing.value = true
  try {
    refreshResult.value = await invokeCommand<SessionIndexRefreshResult>('refresh_session_index')
    await applyFilters()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    refreshing.value = false
  }
}

function confirmGraphNode(node: SessionHistoryGraphNode) {
  const source = node.sources[0]
  emit('confirmResult', {
    messageUuid: source?.messageUuid || node.id,
    sessionId: source?.sessionId || '',
    sessionName: source?.sessionName || node.label,
    project: node.project,
    source: node.module ? `milksu-${node.module}` : 'milksu',
    timestamp: source?.timestamp || node.timestamp,
    snippet: node.quote || node.detail || node.label,
  })
}

onMounted(async () => {
  query.value = props.defaultQuery.trim() || suggestedQueries.value[0]
  await loadStatus()
  await applyFilters(query.value)
})

watch(() => props.defaultQuery, value => {
  const normalized = (value || '').trim()
  if (normalized && normalized !== query.value) query.value = normalized
})

defineExpose({ refresh: refreshIndex })
</script>

<template>
  <section class="border-b border-border px-4 py-4" data-session-history-panel>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <History class="size-4 text-primary" />
          <h3 class="text-label font-medium">相关历史</h3>
          <Badge variant="outline">{{ moduleLabel }}</Badge>
        </div>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ statusLine }}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        :disabled="loading || !desktopRuntime"
        aria-label="刷新相关历史索引"
        @click="refreshIndex"
      >
        <RefreshCw class="size-4" :class="{ 'animate-spin': refreshing }" />
      </Button>
    </div>

    <div v-if="!compact" class="mt-3 flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" aria-label="历史视图">
        <Button
          type="button"
          size="sm"
          :variant="viewMode === 'list' ? 'secondary' : 'ghost'"
          aria-label="列表视图"
          @click="viewMode = 'list'"
        >
          <List class="size-3.5" />列表
        </Button>
        <Button
          type="button"
          size="sm"
          :variant="viewMode === 'graph' ? 'secondary' : 'ghost'"
          aria-label="图谱视图"
          @click="viewMode = 'graph'"
        >
          <GitFork class="size-3.5" />图谱
        </Button>
      </div>
      <Select :model-value="moduleFilter" @update:model-value="changeModule">
        <SelectTrigger size="sm" class="w-32" aria-label="按模块筛选相关历史">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部模块</SelectItem>
          <SelectItem value="coding">Coding</SelectItem>
          <SelectItem value="ctf">CTF</SelectItem>
          <SelectItem value="cve">CVE</SelectItem>
        </SelectContent>
      </Select>
      <Select :model-value="project" @update:model-value="changeProject">
        <SelectTrigger size="sm" class="w-40" aria-label="按项目筛选相关历史">
          <SelectValue placeholder="全部项目" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部项目</SelectItem>
          <SelectItem v-for="item in projects" :key="item" :value="item">{{ item }}</SelectItem>
        </SelectContent>
      </Select>
      <Select :model-value="timeRange" @update:model-value="changeTimeRange">
        <SelectTrigger size="sm" class="w-32" aria-label="按时间筛选相关历史">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部时间</SelectItem>
          <SelectItem value="7d">最近 7 天</SelectItem>
          <SelectItem value="30d">最近 30 天</SelectItem>
          <SelectItem value="90d">最近 90 天</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <form class="mt-3 flex items-center gap-2" @submit.prevent="applyFilters()">
      <label class="relative min-w-0 flex-1">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="query" size="sm" class="pl-8" placeholder="搜索历史会话" aria-label="搜索相关历史" />
      </label>
      <Button type="submit" variant="outline" size="sm" :disabled="loading || !desktopRuntime || !query.trim()">
        搜索
      </Button>
    </form>

    <div class="mt-2 flex flex-wrap gap-1.5">
      <Button
        v-for="item in suggestedQueries"
        :key="item"
        type="button"
        variant="ghost"
        size="sm"
        :disabled="loading || !desktopRuntime"
        @click="applyFilters(item)"
      >
        {{ item }}
      </Button>
    </div>

    <p v-if="error" class="mt-3 text-caption leading-5 text-destructive">{{ error }}</p>

    <div v-if="loading && viewMode === 'list'" class="mt-4 flex items-center gap-2 text-caption text-muted-foreground">
      <LoaderCircle class="size-3.5 animate-spin" />正在读取历史
    </div>

    <SessionHistoryGraph
      v-else-if="!compact && viewMode === 'graph'"
      :response="graphResponse"
      :loading="graphLoading"
      :confirm-action-label="confirmActionLabel"
      @open-session="emit('openSession', $event)"
      @confirm-node="confirmGraphNode"
    />

    <div v-else-if="response?.results.length" class="mt-4 space-y-3">
      <article v-for="result in response.results" :key="result.messageUuid" class="rounded-xl border border-border bg-card px-3 py-3">
        <div class="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">{{ sourceLabel(result.source) }}</Badge>
          <p class="min-w-0 flex-1 truncate text-body font-medium">{{ redacted(result.sessionName) }}</p>
          <span class="shrink-0 text-caption text-muted-foreground">{{ formatTime(result.timestamp) }}</span>
        </div>
        <p class="mt-2 line-clamp-4 text-caption leading-5 text-muted-foreground">{{ redacted(result.snippet) }}</p>
        <p v-if="result.skill" class="mt-2 truncate font-mono text-caption text-muted-foreground">{{ redacted(result.skill) }}</p>
        <div v-if="confirmActionLabel" class="mt-3 flex justify-end">
          <Button type="button" variant="outline" size="sm" @click="emit('confirmResult', result)">
            {{ confirmActionLabel }}
          </Button>
        </div>
      </article>
    </div>

    <p v-else class="mt-4 text-caption leading-5 text-muted-foreground">
      {{ desktopRuntime ? '还没有匹配的历史。' : '请在打包 App 中查看真实历史。' }}
    </p>
  </section>
</template>
