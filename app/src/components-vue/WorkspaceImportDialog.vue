<script setup lang="ts">
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@felinic/ui'
import { t } from '@/lib/uiLocale'

withDefaults(defineProps<{
  open: boolean
  title?: string
  description?: string
}>(), {
  title: '',
  description: '',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogPanel width="2xl" class="workspace-import-dialog" data-testid="workspace-import-dialog">
      <DialogHeader>
        <DialogTitle>{{ title || t('导入', 'Import') }}</DialogTitle>
        <DialogDescription :class="description ? '' : 'sr-only'">
          {{ description || t('同步公开来源，或导入本机材料。', 'Sync a public source, or import local materials.') }}
        </DialogDescription>
      </DialogHeader>
      <DialogBody class="space-y-6">
        <slot />
      </DialogBody>
    </DialogPanel>
  </Dialog>
</template>
