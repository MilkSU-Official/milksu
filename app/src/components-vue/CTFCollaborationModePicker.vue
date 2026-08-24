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
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  modelValue: CTFCollaborationMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: CTFCollaborationMode]
}>()

const helpOpen = ref(false)
const modeItems = computed(() => [
  { value: 'coach' as const, label: t('教练', 'Coach') },
  { value: 'copilot' as const, label: t('搭档', 'Copilot') },
  { value: 'delegate' as const, label: t('代理', 'Delegate') },
])
const descriptions = computed(() => [
  {
    mode: 'coach' as const,
    label: t('教练', 'Coach'),
    lead: t('你主导解题', 'You lead solving'),
    detail: t('每轮一个最小提示。', 'One minimal hint per turn.'),
  },
  {
    mode: 'copilot' as const,
    label: t('搭档', 'Copilot'),
    lead: t('你和 Agent 一起解', 'You and the Agent solve together'),
    detail: t('一起完成材料基线和低成本实验。', 'Work together on the material baseline and low-cost experiments.'),
  },
  {
    mode: 'delegate' as const,
    label: t('代理', 'Delegate'),
    lead: t('Agent 主导推进', 'Agent leads progress'),
    detail: t('在授权与预算内连续实验；遇到边界时停下询问。', 'Run consecutive experiments within authorization and budget; stop and ask at boundaries.'),
  },
])
const activeDescription = computed(() => (
  descriptions.value.find(item => item.mode === props.modelValue) ?? descriptions.value[1]
))
</script>

<template>
  <div class="flex items-center gap-2">
    <SegmentedControl
      :model-value="modelValue"
      :aria-label="t('协作模式', 'Collaboration mode')"
      :aria-description="`${activeDescription.lead}。${activeDescription.detail}`"
      :items="modeItems"
      @update:model-value="emit('update:modelValue', $event as CTFCollaborationMode)"
    />
    <HoverCard v-model:open="helpOpen" :open-delay="100">
      <HoverCardTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('查看三种协作模式的区别', 'View the three collaboration modes')"
          :aria-expanded="helpOpen"
          @click="helpOpen = !helpOpen"
        >
          <CircleHelp class="size-4" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="end" :align-offset="0" class="w-80">
        <p class="text-control font-medium">{{ t('三种协作模式', 'Three collaboration modes') }}</p>
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
