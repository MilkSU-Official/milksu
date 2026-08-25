<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Button,
  buttonVariants,
  menuContentClass,
  menuLabelClass,
  menuSeparatorClass,
  menuViewportClass,
} from '@felinic/ui'
import { Clock3, FilePlus2 } from 'lucide-vue-next'
import { t } from '@/lib/uiLocale'

const props = withDefaults(defineProps<{
  historyCount?: number
  historyAriaLabel?: string
  historyMenuLabel?: string
  importAriaLabel?: string
}>(), {
  historyCount: 0,
})

const emit = defineEmits<{
  import: []
}>()

const historyMenu = ref<HTMLDetailsElement | null>(null)

const historyAria = () => props.historyAriaLabel?.trim() || t('打开历史', 'Open history')
const historyMenuAria = () => props.historyMenuLabel?.trim() || t('历史', 'History')
const importAria = () => props.importAriaLabel?.trim() || t('导入', 'Import')

function closeHistoryMenuOnOutsidePointer(event: PointerEvent) {
  if (!(event.target instanceof Node)) return
  const menu = historyMenu.value
  if (menu?.open && !menu.contains(event.target)) menu.open = false
}

function closeHistoryMenu() {
  if (historyMenu.value) historyMenu.value.open = false
}

function openImport() {
  closeHistoryMenu()
  emit('import')
}

onMounted(() => {
  document.addEventListener('pointerdown', closeHistoryMenuOnOutsidePointer)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeHistoryMenuOnOutsidePointer)
})

defineExpose({ closeHistoryMenu })
</script>

<template>
  <div
    class="flex min-w-0 shrink-0 items-center gap-2"
    data-workspace-catalog-actions
  >
    <details
      ref="historyMenu"
      class="app-no-drag relative shrink-0"
      data-testid="workspace-history"
      @keydown.esc.stop.prevent="closeHistoryMenu"
    >
      <summary
        data-button=""
        data-variant="outline"
        data-size="sm"
        :class="buttonVariants({ variant: 'outline', size: 'sm' })"
        class="list-none [&::-webkit-details-marker]:hidden"
        :aria-label="historyAria()"
      >
        <Clock3 class="size-4" />
        {{ t('历史', 'History') }}
        <span class="font-mono text-caption text-muted-foreground">
          {{ historyCount }}
        </span>
      </summary>
      <div
        data-state="open"
        data-side="bottom"
        :class="[menuContentClass, menuViewportClass]"
        class="tactical-floating-surface absolute right-0 top-[calc(100%+4px)] z-[var(--z-overlay)] max-h-[min(480px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] overflow-y-auto"
        role="menu"
        :aria-label="historyMenuAria()"
      >
        <div :class="menuLabelClass" class="flex items-center justify-between gap-3 px-2.5 py-2">
          <span>{{ historyMenuAria() }}</span>
          <span class="font-normal text-muted-foreground">{{ t('仅保存在本机', 'Stored on this machine only') }}</span>
        </div>
        <div :class="menuSeparatorClass" />
        <slot name="history" />
      </div>
    </details>
    <Button
      variant="default"
      size="sm"
      class="app-no-drag workspace-import-action shrink-0"
      data-testid="workspace-import"
      :aria-label="importAria()"
      @click="openImport"
    >
      <FilePlus2 class="size-4" />
      {{ t('导入', 'Import') }}
    </Button>
  </div>
</template>
