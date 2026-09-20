import { useEffect, useState } from 'react'
import { Button, SettingsGhostPicker, SettingsRow, SettingsSection, Switch } from '@/components/ui'
import { invokeCommand } from '@/desktop'
import SearchableModelPicker from '@/components/SearchableModelPicker'
import ModelVendorIcon from '@/components/ModelVendorIcon'
import { encodePickerSelection, parsePickerSelection } from '@/modelCatalog'
import { toastError } from '@/lib/appToast'
import { useT, useUiLocale } from '@/hooks/useUiLocale'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'
import type {
  AppSettings,
  CompanionShellStatus,
  CompanionSkinImportResult,
  CompanionSkinList,
  CompanionSkinSummary,
  CompanionTeaching,
} from '@/types'

function skinLabel(skin: CompanionSkinSummary, locale: string) {
  return locale === 'en' ? skin.name.en : skin.name.zh
}

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
  const locale = useUiLocale()
  const [shell, setShell] = useState<CompanionShellStatus | null>(null)
  const [skins, setSkins] = useState<CompanionSkinSummary[]>([
    { id: 'default', source: 'factory', factory: true, name: { zh: 'Milk', en: 'Milk' } },
  ])
  const [busy, setBusy] = useState<'import' | 'remove' | null>(null)

  useEffect(() => {
    void invokeCommand<CompanionShellStatus>('get_companion_shell_status')
      .then(value => setShell(value))
      .catch(() => undefined)
    void invokeCommand<CompanionSkinList>('list_companion_skins')
      .then(value => {
        if (Array.isArray(value?.skins) && value.skins.length) setSkins(value.skins)
      })
      .catch(() => undefined)
  }, [])

  if (!settings) return null
  const modelKey = encodePickerSelection(
    settings.companion_provider ?? '',
    settings.companion_model ?? '',
    settings.companion_source || 'personal',
  )
  const modelLabel = settings.companion_model || t('选择模型', 'Choose a model')
  const selectedSkin = skins.some(item => item.id === settings.companion_skin_id)
    ? (settings.companion_skin_id ?? 'default')
    : 'default'
  const selected = skins.find(item => item.id === selectedSkin)

  function patch(next: Partial<AppSettings>) {
    Object.assign(settings!, next)
    onPersist()
  }

  function applySkin(id: string) {
    patch({ companion_skin_id: id })
    void invokeCommand('notify_companion_skin_changed', { id }).catch(() => undefined)
  }

  async function importSkin() {
    setBusy('import')
    try {
      const result = await invokeCommand<CompanionSkinImportResult>('import_companion_skin', { locale })
      if (result?.canceled) return
      if (Array.isArray(result?.skins) && result.skins.length) setSkins(result.skins)
      if (result?.imported?.id) applySkin(result.imported.id)
    } catch (reason) {
      toastError(reason, t('这不是有效的桌宠皮肤', 'This is not a valid companion skin'))
    } finally {
      setBusy(null)
    }
  }

  async function removeSkin() {
    if (!selected?.removable) return
    setBusy('remove')
    try {
      const result = await invokeCommand<CompanionSkinList>('remove_companion_skin', { id: selected.id })
      if (Array.isArray(result?.skins) && result.skins.length) setSkins(result.skins)
      applySkin('default')
    } catch (reason) {
      toastError(reason, t('没能移除这套皮肤', 'Could not remove this skin'))
    } finally {
      setBusy(null)
    }
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
            ? t('当前会话是 Wayland，不能贴悬浮窗。', 'This session is Wayland, so the float cannot be placed.')
            : undefined}
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
          trailing={(
            <SettingsGhostPicker
              value={selectedSkin}
              ariaLabel={t('皮肤', 'Skin')}
              options={skins.map(item => ({
                value: item.id,
                label: skinLabel(item, locale),
              }))}
              onChange={value => applySkin(value)}
            />
          )}
        />
        <SettingsRow
          label={t('添加皮肤', 'Add skin')}
          divider={!selected?.removable}
          trailing={(
            <Button
              variant="outline"
              size="sm"
              disabled={busy === 'import'}
              onClick={() => void importSkin()}
            >
              {t('选择文件夹', 'Choose folder')}
            </Button>
          )}
        />
        {selected?.removable ? (
          <SettingsRow
            label={t('移除皮肤', 'Remove skin')}
            divider={false}
            trailing={(
              <Button
                variant="outline"
                size="sm"
                disabled={busy === 'remove'}
                onClick={() => void removeSkin()}
              >
                {t('移除', 'Remove')}
              </Button>
            )}
          />
        ) : null}
      </SettingsSection>
    </>
  )
}
