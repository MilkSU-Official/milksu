<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Badge, Button } from '@felinic/ui'
import { ExternalLink, Focus, LoaderCircle, Minus, Plus, Quote } from 'lucide-vue-next'
import { Graph, NodeEvent, type GraphOptions } from '@antv/g6'
import { redactProviderCredentials } from '@/lib/redaction'
import type {
  SessionHistoryGraphEdge,
  SessionHistoryGraphNode,
  SessionHistoryGraphNodeType,
  SessionHistoryGraphResponse,
} from '@/sessionIndexTypes'

defineOptions({ name: 'SessionHistoryGraph' })

const props = withDefaults(defineProps<{
  response: SessionHistoryGraphResponse | null
  loading?: boolean
  confirmActionLabel?: string
}>(), {
  loading: false,
  confirmActionLabel: '确认引用',
})

const emit = defineEmits<{
  openSession: [conversationId: string]
  confirmNode: [node: SessionHistoryGraphNode]
}>()

const graphContainer = ref<HTMLElement | null>(null)
const selectedNodeID = ref('')
const renderError = ref('')
const themeMode = ref<'light' | 'dark'>('dark')

let graph: Graph | null = null
let resizeObserver: ResizeObserver | null = null
let observedContainer: HTMLElement | null = null
let themeObserver: MutationObserver | null = null
let renderGeneration = 0

const nodeTypeLabels: Record<SessionHistoryGraphNodeType, string> = {
  project: '项目',
  session: '会话',
  goal: '目标',
  ctf: 'CTF',
  cve: 'CVE',
  model: '模型',
  tool: '工具',
  skill: 'Skill',
  evidence: '证据',
  artifact: '制品',
}

const edgeTypeLabels: Record<SessionHistoryGraphEdge['type'], string> = {
  contains: '包含',
  uses: '使用',
  calls: '调用',
  loads: '加载',
  focuses: '聚焦',
  mentions: '提及',
  'derived-from': '派生自',
}

const nodeColors: Record<'light' | 'dark', Record<SessionHistoryGraphNodeType, string>> = {
  dark: {
    project: '#6aa9ff',
    session: '#9fef00',
    goal: '#f6c344',
    ctf: '#c494ff',
    cve: '#ff7b73',
    model: '#66d9b7',
    tool: '#69c7dc',
    skill: '#ef91c5',
    evidence: '#ffd979',
    artifact: '#9bc5ff',
  },
  light: {
    project: '#2f6fa7',
    session: '#5f9800',
    goal: '#b87900',
    ctf: '#7b55c7',
    cve: '#c2413a',
    model: '#247a63',
    tool: '#287a8d',
    skill: '#a64279',
    evidence: '#8b5a00',
    artifact: '#486ab3',
  },
}

function redacted(value?: string) {
  return redactProviderCredentials(value || '')
}

function safeNode(node: SessionHistoryGraphNode): SessionHistoryGraphNode {
  return {
    ...node,
    label: redacted(node.label),
    detail: redacted(node.detail),
    project: redacted(node.project),
    archiveId: redacted(node.archiveId),
    quote: redacted(node.quote),
    sources: node.sources.map(source => ({
      ...source,
      sessionName: redacted(source.sessionName),
    })),
  }
}

const nodes = computed(() => (props.response?.nodes ?? []).map(safeNode))
const nodeIDs = computed(() => new Set(nodes.value.map(node => node.id)))
const edges = computed(() => (props.response?.edges ?? []).filter(edge => (
  nodeIDs.value.has(edge.source) && nodeIDs.value.has(edge.target)
)))
const selectedNode = computed(() => (
  nodes.value.find(node => node.id === selectedNodeID.value) ?? null
))
const visibleNodeTypes = computed(() => {
  const types = new Set(nodes.value.map(node => node.type))
  return (Object.keys(nodeTypeLabels) as SessionHistoryGraphNodeType[])
    .filter(type => types.has(type))
})
const visibleEdgeTypes = computed(() => {
  const types = new Set(edges.value.map(edge => edge.type))
  return (Object.keys(edgeTypeLabels) as SessionHistoryGraphEdge['type'][])
    .filter(type => types.has(type))
})

