<script setup lang="ts">
import { computed } from 'vue'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@felinic/ui'
import type { ContextUsagePresentation } from '@/lib/sessionTurnStatus'

const props = withDefaults(defineProps<{
  usage: ContextUsagePresentation
  /** Visual size of the ring / chip. */
  size?: 'sm' | 'md'
}>(), {
  size: 'sm',
})

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
const hasRing = computed(() => props.usage.percent !== undefined)
const detailTitle = computed(() => (
  props.usage.windowLabel
    ? `上下文 ${props.usage.inputLabel}/${props.usage.windowLabel}`
    : '本轮 Token'
))
</script>

<template>
  <HoverCard :open-delay="80" :close-delay="60">
    <HoverCardTrigger as-child>
      <button
        type="button"
        class="context-usage-meter inline-flex items-center gap-1.5 rounded-full px-0.5 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="{ 'text-warning': usage.nearLimit }"
        data-testid="context-usage-meter"
        :aria-label="usage.strip"
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
            :cx="viewBox.center"
            :cy="viewBox.center"
            :r="radius"
            fill="none"
            :class="usage.nearLimit ? 'stroke-warning' : 'stroke-primary'"
            :stroke-width="stroke"
            stroke-linecap="round"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="dashOffset"
          />
        </svg>
        <span
          v-else
          class="size-1.5 shrink-0 rounded-full"
          :class="usage.nearLimit ? 'bg-warning' : 'bg-muted-foreground'"
          aria-hidden="true"
        />
        <span class="font-mono text-caption tabular-nums">
          <template v-if="hasRing">{{ usage.percent }}%</template>
          <template v-else>{{ usage.ioLabel }}</template>
        </span>
      </button>
    </HoverCardTrigger>
    <HoverCardContent
      side="top"
      align="start"
      :side-offset="8"
      class="w-52 p-3"
    >
      <p class="text-caption font-medium text-muted-foreground">{{ detailTitle }}</p>
      <div
        v-if="hasRing"
        class="ak-progress mt-2"
        :class="{ 'ak-progress--warning': usage.nearLimit }"
        :style="{ '--ak-progress-value': `${usage.percent}%` }"
      >
        <div class="ak-progress__header">
          <span>CONTEXT</span>
          <span class="ak-progress__value">{{ usage.percent }}%</span>
        </div>
        <div class="ak-progress__track"><span class="ak-progress__fill" /></div>
      </div>
      <dl class="mt-2 space-y-1.5 font-mono text-caption tabular-nums">
        <div class="flex items-center justify-between gap-3">
          <dt class="text-muted-foreground">↑ 输入</dt>
          <dd>{{ usage.inputLabel }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-muted-foreground">↓ 输出</dt>
          <dd>{{ usage.outputLabel }}</dd>
        </div>
        <div
          v-if="usage.windowLabel"
          class="flex items-center justify-between gap-3 border-t border-border pt-1.5"
        >
          <dt class="text-muted-foreground">窗口</dt>
          <dd>{{ usage.inputLabel }}/{{ usage.windowLabel }}</dd>
        </div>
        <div
          v-if="usage.percent !== undefined"
          class="flex items-center justify-between gap-3"
        >
          <dt class="text-muted-foreground">占用</dt>
          <dd :class="{ 'text-warning': usage.nearLimit }">{{ usage.percent }}%</dd>
        </div>
      </dl>
    </HoverCardContent>
  </HoverCard>
</template>
