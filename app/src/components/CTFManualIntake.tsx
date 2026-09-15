import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'
import { Alert, AlertDescription, Button, Input, NativeSelect, NativeSelectOption, Textarea } from '@/components/ui'
import { LoaderCircle, Paperclip } from 'lucide-react'
import { invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import type {
  CTFChallengeRequest,
  CTFCollaborationMode,
  CTFMaterialRequest,
} from '@/ctfTypes'

type ManualSourceKind = 'text' | 'url' | 'socket' | 'ssh'

export type CTFManualIntakeHandle = {
  reset: () => void
}

const CTFManualIntake = forwardRef<CTFManualIntakeHandle, {
  loading?: boolean
  error?: string
  onSubmit?: (request: CTFChallengeRequest) => void
  onCancel?: () => void
}>(function CTFManualIntake({
  loading = false,
  error = '',
  onSubmit,
  onCancel,
}, ref) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [statement, setStatement] = useState('')
  const [category, setCategory] = useState('misc')
  const [sourceKind, setSourceKind] = useState<ManualSourceKind>('text')
  const [sourceValue, setSourceValue] = useState('')
  const [knowledge, setKnowledge] = useState('')
  const [collaborationMode, setCollaborationMode] = useState<CTFCollaborationMode>('copilot')
  const [materials, setMaterials] = useState<CTFMaterialRequest[]>([])
  const [materialError, setMaterialError] = useState('')
  const [choosingMaterials, setChoosingMaterials] = useState(false)

  const modeItems = useMemo(() => [
    { value: 'coach' as const, label: t('教练', 'Coach') },
    { value: 'copilot' as const, label: t('搭档', 'Copilot') },
    { value: 'delegate' as const, label: t('代理', 'Delegate') },
  ], [t])

  const sourceLabel = sourceKind === 'url'
    ? t('题目或靶机 URL', 'Challenge or target URL')
    : sourceKind === 'socket'
      ? t('TCP 地址', 'TCP address')
      : sourceKind === 'ssh'
        ? t('SSH 地址', 'SSH address')
        : ''

  const sourcePlaceholder = sourceKind === 'url'
    ? 'https://ctf.example/challenges/123'
    : sourceKind === 'socket'
      ? 'challenge.example:31337'
      : sourceKind === 'ssh'
        ? 'ssh://player@challenge.example:2222'
        : ''

  const canSubmit = title.trim().length > 0
    && statement.trim().length > 0
    && (sourceKind === 'text' || sourceValue.trim().length > 0)

  function reset() {
    setTitle('')
    setStatement('')
    setCategory('misc')
    setSourceKind('text')
    setSourceValue('')
    setKnowledge('')
    setCollaborationMode('copilot')
    setMaterials([])
    setMaterialError('')
  }

  useImperativeHandle(ref, () => ({ reset }), [])

  async function chooseMaterials() {
    setMaterialError('')
    setChoosingMaterials(true)
    try {
      setMaterials(await invokeCommand<CTFMaterialRequest[]>('choose_ctf_materials'))
    } catch (reason) {
      setMaterialError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setChoosingMaterials(false)
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit || loading) return
    const points = knowledge
      .split(/[,，\n]+/)
      .map(value => value.trim())
      .filter(Boolean)
    onSubmit?.({
      title: title.trim(),
      statement: statement.trim(),
      category,
      collaborationMode,
      deferAgent: true,
      trackName: t('自定义 CTF 训练', 'Custom CTF training'),
      humanGoal: t(`完成 ${title.trim()}，并保留可复现的假设、实验和平台判题证据。`, `Complete ${title.trim()} and keep reproducible hypotheses, experiments, and platform judge evidence.`),
      sourceKind,
      sourceUri: sourceKind === 'text' ? '' : sourceValue.trim(),
      expectedFlag: '',
      knowledgePoints: points,
      materials,
    })
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <label className="block">
        <span className="mb-2 block text-label font-medium">{t('题目名称', 'Challenge name')}</span>
        <Input
          value={title}
          onChange={event => setTitle(event.target.value)}
          autoFocus
          required
          maxLength={120}
          placeholder={t('例如：Web warmup', 'Example: Web warmup')}
        />
      </label>

      <label className="block">
        <span className="mb-2 block text-label font-medium">{t('题面', 'Statement')}</span>
        <Textarea
          value={statement}
          onChange={event => setStatement(event.target.value)}
          required
          maxLength={12000}
          className="min-h-32 resize-y"
          placeholder={t('粘贴题面、Flag 格式和已知限制', 'Paste the statement, flag format, and known constraints')}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-label font-medium">{t('题型', 'Category')}</span>
          <NativeSelect value={category} onChange={event => setCategory(event.target.value)}>
            <NativeSelectOption value="web">Web</NativeSelectOption>
            <NativeSelectOption value="pwn">Pwn</NativeSelectOption>
            <NativeSelectOption value="reverse">Reverse</NativeSelectOption>
            <NativeSelectOption value="crypto">Crypto</NativeSelectOption>
            <NativeSelectOption value="forensics">Forensics</NativeSelectOption>
            <NativeSelectOption value="misc">Misc</NativeSelectOption>
          </NativeSelect>
        </label>

        <label className="block">
          <span className="mb-2 block text-label font-medium">{t('入口', 'Entry')}</span>
          <NativeSelect value={sourceKind} onChange={event => setSourceKind(event.target.value as ManualSourceKind)}>
            <NativeSelectOption value="text">{t('题面 / 附件', 'Statement / attachment')}</NativeSelectOption>
            <NativeSelectOption value="url">Web URL</NativeSelectOption>
            <NativeSelectOption value="socket">{t('TCP 服务', 'TCP service')}</NativeSelectOption>
            <NativeSelectOption value="ssh">{t('SSH 服务', 'SSH service')}</NativeSelectOption>
          </NativeSelect>
        </label>
      </div>

      {sourceKind !== 'text' ? (
        <label className="block">
          <span className="mb-2 block text-label font-medium">{sourceLabel}</span>
          <Input
            value={sourceValue}
            onChange={event => setSourceValue(event.target.value)}
            required
            placeholder={sourcePlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ) : null}

      <label className="block">
        <span className="mb-2 block text-label font-medium">{t('知识点', 'Knowledge points')}</span>
        <Input
          value={knowledge}
          onChange={event => setKnowledge(event.target.value)}
          placeholder={t('可选，用逗号分隔', 'Optional, comma-separated')}
        />
      </label>

      <div>
        <span className="mb-2 block text-label font-medium">{t('协作方式', 'Collaboration mode')}</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('协作方式', 'Collaboration mode')}>
          {modeItems.map(item => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={collaborationMode === item.value ? 'default' : 'outline'}
              aria-pressed={collaborationMode === item.value}
              onClick={() => setCollaborationMode(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={choosingMaterials}
          onClick={() => { void chooseMaterials() }}
        >
          {choosingMaterials ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          {t('选择附件或截图', 'Choose attachments or screenshots')}
        </Button>
        {materials.length ? (
          <span
            className="min-w-0 truncate text-caption text-muted-foreground"
            title={materials.map(material => material.name).join(' · ')}
          >
            {t(`${materials.length} 项 · ${materials.map(material => material.name).join(' · ')}`, `${materials.length} items · ${materials.map(material => material.name).join(' · ')}`)}
          </span>
        ) : null}
      </div>

      {materialError || error ? (
        <Alert variant="destructive">
          <AlertDescription>{materialError || error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel}>{t('取消', 'Cancel')}</Button>
        <Button type="submit" disabled={!canSubmit || loading}>
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {t('创建本地工作区', 'Create local workspace')}
        </Button>
      </div>
    </form>
  )
})

export default CTFManualIntake
