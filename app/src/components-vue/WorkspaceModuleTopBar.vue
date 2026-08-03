<script setup lang="ts">
import { computed } from 'vue'
import WorkspaceTopBar from '@/components-vue/WorkspaceTopBar.vue'

const props = defineProps<{
  module: 'coding' | 'ctf' | 'cve'
  subtitle?: string
}>()

const title = computed(() => ({
  coding: 'Coding',
  ctf: 'CTF',
  cve: 'CVE',
})[props.module])
</script>

<template>
  <WorkspaceTopBar
    :module="module"
    :title="title"
    :subtitle="subtitle"
    data-workspace-module-topbar
  >
    <template v-if="$slots.badge" #badge>
      <slot name="badge" />
    </template>
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
    <template v-if="$slots.filters" #filters>
      <slot name="filters" />
    </template>
    <template v-if="$slots.metrics" #metrics>
      <slot name="metrics" />
    </template>
  </WorkspaceTopBar>
</template>
