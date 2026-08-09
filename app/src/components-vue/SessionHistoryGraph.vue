<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Badge, Button } from '@felinic/ui'
import { ExternalLink, LoaderCircle, Minus, Plus, RefreshCw, Scan, Sparkles } from 'lucide-vue-next'
import { Graph, NodeEvent, type GraphOptions } from '@antv/g6'
import { redactProviderCredentials } from '@/lib/redaction'
import type {
  SessionHistoryGraphEdge,
  SessionHistoryGraphNode,
  SessionHistoryGraphNodeStatus,
  SessionHistoryGraphNodeType,
  SessionHistoryGraphResponse,
} from '@/sessionIndexTypes'

defineOptions({ name: 'SessionHistoryGraph' })

const props = withDefaults(defineProps<{
  response: SessionHistoryGraphResponse | null
  loading?: boolean
}>(), {
  loading: false,
})

const emit = defineEmits<{
  openSession: [conversationId: string]
  regenerate: []
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
  topic: '主题',
  decision: '决策',
  milestone: '里程碑',
  capability: '能力',
  problem: '问题',
  evidence: '证据',
  insight: '洞见',
}

const nodeStatusLabels: Record<SessionHistoryGraphNodeStatus, string> = {
  current: '当前',
  complete: '已完成',
  planned: '计划中',
  blocked: '受阻',
  uncertain: '待确认',
}

const edgeTypeLabels: Record<SessionHistoryGraphEdge['type'], string> = {
  depends_on: '依赖',
  enables: '促成',
  blocks: '阻碍',
  supports: '支持',
  validates: '验证',
  evolves_to: '演进为',
  contrasts_with: '对照',
}

const clusterPalette = [
  { dark: '#8fd14f', light: '#4c8618' },
  { dark: '#6eb7ff', light: '#2f6fa7' },
  { dark: '#d49cff', light: '#7c50b7' },
  { dark: '#ffb86b', light: '#a85d14' },
  { dark: '#63d5c1', light: '#247a68' },
  { dark: '#ff8d91', light: '#ad4147' },
]

function redacted(value?: string) {
  return redactProviderCredentials(value || '')
}

function safeNode(node: SessionHistoryGraphNode): SessionHistoryGraphNode {
  return {
    ...node,
    label: redacted(node.label),
    summary: redacted(node.summary),
    sources: node.sources.map(source => ({
      ...source,
      sessionName: redacted(source.sessionName),
      project: redacted(source.project),
      excerpt: redacted(source.excerpt),
    })),
  }
}

const nodes = computed(() => (props.response?.nodes ?? []).map(safeNode))
const nodeIDs = computed(() => new Set(nodes.value.map(node => node.id)))
const edges = computed(() => (props.response?.edges ?? []).filter(edge => (
  nodeIDs.value.has(edge.source) && nodeIDs.value.has(edge.target)
)).map(edge => ({ ...edge, rationale: redacted(edge.rationale) })))
const selectedNode = computed(() => (
  nodes.value.find(node => node.id === selectedNodeID.value) ?? null
))
const selectedRelations = computed(() => {
  if (!selectedNode.value) return []
  const labelByID = new Map(nodes.value.map(node => [node.id, node.label]))
  return edges.value.filter(edge => (
    edge.source === selectedNode.value?.id || edge.target === selectedNode.value?.id
  )).map(edge => ({
    ...edge,
    otherLabel: labelByID.get(edge.source === selectedNode.value?.id ? edge.target : edge.source) || '',
    outgoing: edge.source === selectedNode.value?.id,
  }))
})
const clusterByID = computed(() => new Map((props.response?.clusters ?? []).map((cluster, index) => [
  cluster.id,
  { ...cluster, color: clusterPalette[index % clusterPalette.length][themeMode.value] },
])))
const visibleClusters = computed(() => {
  const ids = new Set(nodes.value.map(node => node.cluster))
  return [...clusterByID.value.values()].filter(cluster => ids.has(cluster.id))
})

