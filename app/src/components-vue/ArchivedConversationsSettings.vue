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
  return value ? new Date(value).toLocaleString() : '归档时间未知'
}

onMounted(load)
</script>

<template>
  <div class="space-y-3">
    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">正在读取归档聊天…</p>
    <p v-else-if="!conversations.length" class="text-sm text-muted-foreground">暂无归档聊天。</p>
    <div
      v-for="conversation in conversations"
      :key="conversation.id"
      class="flex items-center gap-4 border-b border-border py-3 last:border-b-0"
    >
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{{ conversation.title }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ archivedTime(conversation.archivedAt) }}</p>
      </div>
      <Button variant="outline" size="sm" @click="confirmation = { action: 'restore', conversation }">
        <ArchiveRestore class="size-4" />
        恢复
      </Button>
      <Button variant="destructive" size="sm" @click="confirmation = { action: 'delete', conversation }">
        <Trash2 class="size-4" />
        删除
      </Button>
    </div>

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
