<script setup lang="ts">
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@felinic/ui'

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
      <DialogTitle>继续调用工具？</DialogTitle>
      <DialogDescription>
        已经调用了 {{ props.count }} 次工具，要继续吗？
      </DialogDescription>
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" @click="emit('stop')">
          停止
        </Button>
        <Button type="button" variant="brand" @click="emit('continue')">
          继续
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
