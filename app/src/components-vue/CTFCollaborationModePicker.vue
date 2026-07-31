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
    detail: 'Agent 每轮只给一个最小提示并检查理解；不使用 Shell，也不会先替你交完整解法。',
  },
  {
    mode: 'copilot',
    label: '搭档',
    lead: '你和 Agent 一起解',
    detail: 'Agent 主动完成材料基线和一个低成本实验；可用受限 Shell，候选必须附可复核证据。',
  },
  {
    mode: 'delegate',
    label: '代理',
    lead: 'Agent 主导推进',
    detail: 'Agent 在授权与预算内连续实验；可用受限 Shell，遇到边界或重复失败时停下询问。',
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
        <p class="mt-3 border-t border-border pt-3 text-caption leading-5 text-muted-foreground">
          三种模式都只在本题授权范围内工作；向平台提交候选仍由你确认，Accepted 只认 Judge 回执。
        </p>
      </HoverCardContent>
    </HoverCard>
  </div>
</template>
