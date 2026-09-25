import { useEffect, useState } from 'react'
import { Button, Input, SettingsGhostPicker, SettingsRow, SettingsSection, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { invokeCommand, listenEvent } from '@/desktop'
import SearchableModelPicker from '@/components/SearchableModelPicker'
import ModelVendorIcon from '@/components/ModelVendorIcon'
import ConversationSizeInput from '@/components/ConversationSizeInput'
import { encodePickerSelection, parsePickerSelection } from '@/modelCatalog'
import { toastError } from '@/lib/appToast'
import { filterCompanionMemories, sortCompanionMemoriesNewestFirst } from '@/lib/companionMemory'
import {
  applyConversationFontSize,
  normalizeUiFontSize,
} from '@/lib/uiFonts'
import { useT, useUiLocale } from '@/hooks/useUiLocale'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'
import {
  COMPANION_MEMORY_EXTRACT_IDLE_MINUTES,
  companionSettingsSource,
  normalizeCompanionMemoryExtract,
  normalizeCompanionMemoryExtractIdleMinutes,
  normalizeCompanionReplyStyle,
  type AppSettings,
  type CompanionApprovedMemory,
  type CompanionMemoryExtract,
  type CompanionMemorySnapshot,
  type CompanionShellStatus,
  type CompanionSkinImportResult,
  type CompanionSkinList,
  type CompanionSkinSummary,
  type CompanionTeaching,
} from '@/types'

function ReplyStyleThumb({ kind }: { kind: 'markdown' | 'chat' }) {
  if (kind === 'chat') {
    return (
      <span className="pointer-events-none flex h-16 w-[88px] flex-col justify-center gap-1 rounded-md bg-muted px-1.5" aria-hidden="true">
        <span className="h-2.5 w-10 rounded-md bg-foreground/25" />
        <span className="inline-flex h-2.5 w-8 items-center justify-center gap-0.5 rounded-md bg-foreground/20">
          <span className="size-1 rounded-full bg-foreground/70" />
          <span className="size-1 rounded-full bg-foreground/70" />
          <span className="size-1 rounded-full bg-foreground/70" />
        </span>
        <span className="h-2.5 w-12 rounded-md bg-foreground/25" />
      </span>
    )
  }
  return (
    <span className="pointer-events-none flex h-16 w-[88px] flex-col justify-center gap-1 rounded-md bg-muted px-1.5" aria-hidden="true">
      <span className="h-1 w-full rounded-sm bg-foreground/25" />
      <span className="h-1 w-full rounded-sm bg-foreground/20" />
      <span className="h-1 w-4/5 rounded-sm bg-foreground/20" />
      <span className="h-1 w-full rounded-sm bg-foreground/15" />
    </span>
  )
}

function skinLabel(skin: CompanionSkinSummary, locale: string) {
  return locale === 'en' ? skin.name.en : skin.name.zh
}

export default function CompanionSettingsPanel({
  settings,
  groups,
  onPersist,
  compact = false,
  presentation = 'page',
}: {
  settings: AppSettings | null
  groups: SearchableModelGroup[]
  onPersist: () => void
  /** Narrow phone chrome: stack label above control. Ignored when presentation is phone. */
  compact?: boolean
  /** Phone draws inset grouped rows; page keeps the desktop SettingsRow metrics. */
  presentation?: 'page' | 'phone'
}) {
  const rowStack = presentation === 'phone' ? 'never' as const : compact ? 'always' as const : 'never' as const
  const pickerAlign = presentation === 'phone' ? 'end' as const : compact ? 'start' as const : 'end' as const
  const pickerMenuClassName = presentation === 'phone' ? 'companion-settings-menu' : undefined
  const t = useT()
  const locale = useUiLocale()
  const [shell, setShell] = useState<CompanionShellStatus | null>(null)
  const [skins, setSkins] = useState<CompanionSkinSummary[]>([
    { id: 'default', source: 'factory', factory: true, name: { zh: 'Milk', en: 'Milk' } },
  ])
  const [busy, setBusy] = useState<'import' | 'remove' | null>(null)
  const [memories, setMemories] = useState<CompanionApprovedMemory[]>([])
  const [memoryQuery, setMemoryQuery] = useState('')
  const [forgetting, setForgetting] = useState('')

  useEffect(() => {
    let stop = false
    const loadMemories = () => {
      void invokeCommand<CompanionMemorySnapshot>('get_companion_memory')
        .then(value => {
          if (stop) return
          const rows = Array.isArray(value?.approved) ? value.approved : []
          setMemories(sortCompanionMemoriesNewestFirst(rows))
        })
        .catch(() => undefined)
    }
    loadMemories()
    let unlisten: (() => void) | undefined
    void listenEvent<{ type?: string }>('companion-event', event => {
      if (event.payload?.type === 'companion.memory') loadMemories()
    }).then(dispose => {
      if (stop) dispose()
      else unlisten = dispose
    })
    return () => {
      stop = true
      unlisten?.()
    }
  }, [])

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
    companionSettingsSource(settings.companion_source),
  )
  const modelLabel = settings.companion_model || t('选择模型', 'Choose a model')
  const selectedSkin = skins.some(item => item.id === settings.companion_skin_id)
    ? (settings.companion_skin_id ?? 'default')
    : 'default'
  const selected = skins.find(item => item.id === selectedSkin)
  const memoryExtract = normalizeCompanionMemoryExtract(settings.companion_memory_extract)
  const memoryIdleMinutes = normalizeCompanionMemoryExtractIdleMinutes(
    settings.companion_memory_extract_idle_minutes,
  )
  const visibleMemories = filterCompanionMemories(memories, memoryQuery)

  function patch(next: Partial<AppSettings>) {
    Object.assign(settings!, next)
    onPersist()
  }

  function applySkin(id: string) {
    patch({ companion_skin_id: id })
    void invokeCommand('notify_companion_skin_changed', { id }).catch(() => undefined)
  }

  async function forgetMemory(id: string) {
    setForgetting(id)
    try {
      await invokeCommand('forget_companion_memory', { id })
      setMemories(current => current.filter(item => item.id !== id))
    } catch (reason) {
      toastError(reason, t('没能忘掉这条记忆', 'Could not forget this memory'))
    } finally {
      setForgetting('')
    }
  }

  async function importSkin() {
    setBusy('import')
    try {
      const result = await invokeCommand<CompanionSkinImportResult>('import_companion_skin', { locale })
      if (result?.canceled) return
      if (Array.isArray(result?.skins) && result.skins.length) setSkins(result.skins)
      if (result?.imported?.id) applySkin(result.imported.id)
    } catch (reason) {
      toastError(reason, t('这不是有效的看板娘皮肤', 'This is not a valid companion skin'))
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
          label={t('看板娘模型', 'Companion model')}
          stack={rowStack}
          trailing={(
            <SearchableModelPicker
              value={modelKey}
              triggerClassName="settings-control h-7 px-2"
              ariaLabel={t('看板娘模型', 'Companion model')}
              contentClassName={pickerMenuClassName}
              align={pickerAlign}
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
                  companion_source: companionSettingsSource(selection.source),
                })
              }}
            />
          )}
        />
        <SettingsRow
          label={t('跨会话调度', 'Dispatch')}
          stack={rowStack}
          trailing={(
            <Switch
              checked={settings.companion_dispatch_enabled !== false}
              onCheckedChange={checked => patch({ companion_dispatch_enabled: checked })}
              aria-label={t('跨会话调度', 'Dispatch')}
            />
          )}
        />
      </SettingsSection>
      <SettingsSection title={t('回复', 'Replies')}>
        <SettingsRow
          label={t('回复样式', 'Reply style')}
          stack="always"
          divider={false}
        >
          <div role="radiogroup" aria-label={t('回复样式', 'Reply style')} className="mt-2 flex gap-3">
            {([
              ['markdown', t('Markdown', 'Markdown')],
              ['chat', t('对话', 'Chat')],
            ] as const).map(([value, label]) => {
              const selected = normalizeCompanionReplyStyle(settings.companion_reply_style) === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    'shrink-0 rounded-md border-2 border-transparent p-1 text-left outline-none',
                    'transition-[border-color,transform] duration-[120ms] ease-[var(--ease-out)] active:scale-[0.97]',
                    'focus-visible:border-emphasis',
                    selected && 'border-emphasis',
                  )}
                  onClick={() => patch({ companion_reply_style: value })}
                >
                  <ReplyStyleThumb kind={value} />
                  <span className="mt-1 block text-center text-[length:var(--text-caption)] leading-[var(--text-caption--line-height)] text-muted-foreground">
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t('主动性', 'Proactivity')}>
        <SettingsRow
          label={t('任务事件', 'Task events')}
          stack={rowStack}
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
          stack={rowStack}
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
          stack={rowStack}
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
          stack={rowStack}
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
          stack={rowStack}
          divider={false}
          trailing={(
            <SettingsGhostPicker
              value={settings.companion_teaching ?? 'ask_me'}
              ariaLabel={t('教学形态', 'Teaching style')}
              menuClassName={pickerMenuClassName}
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
      <SettingsSection title={t('记忆', 'Memory')}>
        <SettingsRow
          label={t('提取', 'Extract')}
          stack={rowStack}
          divider={memoryExtract === 'idle' || memories.length > 0}
          trailing={(
            <SettingsGhostPicker
              value={memoryExtract}
              ariaLabel={t('提取', 'Extract')}
              menuClassName={pickerMenuClassName}
              options={[
                { value: 'off', label: t('关闭', 'Off') },
                { value: 'turn', label: t('每轮结束', 'Each turn') },
                { value: 'idle', label: t('闲置后', 'After idle') },
              ]}
              onChange={value => patch({ companion_memory_extract: value as CompanionMemoryExtract })}
            />
          )}
        />
        {memoryExtract === 'idle' ? (
          <SettingsRow
            label={t('闲置', 'Idle')}
            stack={rowStack}
            divider={memories.length > 0}
            trailing={(
              <SettingsGhostPicker
                value={String(memoryIdleMinutes)}
                ariaLabel={t('闲置', 'Idle')}
                menuClassName={pickerMenuClassName}
                options={COMPANION_MEMORY_EXTRACT_IDLE_MINUTES.map(minutes => ({
                  value: String(minutes),
                  label: t(`${minutes} 分钟`, `${minutes} min`),
                }))}
                onChange={value => patch({
                  companion_memory_extract_idle_minutes: normalizeCompanionMemoryExtractIdleMinutes(value),
                })}
              />
            )}
          />
        ) : null}
        {memories.length > 0 ? (
          <SettingsRow
            label={t('检索', 'Search')}
            stack={rowStack}
            divider={visibleMemories.length > 0}
            trailing={(
              <Input
                value={memoryQuery}
                aria-label={t('检索', 'Search')}
                className="h-7 w-36 px-2 text-[13px]"
                onChange={event => setMemoryQuery(event.target.value)}
              />
            )}
          />
        ) : null}
        {visibleMemories.map((item, index) => (
          <SettingsRow
            key={item.id}
            align="start"
            stack={rowStack}
            divider={index < visibleMemories.length - 1}
            trailing={(
              <Button
                variant="outline"
                size="sm"
                disabled={forgetting === item.id}
                onClick={() => void forgetMemory(item.id)}
              >
                {t('忘掉', 'Forget')}
              </Button>
            )}
          >
            <p className="min-w-0 break-words text-[length:var(--text-label)] leading-[var(--text-label--line-height)]">
              {item.markdown || item.title}
            </p>
            {item.evidence ? (
              <p className="mt-0.5 min-w-0 break-words text-[length:var(--text-caption)] leading-[var(--text-caption--line-height)] text-muted-foreground">
                {item.evidence}
              </p>
            ) : null}
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title={t('隐私', 'Privacy')}>
        <SettingsRow
          label={t('情景检索', 'Episodic search')}
          stack={rowStack}
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
          label={t('对话字号', 'Conversation size')}
          stack={rowStack}
          trailing={(
            <ConversationSizeInput
              value={normalizeUiFontSize(settings.conversation_font_size)}
              ariaLabel={t('对话字号', 'Conversation size')}
              onCommit={size => {
                patch({ conversation_font_size: size })
                applyConversationFontSize(size)
              }}
            />
          )}
        />
        <SettingsRow
          label={t('悬浮窗', 'Floating window')}
          description={shell?.wayland
            ? t('当前会话是 Wayland，不能贴悬浮窗。', 'This session is Wayland, so the float cannot be placed.')
            : undefined}
          stack={rowStack}
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
          stack={rowStack}
          trailing={(
            <SettingsGhostPicker
              value={selectedSkin}
              ariaLabel={t('皮肤', 'Skin')}
              menuClassName={pickerMenuClassName}
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
          stack={rowStack}
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
            stack={rowStack}
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
