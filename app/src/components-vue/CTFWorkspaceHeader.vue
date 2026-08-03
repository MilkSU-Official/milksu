<script setup lang="ts">
import { Badge, Button } from '@felinic/ui'
import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-vue-next'
import WorkspaceTopBar from '@/components-vue/WorkspaceTopBar.vue'

defineProps<{
  challengeTitle?: string
  sourceUri?: string
}>()

defineEmits<{
  returnCatalog: []
  openSource: []
  openSettings: []
}>()
</script>

<template>
  <WorkspaceTopBar title="CTF" subtitle="解题会话">
    <template #badge>
      <Badge v-if="challengeTitle" variant="secondary" class="max-w-[18rem] truncate">
        {{ challengeTitle }}
      </Badge>
    </template>
    <template #actions>
      <Button variant="ghost" size="sm" aria-label="返回 CTF 题库" @click="$emit('returnCatalog')">
        <ArrowLeft class="size-4" />
        返回题库
      </Button>
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
      <Button variant="ghost" size="sm" aria-label="打开 CTF 授权与模型设置" @click="$emit('openSettings')">
        <ShieldCheck class="size-4" />
        授权与模型
      </Button>
    </template>
  </WorkspaceTopBar>
</template>
