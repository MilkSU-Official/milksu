<script setup lang="ts">
import { computed } from 'vue'
import ChatActivityGroup from '@/components-vue/ChatActivityGroup.vue'
import ChatMessageItem from '@/components-vue/ChatMessageItem.vue'
import {
  isThinkingOnlyAssistant,
  mergeProcessThinking,
  processFoldSummary,
  type ChatProcessFoldBlock,
  type ChatTurnBlock,
} from '@/lib/chatActivity'
import { t } from '@/lib/uiLocale'
import type { SubagentTask } from '@/types'

const props = defineProps<{
  process: ChatProcessFoldBlock
  recoverableFailureId?: string | null
  recoveryContext?: 'ctf' | 'coding'
  rewindableUserMessageId?: string
  rewindDisabled?: boolean
  kernel?: 'pi' | 'dsh'
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
  rewindContext: []
  branchAssistant: [messageId: string]
}>()

const foldSummary = computed(() => processFoldSummary(props.process.blocks))
const foldedThinking = computed(() => mergeProcessThinking(props.process.blocks))
const visibleBlocks = computed(() => (
  props.process.blocks.filter((block): block is ChatTurnBlock => (
    block.kind === 'activity'
    || (block.kind === 'message' && !isThinkingOnlyAssistant(block.message))
  ))
))
</script>

<template>
  <details class="agent-process mb-7">
    <summary class="agent-process__summary">
      <span>{{ t('过程', 'Process') }}</span>
      <span
        v-if="foldSummary"
        class="agent-process__count"
      >{{ foldSummary }}</span>
    </summary>
    <div class="agent-process__body">
      <ChatMessageItem
        v-if="foldedThinking"
        :message="foldedThinking"
        thinking-total
      />
      <template v-for="item in visibleBlocks" :key="item.id">
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
          :can-rewind="item.message.id === rewindableUserMessageId"
          :rewind-disabled="rewindDisabled"
          :kernel="kernel"
          @respond-approval="(requestId, approved, scope, choice) => $emit('respondApproval', requestId, approved, scope, choice)"
          @retry="$emit('retry')"
          @edit-user="(messageId, content) => $emit('editUser', messageId, content)"
          @rewind-context="$emit('rewindContext')"
          @branch-assistant="messageId => $emit('branchAssistant', messageId)"
        />
      </template>
    </div>
  </details>
</template>
