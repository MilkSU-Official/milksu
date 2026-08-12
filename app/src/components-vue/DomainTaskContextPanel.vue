<script setup lang="ts">
import { computed } from 'vue'
import { Badge, Button } from '@felinic/ui'
import {
  ChevronDown,
  File,
  Flag,
  RotateCcw,
  ShieldCheck,
  Target,
} from 'lucide-vue-next'
import type { DomainTaskContextPresentation } from '@/lib/domainTaskContext'

const props = defineProps<{
  presentation: DomainTaskContextPresentation
  collapsed: boolean
}>()

const emit = defineEmits<{
  'update:collapsed': [value: boolean]
  returnDomain: []
}>()

const DomainIcon = computed(() => (
  props.presentation.kind === 'ctf' ? Flag : ShieldCheck
))
const topReturnLabel = computed(() => (
  props.presentation.kind === 'ctf' ? '返回挑战' : '返回 CVE'
))

function toggleCollapsed() {
  emit('update:collapsed', !props.collapsed)
}
</script>

<template>
  <aside
    class="domain-task-context app-no-drag"
    :class="collapsed ? 'domain-task-context--collapsed' : 'domain-task-context--expanded'"
    :aria-label="`${presentation.moduleLabel} 任务信息`"
    data-testid="domain-task-context-panel"
  >
    <template v-if="collapsed">
      <button
        type="button"
        class="domain-task-context__pip"
        :aria-label="`展开 ${presentation.moduleLabel} 任务信息`"
        :title="presentation.collapsedLabel"
        data-testid="reopen-domain-from-pip"
        @click="toggleCollapsed"
      >
        <component :is="DomainIcon" class="size-4 shrink-0" />
        <span class="min-w-0 truncate">{{ presentation.collapsedLabel }}</span>
        <span class="shrink-0 text-caption font-medium text-primary">展开</span>
      </button>
      <Button
        variant="outline"
        size="sm"
        class="min-h-9 shrink-0 px-3"
        :aria-label="presentation.returnAriaLabel"
        :title="presentation.returnLabel"
        @click="emit('returnDomain')"
      >
        {{ presentation.returnLabel }}
      </Button>
    </template>

    <template v-else>
      <header class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div class="flex min-w-0 items-center gap-2 text-control font-medium">
          <component :is="DomainIcon" class="size-4 shrink-0 text-primary" />
          <span>来自 {{ presentation.moduleLabel }}</span>
        </div>
        <Button variant="ghost" size="sm" class="shrink-0" @click="emit('returnDomain')">
          <RotateCcw class="size-3.5" />
          {{ topReturnLabel }}
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <section class="domain-mission-hero game-grid border-b border-border px-5 py-7">
          <p class="break-words text-2xl font-semibold tracking-[-0.035em]" :title="presentation.title">
            {{ presentation.title }}
          </p>
          <div v-if="presentation.meta.length" class="mt-4 flex flex-wrap gap-2">
            <Badge
              v-for="(item, index) in presentation.meta"
              :key="item"
              :variant="index === 0 && presentation.kind === 'ctf' ? 'info' : 'outline'"
            >
              {{ item }}
            </Badge>
          </div>
        </section>

        <div class="space-y-6 px-5 py-5">
          <section class="domain-mission-objective game-focus-panel flex items-center gap-4 px-4 py-4">
            <Target class="size-9 shrink-0 text-primary" />
            <div class="min-w-0">
              <p class="text-caption font-semibold text-foreground">{{ presentation.objectiveLabel }}</p>
              <p class="mt-1 text-body font-semibold leading-6 text-primary">{{ presentation.objective }}</p>
            </div>
          </section>

          <section>
            <h3 class="text-control font-semibold">{{ presentation.briefLabel }}</h3>
            <p class="mt-3 whitespace-pre-line text-body leading-6 text-muted-foreground">
              {{ presentation.brief }}
            </p>
          </section>

          <section v-if="presentation.materials.length">
            <h3 class="text-control font-semibold">材料</h3>
            <div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div
                v-for="material in presentation.materials"
                :key="material"
                class="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background/45 px-3 py-3"
              >
                <File class="size-4 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate text-control">{{ material }}</span>
              </div>
            </div>
          </section>

          <details v-if="presentation.facts.length" class="group rounded-lg border border-border bg-background/35">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-control text-muted-foreground [&::-webkit-details-marker]:hidden">
              {{ presentation.detailsLabel }}
              <ChevronDown class="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <dl class="border-t border-border px-3 py-2">
              <div v-for="fact in presentation.facts" :key="fact.label" class="py-2">
                <dt class="text-caption text-muted-foreground">{{ fact.label }}</dt>
                <dd class="mt-1 break-words text-caption leading-5">{{ fact.value }}</dd>
              </div>
            </dl>
          </details>
        </div>
      </div>

      <footer class="space-y-2 border-t border-border px-4 py-3">
        <Button
          variant="brand"
          class="min-h-10 w-full"
          :aria-label="presentation.returnAriaLabel"
          @click="emit('returnDomain')"
        >
          <component :is="DomainIcon" class="size-4" />
          {{ presentation.returnLabel }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="min-h-9 w-full"
          aria-label="收起任务信息"
          data-testid="collapse-domain-to-pip-inline"
          @click="toggleCollapsed"
        >
          收起简报
        </Button>
      </footer>
    </template>
  </aside>
</template>

<style scoped>
.domain-task-context {
  pointer-events: auto;
}

.domain-task-context--collapsed {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: min(28rem, 80vw);
  border: 1px solid var(--border);
  border-radius: .45rem;
  background: color-mix(in oklab, var(--card) 92%, transparent);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 0.25rem 0.35rem 0.25rem 0.25rem;
  backdrop-filter: blur(10px);
}

.domain-task-context__pip {
  display: inline-flex;
  min-width: 0;
  max-width: 20rem;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0.4rem 0.7rem;
  font-size: 0.8rem;
  line-height: 1.25;
}

.domain-task-context__pip:hover {
  background: color-mix(in srgb, var(--muted) 55%, transparent);
}

.domain-task-context--expanded {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
}

.domain-mission-hero {
  background:
    linear-gradient(90deg, var(--focus-panel-strong), transparent 58%),
    transparent;
  box-shadow: inset 3px 0 0 var(--brand);
}

.domain-task-context-inline.domain-task-context--expanded {
  border: 0;
}
</style>
