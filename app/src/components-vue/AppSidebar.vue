<script setup lang="ts">
import { computed } from 'vue'
import ContextSidebar from '@/components-vue/ContextSidebar.vue'
import WorkspaceRail from '@/components-vue/WorkspaceRail.vue'
import type { CTFWorkspaceSection, WorkspaceSection } from '@/lib/workspaceNavigation'
import type { NSSCTFTrainingDashboard } from '@/nssctfTrainingTypes'
import type { Conversation } from '@/types'

const props = defineProps<{
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

const railSection = computed(() => (
  props.activeSection === 'settings' ? 'ctf' : props.activeSection
))
const showContextSidebar = computed(() => railSection.value === 'chat')
</script>

<template>
  <aside
    class="flex shrink-0 border-r border-border bg-sidebar text-sidebar-foreground"
    :class="showContextSidebar ? 'w-[18.5rem]' : 'w-[4.75rem]'"
  >
    <WorkspaceRail
      :active-section="railSection"
      @navigate="$emit('navigate', $event)"
    />
    <ContextSidebar
      v-if="showContextSidebar"
      :active-section="railSection"
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
