<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@felinic/ui'
import {
  Bug,
  Flag,
  FlaskConical,
  Square,
} from 'lucide-vue-next'
import AkLoadingMark from '@/components-vue/AkLoadingMark.vue'
import ModelVendorIcon from '@/components-vue/ModelVendorIcon.vue'
import { invokeCommand, listenEvent } from '@/desktop'
import type { EvalBoardModel, EvalBoardSnapshot, EvalModelRef, EvalSuiteBoard } from '@/evalTypes'
import {
  encodePickerSelection,
  parsePickerSelection,
  useModelCatalog,
} from '@/modelCatalog'
import { t } from '@/lib/uiLocale'
import type { AppSettings } from '@/types'

const SUITE_MODELS_KEY = 'milksu.eval.suite-models'
const SELECTED_SUITE_KEY = 'milksu.eval.selected-suite'

const props = defineProps<{
  settings: AppSettings | null
}>()

const { pickerGroups, pickerModelLabel } = useModelCatalog(computed(() => ({
  providers: props.settings?.providers ?? {},
  relay: props.settings?.relay ?? null,
})))

const suiteModel = ref<Record<string, string>>(loadSuiteModels())
const selectedSuite = ref(loadSelectedSuite())
const board = ref<EvalBoardSnapshot | null>(null)
const activityOpen = ref(false)
const error = ref('')
let unlisten: (() => void) | undefined
let elapsedTimer: ReturnType<typeof setInterval> | undefined

