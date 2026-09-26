import { useEffect, useState } from 'react'
import { Button, Input, SettingsGhostPicker, SettingsRow, SettingsSection, Switch } from '@/components/ui'
import { invokeCommand, listenEvent } from '@/desktop'
import { toastError } from '@/lib/appToast'
import { filterCompanionMemories, sortCompanionMemoriesNewestFirst } from '@/lib/companionMemory'
import { useT } from '@/hooks/useUiLocale'
import {
  COMPANION_MEMORY_EXTRACT_IDLE_MINUTES,
  normalizeCompanionMemoryExtract,
  normalizeCompanionMemoryExtractIdleMinutes,
  type AppSettings,
  type CompanionApprovedMemory,
  type CompanionMemoryExtract,
  type CompanionMemorySnapshot,
  type CTFMemoryOverview,
  type SessionIndexStatusPayload,
} from '@/types'

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

/**
 * 记忆体系的总览与配置：全应用一份的长期记忆、Obelisk 会话索引、
 * CTF 每题记忆。题目级结论留在 CTF 工作区，不进长期记忆。
 */
export default function MemorySettingsPanel({
  settings,
  onPersist,
}: {
  settings: AppSettings | null
  onPersist: () => void
}) {
  const t = useT()
  const [memories, setMemories] = useState<CompanionApprovedMemory[]>([])
  const [memoryQuery, setMemoryQuery] = useState('')
  const [forgetting, setForgetting] = useState('')
  const [indexStatus, setIndexStatus] = useState<SessionIndexStatusPayload | null>(null)
  const [indexRefreshing, setIndexRefreshing] = useState(false)
  const [ctfOverview, setCtfOverview] = useState<CTFMemoryOverview | null>(null)

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
    const loadIndex = () => {
      void invokeCommand<SessionIndexStatusPayload>('get_session_index_status')
        .then(value => {
          if (!stop) setIndexStatus(value)
        })
        .catch(() => undefined)
    }
    const loadCtf = () => {
      void invokeCommand<CTFMemoryOverview>('get_ctf_memory_overview')
        .then(value => {
          if (!stop) setCtfOverview(value)
        })
        .catch(() => undefined)
    }
    loadMemories()
    loadIndex()
    loadCtf()
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

  if (!settings) return null

  const memoryExtract = normalizeCompanionMemoryExtract(settings.companion_memory_extract)
  const memoryIdleMinutes = normalizeCompanionMemoryExtractIdleMinutes(
    settings.companion_memory_extract_idle_minutes,
  )
  const visibleMemories = filterCompanionMemories(memories, memoryQuery)

  function patch(next: Partial<AppSettings>) {
    Object.assign(settings!, next)
    onPersist()
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

  async function refreshIndex() {
    setIndexRefreshing(true)
    try {
      await invokeCommand('refresh_session_index')
      const value = await invokeCommand<SessionIndexStatusPayload>('get_session_index_status')
      setIndexStatus(value)
    } catch (reason) {
      toastError(reason, t('没能重建会话索引', 'Could not rebuild the session index'))
    } finally {
      setIndexRefreshing(false)
    }
  }

  const indexSummary = indexStatus
    ? [
        indexStatus.indexPath,
        indexStatus.bytes ? formatBytes(indexStatus.bytes) : '',
        typeof indexStatus.sessionCount === 'number'
          ? t(`${indexStatus.sessionCount} 个会话 · ${indexStatus.messageCount ?? 0} 条消息`, `${indexStatus.sessionCount} sessions · ${indexStatus.messageCount ?? 0} messages`)
          : '',
        indexStatus.reason,
      ].filter(Boolean).join(' · ')
    : ''
  const ctfSummary = ctfOverview
    ? [
        ctfOverview.path,
        ctfOverview.bytes ? formatBytes(ctfOverview.bytes) : '',
        typeof ctfOverview.activeCount === 'number'
          ? t(`${ctfOverview.activeCount} 条在记 · ${ctfOverview.archivedCount ?? 0} 条已归档`, `${ctfOverview.activeCount} active · ${ctfOverview.archivedCount ?? 0} archived`)
          : '',
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <>
      <SettingsSection title={t('长期记忆', 'Long-term memory')}>
        <SettingsRow
          label={t('记忆检索', 'Memory retrieval')}
          description={t('看板娘和 Agent 新会话可以检索这份只记你这个人的记忆。', 'The companion and new agent conversations can search this person-level memory.')}
          trailing={(
            <Switch
              checked={settings.companion_memory_enabled !== false}
              onCheckedChange={checked => patch({ companion_memory_enabled: checked })}
              aria-label={t('记忆检索', 'Memory retrieval')}
            />
          )}
        />
        <SettingsRow
          label={t('提取', 'Extract')}
          divider={memoryExtract === 'idle' || memories.length > 0}
          trailing={(
            <SettingsGhostPicker
              value={memoryExtract}
              ariaLabel={t('提取', 'Extract')}
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
            divider={memories.length > 0}
            trailing={(
              <SettingsGhostPicker
                value={String(memoryIdleMinutes)}
                ariaLabel={t('闲置', 'Idle')}
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
      <SettingsSection title={t('会话索引', 'Session index')}>
        <SettingsRow
          label={t('Obelisk', 'Obelisk')}
          description={t('只存其他会话的原文，供看板娘按当前这句话检索。', 'Stores raw text from other sessions so the companion can search it against the current message.')}
          trailing={(
            <Button variant="outline" size="sm" disabled={indexRefreshing} onClick={() => void refreshIndex()}>
              {t('重建索引', 'Rebuild index')}
            </Button>
          )}
        />
        {indexSummary ? (
          <SettingsRow
            label={t('数据', 'Data')}
            description={indexSummary}
            divider={false}
          />
        ) : null}
      </SettingsSection>
      <SettingsSection title={t('CTF 记忆', 'CTF memory')}>
        <SettingsRow
          label={t('数据', 'Data')}
          description={ctfSummary || t('每道题的解题结论留在 CTF 工作区。', 'Per-challenge conclusions stay in the CTF workspace.')}
          divider={false}
        />
      </SettingsSection>
    </>
  )
}