function readThemeMode(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function cssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function nodeColor(type: SessionHistoryGraphNodeType) {
  return nodeColors[themeMode.value][type]
}

function shortenLabel(label: string) {
  const normalized = label.replace(/\s+/g, ' ').trim()
  return normalized.length > 28 ? `${normalized.slice(0, 27)}…` : normalized
}

function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function graphData(): NonNullable<GraphOptions['data']> {
  const foreground = cssColor('--foreground', themeMode.value === 'dark' ? '#f4f4f4' : '#17201b')
  const border = cssColor('--border-hairline', themeMode.value === 'dark' ? '#344158' : '#c6d3bd')
  const edgeStroke = cssColor('--muted-foreground', themeMode.value === 'dark' ? '#8799b5' : '#657569')
  const showEdgeLabels = edges.value.length <= 60

  return {
    nodes: nodes.value.map(node => ({
      id: node.id,
      data: { kind: node.type },
      style: {
        size: node.type === 'session' || node.type === 'project' ? 32 : 25,
        fill: nodeColor(node.type),
        stroke: border,
        lineWidth: 2,
        labelText: shortenLabel(node.label),
        labelFill: foreground,
        labelFontSize: 11,
        labelFontWeight: node.type === 'session' ? 600 : 500,
        labelPlacement: 'bottom' as const,
        labelOffsetY: 4,
        labelMaxWidth: 132,
        labelWordWrap: true,
      },
    })),
    edges: edges.value.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: { kind: edge.type },
      style: {
        stroke: edgeStroke,
        strokeOpacity: 0.58,
        lineWidth: 1,
        endArrow: true,
        labelText: showEdgeLabels ? edgeTypeLabels[edge.type] : '',
        labelFill: edgeStroke,
        labelFontSize: 9,
        labelBackground: true,
        labelBackgroundFill: cssColor('--card', themeMode.value === 'dark' ? '#151f2e' : '#ffffff'),
        labelBackgroundFillOpacity: 0.82,
        labelPadding: [1, 3],
      },
    })),
  }
}

function graphOptions(container: HTMLElement): GraphOptions {
  const foreground = cssColor('--foreground', themeMode.value === 'dark' ? '#f4f4f4' : '#17201b')
  const selectedStroke = cssColor('--primary', themeMode.value === 'dark' ? '#9fef00' : '#5f9800')
  return {
    container,
    data: graphData(),
    animation: false,
    theme: themeMode.value,
    zoomRange: [0.25, 3],
    layout: {
      type: 'antv-dagre',
      rankdir: 'LR',
      nodesep: 34,
      ranksep: 72,
      animation: false,
    },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
    node: {
      type: 'circle',
      animation: false,
      state: {
        selected: {
          halo: true,
          haloLineWidth: 10,
          haloStroke: selectedStroke,
          haloStrokeOpacity: 0.24,
          lineWidth: 3,
          stroke: selectedStroke,
          labelFill: foreground,
          labelFontWeight: 600,
        },
      },
    },
    edge: {
      animation: false,
    },
  }
}

function destroyGraph() {
  renderGeneration += 1
  if (graph && !graph.destroyed) graph.destroy()
  graph = null
}

function observeGraphContainer(container: HTMLElement) {
  if (typeof ResizeObserver === 'undefined' || observedContainer === container) return
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (graph && !graph.destroyed) graph.resize()
    })
  }
  resizeObserver.disconnect()
  resizeObserver.observe(container)
  observedContainer = container
}