const catalogRefs = computed<EvalModelRef[]>(() => {
  const seen = new Set<string>()
  const refs: EvalModelRef[] = []
  for (const group of pickerGroups.value) {
    for (const model of group.models) {
      const id = String(model ?? '').trim()
      if (!id) continue
      const key = `${group.providerId}:${group.source}:${id}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({
        provider: group.providerId,
        model: id,
        source: group.source,
      })
    }
  }
  return refs
})

const catalogSignature = computed(() => (
  catalogRefs.value.map(item => `${item.provider}:${item.source ?? ''}:${item.model}`).join('|')
))

const cards = computed<EvalSuiteBoard[]>(() => {
  if (board.value?.all && board.value.all.length > 0) return board.value.all
  return (board.value?.suites ?? []).map(suite => ({
    suite,
    models: suite.id === board.value?.selected ? (board.value.models ?? []) : [],
  }))
})

const current = computed(() => {
  const card = cards.value.find(item => item.suite.id === selectedSuite.value) ?? cards.value[0]
  if (!card) {
    return {
      suite: { id: selectedSuite.value, name: selectedSuite.value, purpose: '', runnable: false, taskN: 0 },
      models: [] as EvalBoardModel[],
      focused: null as ReturnType<typeof focusedRow>,
      ranked: [] as EvalBoardModel[],
      spark: null as ReturnType<typeof sparkPoints>,
      chart: chartFor([], selectedSuite.value),
      modelKey: suiteModel.value[selectedSuite.value] ?? '',
      modelId: parsePickerSelection(suiteModel.value[selectedSuite.value] ?? '')?.model ?? '',
      selection: parsePickerSelection(suiteModel.value[selectedSuite.value] ?? ''),
      busy: false,
      error: '',
    }
  }
  const focused = focusedRow(card.models, card.suite.id)
  return {
    ...card,
    focused,
    spark: sparkPoints(focused?.runs),
    chart: chartFor(card.models, card.suite.id),
    modelKey: suiteModel.value[card.suite.id] ?? '',
    modelId: parsePickerSelection(suiteModel.value[card.suite.id] ?? '')?.model ?? '',
    selection: parsePickerSelection(suiteModel.value[card.suite.id] ?? ''),
    busy: suiteBusy(card.suite.id),
    error: suiteError(card.suite.id),
  }
})

const running = computed(() => (
  board.value?.progress?.state === 'running' || board.value?.progress?.state === 'stopping'
))
const progress = computed(() => board.value?.progress ?? null)

watch(pickerGroups, groups => {
  const active = props.settings?.active_model
  const match = groups.find(group => group.models.includes(active ?? ''))
  const first = groups[0]
  const fallback = match && active
    ? encodePickerSelection(match.providerId, active, match.source)
    : first?.models[0]
      ? encodePickerSelection(first.providerId, first.models[0], first.source)
      : ''
  if (!fallback) return
  const next = { ...suiteModel.value }
  const ids = cards.value.length > 0
    ? cards.value.map(item => item.suite.id)
    : ['cybench', 'sec-bench', 'autopen']
  for (const id of ids) {
    if (!next[id]) next[id] = fallback
  }
  suiteModel.value = next
}, { immediate: true })

watch(suiteModel, value => {
  try {
    localStorage.setItem(SUITE_MODELS_KEY, JSON.stringify(value))
  } catch {
    // ignore quota / private-mode failures
  }
}, { deep: true })

watch(selectedSuite, value => {
  try {
    localStorage.setItem(SELECTED_SUITE_KEY, value)
  } catch {
    // ignore quota / private-mode failures
  }
})

watch(catalogSignature, (next, previous) => {
  if (next === previous) return
  void refreshBoard()
})

onMounted(async () => {
  await refreshBoard()
  unlisten = await listenEvent<EvalBoardSnapshot>('eval-progress', event => {
    const payload = event.payload
    error.value = payload.progress?.error ?? ''
    board.value = payload
  })
  elapsedTimer = setInterval(() => {
    if (!board.value?.progress || board.value.progress.state === 'idle') return
    board.value = {
      ...board.value,
      progress: {
        ...board.value.progress,
        elapsedMs: board.value.progress.elapsedMs + 1000,
      },
    }
  }, 1000)
})

onBeforeUnmount(() => {
  unlisten?.()
  if (elapsedTimer) clearInterval(elapsedTimer)
})

let boardRequest = 0

async function refreshBoard() {
  const request = ++boardRequest
  try {
    const next = await invokeCommand<EvalBoardSnapshot>('get_eval_board', {
      models: catalogRefs.value,
    })
    if (request !== boardRequest) return
    board.value = next
    error.value = next.progress?.error ?? ''
  } catch (reason) {
    if (request !== boardRequest) return
    error.value = String(reason instanceof Error ? reason.message : reason)
  }
}

async function startCurrent(suiteId: string) {
  const selection = parsePickerSelection(suiteModel.value[suiteId] ?? '')
  const card = cards.value.find(item => item.suite.id === suiteId)
  if (!selection || !card?.suite.runnable) return
  error.value = ''
  try {
    board.value = await invokeCommand<EvalBoardSnapshot>('start_eval_run', {
      suite: suiteId,
      provider: selection.providerId,
      model: selection.model,
      source: selection.source,
    })
  } catch (reason) {
    error.value = String(reason instanceof Error ? reason.message : reason)
  }
}

async function startAll(suiteId: string) {
  const models = catalogRefs.value
  const first = models[0]
  const card = cards.value.find(item => item.suite.id === suiteId)
  if (!first || !card?.suite.runnable) return
  error.value = ''
  try {
    board.value = await invokeCommand<EvalBoardSnapshot>('start_eval_run', {
      suite: suiteId,
      provider: first.provider,
      model: first.model,
      source: first.source,
      models,
    })
  } catch (reason) {
    error.value = String(reason instanceof Error ? reason.message : reason)
  }
}

async function stopRun() {
  try {
    board.value = await invokeCommand<EvalBoardSnapshot>('stop_eval_run')
  } catch (reason) {
    error.value = String(reason instanceof Error ? reason.message : reason)
  }
}

function setSuiteModel(suiteId: string, value: string) {
  suiteModel.value = { ...suiteModel.value, [suiteId]: value }
}

function modelGroup(ref: EvalModelRef) {
  return pickerGroups.value.find(item => (
    item.providerId === ref.provider
    && item.models.includes(ref.model)
    && (ref.source ? item.source === ref.source : true)
  ))
}

function modelLabel(ref: EvalModelRef) {
  const group = modelGroup(ref)
  if (!group) return ref.model
  return pickerModelLabel(group, ref.model)
}

function modelServiceLabel(ref: EvalModelRef) {
  return modelGroup(ref)?.label ?? ''
}

function focusedRow(models: EvalBoardModel[], suiteId: string) {
  const key = parsePickerSelection(suiteModel.value[suiteId] ?? '')
  if (!key) return null
  return models.find(row => (
    row.model.provider === key.providerId
    && row.model.model === key.model
    && (!key.source || !row.model.source || row.model.source === key.source)
    && row.score != null
  )) ?? null
}

function suiteBusy(suiteId: string) {
  return running.value && progress.value?.suite === suiteId
}

function suiteError(suiteId: string) {
  if (progress.value?.suite === suiteId && progress.value.error && !suiteBusy(suiteId)) {
    return progress.value.error
  }
  return ''
}

function selectRow(suiteId: string, row: EvalBoardModel) {
  const group = pickerGroups.value.find(item => (
    item.providerId === row.model.provider
    && item.models.includes(row.model.model)
    && (!row.model.source || item.source === row.model.source)
  ))
  if (!group) return
  setSuiteModel(suiteId, encodePickerSelection(group.providerId, row.model.model, group.source))
}

function iconFor(id: string) {
  if (id === 'cybench') return Flag
  if (id === 'sec-bench') return Bug
  return FlaskConical
}

function chartFor(models: EvalBoardModel[], suiteId: string) {
  const width = 640
  const height = 200
  const pad = { l: 36, r: 12, t: 16, b: 28 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const x = (index: number, count: number) => (
    count <= 1 ? pad.l : pad.l + (index / (count - 1)) * innerW
  )
  const y = (value: number) => pad.t + innerH * (1 - value / 100)
  const selection = parsePickerSelection(suiteModel.value[suiteId] ?? '')
  const drawn = models.filter(row => (row.curve?.length ?? 0) > 0 || row.score != null)
  const series = drawn.map(row => {
    const curve = (row.curve && row.curve.length > 0) ? row.curve : (row.score != null ? [row.score] : [])
    const dots = curve.map((value, index) => ({
      x: Number(x(index, Math.max(curve.length, 1)).toFixed(1)),
      y: Number(y(value).toFixed(1)),
    }))
    return {
      key: `${row.model.provider}::${row.model.model}`,
      points: dots.map(dot => `${dot.x},${dot.y}`).join(' '),
      dots,
      selected: selection?.providerId === row.model.provider && selection.model === row.model.model,
    }
  })
  return {
    width,
    height,
    pad,
    series,
    ticks: [
      { label: t('易', 'Easy'), x: x(0, 2), y: height - 8 },
      { label: t('难', 'Hard'), x: x(1, 2), y: height - 8 },
    ],
    grid: [0, 25, 50, 75, 100].map(value => ({
      value,
      y: y(value),
      x1: pad.l,
      x2: width - pad.r,
    })),
  }
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function remainLabel(ms?: number) {
  if (!ms || ms < 8000) return ''
  if (ms >= 60_000) {
    const minutes = Math.max(1, Math.round(ms / 60_000))
    return t(`大约 ${minutes} 分钟`, `About ${minutes} min`)
  }
  const seconds = Math.round(ms / 1000)
  return t(`大约 ${seconds} 秒`, `About ${seconds} s`)
}

function sparkPoints(runs?: number[]) {
  if (!runs || runs.length < 2) return null
  const w = 120
  const h = 28
  const min = Math.min(...runs)
  const max = Math.max(...runs)
  const span = Math.max(1, max - min)
  const dots = runs.map((value, index) => ({
    x: (index / (runs.length - 1)) * w,
    y: h - 3 - ((value - min) / span) * (h - 6),
  }))
  return {
    line: dots.map(dot => `${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(' '),
    dots,
  }
}

function selectSuite(id: string) {
  selectedSuite.value = id
}

function suiteScore(id: string) {
  const key = parsePickerSelection(suiteModel.value[id] ?? '')
  const card = cards.value.find(item => item.suite.id === id)
  if (!key || !card) return undefined
  return card.models.find(row => (
    row.model.provider === key.providerId && row.model.model === key.model
  ))?.score ?? undefined
}

function loadSelectedSuite() {
  try {
    const value = localStorage.getItem(SELECTED_SUITE_KEY)
    if (value === 'cybench' || value === 'sec-bench' || value === 'autopen') return value
  } catch {
    // ignore
  }
  return 'cybench'
}

function loadSuiteModels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SUITE_MODELS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) next[key] = value
    }
    return next
  } catch {
    return {}
  }
}

