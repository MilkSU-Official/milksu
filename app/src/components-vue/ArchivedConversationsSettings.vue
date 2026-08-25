<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SettingsRow,
  SettingsSection,
} from '@felinic/ui'
import { ArchiveRestore, Trash2 } from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import { t } from '@/lib/uiLocale'
import type { Conversation } from '@/types'

const emit = defineEmits<{ changed: [] }>()
const conversations = ref<Conversation[]>([])
const error = ref('')
const confirmation = ref<{ action: 'restore' | 'delete'; conversation: Conversation } | null>(null)

async function load() {
  error.value = ''
  try {
    conversations.value = await invokeCommand<Conversation[]>('list_archived_conversations')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function confirmAction() {
  const pending = confirmation.value
  if (!pending) return
  error.value = ''
  try {
    await invokeCommand(
      pending.action === 'restore' ? 'restore_conversation' : 'delete_archived_conversation',
      { id: pending.conversation.id },
    )
    confirmation.value = null
    await load()
    emit('changed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function archivedTime(value: number | undefined) {
  return value
    ? t(`归档于 ${new Date(value).toLocaleString()}`, `Archived ${new Date(value).toLocaleString()}`)
    : ''
}

onMounted(load)
</script>

<template>
  <div class="contents">
    <p v-if="error" class="text-body text-destructive">{{ error }}</p>
    <SettingsSection v-if="conversations.length" :aria-label="t('归档聊天', 'Archived chats')">
    <SettingsRow
      v-for="(conversation, index) in conversations"
      :key="conversation.id"
      :label="conversation.title"
      :description="archivedTime(conversation.archivedAt)"
      :divider="index < conversations.length - 1"
    >
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="sm" @click="confirmation = { action: 'restore', conversation }">
          <ArchiveRestore class="size-3.5" />
          {{ t('恢复', 'Restore') }}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-destructive hover:text-destructive"
          :aria-label="t('永久删除归档聊天', 'Permanently delete archived chat')"
          :title="t('永久删除', 'Delete permanently')"
          @click="confirmation = { action: 'delete', conversation }"
        >
          <Trash2 class="size-3.5" />
        </Button>
      </div>
    </SettingsRow>
    </SettingsSection>

    <Dialog :open="Boolean(confirmation)" @update:open="open => { if (!open) confirmation = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ confirmation?.action === 'restore' ? t('恢复聊天？', 'Restore this chat?') : t('永久删除聊天？', 'Permanently delete this chat?') }}</DialogTitle>
          <DialogDescription v-if="confirmation?.action === 'restore'">
            {{ t(`“${confirmation.conversation.title}”将恢复到 Agent 会话列表，可以继续原有上下文。`, `"${confirmation.conversation.title}" will return to the agent conversation list with its existing context.`) }}
          </DialogDescription>
          <DialogDescription v-else>
            {{ t(`“${confirmation?.conversation.title}”的聊天记录将被永久删除，此操作无法撤销。项目文件不会被删除。`, `"${confirmation?.conversation.title}" will be permanently deleted. This cannot be undone. Project files are not deleted.`) }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="confirmation = null">{{ t('取消', 'Cancel') }}</Button>
          <Button :variant="confirmation?.action === 'delete' ? 'destructive' : 'default'" @click="confirmAction">
            {{ confirmation?.action === 'restore' ? t('确认恢复', 'Restore') : t('确认永久删除', 'Delete permanently') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
