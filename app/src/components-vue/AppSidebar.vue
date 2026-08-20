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
  runningConversationIds?: string[]
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
  deleteConversationPermanently: [id: string]
  newProjectSession: [workspacePath: string]
  renameConversation: [id: string, title: string]
  navigateCtf: [value: CTFWorkspaceSection]
  openCodingContext: []
  /** Collapse the open Coding history panel (button lives in the panel header). */
  collapseCodingContext: []
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
      class="coding-history-panel app-no-drag flex h-full min-h-0 w-[16.5rem] shrink-0 flex-col"
      aria-label="Coding 会话"
      data-testid="coding-context-drawer"
    >
      <ContextSidebar
        active-section="chat"
        :active-conversation-id="activeConversationId"
        :conversations="conversations"
        :running-conversation-ids="runningConversationIds"
        :ctf-section="ctfSection"
        @new="$emit('new')"
        @collapse="$emit('collapseCodingContext')"
        @select-conversation="$emit('selectConversation', $event)"
        @delete-conversation="$emit('deleteConversation', $event)"
        @delete-conversation-permanently="$emit('deleteConversationPermanently', $event)"
        @new-project-session="$emit('newProjectSession', $event)"
        @rename-conversation="(id, title) => $emit('renameConversation', id, title)"
        @navigate-ctf="$emit('navigateCtf', $event)"
      />
    </section>

    <!-- Collapsed: expand + new-task icons appear on the Coding topbar leading slot. -->
  </aside>
</template>

<style scoped>
.workspace-navigation-shell {
  --workspace-rail-width: 4.75rem;
  border-right: 1px solid var(--night-border);
  background: var(--ak-surface-canvas, #111315);
}
.coding-history-panel {
  min-height: 0;
  background: transparent;
}
</style>
