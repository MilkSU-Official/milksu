<script setup lang="ts">
import { menuItemClass } from '@felinic/ui'
import { Check } from 'lucide-vue-next'
import { formatCatalogHistoryTime } from '@/lib/catalogHistoryTime'

defineProps<{
  title: string
  subtitle?: string
  time?: string | number
  current?: boolean
  titleMono?: boolean
}>()

defineEmits<{
  select: []
}>()
</script>

<template>
  <button
    type="button"
    role="menuitem"
    :class="menuItemClass"
    class="items-start gap-3 px-2.5 py-2.5 text-left hover:bg-[color:var(--ui-selected)] focus-visible:bg-[color:var(--ui-selected)]"
    :aria-current="current ? 'true' : undefined"
    data-workspace-catalog-history-item
    @click="$emit('select')"
  >
    <slot name="leading" />
    <span class="min-w-0 flex-1">
      <span
        class="block truncate text-control font-medium"
        :class="titleMono ? 'font-mono' : ''"
      >{{ title }}</span>
      <span
        v-if="subtitle"
        class="mt-0.5 block truncate text-caption text-muted-foreground"
      >{{ subtitle }}</span>
    </span>
    <span
      v-if="time !== undefined && time !== ''"
      class="mt-1 shrink-0 text-caption text-muted-foreground"
    >{{ formatCatalogHistoryTime(time) }}</span>
    <Check
      v-if="current"
      class="mt-1 size-4 shrink-0 text-brand"
    />
  </button>
</template>
