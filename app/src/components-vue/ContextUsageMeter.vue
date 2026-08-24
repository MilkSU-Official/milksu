<script setup lang="ts">
import { computed } from 'vue'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@felinic/ui'
import type { ContextUsagePresentation } from '@/lib/sessionTurnStatus'
import { t } from '@/lib/uiLocale'

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
const cacheLength = computed(() => (
  circumference.value * Math.min(100, Math.max(0, props.usage.cachePercent ?? 0)) / 100
))
const uncachedLength = computed(() => (
  circumference.value * Math.min(100, Math.max(0, props.usage.uncachedPercent ?? 0)) / 100
))
const hasSplit = computed(() => (
  (props.usage.cachePercent ?? 0) > 0 && (props.usage.uncachedPercent ?? 0) > 0
))
const cacheOnly = computed(() => (
  (props.usage.cachePercent ?? 0) > 0 && (props.usage.uncachedPercent ?? 0) <= 0
))
const hasRing = computed(() => props.usage.percent !== undefined)
const detailTitle = computed(() => (
  props.usage.windowLabel
    ? t(`上下文 ${props.usage.inputLabel}/${props.usage.windowLabel}`, `Context ${props.usage.inputLabel}/${props.usage.windowLabel}`)
    : t('本轮 Token', 'This turn')
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
    </HoverCardTrigger>
    <HoverCardContent
      side="top"
      align="start"
      :side-offset="8"
      class="w-64 p-3"
    >
      <p class="text-caption font-medium text-muted-foreground">{{ detailTitle }}</p>
      <p v-if="usage.compacting" class="mt-1 text-caption text-muted-foreground">{{ t('正在整理上下文', 'Compacting context') }}</p>
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
        <div class="ak-progress__track">
          <span
            v-if="!hasSplit"
            class="ak-progress__fill"
          />
          <span
            v-else
            class="context-usage-meter__bar"
          >
            <span
              class="context-usage-meter__bar-cache"
              :style="{ width: `${usage.cachePercent}%` }"
            />
            <span
              class="context-usage-meter__bar-fresh"
              :style="{ width: `${usage.uncachedPercent}%` }"
            />
          </span>
        </div>
      </div>
      <template v-if="usage.last">
        <p class="mt-2 text-caption font-medium text-muted-foreground">{{ t('本轮', 'This turn') }}</p>
        <dl class="mt-1 space-y-1.5 font-mono text-caption tabular-nums">
          <div class="flex items-center justify-between gap-3">
            <dt class="flex items-center gap-1.5 text-muted-foreground">
              <span class="context-usage-meter__swatch context-usage-meter__swatch--fresh" />
              {{ t('未命中输入', 'Uncached input') }}
            </dt>
            <dd>{{ usage.last.uncachedLabel }}</dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="flex items-center gap-1.5 text-muted-foreground">
              <span class="context-usage-meter__swatch context-usage-meter__swatch--cache" />
              {{ t('缓存命中', 'Cache hits') }}
            </dt>
            <dd>{{ usage.last.cacheReadLabel }}</dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('写入缓存', 'Cache writes') }}</dt>
            <dd>{{ usage.last.cacheWriteLabel }}</dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('输出', 'Output') }}</dt>
            <dd>{{ usage.last.outputLabel }}</dd>
          </div>
          <div
            v-if="usage.last.reasoningLabel !== '0'"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-muted-foreground">{{ t('推理', 'Reasoning') }}</dt>
            <dd>{{ usage.last.reasoningLabel }}</dd>
          </div>
          <div
            v-if="usage.last.hitRateLabel"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-muted-foreground">{{ t('命中率', 'Hit rate') }}</dt>
            <dd>{{ usage.last.hitRateLabel }}</dd>
          </div>
          <div
            v-if="usage.windowLabel"
            class="flex items-center justify-between gap-3 border-t border-border pt-1.5"
          >
            <dt class="text-muted-foreground">{{ t('窗口', 'Window') }}</dt>
            <dd>{{ usage.inputLabel }}/{{ usage.windowLabel }}</dd>
          </div>
          <div
            v-if="usage.percent !== undefined"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-muted-foreground">{{ t('占用', 'Usage') }}</dt>
            <dd :class="{ 'text-warning': usage.nearLimit }">{{ usage.percent }}%</dd>
          </div>
        </dl>
      </template>
      <template v-else>
        <dl class="mt-2 space-y-1.5 font-mono text-caption tabular-nums">
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('↑ 输入', '↑ Input') }}</dt>
            <dd>{{ usage.inputLabel }}</dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('↓ 输出', '↓ Output') }}</dt>
            <dd>{{ usage.outputLabel }}</dd>
          </div>
        </dl>
      </template>
      <template v-if="usage.session">
        <p class="mt-3 text-caption font-medium text-muted-foreground">
          {{ t(`本会话 · ${usage.session.turns} 次`, `This session · ${usage.session.turns} turns`) }}
        </p>
        <dl class="mt-1 space-y-1.5 font-mono text-caption tabular-nums">
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('未命中输入', 'Uncached input') }}</dt>
            <dd>{{ usage.session.uncachedLabel }}</dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('缓存命中', 'Cache hits') }}</dt>
            <dd>{{ usage.session.cacheReadLabel }}</dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('写入缓存', 'Cache writes') }}</dt>
            <dd>{{ usage.session.cacheWriteLabel }}</dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('输出', 'Output') }}</dt>
            <dd>{{ usage.session.outputLabel }}</dd>
          </div>
          <div
            v-if="usage.session.reasoningLabel !== '0'"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-muted-foreground">{{ t('推理', 'Reasoning') }}</dt>
            <dd>{{ usage.session.reasoningLabel }}</dd>
          </div>
          <div
            v-if="usage.session.hitRateLabel"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-muted-foreground">{{ t('命中率', 'Hit rate') }}</dt>
            <dd>{{ usage.session.hitRateLabel }}</dd>
          </div>
        </dl>
      </template>
    </HoverCardContent>
  </HoverCard>
</template>

<style scoped>
.context-usage-meter__cache {
  stroke: var(--ak-signal-action, #f1c644);
}
.context-usage-meter__fresh {
  stroke: var(--ak-color-primary, #4aabea);
}
.context-usage-meter__bar {
  display: flex;
  width: 100%;
  height: 100%;
}
.context-usage-meter__bar-cache,
.context-usage-meter__bar-fresh {
  display: block;
  height: 100%;
}
.context-usage-meter__bar-cache {
  background: var(--ak-signal-action, #f1c644);
}
.context-usage-meter__bar-fresh {
  background: var(--ak-color-primary, #4aabea);
}
.context-usage-meter__swatch {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
}
.context-usage-meter__swatch--fresh {
  background: var(--ak-color-primary, #4aabea);
}
.context-usage-meter__swatch--cache {
  background: var(--ak-signal-action, #f1c644);
}
</style>
