import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button, SettingsRow, SettingsSection, Textarea } from '@/components/ui'
import { invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import { toast } from '@/lib/appToast'
import { orderCveLearningNotes, prepareCveLearningSave } from '@/lib/cveLearning'
import type { VulnLearningRecord, VulnProjection } from '@/vulnTypes'

export default function CveLearningNote({
  cveId,
  title,
  summary,
  referenceHrefs,
  jobId,
  records,
  onSaved,
}: {
  cveId: string
  title: string
  summary?: string
  referenceHrefs?: string[]
  jobId?: string
  records: VulnLearningRecord[]
  onSaved: (projection: VulnProjection) => void
}) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [forgetting, setForgetting] = useState('')
  const notes = orderCveLearningNotes(records)

  async function save() {
    const plan = prepareCveLearningSave({
      cveId,
      title,
      summary,
      referenceHrefs,
      content: draft,
    })
    if (!plan || saving || forgetting) return
    setSaving(true)
    try {
      let id = jobId?.trim() ?? ''
      if (!id) {
        const ensured = await invokeCommand<VulnProjection>('ensure_vuln_tracking_workspace', {
          request: plan.ensure,
        })
        id = ensured.job?.id?.trim() ?? ''
      }
      if (!id) throw new Error('missing job')
      const saved = await invokeCommand<VulnProjection>('record_vuln_learning', {
        id,
        request: { kind: 'reflection', content: plan.content },
      })
      onSaved(saved)
      setDraft('')
    } catch {
      toast(t('保存失败', 'Save failed'), { tone: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function forget(learningId: string) {
    const id = jobId?.trim() ?? ''
    if (!id || !learningId || forgetting || saving) return
    setForgetting(learningId)
    try {
      const saved = await invokeCommand<VulnProjection>('forget_vuln_learning', {
        id,
        learningId,
      })
      onSaved(saved)
    } catch {
      toast(t('没能忘掉这条记录', 'Could not forget this note'), { tone: 'destructive' })
    } finally {
      setForgetting('')
    }
  }

  return (
    <SettingsSection
      title={t('学习记录', 'Learning')}
      footer={(
        <Button
          type="button"
          variant="brand"
          size="sm"
          disabled={saving || forgetting !== '' || !draft.trim()}
          onClick={() => { void save() }}
        >
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {t('记下', 'Save')}
        </Button>
      )}
    >
      {notes.map(record => (
        <SettingsRow
          key={record.id}
          align="start"
          trailing={(
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!jobId || saving || forgetting !== ''}
              onClick={() => { void forget(record.id) }}
            >
              {t('忘掉', 'Forget')}
            </Button>
          )}
        >
          <p className="min-w-0 whitespace-pre-wrap break-words text-[length:var(--text-label)] leading-[var(--text-label--line-height)]">
            {record.content}
          </p>
        </SettingsRow>
      ))}
      <div className="px-4 py-3">
        <Textarea
          value={draft}
          maxLength={4000}
          aria-label={t('学习记录', 'Learning')}
          onChange={event => setDraft(event.target.value)}
        />
      </div>
    </SettingsSection>
  )
}