const activitySuiteName = computed(() => (
  cards.value.find(item => item.suite.id === progress.value?.suite)?.suite.name ?? ''
))
</script>

<template>
  <div class="w-full">
    <p v-if="error && !running" class="mb-3 text-caption text-destructive">{{ error }}</p>

    <div class="tool-workbench mt-2 grid min-h-[640px] border-y border-border">
      <nav class="border-r border-border" :aria-label="t('评测套件', 'Eval suites')">
        <button
          v-for="item in cards"
          :key="item.suite.id"
          type="button"
          class="tool-row"
          :class="item.suite.id === selectedSuite ? 'is-selected' : ''"
          @click="selectSuite(item.suite.id)"
        >
          <span class="tool-icon">
            <component :is="iconFor(item.suite.id)" class="size-5" />
          </span>
          <span class="min-w-0 flex-1 text-left">
            <strong class="block truncate text-base font-semibold">{{ item.suite.name }}</strong>
            <small class="mt-0.5 block truncate text-caption text-muted-foreground">{{ item.suite.purpose }}</small>
          </span>
          <span
            class="tool-status"
            :data-tone="suiteBusy(item.suite.id) || suiteScore(item.suite.id) != null ? 'ready' : 'idle'"
          >{{ suiteScore(item.suite.id) }}</span>
        </button>
      </nav>

      <article class="min-w-0 px-9 py-7" :aria-label="current.suite.name">
        <header class="border-b border-border pb-5">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="tactical-label text-primary">{{ current.suite.name }}</p>
              <p class="mt-1 text-control text-muted-foreground">{{ current.suite.purpose }}</p>
            </div>
            <div class="flex items-center gap-2">
              <Select
                :model-value="current.modelKey"
                @update:model-value="value => setSuiteModel(current.suite.id, String(value ?? ''))"
              >
                <SelectTrigger size="sm" class="w-72 max-w-full" :aria-label="t(`${current.suite.name} 模型`, `${current.suite.name} model`)">
                  <SelectValue>
                    <span class="inline-flex min-w-0 items-center gap-2">
                      <ModelVendorIcon :model="current.modelId" :label="current.modelId" />
                      <span class="min-w-0 truncate">
                        <template v-if="current.selection">
                          {{ modelServiceLabel({ provider: current.selection.providerId, model: current.selection.model, source: current.selection.source }) }}
                          ·
                          {{ modelLabel({ provider: current.selection.providerId, model: current.selection.model, source: current.selection.source }) }}
                        </template>
                      </span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent size="sm" align="end" class="min-w-96">
                  <template v-for="(group, groupIndex) in pickerGroups" :key="group.key">
                    <SelectGroup>
                      <SelectLabel v-if="groupIndex === 0 || pickerGroups.length > 1">{{ group.label }}</SelectLabel>
                      <SelectItem
                        v-for="model in group.models"
                        :key="`${group.key}:${model}`"
                        :value="encodePickerSelection(group.providerId, model, group.source)"
                      >
                        <span class="inline-flex min-w-0 items-center gap-2">
                          <ModelVendorIcon :model="model" :label="pickerModelLabel(group, model)" />
                          <span class="min-w-0 truncate">{{ group.label }} · {{ pickerModelLabel(group, model) }}</span>
                        </span>
                      </SelectItem>
                    </SelectGroup>
                  </template>
                </SelectContent>
              </Select>
              <Button
                v-if="!current.busy"
                size="sm"
                :disabled="!current.suite.runnable || !current.modelKey || running"
                @click="startCurrent(current.suite.id)"
              >
                {{ t('开始评测', 'Start eval') }}
              </Button>
              <Button v-else size="sm" variant="outline" @click="stopRun">
                <Square class="size-3.5" />
                {{ t('停止', 'Stop') }}
              </Button>
            </div>
          </div>
          <template v-if="current.focused && current.focused.score != null">
            <p class="tactical-display mt-3 text-6xl leading-none tabular-nums">{{ current.focused.score }}</p>
            <div class="mt-2 flex items-center gap-3 text-control text-muted-foreground">
              <span>{{ current.focused.solved }} / {{ current.focused.total }}</span>
              <svg
                v-if="current.spark"
                class="h-7 w-28 overflow-visible"
                viewBox="0 0 120 28"
                aria-hidden="true"
              >
                <polyline fill="none" stroke="var(--brand)" stroke-width="2" :points="current.spark.line" />
                <circle
                  v-for="(dot, index) in current.spark.dots"
                  :key="index"
                  :cx="dot.x"
                  :cy="dot.y"
                  r="2.4"
                  fill="var(--brand)"
                />
              </svg>
            </div>
          </template>
          <button
            v-if="current.busy && progress"
            type="button"
            class="activity-chip mt-4"
            @click="activityOpen = true"
          >
            <AkLoadingMark :label="t('评测进行中', 'Eval running')" />
            <span class="min-w-0 truncate">{{ progress.summary || progress.taskName }}</span>
            <span class="tabular-nums">{{ clock(progress.elapsedMs) }}</span>
            <span v-if="remainLabel(progress.remainMs)" class="text-muted-foreground">
              {{ remainLabel(progress.remainMs) }}
            </span>
          </button>
          <p v-if="current.error" class="mt-3 text-caption text-destructive">{{ current.error }}</p>
        </header>

        <figure
          v-if="current.chart.series.length > 0"
          class="border-b border-border py-5"
          :aria-label="t(`${current.suite.name} 难度曲线`, `${current.suite.name} difficulty curve`)"
        >
          <figcaption class="mb-3 text-base font-semibold">{{ t('难度曲线', 'Difficulty curve') }}</figcaption>
          <svg class="h-auto w-full" :viewBox="`0 0 ${current.chart.width} ${current.chart.height}`" role="img">
            <line
              v-for="line in current.chart.grid"
              :key="line.value"
              :x1="line.x1"
              :x2="line.x2"
              :y1="line.y"
              :y2="line.y"
              stroke="currentColor"
              class="text-border"
              stroke-width="1"
            />
            <text
              v-for="line in current.chart.grid"
              :key="`y-${line.value}`"
              :x="current.chart.pad.l - 8"
              :y="line.y + 4"
              text-anchor="end"
              class="fill-muted-foreground"
              font-size="10"
            >{{ line.value }}</text>
            <template v-for="row in current.chart.series" :key="row.key">
              <polyline
                v-if="row.dots.length > 1"
                fill="none"
                :stroke="row.selected ? 'var(--brand)' : 'currentColor'"
                :class="row.selected ? '' : 'text-muted-foreground/45'"
                :stroke-width="row.selected ? 2.5 : 1.5"
                :points="row.points"
              />
              <circle
                v-for="(dot, index) in row.dots"
                :key="`${row.key}-${index}`"
                :cx="dot.x"
                :cy="dot.y"
                :r="row.selected ? 4.5 : 3.5"
                :fill="row.selected ? 'var(--brand)' : 'currentColor'"
                :class="row.selected ? '' : 'text-muted-foreground/55'"
              />
            </template>
            <text
              v-for="tick in current.chart.ticks"
              :key="tick.label"
              :x="tick.x"
              :y="tick.y"
              text-anchor="middle"
              class="fill-muted-foreground"
              font-size="10"
            >{{ tick.label }}</text>
          </svg>
        </figure>

        <div class="pt-2">
          <div class="flex items-center justify-between gap-3 py-2">
            <span class="text-base font-semibold">{{ t('模型', 'Models') }}</span>
            <Button
              variant="ghost"
              size="sm"
              :disabled="running || !current.suite.runnable || catalogRefs.length === 0"
              @click="startAll(current.suite.id)"
            >
              {{ t('全部测一遍', 'Run all') }}
            </Button>
          </div>
          <ol>
            <li
              v-for="row in current.models"
              :key="`${row.model.provider}:${row.model.source ?? ''}:${row.model.model}`"
              class="rank-row"
              :class="current.modelId === row.model.model ? 'is-selected' : ''"
              @click="selectRow(current.suite.id, row)"
            >
              <span class="w-6 tabular-nums text-caption text-muted-foreground">{{ row.rank ?? '' }}</span>
              <ModelVendorIcon :model="row.model.model" :label="modelLabel(row.model)" />
              <span class="min-w-0 flex-1 truncate">
                <strong class="font-medium">{{ modelLabel(row.model) }}</strong>
                <small class="mt-0.5 block truncate text-caption text-muted-foreground">{{ modelServiceLabel(row.model) }}</small>
              </span>
              <span class="rank-track">
                <i
                  v-if="row.score != null"
                  :class="row.rank === 1 ? 'is-lead' : ''"
                  :style="{ width: `${row.score}%` }"
                />
              </span>
              <strong class="w-14 text-right tabular-nums">{{ row.score ?? '' }}</strong>
            </li>
          </ol>
        </div>
      </article>
    </div>

    <Dialog :open="activityOpen" @update:open="activityOpen = $event">
      <DialogContent class="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>{{ activitySuiteName }}</DialogTitle>
        <p v-if="progress" class="mt-1 text-caption text-muted-foreground">
          {{ clock(progress.elapsedMs) }}
          <template v-if="remainLabel(progress.remainMs)"> · {{ remainLabel(progress.remainMs) }}</template>
          <template v-if="progress.taskName"> · {{ progress.taskName }}</template>
          <template v-if="progress.taskTotal"> · {{ progress.taskIndex }} / {{ progress.taskTotal }}</template>
        </p>
        <ol class="mt-4 space-y-2">
          <li
            v-for="step in progress?.steps ?? []"
            :key="step.id || step.summary"
            class="rounded-md border border-border px-3 py-2"
          >
            <div class="flex items-center gap-2 text-body">
              <AkLoadingMark v-if="step.running" :label="t('进行中', 'Running')" />
              <span class="min-w-0 flex-1 truncate">{{ step.summary }}</span>
              <span v-if="step.durationMs" class="text-caption tabular-nums text-muted-foreground">
                {{ t(`${Math.round(step.durationMs / 1000)} 秒`, `${Math.round(step.durationMs / 1000)} s`) }}
              </span>
            </div>
            <pre v-if="step.detail" class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-caption text-muted-foreground">{{ step.detail }}</pre>
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.tool-workbench { grid-template-columns: minmax(16rem, 0.72fr) minmax(28rem, 1.28fr); }
.tool-row { position: relative; display: flex; min-height: 5.8rem; width: 100%; align-items: center; gap: 1rem; border: 0; border-bottom: 1px solid hsl(var(--border)); background: transparent; padding: 1rem 1.1rem; color: hsl(var(--foreground)); cursor: pointer; }
.tool-row:hover { background: var(--overlay-hover-light); }
.tool-row.is-selected { background: color-mix(in srgb, var(--brand) 7%, transparent); box-shadow: inset 3px 0 0 var(--brand), inset 0 0 0 1px color-mix(in srgb, var(--brand) 48%, transparent); }
.tool-icon { display: grid; width: 2.8rem; height: 2.8rem; flex: 0 0 auto; place-items: center; border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); }
.tool-row.is-selected .tool-icon { border-color: color-mix(in srgb, var(--brand) 55%, transparent); color: var(--brand); }
.tool-status { flex: 0 0 auto; min-width: 2.4rem; text-align: right; font-size: .77rem; font-weight: 650; font-variant-numeric: tabular-nums; }
.tool-status[data-tone='ready'] { color: var(--brand); }
.tool-status[data-tone='idle'] { color: hsl(var(--muted-foreground)); }
.rank-row { display: flex; min-height: 2.75rem; align-items: center; gap: 0.75rem; padding: 0.35rem 0.15rem; cursor: pointer; }
.rank-row:hover { background: var(--overlay-hover-light); }
.rank-row.is-selected { box-shadow: inset 3px 0 0 var(--brand); padding-left: 0.5rem; }
.rank-track { position: relative; height: 0.35rem; width: 7.5rem; overflow: hidden; background: var(--muted); }
.rank-track > i { display: block; height: 100%; background: var(--brand); }
.rank-track > i.is-lead { background: var(--signal-gold); }
.activity-chip {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--brand) 42%, transparent);
  background: color-mix(in srgb, var(--brand) 8%, transparent);
  color: hsl(var(--foreground));
  padding: 0.7rem 0.9rem;
  text-align: left;
  cursor: pointer;
}
.activity-chip:hover { background: color-mix(in srgb, var(--brand) 12%, transparent); }
@media (max-width: 1050px) { .tool-workbench { grid-template-columns: minmax(15rem, .72fr) minmax(24rem, 1.28fr); } }
@media (max-width: 860px) { .tool-workbench { grid-template-columns: 1fr; } .tool-workbench > nav { border-right: 0; border-bottom: 1px solid hsl(var(--border)); } }
</style>
