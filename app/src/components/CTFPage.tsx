import { useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  CircleStop,
  FileCode2,
  Flag,
  FlaskConical,
  KeyRound,
  Paperclip,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { useCTFWorkspace } from '../hooks/useCTFWorkspace'
import type { CTFChallengeRequest, CTFExperiment, CTFProjection } from '../ctfTypes'
import type { JobStatus } from '../runtimeTypes'

interface Props {
  onOpenSettings: () => void
}

const ACTIVE_STATUSES = new Set<JobStatus>(['queued', 'running', 'cancelling', 'recovering'])

export function CTFPage({ onOpenSettings }: Props) {
  const workspace = useCTFWorkspace()
  const [showIntake, setShowIntake] = useState(false)

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-[#f3f1ec] text-[#20211f]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#dfddd6] bg-[#faf9f6] px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl bg-[#18231f] text-[#d6f56f]">
            <Flag className="size-4" strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-[-0.01em]">CTF 训练场</h1>
              <span className="rounded-full bg-[#e7e5df] px-2 py-0.5 font-mono text-[9px] text-[#666862]">M2-A</span>
            </div>
            <p className="text-[10px] text-[#8b8c86]">人与安全 Agent 共同实验、验证和复盘</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-lg border border-[#dddbd4] bg-white px-2.5 py-1.5 font-mono text-[10px] text-[#71736d] xl:block">
            delegate · offline · typed tools
          </span>
          <button
            type="button"
            onClick={() => void workspace.loadJobs()}
            className="rounded-lg border border-[#dddbd4] bg-white p-1.5 text-[#666862] hover:bg-[#f2f1ed]"
            title="刷新"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-lg border border-[#dddbd4] bg-white p-1.5 text-[#666862] hover:bg-[#f2f1ed]"
            title="设置模型与 API 密钥"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[292px] shrink-0 flex-col border-r border-[#dedcd5] bg-[#f9f8f5]">
          <div className="space-y-2 border-b border-[#e2e0da] p-3">
            <button
              type="button"
              onClick={() => setShowIntake(true)}
              disabled={workspace.creating}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#19231f] px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0f1714] disabled:cursor-wait disabled:bg-[#777a74]"
            >
              <Plus className="size-4" />
              新建一道题
            </button>
            <button
              type="button"
              onClick={() => void workspace.startSample()}
              disabled={workspace.creating}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#d9d7d0] bg-white px-3 py-2 text-xs font-medium text-[#4c4e48] transition-colors hover:border-[#b9c68b] hover:bg-[#f7faed] disabled:cursor-wait"
            >
              <Sparkles className="size-3.5 text-[#6e7f29]" />
              运行内置 Hex 练习
            </button>
            <p className="px-1 pt-1 text-[10px] leading-4 text-[#969791]">
              当前只运行本地材料与受控动作，不访问外部网站，不开放任意 Shell。
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="flex items-center justify-between px-2 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#92938d]">训练记录</p>
              <span className="font-mono text-[10px] text-[#aaa]">{workspace.jobs.length}</span>
            </div>
            {workspace.loading && workspace.jobs.length === 0 ? (
              <p className="px-2 py-5 text-xs text-[#999a94]">正在读取本地任务...</p>
            ) : null}
            {!workspace.loading && workspace.jobs.length === 0 ? (
              <div className="mx-1 mt-2 rounded-2xl border border-dashed border-[#d8d6ce] bg-white/70 px-4 py-7 text-center">
                <FlaskConical className="mx-auto size-5 text-[#a1a29c]" />
                <p className="mt-3 text-xs font-medium text-[#5e605a]">还没有实验记录</p>
                <p className="mt-1 text-[10px] leading-4 text-[#999a94]">先跑内置练习，观察 Agent 怎样留下证据链。</p>
              </div>
            ) : null}
            {workspace.jobs.map(job => (
              <button
                key={job.id}
                type="button"
                onClick={() => void workspace.selectJob(job.id)}
                className={`mb-1 w-full rounded-xl border px-3 py-3 text-left transition-all ${
                  workspace.selectedId === job.id
                    ? 'border-[#cdd3b8] bg-[#f8fced] shadow-sm'
                    : 'border-transparent hover:bg-[#efeee9]'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[#373934]">{job.title}</p>
                    <div className="mt-1.5 flex items-center gap-2 font-mono text-[9px] text-[#91928c]">
                      <span>{job.category}</span>
                      <span>{job.experimentCount} experiments</span>
                    </div>
                  </div>
                  <StatusDot status={job.status} />
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto">
          {workspace.error ? (
            <div className="mx-6 mt-5 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              <span>{workspace.error}</span>
              <button type="button" onClick={() => void workspace.loadJobs()} className="shrink-0 font-medium underline">重试</button>
            </div>
          ) : null}
          {showIntake ? (
            <ChallengeIntake
              creating={workspace.creating}
              onClose={() => setShowIntake(false)}
              onSubmit={async request => {
                if (await workspace.startChallenge(request)) setShowIntake(false)
              }}
            />
          ) : workspace.projection ? (
            <ChallengeDetail
              projection={workspace.projection}
              onCancel={() => void workspace.cancelJob(workspace.projection?.job.id ?? '')}
            />
          ) : (
            <EmptyWorkspace onStart={() => void workspace.startSample()} />
          )}
        </section>
      </div>
    </main>
  )
}

function ChallengeDetail({ projection, onCancel }: { projection: CTFProjection; onCancel: () => void }) {
  const canCancel = ACTIVE_STATUSES.has(projection.job.status)
  const latestAttempt = projection.attempts.at(-1)
  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-6">
      <div className="overflow-hidden rounded-[22px] bg-[#18231f] text-white shadow-[0_16px_40px_rgba(25,35,31,0.12)]">
        <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-7 px-7 py-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#d7f46d] px-2.5 py-1 font-mono text-[10px] font-semibold text-[#273014]">{projection.challenge.category}</span>
              <span className="font-mono text-[10px] text-[#aeb9b3]">{projection.contractVersion}</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">{projection.challenge.title}</h2>
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-[#ced5d1]">{projection.challenge.statement}</p>
          </div>
          <div className="border-l border-white/10 pl-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#82908a]">运行边界</p>
            <dl className="mt-3 space-y-2.5 text-xs">
              <BoundaryRow label="Mode" value={projection.challenge.collaborationMode} />
              <BoundaryRow label="Engine" value={latestAttempt?.engine ?? 'waiting'} />
              <BoundaryRow label="Model" value={latestAttempt?.model ?? 'waiting'} />
              <BoundaryRow label="Judge" value={`${projection.challenge.judgeType}@${projection.challenge.judgeVersion}`} />
            </dl>
            {canCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="mt-5 flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] text-[#c9d0cc] hover:border-red-300/50 hover:text-red-200"
              >
                <CircleStop className="size-3" />
                停止本次运行
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-6 border-t border-white/10 bg-black/10 px-7 py-3 font-mono text-[10px] text-[#9eaaa4]">
          <StatusLabel status={projection.job.status} />
          <span>{projection.experiments.length} / 8 experiments</span>
          <span>{projection.evidence.length} evidence</span>
          <span>{projection.artifacts.length} artifacts</span>
        </div>
      </div>

      {projection.outcome ? <OutcomeBanner projection={projection} /> : null}

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_310px] items-start gap-5">
        <div className="overflow-hidden rounded-2xl border border-[#dddbd4] bg-[#faf9f6]">
          <div className="flex items-center justify-between border-b border-[#e3e1da] px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold">实验工作台</h3>
              <p className="mt-1 text-[11px] text-[#8b8c86]">每一步都包含模型理由、受控动作、观察与证据引用。</p>
            </div>
            <FlaskConical className="size-4 text-[#7d847f]" />
          </div>
          <div className="max-h-[640px] overflow-y-auto p-3 [content-visibility:auto]">
            {projection.experiments.length ? projection.experiments.map(experiment => (
              <ExperimentCard key={experiment.id} experiment={experiment} />
            )) : (
              <div className="px-4 py-12 text-center text-xs text-[#979892]">等待 Agent 提出第一个受控实验...</div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <SideCard icon={<Paperclip className="size-3.5" />} title="题目材料">
            {projection.challenge.materials.length ? projection.challenge.materials.map(material => (
              <div key={material.artifactId} className="rounded-xl border border-[#e3e1db] bg-white p-3">
                <div className="flex items-center gap-2">
                  <FileCode2 className="size-3.5 text-[#71804b]" />
                  <p className="min-w-0 flex-1 truncate text-xs font-medium">{material.name}</p>
                </div>
                <p className="mt-2 font-mono text-[9px] text-[#92938d]">{formatBytes(material.size)} · {material.mediaType}</p>
                <p className="mt-1 truncate font-mono text-[9px] text-[#afb0aa]">{material.sha256}</p>
              </div>
            )) : <p className="text-[11px] leading-5 text-[#898a84]">这是纯文本题目，没有额外附件。</p>}
          </SideCard>

          <SideCard icon={<KeyRound className="size-3.5" />} title="本地判题">
            <div className="rounded-xl bg-[#eef3df] p-3 text-[11px] leading-5 text-[#58622f]">
              模型只能提交候选值，不能把自己标记为成功。最终结果由独立 Judge 读取 Artifact 后判定。
            </div>
            {projection.submissions.map((submission, index) => (
              <div key={`${submission.candidate}-${index}`} className="mt-2 rounded-xl border border-[#e1dfd8] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate text-[10px] text-[#454742]">{submission.candidate}</code>
                  <VerdictPill verdict={submission.verdict} />
                </div>
                {submission.summary ? <p className="mt-2 text-[10px] leading-4 text-[#888a83]">{submission.summary}</p> : null}
              </div>
            ))}
          </SideCard>

          <SideCard icon={<BookOpen className="size-3.5" />} title="这道题要带走什么">
            {projection.challenge.knowledgePoints.length ? (
              <ul className="space-y-2">
                {projection.challenge.knowledgePoints.map(point => (
                  <li key={point} className="flex gap-2 text-[11px] leading-5 text-[#666862]">
                    <ChevronRight className="mt-1 size-3 shrink-0 text-[#849252]" />
                    {point}
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-[#898a84]">完成后可从实验记录中复盘知识点。</p>}
          </SideCard>
        </div>
      </div>
    </div>
  )
}

function ExperimentCard({ experiment }: { experiment: CTFExperiment }) {
  return (
    <article className="mb-3 rounded-2xl border border-[#e0ded7] bg-white px-4 py-4 shadow-[0_2px_8px_rgba(30,32,29,0.025)]">
      <div className="flex items-start gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#edf1df] font-mono text-[10px] font-semibold text-[#69743d]">{experiment.number}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <code className="truncate text-xs font-semibold text-[#343632]">{experiment.action?.name ?? 'planning'}</code>
              <span className="rounded bg-[#f0efeb] px-1.5 py-0.5 font-mono text-[9px] text-[#777973]">{experiment.status}</span>
            </div>
            <span className="font-mono text-[9px] text-[#a1a29c]">{experiment.artifactIds.length} artifacts</span>
          </div>
          {experiment.action?.rationale ? (
            <div className="mt-3 rounded-xl border-l-2 border-[#b8ca72] bg-[#f7f9ef] px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#87915e]">Agent rationale</p>
              <p className="mt-1 text-xs leading-5 text-[#585b54]">{experiment.action.rationale}</p>
            </div>
          ) : null}
          {experiment.observations.map(observation => (
            <div key={observation.id} className="mt-3 rounded-xl bg-[#f5f4f1] px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#92938d]">Observation</p>
              <pre className="mt-1.5 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[#4f514c]">{observation.summary}</pre>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function ChallengeIntake({
  creating,
  onClose,
  onSubmit,
}: {
  creating: boolean
  onClose: () => void
  onSubmit: (request: CTFChallengeRequest) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('misc')
  const [statement, setStatement] = useState('')
  const [expectedFlag, setExpectedFlag] = useState('')
  const [knowledge, setKnowledge] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [intakeError, setIntakeError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIntakeError(null)
    try {
      if (files.length > 8) throw new Error('最多只能接入 8 个附件。')
      if (files.some(file => file.size === 0 || file.size > 512 * 1024)) {
        throw new Error('每个附件必须在 1 B 到 512 KiB 之间。')
      }
      if (files.reduce((total, file) => total + file.size, 0) > 2 * 1024 * 1024) {
        throw new Error('附件总大小不能超过 2 MiB。')
      }
      const materials = await Promise.all(files.map(async file => ({
        name: file.name,
        mediaType: file.type || 'application/octet-stream',
        dataBase64: await fileToBase64(file),
        provenance: 'user:desktop-intake',
      })))
      await onSubmit({
        title,
        statement,
        category,
        collaborationMode: 'delegate',
        expectedFlag,
        knowledgePoints: knowledge.split(/[,，\n]/).map(value => value.trim()).filter(Boolean),
        materials,
      })
    } catch (reason) {
      setIntakeError(String(reason))
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-7 py-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#858780]">Challenge intake</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">把一道题交给 CTF Agent</h2>
          <p className="mt-2 text-sm leading-6 text-[#7c7e77]">可以只粘贴题目，也可以附加本地文件。M2-A 会把输入标准化成可恢复任务。</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-[#dcdad3] bg-white p-2 text-[#73756f] hover:bg-[#efeee9]">
          <X className="size-4" />
        </button>
      </div>

      <form onSubmit={event => void submit(event)} className="mt-7 space-y-5 rounded-2xl border border-[#dcdbd4] bg-[#faf9f6] p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-4">
          <Field label="题目名称">
            <input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} className="ctf-input" placeholder="例如：Baby Crypto 01" />
          </Field>
          <Field label="分类">
            <select value={category} onChange={event => setCategory(event.target.value)} className="ctf-input">
              {['misc', 'crypto', 'web', 'pwn', 'reverse', 'forensics'].map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
        </div>
        <Field label="题目描述" help="把比赛网站里的题面完整粘贴到这里。">
          <textarea required maxLength={12000} value={statement} onChange={event => setStatement(event.target.value)} className="ctf-input min-h-36 resize-y leading-6" placeholder="题面、提示、Flag 格式..." />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="本地正确答案" help="接入后只持久化 SHA-256；模型看不到答案或哈希。">
            <input required type="password" maxLength={512} value={expectedFlag} onChange={event => setExpectedFlag(event.target.value)} className="ctf-input font-mono" placeholder="flag{...}" />
          </Field>
          <Field label="希望掌握的知识点" help="用逗号分隔，可稍后用于教学复盘。">
            <input value={knowledge} onChange={event => setKnowledge(event.target.value)} className="ctf-input" placeholder="Hex 编码, 文件分析" />
          </Field>
        </div>
        <Field label="本地附件" help="可选；最多 8 个，单个不超过 512 KiB，合计不超过 2 MiB。">
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-[#cfcdc5] bg-white px-4 py-3 hover:border-[#aebd72] hover:bg-[#f9fbed]">
            <span className="flex items-center gap-2 text-xs text-[#656760]"><Paperclip className="size-3.5" />选择一个或多个文件</span>
            <span className="max-w-[360px] truncate font-mono text-[10px] text-[#979892]">{files.length ? files.map(file => file.name).join(', ') : '未选择'}</span>
            <input type="file" multiple className="hidden" onChange={event => setFiles(Array.from(event.target.files ?? []))} />
          </label>
        </Field>
        {intakeError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{intakeError}</p> : null}
        <div className="flex items-center justify-between border-t border-[#e3e1da] pt-5">
          <div className="flex items-center gap-2 text-[10px] text-[#898b84]"><ShieldCheck className="size-3.5 text-[#758347]" />输入先进入 Go Intake，不直接成为工具指令。</div>
          <button type="submit" disabled={creating} className="rounded-xl bg-[#19231f] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#0f1714] disabled:cursor-wait disabled:bg-[#777a74]">
            {creating ? '正在建立任务...' : '开始受控实验'}
          </button>
        </div>
      </form>
    </div>
  )
}

function EmptyWorkspace({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center px-8 py-16">
      <div className="max-w-lg text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#18231f] text-[#d6f56f] shadow-lg"><Flag className="size-6" /></div>
        <h2 className="mt-5 text-xl font-semibold tracking-[-0.025em]">从一道能被验证的小题开始</h2>
        <p className="mt-2 text-sm leading-6 text-[#80827b]">Agent 不只是给答案。它会解释为什么进行这一步，并把观察、产物、提交和 Judge 结论留在同一条可复盘的事实链里。</p>
        <button type="button" onClick={onStart} className="mt-5 rounded-xl border border-[#cfcdc5] bg-white px-4 py-2.5 text-xs font-medium text-[#454741] hover:border-[#aebd72] hover:bg-[#f9fbed]">运行内置 Hex 练习</button>
      </div>
    </div>
  )
}

function OutcomeBanner({ projection }: { projection: CTFProjection }) {
  const succeeded = projection.outcome?.status === 'succeeded'
  return (
    <div className={`mt-5 flex items-start gap-3 rounded-2xl border px-5 py-4 ${succeeded ? 'border-[#c9d9a0] bg-[#f3f8e8]' : 'border-[#e3c7c0] bg-[#fff3f0]'}`}>
      <ShieldCheck className={`mt-0.5 size-4 shrink-0 ${succeeded ? 'text-[#70833b]' : 'text-[#a96153]'}`} />
      <div>
        <p className="text-xs font-semibold">{succeeded ? 'Judge 已确认完成' : '本次运行已结束'}</p>
        <p className="mt-1 text-xs leading-5 text-[#686a64]">{projection.outcome?.summary}</p>
      </div>
    </div>
  )
}

function SideCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#dddbd4] bg-[#faf9f6] p-4">
      <div className="mb-3 flex items-center gap-2 text-[#5e615a]">{icon}<h3 className="text-xs font-semibold">{title}</h3></div>
      {children}
    </section>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[#4e504a]">{label}</span>
      {help ? <span className="ml-2 text-[10px] text-[#999a94]">{help}</span> : null}
      <div className="mt-2">{children}</div>
    </label>
  )
}

function BoundaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-2"><dt className="text-[#78847e]">{label}</dt><dd className="max-w-[135px] break-words text-right font-mono text-[10px] text-[#c6cfca]">{value}</dd></div>
}

function StatusDot({ status }: { status: JobStatus }) {
  const tone = status === 'succeeded' ? 'bg-[#8aa34a]' : status === 'failed' ? 'bg-[#c56c58]' : status === 'cancelled' ? 'bg-[#999b95]' : 'bg-[#4f87a6] animate-pulse'
  return <span className={`mt-1 size-2 shrink-0 rounded-full ${tone}`} title={status} />
}

function StatusLabel({ status }: { status: JobStatus }) {
  return <span className="flex items-center gap-2"><StatusDot status={status} />{status}</span>
}

function VerdictPill({ verdict }: { verdict: string }) {
  const tone = verdict === 'pass' ? 'bg-[#e7f1cf] text-[#637633]' : verdict === 'fail' ? 'bg-[#f7dfda] text-[#9d5143]' : 'bg-[#ecebe7] text-[#777973]'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] ${tone}`}>{verdict || 'waiting'}</span>
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} KiB`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`))
    reader.onload = () => {
      const value = String(reader.result ?? '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}
