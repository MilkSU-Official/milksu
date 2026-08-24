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
  count: number
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  continue: []
  stop: []
}>()
</script>

<template>
  <Dialog :open="props.open" @update:open="value => emit('update:open', value)">
    <DialogContent class="sm:max-w-md">
      <DialogTitle>{{ t('继续调用工具？', 'Keep calling tools?') }}</DialogTitle>
      <DialogDescription>
        {{ t(`已经调用了 ${props.count} 次工具，要继续吗？`, `Tools have already been called ${props.count} times. Continue?`) }}
      </DialogDescription>
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" @click="emit('stop')">
          {{ t('停止', 'Stop') }}
        </Button>
        <Button type="button" variant="brand" @click="emit('continue')">
          {{ t('继续', 'Continue') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