async function renderGraph() {
  if (props.loading) {
    destroyGraph()
    return
  }
  const container = graphContainer.value
  if (!container || nodes.value.length === 0) {
    destroyGraph()
    return
  }

  observeGraphContainer(container)
  const generation = ++renderGeneration
  if (graph && !graph.destroyed) graph.destroy()
  graph = null
  renderError.value = ''

  try {
    const nextGraph = new Graph(graphOptions(container))
    graph = nextGraph
    nextGraph.on(NodeEvent.CLICK, event => {
      const id = String((event as unknown as { target: { id: string | number } }).target.id)
      void selectNode(id)
    })
    await nextGraph.render()
    if (generation !== renderGeneration || nextGraph.destroyed) return
    await nextGraph.fitView({ when: 'always', direction: 'both' }, false)
    if (selectedNodeID.value && nodeIDs.value.has(selectedNodeID.value)) {
      await nextGraph.setElementState(selectedNodeID.value, 'selected', false)
    }
  } catch (cause) {
    if (generation !== renderGeneration) return
    renderError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function selectNode(id: string) {
  if (!nodeIDs.value.has(id)) return
  const previous = selectedNodeID.value
  selectedNodeID.value = id
  if (!graph || graph.destroyed) return
  if (previous && previous !== id) await graph.setElementState(previous, [], false)
  await graph.setElementState(id, 'selected', false)
}

function zoomBy(ratio: number) {
  if (graph && !graph.destroyed) void graph.zoomBy(ratio, false)
}

function fitView() {
  if (graph && !graph.destroyed) {
    void graph.fitView({ when: 'always', direction: 'both' }, false)
  }
}

function openSource(conversationID?: string) {
  if (conversationID) emit('openSession', conversationID)
}

function confirmSelection() {
  if (selectedNode.value?.quote?.trim()) emit('confirmNode', selectedNode.value)
}

watch(
  () => [props.response, props.loading] as const,
  async () => {
    if (selectedNodeID.value && !nodeIDs.value.has(selectedNodeID.value)) selectedNodeID.value = ''
    await nextTick()
    await renderGraph()
  },
  { deep: true },
)

onMounted(async () => {
  themeMode.value = readThemeMode()
  if (typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      const nextTheme = readThemeMode()
      if (nextTheme === themeMode.value) return
      themeMode.value = nextTheme
      void renderGraph()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  }
  await nextTick()
  await renderGraph()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  observedContainer = null
  themeObserver?.disconnect()
  destroyGraph()
})
</script>

<template>
  <section class="history-graph mt-4" data-session-history-graph>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <span>{{ nodes.length }} 节点</span>
        <span aria-hidden="true">·</span>
        <span>{{ edges.length }} 关系</span>
        <Badge v-if="response?.truncated" variant="warning">已按上限截断</Badge>
      </div>
      <div class="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" :disabled="loading || nodes.length === 0" aria-label="缩小关系图" @click="zoomBy(0.8)">
          <Minus class="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" :disabled="loading || nodes.length === 0" aria-label="放大关系图" @click="zoomBy(1.25)">
          <Plus class="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" :disabled="loading || nodes.length === 0" aria-label="适应关系图视图" @click="fitView">
          <Focus class="size-3.5" />
        </Button>
      </div>
    </div>

    <div v-if="response?.truncated" class="mt-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-caption leading-5 text-warning-foreground">
      当前关系较多，只显示最相关的一部分。可用项目、模块或时间筛选缩小范围。
    </div>

    <div v-if="loading" class="mt-3 flex min-h-72 items-center justify-center gap-2 rounded-xl border border-border bg-card text-caption text-muted-foreground">
      <LoaderCircle class="size-4 animate-spin" />
      正在生成关系图
    </div>

    <div v-else-if="renderError" class="mt-3 rounded-xl border border-destructive-border bg-destructive-soft px-4 py-5 text-caption leading-5 text-destructive">
      关系图渲染失败：{{ renderError }}
    </div>

    <div v-else-if="nodes.length === 0" class="mt-3 flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
      <p class="text-body font-medium">没有可关联的历史</p>
      <p class="mt-1 max-w-sm text-caption leading-5 text-muted-foreground">
        调整搜索或筛选条件，或刷新索引后再试。
      </p>
    </div>

    <div v-else class="history-graph__layout mt-3">
      <div class="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
        <div
          ref="graphContainer"
          class="history-graph__canvas"
          role="img"
          :aria-label="`相关历史关系图，共 ${nodes.length} 个节点、${edges.length} 条关系`"
        />
        <div class="border-t border-border px-3 py-2">
          <div class="flex flex-wrap gap-x-3 gap-y-1.5">
            <span
              v-for="type in visibleNodeTypes"
              :key="type"
              class="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
            >
              <span class="size-2 rounded-full" :style="{ backgroundColor: nodeColor(type) }" aria-hidden="true" />
              {{ nodeTypeLabels[type] }}
            </span>
          </div>
          <p v-if="visibleEdgeTypes.length" class="mt-1.5 text-caption leading-5 text-muted-foreground">
            关系：{{ visibleEdgeTypes.map(type => edgeTypeLabels[type]).join(' · ') }}
          </p>
        </div>
      </div>

      <aside class="history-graph__detail rounded-xl border border-border bg-card p-4" aria-live="polite">
        <template v-if="selectedNode">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <Badge variant="secondary">{{ nodeTypeLabels[selectedNode.type] }}</Badge>
              <h4 class="mt-2 break-words text-body font-medium">{{ selectedNode.label }}</h4>
            </div>
            <span class="mt-1 size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: nodeColor(selectedNode.type) }" aria-hidden="true" />
          </div>

          <p v-if="selectedNode.detail" class="mt-2 break-words text-caption leading-5 text-muted-foreground">
            {{ selectedNode.detail }}
          </p>
          <dl class="mt-3 space-y-1.5 text-caption">
            <div v-if="selectedNode.module" class="flex gap-2">
              <dt class="w-12 shrink-0 text-muted-foreground">模块</dt>
              <dd class="break-all">{{ selectedNode.module }}</dd>
            </div>
            <div v-if="selectedNode.project" class="flex gap-2">
              <dt class="w-12 shrink-0 text-muted-foreground">项目</dt>
              <dd class="break-all">{{ selectedNode.project }}</dd>
            </div>
            <div v-if="selectedNode.timestamp" class="flex gap-2">
              <dt class="w-12 shrink-0 text-muted-foreground">时间</dt>
              <dd>{{ formatTime(selectedNode.timestamp) }}</dd>
            </div>
          </dl>

          <div v-if="selectedNode.sources.length" class="mt-4 border-t border-border pt-3">
            <p class="text-caption font-medium text-muted-foreground">来源会话</p>
            <div class="mt-2 space-y-2">
              <button
                v-for="source in selectedNode.sources"
                :key="`${source.sessionId}:${source.messageUuid || ''}`"
                type="button"
                class="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-caption transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-70"
                :disabled="!source.conversationId"
                :aria-label="source.conversationId ? `回到来源会话：${source.sessionName}` : undefined"
                @click="openSource(source.conversationId)"
              >
                <span class="min-w-0 flex-1 truncate">{{ source.sessionName }}</span>
                <ExternalLink v-if="source.conversationId" class="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          </div>

          <Button
            v-if="confirmActionLabel && selectedNode.quote?.trim()"
            type="button"
            variant="outline"
            size="sm"
            class="mt-4 w-full"
            @click="confirmSelection"
          >
            <Quote class="size-3.5" />
            {{ confirmActionLabel }}
          </Button>
        </template>
        <template v-else>
          <p class="text-body font-medium">节点详情</p>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">
            选择一个节点查看来源。拖动节点或画布整理视图，滚轮可缩放。
          </p>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.history-graph {
  container-type: inline-size;
}

.history-graph__layout {
  display: grid;
  gap: 0.75rem;
}

.history-graph__canvas {
  width: 100%;
  min-height: 23rem;
  background:
    radial-gradient(circle at center, color-mix(in srgb, var(--primary) 7%, transparent), transparent 58%),
    var(--card);
}

@container (min-width: 48rem) {
  .history-graph__layout {
    grid-template-columns: minmax(0, 1fr) 17rem;
    align-items: stretch;
  }

  .history-graph__detail {
    max-height: 28rem;
    overflow-y: auto;
  }
}
</style>
