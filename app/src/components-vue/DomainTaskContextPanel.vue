<script setup lang="ts">
import { computed } from 'vue'
import { Badge, Button } from '@felinic/ui'
import {
  Flag,
  ShieldCheck,
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
      <header class="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <component :is="DomainIcon" class="size-4 shrink-0 text-primary" />
            <Badge variant="secondary">{{ presentation.moduleLabel }}</Badge>
            <span class="truncate text-caption font-medium">任务信息</span>
          </div>
          <p class="mt-1 truncate text-body font-medium" :title="presentation.title">
            {{ presentation.title }}
          </p>
          <p v-if="presentation.subtitle" class="mt-0.5 line-clamp-2 text-caption leading-5 text-muted-foreground">
            {{ presentation.subtitle }}
          </p>
        </div>
      </header>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <p v-if="presentation.ownership" class="text-caption leading-5 text-muted-foreground">
          {{ presentation.ownership }}
        </p>
        <dl v-if="presentation.facts.length" class="space-y-2">
          <div
            v-for="fact in presentation.facts"
            :key="fact.label"
            class="flex items-start justify-between gap-3 border-b border-border px-0 py-2.5 last:border-b-0"
          >
            <dt class="shrink-0 text-caption text-muted-foreground">{{ fact.label }}</dt>
            <dd class="min-w-0 break-words text-right text-caption font-medium leading-5">{{ fact.value }}</dd>
          </div>
        </dl>
        <p v-else class="text-caption text-muted-foreground">
          可返回工作台查看题面与材料。
        </p>
      </div>

      <footer class="space-y-2 border-t border-border px-3 py-2.5">
        <Button
          variant="outline"
          size="sm"
          class="min-h-9 w-full justify-start"
          aria-label="收起任务信息"
          data-testid="collapse-domain-to-pip-inline"
          @click="toggleCollapsed"
        >
          收起
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="min-h-9 w-full justify-start"
          :aria-label="presentation.returnAriaLabel"
          @click="emit('returnDomain')"
        >
          {{ presentation.returnLabel }}
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
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  background: color-mix(in oklab, hsl(var(--card)) 92%, transparent);
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
  background: hsl(var(--muted) / 0.55);
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

.domain-task-context-inline.domain-task-context--expanded {
  border: 0;
}
</style>
