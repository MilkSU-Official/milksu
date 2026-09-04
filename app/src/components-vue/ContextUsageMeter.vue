<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@felinic/ui'
import { X } from 'lucide-vue-next'
import type { ContextUsagePresentation } from '@/lib/sessionTurnStatus'
import { t } from '@/lib/uiLocale'

const props = withDefaults(defineProps<{
  usage: ContextUsagePresentation
  /** Visual size of the ring / chip. */
  size?: 'sm' | 'md'
}>(), {
  size: 'sm',
})

const panelOpen = ref(false)
const radius = computed(() => (props.size === 'md' ? 9 : 7))
const stroke = computed(() => (props.size === 'md' ? 2.5 : 2))
const viewBox = computed(() => {
  const pad = radius.value + stroke.value
  const dim = pad * 2
  return { dim, center: pad }
})
const circumference = computed(() => 2 * Math.PI * radius.value)
const dashOffset = computed(() => {
  const percent = Math.min(100, Math.max(0, props.usage.percent ?? 0))
  return circumference.value * (1 - percent / 100)
})
const cacheLength = computed(() => (
  circumference.value * Math.min(100, Math.max(0, props.usage.cachePercent ?? 0)) / 100
))
const uncachedLength = computed(() => (
  circumference.value * Math.min(100, Math.max(0, props.usage.uncachedPercent ?? 0)) / 100
))
const hasCategories = computed(() => (props.usage.categories?.length ?? 0) > 0)
const hasSplit = computed(() => (
  !hasCategories.value
  && (props.usage.cachePercent ?? 0) > 0
  && (props.usage.uncachedPercent ?? 0) > 0
))
const cacheOnly = computed(() => (
  !hasCategories.value
  && (props.usage.cachePercent ?? 0) > 0
  && (props.usage.uncachedPercent ?? 0) <= 0
))
const hasRing = computed(() => props.usage.percent !== undefined)
const triggerLabel = computed(() => {
  const used = props.usage.usedLabel?.trim()
  const ratio = props.usage.tokenRatioLabel?.trim()
  if (used && ratio) return `${used} ${ratio}`
  return used || ratio || props.usage.strip
})
const occupancyBarPercent = computed(() => (
  Math.min(100, Math.max(0, props.usage.percent ?? 0))
))
const categorySegments = computed(() => {
  const cats = props.usage.categories ?? []
  if (!cats.length) return []
  const windowTokens = props.usage.windowTokens
  const estimated = props.usage.estimatedTokens
    || cats.reduce((sum, item) => sum + item.tokens, 0)
  if (windowTokens && windowTokens > 0) {
    return cats.map(item => ({
      id: item.id,
      barPercent: (item.tokens / windowTokens) * 100,
    }))
  }
  if (estimated <= 0) return []
  const scale = (props.usage.percent ?? 100) / 100
  return cats.map(item => ({
    id: item.id,
    barPercent: (item.tokens / estimated) * scale * 100,
  }))
})
const showOccupancyBar = computed(() => (
  hasCategories.value || props.usage.percent !== undefined
))
const showBilled = computed(() => Boolean(props.usage.last))

function closePanel() {
  panelOpen.value = false
}
</script>

