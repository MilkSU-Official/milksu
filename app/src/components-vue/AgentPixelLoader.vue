<script setup lang="ts">
const PIXEL_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270]

withDefaults(defineProps<{
  label?: string
  elapsed?: string
  running?: boolean
}>(), {
  running: false,
})
</script>

<template>
  <span
    class="agent-pixel-loader"
    role="status"
    :aria-label="[label, elapsed].filter(Boolean).join(' ')"
  >
    <span
      v-if="running"
      class="agent-pixel"
      aria-hidden="true"
    >
      <span
        v-for="(delay, index) in PIXEL_DELAYS"
        :key="index"
        class="agent-pixel__cell"
        :style="{ animationDelay: `${delay}ms` }"
      />
    </span>
    <span
      v-if="label"
      class="agent-pixel-loader__label"
      :class="{ 'agent-pixel-loader__label--run': running }"
    >{{ label }}</span>
    <span
      v-if="elapsed"
      class="agent-pixel-loader__elapsed"
    >{{ elapsed }}</span>
  </span>
</template>
