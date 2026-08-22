<script setup lang="ts">
import { Badge, Button } from '@felinic/ui'
import { ArrowLeft, ExternalLink } from 'lucide-vue-next'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'

defineProps<{
  challengeTitle?: string
  sourceUri?: string
}>()

defineEmits<{
  returnCatalog: []
  openSource: []
}>()
</script>

<template>
  <WorkspaceModuleTopBar module="ctf" subtitle="解题会话">
    <template #leading>
      <Button variant="ghost" size="icon-sm" aria-label="返回 CTF 题库" @click="$emit('returnCatalog')">
        <ArrowLeft class="size-4" />
      </Button>
    </template>
    <template #badge>
      <Badge v-if="challengeTitle" variant="secondary" class="max-w-[18rem] truncate">
        {{ challengeTitle }}
      </Badge>
    </template>
    <template #actions>
      <Button
        v-if="sourceUri"
        variant="outline"
        size="sm"
        aria-label="打开当前 CTF 题目"
        @click="$emit('openSource')"
      >
        <ExternalLink class="size-4" />
        打开题目
      </Button>
    </template>
  </WorkspaceModuleTopBar>
</template>
