<script setup lang="ts">
import { computed } from 'vue'
import WorkspaceTopBarTitle from '@/components-vue/WorkspaceTopBarTitle.vue'

const props = defineProps<{
  module?: 'coding' | 'ctf' | 'cve'
  title: string
  subtitle?: string
}>()

const moduleKey = computed(() => props.module ?? props.title.trim().toLowerCase())
</script>

<template>
  <header
    class="workspace-topbar app-drag px-6 py-4"
    data-module-topbar
    data-workspace-topbar
    :data-workspace-module="moduleKey"
  >
    <div class="flex min-w-0 items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-3">
        <span class="workspace-topbar__module-mark tactical-display" aria-hidden="true">{{ moduleKey === 'coding' ? '</>' : moduleKey.toUpperCase() }}</span>
        <div v-if="$slots.leading" class="workspace-topbar__leading app-no-drag shrink-0">
          <slot name="leading" />
        </div>
        <div class="min-w-0">
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
  --foreground: #f5f6f7;
  --muted-foreground: #9da6b0;
  --border: #3a424a;
  --border-hairline: #46505a;
  --card: #14191d;
  --secondary: #1b2026;
  --muted: #1b2026;
  --surface-sunken: #0b0e11;
  --module-topbar-title-size: var(--text-control, 0.875rem);
  --module-topbar-title-line-height: var(--text-control--line-height, 1.25rem);
  --module-topbar-control-size: var(--text-control, 0.875rem);
  --module-topbar-control-line-height: var(--text-control--line-height, 1.25rem);

  min-height: 5rem;
  position: relative;
  z-index: var(--z-sticky);
  isolation: isolate;
  margin: .75rem .75rem 0;
  border: 0;
  background: transparent;
  color: #f5f6f7;
  overflow: visible;
}

.workspace-topbar::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  border: 1px solid #323a42;
  background-color: var(--tactical-ink-2);
  background-image: var(--tactical-carbon-image);
  background-size: 640px 640px;
  clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);
  content: '';
}

.workspace-topbar::after {
  position: absolute;
  inset-inline: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, var(--tactical-blue), transparent 45%);
  content: '';
  opacity: .45;
}

.workspace-topbar__module-mark {
  display: inline-flex;
  min-width: 2.1rem;
  height: 2.2rem;
  flex: none;
  align-items: center;
  justify-content: center;
  color: var(--tactical-acid);
  font-size: 1rem;
}

.workspace-topbar__actions {
  max-width: 100%;
}

.workspace-topbar[data-workspace-module="ctf"],
.workspace-topbar[data-workspace-module="cve"] {
  --module-topbar-title-size: 1.75rem;
  --module-topbar-title-line-height: 2.1rem;
  min-height: 6rem;
  padding-top: 1.15rem;
  padding-bottom: 1.05rem;
}

.workspace-topbar :deep([data-button]) { color: #f5f6f7; }
.workspace-topbar__subtitle { color: #9da6b0; }

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