function readThemeMode(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function cssColor(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function clusterColor(clusterID: string) {
  return clusterByID.value.get(clusterID)?.color || clusterPalette[0][themeMode.value]
}

function shortenLabel(label: string) {
  const normalized = label.replace(/\s+/g, ' ').trim()
  return normalized.length > 20 ? `${normalized.slice(0, 19)}…` : normalized
}

function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function graphData(): NonNullable<GraphOptions['data']> {
  const foreground = cssColor('--foreground', themeMode.value === 'dark' ? '#f4f4f4' : '#17201b')
  const card = cssColor('--card', themeMode.value === 'dark' ? '#151f2e' : '#ffffff')
  const edgeStroke = cssColor('--muted-foreground', themeMode.value === 'dark' ? '#8799b5' : '#657569')
  const showEdgeLabels = edges.value.length <= 18

  return {
    nodes: nodes.value.map(node => {
      const color = clusterColor(node.cluster)
      const width = 118 + node.importance * 10
      const height = 44 + Math.min(node.importance, 3) * 3
      return {
        id: node.id,
        data: { kind: node.type, cluster: node.cluster },
        style: {
          size: [width, height],
          radius: 14,
          fill: card,
          fillOpacity: themeMode.value === 'dark' ? 0.94 : 0.98,
          stroke: color,
          lineWidth: node.importance >= 4 ? 2.4 : 1.5,
          shadowColor: color,
          shadowBlur: node.importance >= 4 ? 16 : 7,
          shadowOffsetX: 0,
          shadowOffsetY: 2,
          labelText: shortenLabel(node.label),
          labelFill: foreground,
          labelFontSize: node.importance >= 4 ? 12 : 11,
          labelFontWeight: node.importance >= 4 ? 650 : 550,
          labelMaxWidth: width - 20,
          labelWordWrap: true,
        },
      }
    }),
    edges: edges.value.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: { kind: edge.type },
      style: {
        stroke: edge.type === 'blocks' ? '#ef7777' : edgeStroke,
        strokeOpacity: 0.38 + Math.max(0, Math.min(1, edge.confidence)) * 0.38,
        lineWidth: 1 + Math.max(0, Math.min(1, edge.confidence)),
        endArrow: true,
        labelText: showEdgeLabels ? edgeTypeLabels[edge.type] : '',
        labelFill: edgeStroke,
        labelFontSize: 9,
        labelBackground: true,
        labelBackgroundFill: card,
        labelBackgroundFillOpacity: 0.9,
        labelPadding: [2, 4],
      },
    })),
  }
}

