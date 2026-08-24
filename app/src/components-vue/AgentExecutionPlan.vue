<script setup lang="ts">
import { computed } from 'vue'
import { Check, Circle, LoaderCircle } from 'lucide-vue-next'
import { latestCodingPlan, settleIdleCodingPlan } from '@/lib/codingPlan'
import { t } from '@/lib/uiLocale'
import type { Message } from '@/types'

const props = withDefaults(defineProps<{
  messages: Message[]
  running?: boolean
}>(), {
  running: false,
})

const plan = computed(() => {
  const current = latestCodingPlan(props.messages)
  if (!current) return null
  return props.running ? current : settleIdleCodingPlan(current)
})
</script>

<template>
  <section
    v-if="plan"
    class="agent-execution-plan border-b border-border px-4 py-4"
    :aria-label="t('执行计划', 'Execution plan')"
    data-testid="agent-execution-plan"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-caption font-medium text-muted-foreground">{{ t('计划', 'Plan') }}</p>
        <p class="mt-1 text-body font-medium leading-5">{{ plan.summary }}</p>
      </div>
      <span class="shrink-0 text-caption tabular-nums text-muted-foreground">
        {{ plan.steps.filter(step => step.status === 'completed').length }}/{{ plan.steps.length }}
      </span>
    </div>

    <ol class="mt-3 space-y-1.5">
      <li
        v-for="(step, index) in plan.steps"
        :key="`${index}:${step.text}`"
        class="flex min-w-0 items-start gap-2 rounded-md px-1 py-1"
        :class="{
          'bg-primary/10': step.status === 'in_progress',
          'opacity-70': step.status === 'completed',
        }"
      >
        <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <Check
            v-if="step.status === 'completed'"
            class="size-3.5 text-primary"
            :aria-label="t('已完成', 'Completed')"
          />
          <LoaderCircle
            v-else-if="step.status === 'in_progress'"
            class="size-3.5 animate-spin text-primary"
            :aria-label="t('进行中', 'In progress')"
          />
          <Circle
            v-else
            class="size-3 text-muted-foreground"
            :aria-label="t('待开始', 'Not started')"
          />
        </span>
        <span
          class="min-w-0 flex-1 text-caption leading-5"
          :class="step.status === 'in_progress' ? 'text-foreground' : 'text-muted-foreground'"
        >
          {{ step.text }}
        </span>
      </li>
    </ol>
  </section>
</template>
