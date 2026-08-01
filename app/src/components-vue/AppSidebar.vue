<script setup lang="ts">
import ContextSidebar from '@/components-vue/ContextSidebar.vue'
import WorkspaceRail from '@/components-vue/WorkspaceRail.vue'
import type { CTFWorkspaceSection, WorkspaceSection } from '@/lib/workspaceNavigation'
import type { NSSCTFTrainingDashboard } from '@/nssctfTrainingTypes'
import type { Conversation } from '@/types'

defineProps<{
  activeSection: WorkspaceSection | 'settings'
  activeConversationId: string | null
  conversations: Conversation[]
  ctfDashboard: NSSCTFTrainingDashboard | null
  ctfSection: CTFWorkspaceSection
}>()

defineEmits<{
  new: []
  navigate: [value: WorkspaceSection]
  selectConversation: [id: string]
  deleteConversation: [id: string]
  navigateCtf: [value: CTFWorkspaceSection]
  settings: []
}>()
</script>

<template>
  <aside class="flex w-[18.5rem] shrink-0 border-r border-border bg-sidebar text-sidebar-foreground">
    <WorkspaceRail
      :active-section="activeSection === 'settings' ? 'ctf' : activeSection"
      :ctf-dashboard="ctfDashboard"
      @navigate="$emit('navigate', $event)"
    />
    <ContextSidebar
      :active-section="activeSection === 'settings' ? 'ctf' : activeSection"
      :active-conversation-id="activeConversationId"
      :conversations="conversations"
      :ctf-section="ctfSection"
      @new="$emit('new')"
      @select-conversation="$emit('selectConversation', $event)"
      @delete-conversation="$emit('deleteConversation', $event)"
      @navigate-ctf="$emit('navigateCtf', $event)"
      @settings="$emit('settings')"
    />
  </aside>
</template>
