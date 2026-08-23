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
} from '@felinic/ui'
import { ArchiveRestore, Trash2 } from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import type { Conversation } from '@/types'

const emit = defineEmits<{ changed: [] }>()
const conversations = ref<Conversation[]>([])
const loading = ref(false)
const error = ref('')
const confirmation = ref<{ action: 'restore' | 'delete'; conversation: Conversation } | null>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    conversations.value = await invokeCommand<Conversation[]>('list_archived_conversations')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
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
  return value ? `归档于 ${new Date(value).toLocaleString()}` : '归档时间未知'
}

onMounted(load)
</script>

<template>
  <div>
    <p v-if="error" class="px-4 py-3 text-body text-destructive">{{ error }}</p>
    <p v-if="loading" class="px-4 py-5 text-body text-muted-foreground">正在读取归档聊天…</p>
    <SettingsRow
      v-for="conversation in conversations"
      :key="conversation.id"
      :label="conversation.title"
      :description="archivedTime(conversation.archivedAt)"
    >
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="sm" @click="confirmation = { action: 'restore', conversation }">
          <ArchiveRestore class="size-3.5" />
          恢复
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-destructive hover:text-destructive"
          aria-label="永久删除归档聊天"
          title="永久删除"
          @click="confirmation = { action: 'delete', conversation }"
        >
          <Trash2 class="size-3.5" />
        </Button>
      </div>
    </SettingsRow>

    <Dialog :open="Boolean(confirmation)" @update:open="open => { if (!open) confirmation = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ confirmation?.action === 'restore' ? '恢复聊天？' : '永久删除聊天？' }}</DialogTitle>
          <DialogDescription v-if="confirmation?.action === 'restore'">
            “{{ confirmation.conversation.title }}”将恢复到 Agent 会话列表，可以继续原有上下文。
          </DialogDescription>
          <DialogDescription v-else>
            “{{ confirmation?.conversation.title }}”的聊天记录将被永久删除，此操作无法撤销。项目文件不会被删除。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="confirmation = null">取消</Button>
          <Button :variant="confirmation?.action === 'delete' ? 'destructive' : 'default'" @click="confirmAction">
            {{ confirmation?.action === 'restore' ? '确认恢复' : '确认永久删除' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
