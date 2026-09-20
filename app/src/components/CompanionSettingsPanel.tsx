import { useEffect, useState } from 'react'
import { SettingsGhostPicker, SettingsRow, SettingsSection, Switch } from '@/components/ui'
import { invokeCommand } from '@/desktop'
import SearchableModelPicker from '@/components/SearchableModelPicker'
import ModelVendorIcon from '@/components/ModelVendorIcon'
import { encodePickerSelection, parsePickerSelection } from '@/modelCatalog'
import { useT } from '@/hooks/useUiLocale'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'
import type { AppSettings, CompanionShellStatus, CompanionTeaching } from '@/types'

export default function CompanionSettingsPanel({
  settings,
  groups,
  onPersist,
}: {
  settings: AppSettings | null
  groups: SearchableModelGroup[]
  onPersist: () => void
}) {
  const t = useT()
  const [shell, setShell] = useState<CompanionShellStatus | null>(null)
  useEffect(() => {
    void invokeCommand<CompanionShellStatus>('get_companion_shell_status')
      .then(value => setShell(value))
      .catch(() => undefined)
  }, [])
  if (!settings) return null
  const modelKey = encodePickerSelection(
    settings.companion_provider ?? '',
    settings.companion_model ?? '',
    settings.companion_source || 'personal',
  )
  const modelLabel = settings.companion_model || t('选择模型', 'Choose a model')

  function patch(next: Partial<AppSettings>) {
    Object.assign(settings!, next)
    onPersist()
  }

  return (
    <>
      <SettingsSection title={t('模型', 'Model')}>
        <SettingsRow
          label={t('桌宠模型', 'Companion model')}
          trailing={(
            <SearchableModelPicker
              value={modelKey}
              triggerClassName="settings-control h-7 px-2"
              ariaLabel={t('桌宠模型', 'Companion model')}
              align="end"
              trigger={(
                <span className="inline-flex min-w-0 items-center gap-2">
                  <ModelVendorIcon model={settings.companion_model ?? ''} label={modelLabel} />
                  <span className="min-w-0 truncate">{modelLabel}</span>
                </span>
              )}
              groups={groups}
              onChange={value => {
                const selection = parsePickerSelection(value)
                if (!selection) return
                patch({
                  companion_provider: selection.providerId,
                  companion_model: selection.model,
                  companion_source: selection.source,
                })
              }}
            />
          )}
        />
        <SettingsRow
          label={t('跨会话调度', 'Dispatch')}
          trailing={(
            <Switch
              checked={settings.companion_dispatch_enabled !== false}
              onCheckedChange={checked => patch({ companion_dispatch_enabled: checked })}
              aria-label={t('跨会话调度', 'Dispatch')}
            />
          )}
        />
      </SettingsSection>
      <SettingsSection title={t('主动性', 'Proactivity')}>
        <SettingsRow
          label={t('任务事件', 'Task events')}
          trailing={(
            <Switch
              checked={settings.companion_proactivity?.task_events !== false}
              onCheckedChange={checked => patch({
                companion_proactivity: { ...settings.companion_proactivity, task_events: checked },
              })}
              aria-label={t('任务事件', 'Task events')}
            />
          )}
        />
        <SettingsRow
          label={t('教学提示', 'Teaching hints')}
          trailing={(
            <Switch
              checked={settings.companion_proactivity?.teaching_hints === true}
              onCheckedChange={checked => patch({
                companion_proactivity: { ...settings.companion_proactivity, teaching_hints: checked },
              })}
              aria-label={t('教学提示', 'Teaching hints')}
            />
          )}
        />
        <SettingsRow
          label={t('定时播报', 'Scheduled broadcast')}
          trailing={(
            <Switch
              checked={settings.companion_proactivity?.scheduled_broadcast === true}
              onCheckedChange={checked => patch({
                companion_proactivity: { ...settings.companion_proactivity, scheduled_broadcast: checked },
              })}
              aria-label={t('定时播报', 'Scheduled broadcast')}
            />
          )}
        />
        <SettingsRow
          label={t('闲聊', 'Idle chat')}
          divider={false}
          trailing={(
            <Switch
              checked={settings.companion_proactivity?.idle_chat === true}
              onCheckedChange={checked => patch({
                companion_proactivity: { ...settings.companion_proactivity, idle_chat: checked },
              })}
              aria-label={t('闲聊', 'Idle chat')}
            />
          )}
        />
      </SettingsSection>
      <SettingsSection title={t('教学', 'Teaching')}>
        <SettingsRow
          label={t('教学形态', 'Teaching style')}
          divider={false}
          trailing={(
            <SettingsGhostPicker
              value={settings.companion_teaching ?? 'ask_me'}
              ariaLabel={t('教学形态', 'Teaching style')}
              options={[
                { value: 'ask_me', label: t('先问我', 'Ask me') },
                { value: 'hints', label: t('提示', 'Hints') },
                { value: 'review', label: t('复盘', 'Review') },
              ]}
              onChange={value => patch({ companion_teaching: value as CompanionTeaching })}
            />
          )}
        />
      </SettingsSection>
      <SettingsSection title={t('隐私', 'Privacy')}>
        <SettingsRow
          label={t('情景检索', 'Episodic search')}
          divider={false}
          trailing={(
            <Switch
              checked={settings.companion_memory_enabled !== false}
              onCheckedChange={checked => patch({ companion_memory_enabled: checked })}
              aria-label={t('情景检索', 'Episodic search')}
            />
          )}
        />
      </SettingsSection>
      <SettingsSection title={t('外观', 'Appearance')}>
        <SettingsRow
          label={t('悬浮窗', 'Floating window')}
          description={shell?.wayland
            ? t('当前 Linux 会话是 Wayland，客户端不能自己设定窗口全局坐标，所以只保留主窗口里的桌宠页。', 'This Linux session is Wayland. Clients cannot set global window coordinates, so Companion stays in the main window.')
            : t('关掉主窗口后，macOS Dock 和 Windows 任务栏仍显示 MilkSU，用来唤醒桌宠。Linux 用托盘。', 'After the main window is hidden, macOS Dock and Windows taskbar still show MilkSU so you can wake the companion. Linux uses the tray.')}
          trailing={(
            <Switch
              checked={settings.companion_float_enabled !== false && !shell?.wayland}
              disabled={shell?.wayland === true}
              onCheckedChange={checked => {
                patch({ companion_float_enabled: checked })
                void invokeCommand<CompanionShellStatus>('set_companion_float_enabled', { enabled: checked })
                  .then(value => setShell(value))
                  .catch(() => undefined)
              }}
              aria-label={t('悬浮窗', 'Floating window')}
            />
          )}
        />
        <SettingsRow
          label={t('皮肤', 'Skin')}
          divider={false}
          trailing={<span className="text-label text-muted-foreground">{t('默认', 'Default')}</span>}
        />
      </SettingsSection>
    </>
  )
}
