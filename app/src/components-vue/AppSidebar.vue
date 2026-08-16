<script setup lang="ts">
import { computed } from 'vue'
import ContextSidebar from '@/components-vue/ContextSidebar.vue'
import TacticalPanelShell from '@/components-vue/TacticalPanelShell.vue'
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
  codingContextOpen?: boolean
  themeMode: ThemeMode
}>()

defineEmits<{
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
}>()

const railSection = computed(() => props.activeSection)
const showContextSidebar = computed(() => props.codingContextOpen)
</script>

<template>
  <aside
    class="workspace-navigation-shell relative z-40 flex shrink-0 border-r border-[var(--night-border)] text-sidebar-foreground"
    data-testid="stable-app-sidebar"
  >
    <WorkspaceRail
      :active-section="railSection"
      :account-status="accountStatus"
      :theme-mode="themeMode"
      @navigate="$emit('navigate', $event)"
      @profile="$emit('profile')"
      @account-login="$emit('accountLogin')"
      @account-logout="$emit('accountLogout')"
      @settings="$emit('settings')"
      @toggle-theme="$emit('toggleTheme')"
    />
    <button
      v-if="showContextSidebar"
      type="button"
      class="coding-context-backdrop fixed bottom-0 right-0 top-0 z-30 cursor-default bg-black/45 backdrop-blur-[1px]"
      aria-label="关闭 Coding 会话"
      @click="$emit('closeCodingContext')"
    />
    <TacticalPanelShell
      v-if="showContextSidebar"
      as="section"
      size="drawer"
      body-mode="viewport"
      id="coding-context-sidebar"
      class="coding-context-drawer app-no-drag z-40"
      aria-label="Coding 会话"
      data-testid="coding-context-drawer"
    >
      <ContextSidebar
        active-section="chat"
        :active-conversation-id="activeConversationId"
        :conversations="conversations"
        :ctf-section="ctfSection"
        @new="$emit('closeCodingContext'); $emit('new')"
        @select-conversation="$emit('closeCodingContext'); $emit('selectConversation', $event)"
        @delete-conversation="$emit('deleteConversation', $event)"
        @navigate-ctf="$emit('navigateCtf', $event)"
      />
    </TacticalPanelShell>
  </aside>
</template>

<style scoped>
.workspace-navigation-shell {
  --workspace-rail-width: 4.75rem;
  width: var(--workspace-rail-width);
}
.coding-context-backdrop { left: var(--workspace-rail-width); }
.coding-context-drawer {
  --tactical-panel-position: absolute;
  inset-block: 0;
  left: 100%;
  border-right: 1px solid var(--night-border);
}
@media (min-width: 1180px) {
  .workspace-navigation-shell { --workspace-rail-width: 13.5rem; }
}
</style>
