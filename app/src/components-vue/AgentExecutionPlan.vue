<script setup lang="ts">
import { computed, ref } from 'vue'
import { latestCodingPlan, settleIdleCodingPlan, type CodingPlanStep } from '@/lib/codingPlan'
import { t } from '@/lib/uiLocale'
import type { Message } from '@/types'

const RING = 24
const STROKE = 2
const ringRadius = (RING - STROKE) / 2
const ringCircumference = 2 * Math.PI * ringRadius
const ringDash = `${ringCircumference * 0.28} ${ringCircumference * 0.72}`

const props = withDefaults(defineProps<{
  messages: Message[]
  running?: boolean
}>(), {
  running: false,
})

const expanded = ref(false)

const plan = computed(() => {
  const current = latestCodingPlan(props.messages)
  if (!current) return null
  return props.running ? current : settleIdleCodingPlan(current)
})

const completedCount = computed(() => (
  plan.value?.steps.filter(step => step.status === 'completed').length ?? 0
))

const headlineStatus = computed<CodingPlanStep['status']>(() => {
  if (!plan.value) return 'pending'
  if (plan.value.steps.some(step => step.status === 'in_progress')) return 'in_progress'
  if (plan.value.steps.every(step => step.status === 'completed')) return 'completed'
  return 'pending'
})

const headlineIndex = computed(() => {
  if (!plan.value) return 0
  const active = plan.value.steps.findIndex(step => (
    step.status === 'in_progress' || step.status === 'pending'
  ))
  return active >= 0 ? active : Math.max(0, plan.value.steps.length - 1)
})

function statusLabel(status: CodingPlanStep['status']) {
  if (status === 'completed') return t('已完成', 'Completed')
  if (status === 'in_progress') return t('进行中', 'In progress')
  return t('待开始', 'Not started')
}

function open() {
  expanded.value = true
}

function close(event?: FocusEvent) {
  const next = event?.relatedTarget
  if (next instanceof Node && (event?.currentTarget instanceof Node) && event.currentTarget.contains(next)) {
    return
  }
  expanded.value = false
}
</script>

<template>
  <section
    v-if="plan"
    class="agent-task-rows"
    :aria-label="t('执行计划', 'Execution plan')"
    data-testid="agent-execution-plan"
    @mouseenter="open"
    @mouseleave="close"
    @focusin="open"
    @focusout="close"
  >
    <div class="agent-task-row" :data-open="expanded ? 'true' : 'false'">
      <button
        type="button"
        class="agent-task-row__head"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <span class="agent-task-badge">
          <span
            v-if="headlineStatus === 'completed'"
            class="agent-task-badge__done"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          <span
            v-else
            class="agent-task-ring"
            :class="{ 'agent-task-ring--active': headlineStatus === 'in_progress' }"
          >
            <svg :width="RING" :height="RING" class="agent-task-ring__svg" aria-hidden="true">
              <circle
                :cx="RING / 2"
                :cy="RING / 2"
                :r="ringRadius"
                fill="none"
                stroke="currentColor"
                class="agent-task-ring__track"
                :stroke-width="STROKE"
              />
              <circle
                v-if="headlineStatus === 'in_progress'"
                :cx="RING / 2"
                :cy="RING / 2"
                :r="ringRadius"
                fill="none"
                stroke="currentColor"
                class="agent-task-ring__arc"
                :stroke-width="STROKE"
                stroke-linecap="round"
                :stroke-dasharray="ringDash"
              />
            </svg>
            <span class="agent-task-ring__index">{{ headlineIndex + 1 }}</span>
          </span>
        </span>
        <span class="agent-task-row__label">{{ plan.summary }}</span>
        <span class="agent-task-row__amount">{{ completedCount }}/{{ plan.steps.length }}</span>
        <span
          v-if="headlineStatus === 'completed'"
          class="agent-task-pill agent-task-pill--ok"
        >{{ statusLabel('completed') }}</span>
        <span class="agent-task-row__chevron" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
    </div>

    <div class="agent-task-rows__more" :data-open="expanded ? 'true' : 'false'">
      <div class="agent-task-rows__more-inner">
        <div
          v-for="(step, index) in plan.steps"
          :key="`${index}:${step.text}`"
          class="agent-task-row agent-task-row--child"
          :style="{ animationDelay: `${80 + index * 80}ms` }"
        >
          <div class="agent-task-row__head">
            <span class="agent-task-badge">
              <span
                v-if="step.status === 'completed'"
                class="agent-task-badge__done"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <span
                v-else
                class="agent-task-ring"
                :class="{ 'agent-task-ring--active': step.status === 'in_progress' }"
              >
                <svg :width="RING" :height="RING" class="agent-task-ring__svg" aria-hidden="true">
                  <circle
                    :cx="RING / 2"
                    :cy="RING / 2"
                    :r="ringRadius"
                    fill="none"
                    stroke="currentColor"
                    class="agent-task-ring__track"
                    :stroke-width="STROKE"
                  />
                  <circle
                    v-if="step.status === 'in_progress'"
                    :cx="RING / 2"
                    :cy="RING / 2"
                    :r="ringRadius"
                    fill="none"
                    stroke="currentColor"
                    class="agent-task-ring__arc"
                    :stroke-width="STROKE"
                    stroke-linecap="round"
                    :stroke-dasharray="ringDash"
                  />
                </svg>
                <span class="agent-task-ring__index">{{ index + 1 }}</span>
              </span>
            </span>
            <span class="agent-task-row__label">{{ step.text }}</span>
            <span
              v-if="step.status === 'completed'"
              class="agent-task-pill agent-task-pill--ok"
            >{{ statusLabel(step.status) }}</span>
            <span
              v-else-if="step.status === 'in_progress'"
              class="agent-task-row__amount"
            >{{ statusLabel(step.status) }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
