<script setup lang="ts">
import { t } from '@/lib/uiLocale'

withDefaults(defineProps<{
  live: boolean
  decorative?: boolean
}>(), {
  decorative: false,
})
</script>

<template>
  <span
    class="ak-status ak-status--compact"
    :data-connection-live="live ? 'live' : 'off'"
    :class="live ? '' : 'ak-status--offline'"
    :role="decorative ? undefined : 'status'"
    :aria-hidden="decorative ? true : undefined"
    :aria-label="decorative
      ? undefined
      : live ? t('已连接', 'Connected') : t('未连接', 'Not connected')"
  >
    <span class="ak-status__signal" />
    <span class="ak-status__label">{{ live ? 'LIVE' : 'OFF' }}</span>
  </span>
</template>
