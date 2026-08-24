<script setup lang="ts">
import { computed } from 'vue'
import type { CTFAbilityDimension } from '@/nssctfTrainingTypes'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  dimensions: CTFAbilityDimension[]
}>()

const size = 300
const center = size / 2
const radius = 92

function point(index: number, value: number) {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / props.dimensions.length)
  const distance = radius * Math.max(0, Math.min(100, value)) / 100
  return {
    x: center + Math.cos(angle) * distance,
    y: center + Math.sin(angle) * distance,
  }
}

function polygon(value: number) {
  if (!props.dimensions.length) return ''
  return props.dimensions
    .map((_, index) => {
      const valuePoint = point(index, value)
      return `${valuePoint.x},${valuePoint.y}`
    })
    .join(' ')
}

function effectiveScore(dimension: CTFAbilityDimension) {
  return dimension.confidence > 0 ? dimension.score : 0
}

const dataPolygon = computed(() => props.dimensions
  .map((dimension, index) => {
    const valuePoint = point(index, effectiveScore(dimension))
    return `${valuePoint.x},${valuePoint.y}`
  })
  .join(' '))

const labels = computed(() => props.dimensions.map((dimension, index) => {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / props.dimensions.length)
  const labelRadius = radius + 34
  return {
    ...dimension,
    x: center + Math.cos(angle) * labelRadius,
    y: center + Math.sin(angle) * labelRadius,
    anchor: Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end',
  }
}))
</script>

<template>
  <figure class="w-full" aria-labelledby="ability-radar-title">
    <figcaption id="ability-radar-title" class="sr-only">{{ t('个人 CTF 能力雷达图', 'Personal CTF ability radar') }}</figcaption>
    <svg
      class="mx-auto block h-auto w-full max-w-[320px] overflow-visible"
      :viewBox="`0 0 ${size} ${size}`"
      role="img"
      aria-describedby="ability-radar-description"
    >
      <title>{{ t('个人 CTF 能力雷达图', 'Personal CTF ability radar') }}</title>
      <desc id="ability-radar-description">{{ t('六个方向的能力分数，范围从 0 到 100；没有训练证据的方向显示为待校准。', 'Scores for six dimensions, from 0 to 100. Axes without training evidence stay uncalibrated.') }}</desc>
      <g class="text-border">
        <polygon
          v-for="level in [25, 50, 75, 100]"
          :key="level"
          :points="polygon(level)"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        />
        <line
          v-for="(_, index) in dimensions"
          :key="`axis-${index}`"
          :x1="center"
          :y1="center"
          :x2="point(index, 100).x"
          :y2="point(index, 100).y"
          stroke="currentColor"
          stroke-width="1"
        />
      </g>
      <polygon
        :points="dataPolygon"
        fill="color-mix(in srgb, var(--primary) 22%, transparent)"
        stroke="var(--primary)"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      <circle
        v-for="(dimension, index) in dimensions"
        :key="`value-${dimension.key}`"
        :cx="point(index, effectiveScore(dimension)).x"
        :cy="point(index, effectiveScore(dimension)).y"
        r="3.5"
        fill="var(--primary)"
        stroke="var(--background)"
        stroke-width="2"
      />
      <g
        v-for="label in labels"
        :key="label.key"
        class="fill-foreground"
        :text-anchor="label.anchor"
      >
        <text :x="label.x" :y="label.y - 4" class="text-[18px] font-semibold">{{ label.label }}</text>
        <text :x="label.x" :y="label.y + 16" class="fill-muted-foreground text-[16px]">
          {{ label.confidence > 0 ? label.score : '—' }}
        </text>
      </g>
    </svg>
  </figure>
</template>
