<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Badge,
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  SegmentedControl,
} from '@felinic/ui'
import { CircleHelp } from 'lucide-vue-next'
import type { CTFCollaborationMode } from '@/ctfTypes'

const props = defineProps<{
  modelValue: CTFCollaborationMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: CTFCollaborationMode]
}>()

const helpOpen = ref(false)
const modeItems = [
  { value: 'coach' as const, label: '教练' },
  { value: 'copilot' as const, label: '搭档' },
  { value: 'delegate' as const, label: '代理' },
]
const descriptions: Array<{
  mode: CTFCollaborationMode
  label: string
  lead: string
  detail: string
}> = [
  {
    mode: 'coach',
    label: '教练',
    lead: '你主导解题',
    detail: '每轮一个最小提示。',
  },
  {
    mode: 'copilot',
    label: '搭档',
    lead: '你和 Agent 一起解',
    detail: '一起完成材料基线和低成本实验。',
  },
  {
    mode: 'delegate',
    label: '代理',
    lead: 'Agent 主导推进',
    detail: '在授权与预算内连续实验；遇到边界时停下询问。',
  },
]
const activeDescription = computed(() => (
  descriptions.find(item => item.mode === props.modelValue) ?? descriptions[1]
))
</script>

<template>
  <div class="flex items-center gap-2">
    <SegmentedControl
      :model-value="modelValue"
      aria-label="协作模式"
      :aria-description="`${activeDescription.lead}。${activeDescription.detail}`"
      :items="modeItems"
      @update:model-value="emit('update:modelValue', $event as CTFCollaborationMode)"
    />
    <HoverCard v-model:open="helpOpen" :open-delay="100">
      <HoverCardTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="查看三种协作模式的区别"
          :aria-expanded="helpOpen"
          @click="helpOpen = !helpOpen"
        >
          <CircleHelp class="size-4" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="end" :align-offset="0" class="w-80">
        <p class="text-control font-medium">三种协作模式</p>
        <div class="mt-3 space-y-3">
          <div v-for="item in descriptions" :key="item.mode" class="flex items-start gap-3">
            <Badge
              :variant="item.mode === modelValue ? 'default' : 'outline'"
              class="mt-0.5 min-w-11 justify-center"
            >
              {{ item.label }}
            </Badge>
            <div class="min-w-0">
              <p class="text-caption font-medium">{{ item.lead }}</p>
              <p class="mt-0.5 text-caption leading-5 text-muted-foreground">{{ item.detail }}</p>
            </div>
          </div>
        </div>

      </HoverCardContent>
    </HoverCard>
  </div>
</template>
