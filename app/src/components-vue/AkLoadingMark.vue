<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/lib/uiLocale'

const props = withDefaults(defineProps<{
  label?: string
  showLabel?: boolean
}>(), {
  showLabel: false,
})

const resolvedLabel = computed(() => props.label ?? t('进行中', 'In progress'))
</script>

<template>
  <span
    class="ak-loading-host"
    :class="{ 'ak-loading-host--labeled': showLabel }"
    role="status"
    :aria-label="resolvedLabel"
  >
    <span class="ak-loading ak-loading--compact" aria-hidden="true" />
    <span v-if="showLabel" class="ak-loading-host__label">{{ resolvedLabel }}</span>
  </span>
</template>
