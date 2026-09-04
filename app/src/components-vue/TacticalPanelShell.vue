<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { clampCodingRailWidth } from '@/lib/codingRailWidth'
import { t } from '@/lib/uiLocale'

const props = withDefaults(defineProps<{
  as?: string
  size?: 'compact' | 'wide' | 'drawer'
  bodyMode?: 'scroll' | 'viewport'
  resizable?: boolean
  width?: number | null
}>(), {
  as: 'section',
  size: 'compact',
  bodyMode: 'scroll',
  resizable: false,
  width: null,
})

const emit = defineEmits<{
  'update:width': [value: number]
}>()

const slots = useSlots()
const hasHeader = computed(() => Boolean(slots.header))
const hasFooter = computed(() => Boolean(slots.footer))
const panelStyle = computed(() => (
  props.width
    ? { width: `${props.width}px`, maxWidth: '100%' }
    : undefined
))

function startResize(event: PointerEvent) {
  if (event.button !== 0) return
  const handle = event.currentTarget as HTMLElement
  const panel = handle.closest('.tactical-panel-shell')
  if (!panel) return
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const startWidth = panel.getBoundingClientRect().width

  function onMove(move: PointerEvent) {
    emit('update:width', clampCodingRailWidth(startWidth + (startX - move.clientX)))
  }
  function onUp(up: PointerEvent) {
    handle.releasePointerCapture(up.pointerId)
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
}
</script>

<template>
  <component
    :is="as"
    class="tactical-panel-shell"
    :data-panel-size="size"
    :data-panel-body-mode="bodyMode"
    :data-panel-resizable="resizable ? '' : undefined"
    :style="panelStyle"
  >
    <div
      v-if="resizable"
      class="tactical-panel-shell__resize app-no-drag"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('调整右侧栏宽度', 'Resize the right panel')"
      @pointerdown="startResize"
    />
    <header v-if="hasHeader" class="tactical-panel-shell__header">
      <slot name="header" />
    </header>
    <div class="tactical-panel-shell__body">
      <slot />
    </div>
    <footer v-if="hasFooter" class="tactical-panel-shell__footer">
      <slot name="footer" />
    </footer>
  </component>
</template>

<style scoped>
.tactical-panel-shell {
  position: var(--tactical-panel-position, relative);
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: none;
  flex-direction: column;
  isolation: isolate;
  overflow: hidden;
  border-left: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: var(--background);
  color: var(--foreground);
  animation: agent-chrome-in-x 280ms cubic-bezier(0.16, 1, 0.3, 1);
}

.tactical-panel-shell[data-panel-size='compact'],
.tactical-panel-shell[data-panel-size='wide'] {
  width: clamp(18rem, 26cqi, 24rem);
}
.tactical-panel-shell[data-panel-size='drawer'] { width: clamp(16rem, 22vw, 19rem); }

.tactical-panel-shell__resize {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 2;
  width: 8px;
  margin-left: -3px;
  cursor: col-resize;
  touch-action: none;
}

.tactical-panel-shell__resize::after {
  position: absolute;
  inset: 0 3px;
  background: transparent;
  content: '';
}

.tactical-panel-shell__resize:hover::after,
.tactical-panel-shell__resize:focus-visible::after {
  background: var(--hover-2);
}

.tactical-panel-shell__header {
  display: flex;
  min-height: 2.5rem;
  flex: none;
  align-items: center;
  padding: 0.25rem calc(0.5rem + var(--shell-window-control-safe-right)) 0.25rem 0.5rem;
}

.tactical-panel-shell__body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.tactical-panel-shell__body > :deep(*) {
  min-width: 0;
}

.tactical-panel-shell[data-panel-body-mode='scroll'] > .tactical-panel-shell__body {
  overflow-y: auto;
}

.tactical-panel-shell[data-panel-body-mode='viewport'] > .tactical-panel-shell__body {
  overflow: hidden;
}

.tactical-panel-shell__footer {
  flex: none;
}

@keyframes agent-chrome-in-x {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tactical-panel-shell {
    animation: none;
  }
}
</style>
