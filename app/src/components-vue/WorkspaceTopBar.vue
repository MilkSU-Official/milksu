<script setup lang="ts">
import { computed } from 'vue'
import WorkspaceTopBarTitle from '@/components-vue/WorkspaceTopBarTitle.vue'

const props = defineProps<{
  module?: 'coding' | 'ctf' | 'cve'
  title: string
  subtitle?: string
  hideIdentity?: boolean
}>()

const moduleKey = computed(() => props.module ?? props.title.trim().toLowerCase())
</script>

<template>
  <header
    class="workspace-topbar app-drag px-6 py-4"
    data-module-topbar
    data-workspace-topbar
    :data-workspace-module="moduleKey"
    :data-workspace-topbar-idle="hideIdentity ? '' : undefined"
  >
    <div class="flex min-w-0 items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-3">
        <span
          v-if="!hideIdentity"
          class="workspace-topbar__module-mark tactical-display"
          aria-hidden="true"
        >{{ moduleKey === 'coding' ? '</>' : moduleKey.toUpperCase() }}</span>
        <div v-if="$slots.leading" class="workspace-topbar__leading app-no-drag shrink-0">
          <slot name="leading" />
        </div>
        <div v-if="!hideIdentity" class="min-w-0">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden">
          <WorkspaceTopBarTitle :title="title" />
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
      </div>
      <div
        v-if="$slots.actions"
        class="workspace-topbar__actions app-no-drag flex min-w-0 shrink-0 items-center gap-2 text-control"
        data-workspace-topbar-actions
      >
        <slot name="actions" />
      </div>
    </div>
    <div
      v-if="$slots.filters"
      class="workspace-topbar__filters app-no-drag mt-3 text-control"
      data-workspace-topbar-filters
    >
      <slot name="filters" />
    </div>
    <div v-if="$slots.metrics" class="workspace-topbar__metrics mt-3 text-body">
      <slot name="metrics" />
    </div>
  </header>
</template>

<style scoped>
.workspace-topbar {
  --foreground: var(--night-foreground);
  --muted-foreground: var(--night-muted-foreground);
  --border: var(--night-border);
  --border-hairline: var(--night-border-hairline);
  --card: var(--night-card);
  --secondary: var(--night-muted);
  --muted: var(--night-muted);
  --surface-sunken: var(--night-sunken);
  --module-topbar-title-size: var(--text-control, 0.875rem);
  --module-topbar-title-line-height: var(--text-control--line-height, 1.25rem);
  --module-topbar-control-size: var(--text-control, 0.875rem);
  --module-topbar-control-line-height: var(--text-control--line-height, 1.25rem);

  min-height: 4.25rem;
  position: relative;
  z-index: var(--z-sticky);
  isolation: isolate;
  margin: 0;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--night-foreground) 14%, transparent);
  background: color-mix(in srgb, var(--ak-surface-canvas, #111315) 88%, #17191b);
  color: var(--night-foreground);
  overflow: visible;
}

.workspace-topbar[data-workspace-topbar-idle] {
  min-height: 2.75rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}

.workspace-topbar__module-mark {
  display: inline-flex;
  min-width: 2.1rem;
  height: 2.2rem;
  flex: none;
  align-items: center;
  justify-content: center;
  color: var(--brand);
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 900;
  letter-spacing: -.06em;
}

.workspace-topbar__actions {
  max-width: 100%;
}

.workspace-topbar[data-workspace-module="ctf"],
.workspace-topbar[data-workspace-module="cve"] {
  --module-topbar-title-size: 1.5rem;
  --module-topbar-title-line-height: 1.85rem;
  min-height: 4.75rem;
  padding-top: 0.9rem;
  padding-bottom: 0.85rem;
}

.workspace-topbar :deep([data-button]) { color: var(--night-foreground); }
.workspace-topbar__subtitle { color: var(--night-muted-foreground); }

.workspace-topbar__title,
.workspace-topbar__subtitle {
  margin: 0;
}

.workspace-topbar__title {
  font-size: var(--module-topbar-title-size);
  line-height: var(--module-topbar-title-line-height);
}

.workspace-topbar__actions :deep([data-button][data-size="sm"]),
.workspace-topbar__actions :deep([data-button][data-size="icon-sm"]),
.workspace-topbar__actions :deep([data-slot="select-trigger"][data-size="sm"]),
.workspace-topbar__actions :deep([data-slot="native-select"][data-size="sm"]),
.workspace-topbar__actions :deep([data-slot="input"][data-size="sm"]),
.workspace-topbar__filters :deep([data-button][data-size="sm"]),
.workspace-topbar__filters :deep([data-button][data-size="icon-sm"]),
.workspace-topbar__filters :deep([data-slot="select-trigger"][data-size="sm"]),
.workspace-topbar__filters :deep([data-slot="native-select"][data-size="sm"]),
.workspace-topbar__filters :deep([data-slot="input"][data-size="sm"]) {
  font-size: var(--module-topbar-control-size);
  line-height: var(--module-topbar-control-line-height);
}
</style>
