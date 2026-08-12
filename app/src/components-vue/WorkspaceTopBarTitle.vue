<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <h1
    class="workspace-topbar__title truncate text-control tactical-display"
    data-workspace-topbar-title
  >
    {{ title }}
  </h1>
</template>
