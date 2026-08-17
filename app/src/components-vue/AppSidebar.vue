<script setup lang="ts">
import { computed } from 'vue'
import ContextSidebar from '@/components-vue/ContextSidebar.vue'
import WorkspaceRail from '@/components-vue/WorkspaceRail.vue'
import type { ThemeMode } from '@/lib/themeMode'
import type { AppSection, CTFWorkspaceSection, WorkspaceSection } from '@/lib/workspaceNavigation'
import type { AccountStatus, Conversation } from '@/types'

const props = defineProps<{
  activeSection: AppSection
  accountStatus: AccountStatus
  activeConversationId: string | null
  conversations: Conversation[]
  ctfSection: CTFWorkspaceSection
  /** Coding history panel: fixed beside the rail, not a floating overlay. */
  codingContextOpen?: boolean
  themeMode: ThemeMode
}>()

const emit = defineEmits<{
  new: []
  navigate: [value: WorkspaceSection]
  settings: []
  profile: []
  accountLogin: []
  accountLogout: []
  toggleTheme: []
  selectConversation: [id: string]
  deleteConversation: [id: string]
  navigateCtf: [value: CTFWorkspaceSection]
  closeCodingContext: []
  openCodingContext: []
}>()

const railSection = computed(() => props.activeSection)
const showCodingHistory = computed(() => (
  props.activeSection === 'chat' && props.codingContextOpen
))
</script>

<template>
  <aside
    class="workspace-navigation-shell relative z-30 flex h-full min-h-0 shrink-0 text-sidebar-foreground"
    data-testid="stable-app-sidebar"
  >
    <WorkspaceRail
      :active-section="railSection"
      :account-status="accountStatus"
      :theme-mode="themeMode"
      collapsed
      @navigate="$emit('navigate', $event)"
      @profile="$emit('profile')"
      @account-login="$emit('accountLogin')"
      @account-logout="$emit('accountLogout')"
      @settings="$emit('settings')"
      @toggle-theme="$emit('toggleTheme')"
    />

    <section
      v-if="showCodingHistory"
      id="coding-context-sidebar"
      class="coding-history-panel app-no-drag flex h-full min-h-0 w-[16.5rem] shrink-0 flex-col border-r border-[var(--night-border)] bg-[var(--tactical-ink)]"
      aria-label="Coding 会话"
      data-testid="coding-context-drawer"
    >
      <ContextSidebar
        active-section="chat"
        :active-conversation-id="activeConversationId"
        :conversations="conversations"
        :ctf-section="ctfSection"
        @new="$emit('new')"
        @select-conversation="$emit('selectConversation', $event)"
        @delete-conversation="$emit('deleteConversation', $event)"
        @navigate-ctf="$emit('navigateCtf', $event)"
        @collapse="$emit('closeCodingContext')"
      />
    </section>

    <!-- Collapsed: no extra strip; expand from Coding topbar only. -->
  </aside>
</template>

<style scoped>
.workspace-navigation-shell {
  --workspace-rail-width: 4.75rem;
  /* Single edge against the main canvas; history panel has its own right border. */
  border-right: 1px solid var(--night-border);
}
.coding-history-panel {
  min-height: 0;
  /* History sits between icon rail and chat; keep a hairline on the rail side. */
  border-left: 1px solid color-mix(in srgb, var(--night-border) 80%, transparent);
  background-image: var(--tactical-carbon-image);
  background-size: 640px 640px;
}
</style>
