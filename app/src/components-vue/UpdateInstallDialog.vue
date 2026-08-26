<script setup lang="ts">
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@felinic/ui'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  open: boolean
  version?: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  confirm: []
  later: []
}>()
</script>

<template>
  <Dialog :open="props.open" @update:open="value => emit('update:open', value)">
    <DialogContent class="sm:max-w-md">
      <DialogTitle>{{ t('安装更新并重启？', 'Install the update and restart?') }}</DialogTitle>
      <DialogDescription>
        {{ t(
          `MilkSU ${props.version || ''} 已经下载完成。现在安装会中断正在运行的任务并重启。`,
          `MilkSU ${props.version || ''} is ready. Installing now will stop running tasks and restart.`,
        ) }}
      </DialogDescription>
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" @click="emit('later')">
          {{ t('稍后', 'Later') }}
        </Button>
        <Button type="button" variant="brand" @click="emit('confirm')">
          {{ t('安装并重启', 'Install and restart') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
