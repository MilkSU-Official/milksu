<script setup lang="ts">
import { Button } from '@felinic/ui'
import {
  Bug,
  Code2,
  Flag,
} from 'lucide-vue-next'
import milksuAppIcon from '@/assets/milksu-app-icon.png'
import {
  WORKSPACE_RAIL_ITEMS,
  type WorkspaceSection,
} from '@/lib/workspaceNavigation'

const props = defineProps<{
  activeSection: WorkspaceSection
}>()

defineEmits<{
  navigate: [value: WorkspaceSection]
}>()

const icons = {
  ctf: Flag,
  vuln: Bug,
  chat: Code2,
} as const
</script>

<template>
  <div class="app-drag flex w-[4.75rem] shrink-0 flex-col border-r border-border bg-sidebar">
    <div class="flex h-[4.75rem] items-center justify-center border-b border-border">
      <img
        :src="milksuAppIcon"
        alt="MilkSU"
        class="size-9 rounded-xl border border-border bg-white object-cover"
      >
    </div>

    <nav class="app-no-drag flex flex-col gap-1.5 px-2 py-3" aria-label="全局工作区">
      <Button
        v-for="item in WORKSPACE_RAIL_ITEMS"
        :key="item.id"
        :variant="activeSection === item.id ? 'secondary' : 'ghost'"
        :class="[
          'workspace-rail-item relative h-auto min-h-12 flex-col gap-0.5 px-1 py-1.5',
          activeSection === item.id ? 'workspace-rail-active' : '',
        ]"
        :aria-label="item.label"
        :aria-current="activeSection === item.id ? 'page' : undefined"
        :title="item.label"
        :data-ui-selected="activeSection === item.id ? '' : undefined"
        @click="$emit('navigate', item.id)"
      >
        <component :is="icons[item.id]" class="size-4" />
        <span>{{ item.label }}</span>
      </Button>
    </nav>

    <div class="flex-1" />
  </div>
</template>

<style scoped>
.workspace-rail-item {
  font-size: 0.625rem;
  line-height: 0.875rem;
  letter-spacing: var(--text-caption--letter-spacing);
}

.workspace-rail-active {
  color: var(--brand);
}

.workspace-rail-active::after {
  position: absolute;
  inset-block: 0.75rem;
  inset-inline-start: 0.125rem;
  width: 0.1875rem;
  border-radius: 999px;
  background: var(--brand);
  content: '';
}
</style>
