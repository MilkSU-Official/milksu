<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
const codingContextOpen = ref(false)
const codingContextAvailable = computed(() => railSection.value === 'chat')
const showContextSidebar = computed(() => codingContextAvailable.value && codingContextOpen.value)

watch(
  () => props.activeSection,
  () => { codingContextOpen.value = false },
)
</script>

<template>
  <aside
    class="workspace-navigation-shell relative z-40 flex shrink-0 border-r border-[#2d343b] text-sidebar-foreground"
    data-testid="stable-app-sidebar"
  >
    <WorkspaceRail
      :active-section="railSection"
      :account-status="accountStatus"
      :context-available="codingContextAvailable"
      :context-open="codingContextOpen"
      :theme-mode="themeMode"
      @navigate="$emit('navigate', $event)"
      @profile="$emit('profile')"
      @account-login="$emit('accountLogin')"
      @account-logout="$emit('accountLogout')"
      @settings="$emit('settings')"
      @toggle-theme="$emit('toggleTheme')"
      @toggle-context="codingContextOpen = !codingContextOpen"
    />
    <button
      v-if="showContextSidebar"
      type="button"
      class="coding-context-backdrop fixed bottom-0 right-0 top-0 z-30 cursor-default bg-black/45 backdrop-blur-[1px]"
      aria-label="关闭 Coding 会话"
      @click="codingContextOpen = false"
    />
    <TacticalPanelShell
      v-if="showContextSidebar"
      as="section"
      size="drawer"
      body-mode="viewport"
      id="coding-context-sidebar"
      class="coding-context-drawer absolute bottom-0 left-full top-0 z-40"
      aria-label="Coding 会话"
      data-testid="coding-context-drawer"
    >
      <ContextSidebar
        active-section="chat"
        :active-conversation-id="activeConversationId"
        :conversations="conversations"
        :ctf-section="ctfSection"
        @new="codingContextOpen = false; $emit('new')"
        @select-conversation="codingContextOpen = false; $emit('selectConversation', $event)"
        @delete-conversation="$emit('deleteConversation', $event)"
        @navigate-ctf="$emit('navigateCtf', $event)"
      />
    </TacticalPanelShell>
  </aside>
</template>

<style scoped>
.workspace-navigation-shell { width: 4.75rem; }
.coding-context-backdrop { left: 4.75rem; }
.coding-context-drawer { border-right: 1px solid #343b42; }
@media (min-width: 1180px) {
  .workspace-navigation-shell { width: 13.5rem; }
  .coding-context-backdrop { left: 13.5rem; }
}
</style>
