<script setup lang="ts">
import ContextSidebar from '@/components-vue/ContextSidebar.vue'
import { t } from '@/lib/uiLocale'
import type { ThemeMode } from '@/lib/themeMode'
import type { AppSection, CTFWorkspaceSection, WorkspaceSection } from '@/lib/workspaceNavigation'
import type { AccountStatus, Conversation } from '@/types'

defineProps<{
  activeSection: AppSection
  accountStatus: AccountStatus
  activeConversationId: string | null
  conversations: Conversation[]
  runningConversationIds?: string[]
  conversationActionError?: string
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
  deleteConversationPermanently: [id: string]
  newProjectSession: [workspacePath: string]
  renameConversation: [id: string, title: string]
  navigateCtf: [value: CTFWorkspaceSection]
  openCodingContext: []
  collapseCodingContext: []
}>()
</script>

<template>
  <aside
    class="workspace-navigation-shell relative z-30 flex h-full min-h-0 shrink-0 text-sidebar-foreground"
    data-testid="stable-app-sidebar"
    :aria-label="t('工作区导航', 'Workspace navigation')"
  >
    <ContextSidebar
      :active-section="activeSection"
      :active-conversation-id="activeConversationId"
      :conversations="conversations"
      :running-conversation-ids="runningConversationIds"
      :action-error="conversationActionError"
      :ctf-section="ctfSection"
      :account-status="accountStatus"
      :theme-mode="themeMode"
      :collapsed="!codingContextOpen"
      @new="$emit('new')"
      @collapse="$emit('collapseCodingContext')"
      @expand="$emit('openCodingContext')"
      @select-conversation="$emit('selectConversation', $event)"
      @delete-conversation="$emit('deleteConversation', $event)"
      @delete-conversation-permanently="$emit('deleteConversationPermanently', $event)"
      @new-project-session="$emit('newProjectSession', $event)"
      @rename-conversation="(id, title) => $emit('renameConversation', id, title)"
      @navigate-ctf="$emit('navigateCtf', $event)"
      @navigate="$emit('navigate', $event)"
      @profile="$emit('profile')"
      @settings="$emit('settings')"
      @account-login="$emit('accountLogin')"
      @account-logout="$emit('accountLogout')"
      @toggle-theme="$emit('toggleTheme')"
    />
  </aside>
</template>

<style scoped>
.workspace-navigation-shell {
  border-right: 1px solid var(--border);
  background: var(--background);
}
</style>
