import { Badge, Button, SettingsRow, SettingsSection } from '@/components/ui'
import type { CodingMCPServerSummary } from '@/codingEnvironmentTypes'
import { useT } from '@/hooks/useUiLocale'

export default function CodingMCPReviewCard({
  server,
  selected,
  running,
  alwaysOn,
  onToggle,
}: {
  server: CodingMCPServerSummary
  selected: boolean
  running: boolean
  alwaysOn?: boolean
  onToggle?: () => void
}) {
  const t = useT()
  const userScoped = Boolean(alwaysOn || server.scope === 'user')

  return (
    <SettingsSection
      title={server.name}
      actions={
        userScoped ? (
          <Badge variant="outline">{t('用户', 'User')}</Badge>
        ) : (
          <Badge variant={server.reviewReady ? 'outline' : 'secondary'}>
            {server.reviewReady ? t('审阅信息完整', 'Review details complete') : t('不可启用', 'Cannot enable')}
          </Badge>
        )
      }
      footer={
        !alwaysOn ? (
          <Button
            type="button"
            variant={selected ? 'secondary' : 'outline'}
            size="sm"
            disabled={running || !server.reviewReady}
            aria-pressed={selected}
            onClick={() => onToggle?.()}
          >
            {selected ? t('从本任务移除', 'Remove from this task') : t('仅为本任务启用', 'Enable for this task only')}
          </Button>
        ) : (
          <p className="text-caption text-muted-foreground">
            {t('已在设置中启用', 'Enabled in Settings')}
          </p>
        )
      }
    >
      <SettingsRow label={t('传输', 'Transport')} description={server.transport} />
      {server.reviewProblem ? (
        <SettingsRow label={t('问题', 'Issue')} description={server.reviewProblem} />
      ) : null}
      <SettingsRow
        label={t('来源', 'Source')}
        description={userScoped ? t('设置', 'Settings') : (server.source || t('未声明', 'Not declared'))}
      />
      {!userScoped ? (
        <SettingsRow label={t('固定版本', 'Pinned version')} description={server.version || t('未声明', 'Not declared')} />
      ) : null}
      {!userScoped ? (
        <SettingsRow label={t('任务范围', 'Task scope')} description={server.taskScope || t('未声明', 'Not declared')} />
      ) : null}
      {!userScoped ? (
        <SettingsRow
          label={t('工具面', 'Tools')}
          description={server.tools.length ? server.tools.join(' · ') : t('未声明白名单', 'No allowlist declared')}
        />
      ) : null}
      <SettingsRow label={t('文件', 'Files')} description={server.fileAccess} />
      <SettingsRow label={t('网络', 'Network')} description={server.networkAccess} />
      <SettingsRow label={t('凭据', 'Credentials')} description={server.credentialAccess} divider={false} />
    </SettingsSection>
  )
}
