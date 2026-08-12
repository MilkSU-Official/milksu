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
    class="workspace-topbar app-drag border-b border-border bg-background/95 px-6 py-4"
    data-module-topbar
    data-workspace-topbar
    :data-workspace-module="moduleKey"
  >
    <div class="flex min-w-0 items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-3">
        <span class="workspace-topbar__module-mark" aria-hidden="true" />
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
  --module-topbar-title-size: var(--text-control, 0.875rem);
  --module-topbar-title-line-height: var(--text-control--line-height, 1.25rem);
  --module-topbar-control-size: var(--text-control, 0.875rem);
  --module-topbar-control-line-height: var(--text-control--line-height, 1.25rem);

  min-height: 4rem;
  position: relative;
  background-image: linear-gradient(90deg, color-mix(in srgb, var(--action) 4%, transparent), transparent 34%);
}

.workspace-topbar::after {
  position: absolute;
  inset-inline: 1.5rem;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, var(--action-border), transparent 45%);
  content: '';
  opacity: .45;
}

.workspace-topbar__module-mark {
  width: .22rem;
  height: 1.9rem;
  flex: none;
  background: var(--brand);
  box-shadow: 0 0 16px color-mix(in srgb, var(--brand) 45%, transparent);
}

.workspace-topbar__actions {
  max-width: 100%;
}

.workspace-topbar[data-workspace-module="ctf"],
.workspace-topbar[data-workspace-module="cve"] {
  --module-topbar-title-size: 1.75rem;
  --module-topbar-title-line-height: 2.1rem;
  min-height: 5.25rem;
  padding-top: 1.15rem;
  padding-bottom: 1.05rem;
}

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
