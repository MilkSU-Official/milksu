<script setup lang="ts">
import { computed } from 'vue'
import { Badge, Button, SettingsRow, SettingsSection } from '@felinic/ui'
import type { CodingMCPServerSummary } from '@/codingEnvironmentTypes'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  server: CodingMCPServerSummary
  selected: boolean
  running: boolean
  alwaysOn?: boolean
}>()

defineEmits<{
  toggle: []
}>()

const userScoped = computed(() => props.alwaysOn || props.server.scope === 'user')
</script>

<template>
  <SettingsSection :title="server.name">
    <template #actions>
      <Badge v-if="userScoped" variant="outline">
        {{ t('用户', 'User') }}
      </Badge>
      <Badge v-else :variant="server.reviewReady ? 'outline' : 'secondary'">
        {{ server.reviewReady ? t('审阅信息完整', 'Review details complete') : t('不可启用', 'Cannot enable') }}
      </Badge>
    </template>
    <SettingsRow :label="t('传输', 'Transport')" :description="server.transport" />
    <SettingsRow v-if="server.reviewProblem" :label="t('问题', 'Issue')" :description="server.reviewProblem" />
    <SettingsRow
      :label="t('来源', 'Source')"
      :description="userScoped ? t('设置', 'Settings') : (server.source || t('未声明', 'Not declared'))"
    />
    <SettingsRow v-if="!userScoped" :label="t('固定版本', 'Pinned version')" :description="server.version || t('未声明', 'Not declared')" />
    <SettingsRow v-if="!userScoped" :label="t('任务范围', 'Task scope')" :description="server.taskScope || t('未声明', 'Not declared')" />
    <SettingsRow
      v-if="!userScoped"
      :label="t('工具面', 'Tools')"
      :description="server.tools.length ? server.tools.join(' · ') : t('未声明白名单', 'No allowlist declared')"
    />
    <SettingsRow :label="t('文件', 'Files')" :description="server.fileAccess" />
    <SettingsRow :label="t('网络', 'Network')" :description="server.networkAccess" />
    <SettingsRow :label="t('凭据', 'Credentials')" :description="server.credentialAccess" :divider="false" />
    <template #footer>
      <Button
        v-if="!alwaysOn"
        type="button"
        :variant="selected ? 'secondary' : 'outline'"
        size="sm"
        :disabled="running || !server.reviewReady"
        :aria-pressed="selected"
        @click="$emit('toggle')"
      >
        {{ selected ? t('从本任务移除', 'Remove from this task') : t('仅为本任务启用', 'Enable for this task only') }}
      </Button>
      <p v-else class="text-caption text-muted-foreground">
        {{ t('已在设置中启用', 'Enabled in Settings') }}
      </p>
    </template>
  </SettingsSection>
</template>
