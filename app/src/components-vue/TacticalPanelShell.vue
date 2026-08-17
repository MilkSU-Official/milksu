<script setup lang="ts">
import { computed, useSlots } from 'vue'

const props = withDefaults(defineProps<{
  as?: string
  size?: 'compact' | 'wide' | 'drawer'
  bodyMode?: 'scroll' | 'viewport'
}>(), {
  as: 'section',
  size: 'compact',
  bodyMode: 'scroll',
})

const slots = useSlots()
const hasHeader = computed(() => Boolean(slots.header))
const hasFooter = computed(() => Boolean(slots.footer))
</script>

<template>
  <component
    :is="as"
    class="tactical-panel-shell tactical-dark-surface"
    :data-panel-size="size"
    :data-panel-body-mode="bodyMode"
  >
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
  border-left: 1px solid var(--night-border);
  background-color: var(--tactical-ink-2);
  background-image: var(--tactical-carbon-image);
  background-size: 640px 640px;
  color: var(--night-foreground);
  box-shadow: -18px 0 38px rgb(0 0 0 / .16);
}

.tactical-panel-shell::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: linear-gradient(180deg, var(--tactical-acid), transparent 32%);
  content: '';
  opacity: .72;
  pointer-events: none;
}

/* Keep environment / changes / artifacts / browser on one rail width. */
.tactical-panel-shell[data-panel-size='compact'],
.tactical-panel-shell[data-panel-size='wide'] {
  width: clamp(22rem, 30cqi, 28rem);
}
.tactical-panel-shell[data-panel-size='drawer'] { width: clamp(16rem, 22vw, 19rem); }

.tactical-panel-shell__header {
  display: flex;
  min-height: 3.5rem;
  flex: none;
  align-items: center;
  border-bottom: 1px solid var(--night-border);
  padding: 0 1rem;
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
  border-top: 1px solid var(--night-border);
}

@container coding-workspace (max-width: 68rem) {
  .tactical-panel-shell[data-panel-size='compact'],
  .tactical-panel-shell[data-panel-size='wide'] {
    position: absolute;
    z-index: var(--z-panel);
    inset-block: 0;
    right: 0;
    width: min(25rem, calc(100% - 4rem));
    max-width: 100%;
    box-shadow: -24px 0 56px rgb(0 0 0 / .38);
  }
}
</style>
