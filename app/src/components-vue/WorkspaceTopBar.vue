<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="workspace-topbar app-drag border-b border-border bg-background px-6 py-3">
    <div class="flex min-w-0 items-center justify-between gap-4">
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden">
          <p class="truncate text-control font-medium">{{ title }}</p>
          <slot name="badge" />
        </div>
        <p v-if="subtitle" class="mt-1 truncate text-caption text-muted-foreground">
          {{ subtitle }}
        </p>
      </div>
      <div v-if="$slots.actions" class="workspace-topbar__actions app-no-drag flex min-w-0 shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="$slots.filters" class="app-no-drag mt-3">
      <slot name="filters" />
    </div>
    <div v-if="$slots.metrics" class="mt-3">
      <slot name="metrics" />
    </div>
  </header>
</template>

<style scoped>
.workspace-topbar {
  min-height: 3.5rem;
}

.workspace-topbar__actions {
  max-width: 100%;
}
</style>
