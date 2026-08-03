<script setup lang="ts">
import { Badge, Button } from '@felinic/ui'
import { Archive, ArrowLeft, ExternalLink, Play, ShieldCheck } from 'lucide-vue-next'
import WorkspaceTopBar from '@/components-vue/WorkspaceTopBar.vue'

defineProps<{
  challengeTitle?: string
  sourceUri?: string
  mode?: 'solve' | 'review'
  hasReviewActivity?: boolean
}>()

defineEmits<{
  returnCatalog: []
  openSource: []
  openSettings: []
  switchMode: [mode: 'solve' | 'review']
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
        v-if="hasReviewActivity"
        variant="outline"
        size="sm"
        :aria-label="mode === 'review' ? '返回 CTF 解题模式' : '查看 CTF 复盘模式'"
        @click="$emit('switchMode', mode === 'review' ? 'solve' : 'review')"
      >
        <Play v-if="mode === 'review'" class="size-4" />
        <Archive v-else class="size-4" />
        {{ mode === 'review' ? '返回解题' : '查看复盘' }}
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
