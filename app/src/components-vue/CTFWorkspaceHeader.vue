<script setup lang="ts">
import { Badge, Button } from '@felinic/ui'
import { ArrowLeft, Cable } from 'lucide-vue-next'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import { t } from '@/lib/uiLocale'

defineProps<{
  challengeTitle?: string
  browserStatus?: 'off' | 'live' | ''
}>()

defineEmits<{
  returnCatalog: []
  openBrowserSettings: []
  refreshBridge: []
}>()
</script>

<template>
  <WorkspaceModuleTopBar module="ctf" :subtitle="t('解题会话', 'Solving session')">
    <template #leading>
      <Button variant="ghost" size="icon-sm" :aria-label="t('返回 CTF 题库', 'Back to CTF catalog')" @click="$emit('returnCatalog')">
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
        v-if="browserStatus"
        variant="ghost"
        size="icon-sm"
        :aria-label="browserStatus === 'live' ? t('浏览器已连接', 'Browser connected') : t('浏览器未连接，打开设置', 'Browser disconnected, open settings')"
        :title="browserStatus === 'live' ? t('浏览器已连接', 'Browser connected') : t('浏览器未连接', 'Browser disconnected')"
        @click="browserStatus === 'live' ? $emit('refreshBridge') : $emit('openBrowserSettings')"
      >
        <Cable class="size-4" :class="browserStatus === 'live' ? 'text-foreground' : 'text-muted-foreground'" />
        <span
          class="ak-status ak-status--compact sr-only"
          :class="browserStatus === 'live' ? '' : 'ak-status--offline'"
        >
          {{ browserStatus === 'live' ? 'LIVE' : 'OFF' }}
        </span>
      </Button>
    </template>
  </WorkspaceModuleTopBar>
</template>
