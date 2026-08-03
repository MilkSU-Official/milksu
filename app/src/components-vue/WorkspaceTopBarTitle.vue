<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <h1
    class="workspace-topbar__title truncate text-control font-medium tracking-[-0.01em]"
    data-workspace-topbar-title
  >
    {{ title }}
  </h1>
</template>
