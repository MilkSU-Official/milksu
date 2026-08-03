<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header
    class="workspace-topbar app-drag border-b border-border bg-background px-6 py-3"
    data-workspace-topbar
  >
    <div class="flex min-w-0 items-center justify-between gap-4">
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden">
          <h1
            class="workspace-topbar__title truncate text-control font-medium tracking-[-0.01em]"
            data-workspace-topbar-title
          >
            {{ title }}
          </h1>
          <slot name="badge" />
        </div>
        <p
          v-if="subtitle"
          class="workspace-topbar__subtitle mt-1 truncate text-caption text-muted-foreground"
          data-workspace-topbar-subtitle
        >
          {{ subtitle }}
        </p>
      </div>
      <div
        v-if="$slots.actions"
        class="workspace-topbar__actions app-no-drag flex min-w-0 shrink-0 items-center gap-2 text-control"
        data-workspace-topbar-actions
      >
        <slot name="actions" />
      </div>
    </div>
    <div v-if="$slots.filters" class="workspace-topbar__filters app-no-drag mt-3 text-control">
      <slot name="filters" />
    </div>
    <div v-if="$slots.metrics" class="workspace-topbar__metrics mt-3 text-body">
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

.workspace-topbar__title,
.workspace-topbar__subtitle {
  margin: 0;
}
</style>
