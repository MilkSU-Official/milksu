<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <h2
    class="workspace-detail-title mt-3 text-3xl font-semibold tracking-[-0.045em]"
    data-workspace-detail-title
  >
    {{ title }}
  </h2>
</template>
