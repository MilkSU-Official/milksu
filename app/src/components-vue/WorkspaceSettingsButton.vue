<script setup lang="ts">
import { Button } from '@felinic/ui'
import { Settings } from 'lucide-vue-next'

withDefaults(defineProps<{
  label?: string
  active?: boolean
}>(), {
  label: '打开设置',
  active: false,
})

defineEmits<{
  click: []
}>()
</script>

<template>
  <Button
    :variant="active ? 'outline' : 'ghost'"
    size="icon-sm"
    :aria-label="label"
    title="设置"
    @click="$emit('click')"
  >
    <Settings class="size-4" />
  </Button>
</template>
