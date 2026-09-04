<script setup lang="ts">
import { computed } from 'vue'
import ChatActivityGroup from '@/components-vue/ChatActivityGroup.vue'
import ChatMessageItem from '@/components-vue/ChatMessageItem.vue'
import { buildChatActivityEntries, type ChatProcessFoldBlock } from '@/lib/chatActivity'
import { t } from '@/lib/uiLocale'
import type { SubagentTask } from '@/types'

const props = defineProps<{
  process: ChatProcessFoldBlock
  recoverableFailureId?: string | null
  recoveryContext?: 'ctf' | 'coding'
  activityOpen: (activityId: string) => boolean
  activityOpenEntries: (activityId: string) => ReadonlySet<string>
  subagentTasks?: readonly SubagentTask[]
}>()

const emit = defineEmits<{
  toggleGroup: [activityId: string, open: boolean]
  toggleEntry: [activityId: string, entryId: string, open: boolean]
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string]
  retry: []
  editUser: [messageId: string, content: string]
  branchAssistant: [messageId: string]
}>()

const stepCount = computed(() => {
  let count = 0
  for (const block of props.process.blocks) {
    if (block.kind === 'activity') count += Math.max(1, buildChatActivityEntries(block.messages).length)
    else count += 1
  }
  return count
})
</script>

<template>
  <details class="agent-process mb-7">
    <summary class="agent-process__summary">
      <span>{{ t('过程', 'Process') }}</span>
      <span class="agent-process__count">{{ t(`${stepCount} 步`, `${stepCount} steps`) }}</span>
    </summary>
    <div class="agent-process__body">
      <template v-for="item in process.blocks" :key="item.id">
        <ChatActivityGroup
          v-if="item.kind === 'activity'"
          :activity="item"
          :open="activityOpen(item.id)"
          :open-entry-ids="activityOpenEntries(item.id)"
          :subagent-tasks="subagentTasks"
          reveal-completed
          @toggle-group="open => $emit('toggleGroup', item.id, open)"
          @toggle-entry="(entryId, open) => $emit('toggleEntry', item.id, entryId, open)"
        />
        <ChatMessageItem
          v-else
          :message="item.message"
          :recoverable="item.message.id === recoverableFailureId"
          :recovery-context="recoveryContext"
          @respond-approval="(requestId, approved, scope, choice) => $emit('respondApproval', requestId, approved, scope, choice)"
          @retry="$emit('retry')"
          @edit-user="(messageId, content) => $emit('editUser', messageId, content)"
          @branch-assistant="messageId => $emit('branchAssistant', messageId)"
        />
      </template>
    </div>
  </details>
</template>