function graphOptions(container: HTMLElement): GraphOptions {
  const selectedStroke = cssColor('--primary', themeMode.value === 'dark' ? '#9fef00' : '#5f9800')
  return {
    container,
    data: graphData(),
    animation: false,
    theme: themeMode.value,
    zoomRange: [0.35, 2.5],
    layout: {
      type: 'antv-dagre',
      rankdir: 'LR',
      nodesep: 28,
      ranksep: 58,
      animation: false,
    },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
    node: {
      type: 'rect',
      animation: false,
      state: {
        selected: {
          halo: true,
          haloLineWidth: 12,
          haloStroke: selectedStroke,
          haloStrokeOpacity: 0.18,
          lineWidth: 3,
          stroke: selectedStroke,
        },
      },
    },
    edge: { type: 'cubic-horizontal', animation: false },
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

async function zoom(factor: number) {
  if (graph && !graph.destroyed) await graph.zoomBy(factor, false)
}

async function fitGraph() {
  if (graph && !graph.destroyed) {
    await graph.fitView({ when: 'always', direction: 'both' }, false)
  }
}

watch(() => props.response, () => {
  selectedNodeID.value = ''
  void nextTick(renderGraph)
}, { deep: true })
watch(() => props.loading, () => void nextTick(renderGraph))

onMounted(() => {
  themeMode.value = readThemeMode()
  themeObserver = new MutationObserver(() => {
    const next = readThemeMode()
    if (next === themeMode.value) return
    themeMode.value = next
    void nextTick(renderGraph)
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  void nextTick(renderGraph)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  destroyGraph()
})
</script>

<template>
  <section class="mt-4 space-y-3" data-session-history-graph>
    <div v-if="loading" class="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-border bg-card/70 text-center">
      <span class="relative mb-3 flex size-11 items-center justify-center rounded-2xl border border-primary/25 bg-primary/8">
        <Sparkles class="size-5 text-primary" />
        <LoaderCircle class="absolute -right-1 -top-1 size-4 animate-spin text-primary" />
      </span>
      <p class="text-body font-medium">正在归纳历史脉络</p>
      <p class="mt-1 max-w-64 text-caption leading-5 text-muted-foreground">模型正在把记忆整理成主题、决策与证据关系</p>
    </div>

    <template v-else-if="response">
      <header class="rounded-2xl border border-border bg-gradient-to-br from-card to-muted/35 px-4 py-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-caption text-primary">
              <Sparkles class="size-3.5" />
              <span>模型语义归纳</span>
            </div>
            <h4 class="mt-1.5 text-body font-semibold leading-6">{{ redacted(response.title) }}</h4>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ redacted(response.summary) }}</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="重新生成语义图谱" @click="emit('regenerate')">
            <RefreshCw class="size-3.5" />
          </Button>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
          <Badge variant="outline">{{ nodes.length }} 节点</Badge>
          <Badge variant="outline">{{ edges.length }} 关系</Badge>
          <span v-if="response.model">{{ redacted(response.provider) }} · {{ redacted(response.model) }}</span>
          <span class="ml-auto">{{ formatTime(response.generatedAt) }}</span>
        </div>
      </header>

      <div v-if="nodes.length" class="overflow-hidden rounded-2xl border border-border bg-card">
        <div class="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
          <span v-for="cluster in visibleClusters" :key="cluster.id" class="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <i class="size-2 rounded-full" :style="{ backgroundColor: cluster.color }" />
            {{ redacted(cluster.label) }}
          </span>
          <div class="ml-auto flex items-center gap-0.5">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="缩小语义图谱" @click="zoom(0.8)"><Minus class="size-3.5" /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="放大语义图谱" @click="zoom(1.25)"><Plus class="size-3.5" /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="适应语义图谱视图" @click="fitGraph"><Scan class="size-3.5" /></Button>
          </div>
        </div>
        <div class="semantic-graph-surface relative h-[26rem] overflow-hidden">
          <div ref="graphContainer" class="absolute inset-0" role="img" :aria-label="`${response.title}语义图谱`" />
          <p v-if="renderError" class="absolute inset-x-4 bottom-3 rounded-lg bg-destructive/10 px-3 py-2 text-caption text-destructive">图谱渲染失败：{{ renderError }}</p>
        </div>
      </div>

      <div v-else class="rounded-2xl border border-dashed border-border px-4 py-10 text-center">
        <p class="text-body font-medium">没有足够的历史记忆</p>
        <p class="mt-1 text-caption text-muted-foreground">换一个主题或扩大时间范围后再生成。</p>
      </div>

      <article v-if="selectedNode" class="rounded-2xl border border-border bg-card px-4 py-4">
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{{ nodeTypeLabels[selectedNode.type] }}</Badge>
          <Badge variant="outline">{{ nodeStatusLabels[selectedNode.status] }}</Badge>
          <span class="text-caption text-muted-foreground">重要度 {{ selectedNode.importance }}/5</span>
        </div>
        <h5 class="mt-2 text-body font-semibold">{{ selectedNode.label }}</h5>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ selectedNode.summary }}</p>

        <div v-if="selectedRelations.length" class="mt-4 space-y-2">
          <p class="text-caption font-medium text-muted-foreground">语义关系</p>
          <div v-for="relation in selectedRelations" :key="relation.id" class="rounded-xl bg-muted/45 px-3 py-2 text-caption leading-5">
            <span class="font-medium">{{ relation.outgoing ? edgeTypeLabels[relation.type] : `被${edgeTypeLabels[relation.type]}` }} {{ relation.otherLabel }}</span>
            <span v-if="relation.rationale" class="text-muted-foreground"> · {{ relation.rationale }}</span>
          </div>
        </div>

        <div class="mt-4 space-y-2">
          <p class="text-caption font-medium text-muted-foreground">历史来源</p>
          <div v-for="(source, index) in selectedNode.sources" :key="`${source.messageUuid || source.sessionId}-${index}`" class="rounded-xl border border-border px-3 py-3">
            <div class="flex items-center gap-2">
              <Badge variant="outline">{{ source.kind === 'formal-evidence' ? '正式证据' : source.kind === 'memory' ? '记忆' : '会话' }}</Badge>
              <span class="min-w-0 flex-1 truncate text-caption font-medium">{{ source.sessionName }}</span>
              <span class="text-caption text-muted-foreground">{{ formatTime(source.timestamp) }}</span>
              <Button v-if="source.conversationId" type="button" variant="ghost" size="icon-sm" :aria-label="`回到来源会话 ${source.sessionName}`" @click="emit('openSession', source.conversationId)">
                <ExternalLink class="size-3.5" />
              </Button>
            </div>
            <p class="mt-2 text-caption leading-5 text-muted-foreground">{{ source.excerpt }}</p>
          </div>
        </div>
      </article>

      <p class="px-1 text-caption leading-5 text-muted-foreground">图中节点和关系是模型对历史记忆的语义归纳，仅供人阅读；点击节点可核对来源。</p>
      <p v-if="response.truncated" class="px-1 text-caption text-muted-foreground">历史材料已按安全上限截断，本图优先保留最相关内容。</p>
    </template>
  </section>
</template>

<style scoped>
.semantic-graph-surface {
  background-image:
    radial-gradient(circle at 18% 18%, color-mix(in srgb, var(--primary) 10%, transparent) 0, transparent 31%),
    radial-gradient(circle at 82% 76%, color-mix(in srgb, #6eb7ff 9%, transparent) 0, transparent 34%),
    linear-gradient(color-mix(in srgb, var(--border) 28%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border) 28%, transparent) 1px, transparent 1px);
  background-size: auto, auto, 24px 24px, 24px 24px;
}
</style>
