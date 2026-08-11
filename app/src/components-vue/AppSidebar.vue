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
}>()

const railSection = computed(() => props.activeSection)
const showContextSidebar = computed(() => railSection.value === 'chat')
const expandedRail = computed(() => ['ctf', 'vuln', 'profile'].includes(railSection.value))
</script>

<template>
  <aside
    class="flex shrink-0 border-r border-border bg-sidebar text-sidebar-foreground"
    :class="showContextSidebar ? 'w-[18.5rem]' : expandedRail ? 'w-56' : 'w-[4.75rem]'"
  >
    <WorkspaceRail
      :active-section="railSection"
      :account-status="accountStatus"
      :expanded="expandedRail"
      :theme-mode="themeMode"
      @navigate="$emit('navigate', $event)"
      @profile="$emit('profile')"
      @account-login="$emit('accountLogin')"
      @account-logout="$emit('accountLogout')"
      @settings="$emit('settings')"
      @toggle-theme="$emit('toggleTheme')"
    />
    <ContextSidebar
      v-if="showContextSidebar"
      active-section="chat"
      :active-conversation-id="activeConversationId"
      :conversations="conversations"
      :ctf-section="ctfSection"
      @new="$emit('new')"
      @select-conversation="$emit('selectConversation', $event)"
      @delete-conversation="$emit('deleteConversation', $event)"
      @navigate-ctf="$emit('navigateCtf', $event)"
    />
  </aside>
</template>
