<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  showLabel?: boolean
}>(), {
  label: '进行中',
  showLabel: false,
})
</script>

<template>
  <span
    class="ak-loading-host"
    :class="{ 'ak-loading-host--labeled': showLabel }"
    role="status"
    :aria-label="label"
  >
    <span class="ak-loading ak-loading--compact" aria-hidden="true" />
    <span v-if="showLabel" class="ak-loading-host__label">{{ label }}</span>
  </span>
</template>
