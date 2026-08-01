<script setup lang="ts">
import { computed } from 'vue'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@felinic/ui'
import {
  Bug,
  Code2,
  Flag,
} from 'lucide-vue-next'
import AbilityRadar from '@/components-vue/AbilityRadar.vue'
import milksuAppIcon from '@/assets/milksu-app-icon.png'
import {
  WORKSPACE_RAIL_ITEMS,
  type WorkspaceSection,
} from '@/lib/workspaceNavigation'
import type { NSSCTFTrainingDashboard } from '@/nssctfTrainingTypes'

const props = defineProps<{
  activeSection: WorkspaceSection
  ctfDashboard: NSSCTFTrainingDashboard | null
}>()

defineEmits<{
  navigate: [value: WorkspaceSection]
}>()

const icons = {
  ctf: Flag,
  vuln: Bug,
  chat: Code2,
} as const

const abilitySourceText = computed(() => {
  const sources = props.ctfDashboard?.sources ?? []
  if (!sources.length) return '完成第一道真实平台题后开始校准'
  return sources.map(source => `${source.label} ${source.solved}/${source.attempts}`).join(' · ')
})
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
          'relative h-auto min-h-14 flex-col gap-1 px-1 py-2 text-caption',
          activeSection === item.id ? 'workspace-rail-active' : '',
        ]"
        :aria-label="item.label"
        :aria-current="activeSection === item.id ? 'page' : undefined"
        :title="item.label"
        :data-ui-selected="activeSection === item.id ? '' : undefined"
        @click="$emit('navigate', item.id)"
      >
        <component :is="icons[item.id]" class="size-4.5" />
        <span>{{ item.label }}</span>
      </Button>
    </nav>

    <div class="flex-1" />

    <div class="app-no-drag flex justify-center border-t border-border py-3">
      <Popover>
        <PopoverTrigger as-child>
          <button
            type="button"
            class="group relative grid size-10 place-items-center overflow-hidden rounded-full border border-border bg-white transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="查看 CTF 能力"
          >
            <img :src="milksuAppIcon" alt="" class="size-full rounded-full object-cover">
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          :side-offset="12"
          class="w-[540px] max-w-[calc(100vw-5rem)] p-5"
          aria-label="CTF 能力"
        >
          <div class="flex items-center gap-3">
            <img
              :src="milksuAppIcon"
              alt="MilkSU"
              class="size-12 shrink-0 rounded-full border border-border bg-white object-cover"
            >
            <div>
              <p class="text-caption text-muted-foreground">综合分</p>
              <p class="font-mono text-3xl font-semibold leading-none">
                {{ ctfDashboard?.overallConfidence ? ctfDashboard.overallScore : '—' }}
              </p>
            </div>
            <div class="ml-auto text-right text-caption text-muted-foreground">
              <p>真实训练 {{ ctfDashboard?.realAttemptCount ?? 0 }}</p>
              <p class="mt-1">已完成 {{ ctfDashboard?.realSolvedCount ?? 0 }}</p>
            </div>
          </div>

          <div class="mt-5 grid grid-cols-[minmax(280px,1fr)_minmax(150px,.55fr)] items-center gap-6 border-t border-border pt-5">
            <AbilityRadar
              class="mx-auto w-full max-w-[300px]"
              :dimensions="ctfDashboard?.dimensions ?? []"
            />
            <div class="space-y-2.5 border-l border-border pl-5 text-label">
              <div
                v-for="dimension in ctfDashboard?.dimensions ?? []"
                :key="dimension.key"
                class="flex items-center justify-between gap-4"
              >
                <span class="text-muted-foreground">{{ dimension.label }}</span>
                <span class="font-mono text-foreground">
                  {{ dimension.confidence ? dimension.score : '—' }}
                </span>
              </div>
            </div>
          </div>

          <p class="mt-4 truncate border-t border-border pt-4 text-caption text-muted-foreground">
            {{ abilitySourceText }}
          </p>
        </PopoverContent>
      </Popover>
    </div>
  </div>
</template>

<style scoped>
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