<template>
  <Popover v-model:open="panelOpen">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="context-usage-meter inline-flex items-center gap-1.5 rounded-md px-0.5 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="{ 'text-warning': usage.nearLimit }"
        data-testid="context-usage-meter"
        :aria-label="triggerLabel"
        :aria-expanded="panelOpen"
      >
        <svg
          v-if="hasRing"
          :width="viewBox.dim"
          :height="viewBox.dim"
          :viewBox="`0 0 ${viewBox.dim} ${viewBox.dim}`"
          class="shrink-0 -rotate-90"
          aria-hidden="true"
        >
          <circle
            :cx="viewBox.center"
            :cy="viewBox.center"
            :r="radius"
            fill="none"
            class="stroke-border"
            :stroke-width="stroke"
          />
          <circle
            v-if="!hasSplit"
            :cx="viewBox.center"
            :cy="viewBox.center"
            :r="radius"
            fill="none"
            :class="usage.nearLimit ? 'stroke-warning' : cacheOnly ? 'context-usage-meter__cache' : 'stroke-primary'"
            :stroke-width="stroke"
            stroke-linecap="round"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="dashOffset"
          />
          <circle
            v-if="hasSplit"
            :cx="viewBox.center"
            :cy="viewBox.center"
            :r="radius"
            fill="none"
            class="context-usage-meter__cache"
            :stroke-width="stroke"
            stroke-linecap="butt"
            :stroke-dasharray="`${cacheLength} ${circumference}`"
          />
          <circle
            v-if="hasSplit"
            :cx="viewBox.center"
            :cy="viewBox.center"
            :r="radius"
            fill="none"
            class="context-usage-meter__fresh"
            :stroke-width="stroke"
            stroke-linecap="butt"
            :stroke-dasharray="`${uncachedLength} ${circumference}`"
            :stroke-dashoffset="-cacheLength"
          />
        </svg>
        <span
          v-else
          class="size-1.5 shrink-0 rounded-full"
          :class="usage.nearLimit ? 'bg-warning' : 'bg-muted-foreground'"
          aria-hidden="true"
        />
        <span class="font-mono text-caption tabular-nums">
          <template v-if="usage.compacting">{{ t('整理中', 'Compacting') }}</template>
          <template v-else-if="hasRing">{{ usage.percent }}%</template>
          <template v-else>{{ usage.ioLabel }}</template>
        </span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align="end"
      :side-offset="8"
      class="context-usage-panel w-80 p-3"
      data-testid="context-usage-panel"
    >
      <div class="flex items-start justify-between gap-2">
        <p class="text-caption font-medium">{{ t('上下文用量', 'Context Usage') }}</p>
        <button
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          :aria-label="t('关闭', 'Close')"
          @click="closePanel"
        >
          <X class="size-3.5" />
        </button>
      </div>
      <div
        v-if="usage.usedLabel || usage.tokenRatioLabel"
        class="mt-2 flex items-baseline justify-between gap-3"
      >
        <p class="text-caption">{{ usage.usedLabel }}</p>
        <p class="font-mono text-caption tabular-nums text-muted-foreground">{{ usage.tokenRatioLabel }}</p>
      </div>
      <p
        v-if="usage.compacting && usage.usedLabel !== t('整理中', 'Compacting')"
        class="mt-1 text-caption text-muted-foreground"
      >
        {{ t('整理中', 'Compacting') }}
      </p>
      <div
        v-if="showOccupancyBar"
        class="context-usage-meter__track mt-2"
      >
        <template v-if="hasCategories">
          <span
            v-for="segment in categorySegments"
            :key="segment.id"
            class="context-usage-meter__seg"
            :class="`context-usage-meter__seg--${segment.id}`"
            :style="{ width: `${segment.barPercent}%` }"
          />
        </template>
        <span
          v-else
          class="context-usage-meter__seg"
          :class="usage.nearLimit ? 'context-usage-meter__seg--warning' : 'context-usage-meter__seg--occupied'"
          :style="{ width: `${occupancyBarPercent}%` }"
        />
      </div>
      <ul
        v-if="hasCategories"
        class="mt-3 space-y-1.5"
      >
        <li
          v-for="category in usage.categories"
          :key="category.id"
          class="flex items-center justify-between gap-3"
          data-testid="context-usage-category"
          :data-category="category.id"
        >
          <span class="flex min-w-0 items-center gap-1.5 text-caption">
            <span
              class="context-usage-meter__swatch"
              :class="`context-usage-meter__swatch--${category.id}`"
            />
            <span class="truncate">{{ category.label }}</span>
          </span>
          <span class="font-mono text-caption tabular-nums">{{ category.tokenLabel }}</span>
        </li>
      </ul>
      <p
        v-if="showBilled"
        class="mt-3 text-caption text-muted-foreground"
      >
        {{ t('本轮计费', 'Billed this turn') }}
      </p>
      <div
        v-if="usage.last"
        class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground"
      >
        <span class="inline-flex items-center gap-1.5">
          <span class="context-usage-meter__swatch context-usage-meter__swatch--fresh" />
          {{ t('未命中输入', 'Uncached input') }}
          <span class="font-mono tabular-nums">{{ usage.last.uncachedLabel }}</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="context-usage-meter__swatch context-usage-meter__swatch--cache" />
          {{ t('缓存命中', 'Cache hits') }}
          <span class="font-mono tabular-nums">{{ usage.last.cacheReadLabel }}</span>
        </span>
      </div>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
.context-usage-panel {
  border-radius: 8px !important;
  background: var(--popover, var(--background));
}
.context-usage-meter__cache {
  stroke: var(--ak-signal-action, #f1c644);
}
.context-usage-meter__fresh {
  stroke: var(--ak-color-primary, #4aabea);
}
.context-usage-meter__track {
  display: flex;
  width: 100%;
  height: 0.375rem;
  overflow: hidden;
  border-radius: 8px;
  background: var(--hover-2, var(--muted));
}
.context-usage-meter__seg {
  display: block;
  height: 100%;
  min-width: 0;
}
.context-usage-meter__seg--occupied {
  background: var(--primary, #4aabea);
}
.context-usage-meter__seg--warning {
  background: var(--warning, #d97706);
}
.context-usage-meter__seg--system {
  background: var(--muted-foreground);
}
.context-usage-meter__seg--tools {
  background: #7c6cf0;
}
.context-usage-meter__seg--skills {
  background: #c9864a;
}
.context-usage-meter__seg--mcp {
  background: #c44b8a;
}
.context-usage-meter__seg--subagent {
  background: #3b82c4;
}
.context-usage-meter__seg--conversation {
  background: #d4544a;
}
.context-usage-meter__swatch {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 2px;
}
.context-usage-meter__swatch--fresh {
  background: var(--ak-color-primary, #4aabea);
}
.context-usage-meter__swatch--cache {
  background: var(--ak-signal-action, #f1c644);
}
.context-usage-meter__swatch--system {
  background: var(--muted-foreground);
}
.context-usage-meter__swatch--tools {
  background: #7c6cf0;
}
.context-usage-meter__swatch--skills {
  background: #c9864a;
}
.context-usage-meter__swatch--mcp {
  background: #c44b8a;
}
.context-usage-meter__swatch--subagent {
  background: #3b82c4;
}
.context-usage-meter__swatch--conversation {
  background: #d4544a;
}
</style>
