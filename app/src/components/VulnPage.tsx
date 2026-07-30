import { useMemo, useState } from 'react'
import { useVulnWorkspace } from '../hooks/useVulnWorkspace'
import { demoReproductionRequest } from '../vulnDemo'
import type {
  VulnLearningRecordRequest,
  VulnProjection,
  VulnReproductionRequest,
  VulnSummary,
} from '../vulnTypes'

interface Props {
  onOpenSettings: () => void
}

type IconName =
  | 'flag'
  | 'play'
  | 'shield'
  | 'file'
  | 'check'
  | 'alert'
  | 'book'
  | 'refresh'
  | 'settings'
  | 'calendar'
  | 'chevron'
  | 'edit'
  | 'target'
  | 'flask'
  | 'close'

const iconPaths: Record<IconName, React.ReactNode> = {
  flag: <><path d="M6 21V4" /><path d="M6 5c3-2 6 2 11 0v8c-5 2-8-2-11 0" /></>,
  play: <path d="m9 7 8 5-8 5z" />,
  shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6z" /><path d="m9.5 12 1.7 1.7 3.5-4" /></>,
  file: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /></>,
  check: <path d="m5 12 4 4 10-10" />,
  alert: <><path d="M12 3 3 20h18z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22z" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8A7 7 0 0 1 18 6l2 6M18 16a7 7 0 0 1-12 2l-2-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7-.8-1.8.9-1.9-2.2-2.2-1.9.9-1.8-.8L10.5 2h-3l-.7 2-1.8.8-1.9-.9L1 6.1 2 8l-.8 1.8-2 .7v3l2 .7L2 16l-.9 1.9L3.3 20l1.9-.9 1.8.8.7 2h3l.7-2 1.8-.8 1.9.9 2.2-2.2-.9-1.9.8-1.8z" transform="translate(2.5 0) scale(.8)" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  edit: <><path d="M4 20h4l11-11-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /></>,
  flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" /><path d="M7.5 15h9" /></>,
  close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
}

function Icon({ name, className = 'size-4' }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  )
}

export function VulnPage({ onOpenSettings }: Props) {
  const {
    jobs,
    selectedId,
    projection,
    loading,
    working,
    error,
    loadJobs,
    selectJob,
    startFixture,
    submitReproduction,
    recordLearning,
  } = useVulnWorkspace()
  const [showReproduction, setShowReproduction] = useState(false)
  const [showLearning, setShowLearning] = useState(false)
  const [expandedEvidence, setExpandedEvidence] = useState(true)

  return (
    <main className="flex min-w-0 flex-1 bg-[#f8f8f5] text-[#242521]">
      <ResearchRail
        jobs={jobs}
        selectedId={selectedId}
        loading={loading}
        working={working}
        onStart={() => void startFixture()}
        onSelect={id => void selectJob(id)}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-end gap-3 border-b border-[#dfdfda] bg-[#fbfbf9] px-4">
          <span className="mr-1 text-[12px] font-medium tracking-[0.025em] text-[#777971]">
            local fixture · authorized · evaluator-backed
          </span>
          <button
            type="button"
            onClick={() => void loadJobs()}
            className="grid size-9 place-items-center rounded-xl border border-[#deded9] bg-white text-[#2f312d] shadow-[0_1px_2px_rgba(0,0,0,.03)] transition hover:bg-[#f2f2ee]"
            aria-label="刷新漏洞研究"
          >
            <Icon name="refresh" className="size-[18px]" />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="grid size-9 place-items-center rounded-xl border border-[#deded9] bg-white text-[#2f312d] shadow-[0_1px_2px_rgba(0,0,0,.03)] transition hover:bg-[#f2f2ee]"
            aria-label="打开设置"
          >
            <Icon name="settings" className="size-[18px]" />
          </button>
        </header>

        {error ? (
          <div className="mx-4 mt-4 rounded-xl border border-[#e6b8b0] bg-[#fff5f3] px-4 py-3 text-[12px] leading-5 text-[#8c342b]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="grid flex-1 place-items-center text-[13px] text-[#777971]">正在读取本地研究工作区…</div>
        ) : projection ? (
          <ResearchWorkspace
            projection={projection}
            working={working}
            expandedEvidence={expandedEvidence}
            onToggleEvidence={() => setExpandedEvidence(value => !value)}
            onOpenReproduction={() => setShowReproduction(true)}
            onOpenLearning={() => setShowLearning(true)}
          />
        ) : (
          <EmptyWorkspace working={working} onStart={() => void startFixture()} />
        )}
      </section>

      {showReproduction && projection ? (
        <ReproductionDialog
          working={working}
          onClose={() => setShowReproduction(false)}
          onSubmit={async request => {
            const saved = await submitReproduction(projection.job.id, request)
            if (saved) setShowReproduction(false)
          }}
        />
      ) : null}
      {showLearning && projection ? (
        <LearningDialog
          working={working}
          onClose={() => setShowLearning(false)}
          onSubmit={async request => {
            const saved = await recordLearning(projection.job.id, request)
            if (saved) setShowLearning(false)
          }}
        />
      ) : null}
    </main>
  )
}

function ResearchRail({
  jobs,
  selectedId,
  loading,
  working,
  onStart,
  onSelect,
}: {
  jobs: VulnSummary[]
  selectedId: string | null
  loading: boolean
  working: boolean
  onStart: () => void
  onSelect: (id: string) => void
}) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[#deded9] bg-[#fbfbf8] max-[1024px]:hidden">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[#deded9] px-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#111d18] text-[#b8ef5a] shadow-[0_5px_18px_rgba(11,27,21,.12)]">
          <Icon name="flag" className="size-[22px]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-semibold tracking-[-0.025em] text-[#292b27]">漏洞研究</h1>
            <span className="rounded-md bg-[#eeeeea] px-2 py-0.5 text-[10px] font-semibold text-[#85877f]">M3</span>
          </div>
          <p className="mt-0.5 truncate text-[10px] tracking-[-0.02em] text-[#85877f]">人与安全 Agent 共同提出假设、复现行为、解释根因</p>
        </div>
      </div>

      <div className="border-b border-[#deded9] p-4">
        <button
          type="button"
          disabled={working}
          onClick={onStart}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#10261d] px-3 text-[13px] font-semibold text-white shadow-[0_7px_20px_rgba(15,40,29,.13)] transition hover:bg-[#173529] disabled:cursor-wait disabled:opacity-60"
        >
          <Icon name="play" className="size-4 text-[#c6ee73]" />
          {working ? '正在建立研究工作区' : '开始本地 packet-parser 研究'}
        </button>
        <div className="mt-4 flex items-start gap-2 text-[11px] leading-[1.55] text-[#777a72]">
          <Icon name="shield" className="mt-0.5 size-4 shrink-0 text-[#717970]" />
          <p>只读取项目内置、版本固定、明确授权的 fixture；不接受或执行漏洞触发输入。</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
        <p className="px-1 text-[12px] font-semibold text-[#42443f]">研究记录</p>
        <div className="mt-3 space-y-2 overflow-y-auto">
          {!loading && jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#d9dad3] px-3 py-5 text-center text-[11px] leading-5 text-[#92948d]">
              还没有研究记录
            </div>
          ) : null}
          {jobs.map(job => (
            <button
              type="button"
              key={job.id}
              onClick={() => onSelect(job.id)}
              className={`group w-full rounded-xl border px-3 py-3 text-left transition ${
                job.id === selectedId
                  ? 'border-[#bcc89a] bg-[#eef2df] shadow-[0_1px_2px_rgba(22,37,15,.03)]'
                  : 'border-transparent hover:border-[#e0e1dc] hover:bg-white'
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon name="file" className="mt-0.5 size-[18px] shrink-0 text-[#596052]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[12px] font-medium text-[#3a3c37]">{job.title}</p>
                    <Icon name="chevron" className="ml-auto size-3.5 shrink-0 text-[#777b72]" />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[#767970]">
                    <span>{job.verdict === 'pass' ? '稳定复现' : '待复现证据'}</span>
                    <span className="size-1 rounded-full bg-[#a9b28f]" />
                    <span>{job.reproductionState === 'awaiting_evidence' ? '静态证据已保存' : `${job.reproductionState} 次一致`}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

function EmptyWorkspace({ working, onStart }: { working: boolean; onStart: () => void }) {
  return (
    <div className="grid flex-1 place-items-center px-8">
      <div className="max-w-[520px] text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-[#d9ddd0] bg-[#eef2df] text-[#657347]">
          <Icon name="flask" className="size-7" />
        </div>
        <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.03em] text-[#2b2d29]">从一个固定本地 fixture 开始</h2>
        <p className="mx-auto mt-2 max-w-[440px] text-[13px] leading-6 text-[#777971]">
          MilkSU 会先保存版本、授权和源码证据，再建立攻击面、候选根因与待验证假设。成功只能来自独立评估记录。
        </p>
        <button
          type="button"
          disabled={working}
          onClick={onStart}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-[#10261d] px-5 text-[13px] font-semibold text-white disabled:opacity-60"
        >
          <Icon name="play" className="size-4 text-[#c6ee73]" />
          开始 packet-parser 研究
        </button>
      </div>
    </div>
  )
}

function ResearchWorkspace({
  projection,
  working,
  expandedEvidence,
  onToggleEvidence,
  onOpenReproduction,
  onOpenLearning,
}: {
  projection: VulnProjection
  working: boolean
  expandedEvidence: boolean
  onToggleEvidence: () => void
  onOpenReproduction: () => void
  onOpenLearning: () => void
}) {
  const evaluation = projection.evaluations.at(-1)
  const hypothesis = projection.hypotheses.at(-1)
  const completed = evaluation?.verdict === 'pass'
  const codeLog = projection.reproduction?.runs[0]?.sanitizerLog
  const completedAt = formatDateTime(projection.job.updatedAt)

  return (
    <div className="workspace-scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-[#f9f9f6] px-3 py-4">
      <section className="rounded-xl border border-[#deded9] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,.02)]">
        <div className="flex items-center gap-4">
          <Icon name="file" className="size-7 shrink-0 text-[#20231f]" />
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#292b27]">
              {projection.target.name} <span className="font-normal text-[#7d8078]">·</span> {projection.target.version}
            </h2>
            <div className="mt-2 flex items-center gap-5 text-[11px] text-[#666a62]">
              <span className="inline-flex items-center gap-1.5"><Icon name="file" className="size-3.5" />本地 fixture</span>
              <span className="inline-flex items-center gap-1.5 text-[#667a42]"><Icon name="check" className="size-3.5" />{completed ? '稳定复现' : '授权已记录'}</span>
            </div>
          </div>
          <div className="ml-auto hidden items-stretch divide-x divide-[#e4e4df] xl:flex">
            <MetaItem label="入口" value={projection.target.component} />
            <MetaItem label="环境" value={projection.reproduction ? `ASan · ${projection.reproduction.environment.architecture}` : '外部证据 · 待导入'} />
            <MetaItem label={completed ? '完成于' : '更新于'} value={completedAt} icon="calendar" />
          </div>
        </div>
      </section>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 min-[1180px]:grid-cols-[minmax(310px,.75fr)_minmax(430px,1.25fr)]">
        <div className="space-y-3">
          <Panel icon="file" title="当前假设">
            <div className="rounded-lg border border-[#deded8] px-4 py-3 text-[13px] leading-6 text-[#3d3f3a]">
              {hypothesis?.statement ?? '等待固定源码检查生成候选假设。'}
            </div>
          </Panel>

          <Panel icon="shield" title="实验轨迹">
            <MilestoneTrack projection={projection} onOpenReproduction={onOpenReproduction} />
          </Panel>

          <Panel icon="target" title="根因与影响">
            <dl className="grid grid-cols-[54px_1fr] gap-x-4 gap-y-3 text-[12px] leading-5">
              <dt className="font-medium text-[#555950]">根因</dt>
              <dd className="text-[#2f322d]">{projection.rootCause?.summary ?? '待分析'}</dd>
              <dt className="font-medium text-[#555950]">影响</dt>
              <dd className="text-[#4e524a]">
                {projection.rootCause?.impact ?? '等待可引用证据。'}
                <br />
                {projection.rootCause?.exploitability ?? ''}
              </dd>
            </dl>
          </Panel>
        </div>

        <div className="space-y-3">
          <section className="flex min-h-[570px] flex-col overflow-hidden rounded-xl border border-[#10271e] bg-[#0d2119] text-[#e8eee9] shadow-[0_12px_32px_rgba(8,28,20,.12)]">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <Icon name="file" className="size-[18px]" />
              <h3 className="text-[13px] font-semibold">复现证据</h3>
              {!completed ? (
                <button
                  type="button"
                  disabled={working}
                  onClick={onOpenReproduction}
                  className="ml-auto rounded-lg border border-[#55705f] bg-white/5 px-3 py-1.5 text-[11px] font-medium text-[#dbe7df] transition hover:bg-white/10 disabled:opacity-50"
                >
                  导入三次外部日志
                </button>
              ) : null}
            </div>
            <EvidenceRow
              icon="alert"
              title={completed ? 'AddressSanitizer: stack-buffer-overflow' : '等待外部 Sanitizer 日志'}
              expanded={expandedEvidence}
              onClick={onToggleEvidence}
            />
            <EvidenceRow
              icon="file"
              title={projection.reproduction ? `触发样本元数据 · ${projection.reproduction.triggerSize} B · SHA-256 ${projection.reproduction.triggerSha256.slice(0, 10)}…` : '触发样本只记录大小与哈希，不接收原始字节'}
              expanded={false}
              onClick={onToggleEvidence}
            />
            <EvidenceRow
              icon="file"
              title={projection.reproduction ? `reproduction.json · ${projection.reproduction.stableRuns}/${projection.reproduction.totalRuns}` : 'reproduction.json · 等待导入'}
              expanded={false}
              onClick={onToggleEvidence}
            />
            {expandedEvidence ? (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap border-t border-white/10 px-5 py-4 font-mono text-[10px] leading-[1.55] text-[#d5dfd8]">
                {codeLog ?? [
                  '尚未保存动态复现日志。',
                  '',
                  'MilkSU 已保存静态源码证据和候选根因。',
                  '请导入三个独立、干净本地进程产生的 ASan 日志，',
                  '以及同一触发样本的 SHA-256 与字节数。',
                  '',
                  '触发样本原始字节不会进入或由本工作台执行。',
                ].join('\n')}
              </pre>
            ) : null}
          </section>

          <Panel icon="book" title="学习复盘">
            <div className="grid grid-cols-[1.8fr_.5fr_.65fr_.55fr_auto] items-center divide-x divide-[#e3e3de]">
              <div className="pr-4">
                <p className="text-[11px] font-medium text-[#565a52]">学习目标</p>
                <p className="mt-1 text-[12px] leading-5 text-[#343733]">{projection.humanOutcome.goal}</p>
              </div>
              <LearningMetric label="提示" value="0" />
              <LearningMetric label="独立步骤" value={String(projection.humanOutcome.independentSteps)} />
              <LearningMetric label="复盘" value={String(projection.humanOutcome.reflectionCount)} />
              <button
                type="button"
                onClick={onOpenLearning}
                className="ml-4 inline-flex h-10 items-center gap-2 rounded-xl border border-[#94a66d] px-4 text-[12px] font-medium text-[#4d5f2c] transition hover:bg-[#f2f5e8]"
              >
                <Icon name="edit" className="size-4" />
                记录复盘
              </button>
            </div>
          </Panel>
        </div>
      </div>

      <section className="mt-3 grid min-w-0 grid-cols-1 divide-y divide-[#e1e1dc] rounded-xl border border-[#deded9] bg-white px-4 py-4 min-[1100px]:grid-cols-[1.45fr_.55fr_.9fr] min-[1100px]:divide-x min-[1100px]:divide-y-0">
        <div className="px-2">
          <p className="text-[12px] font-semibold text-[#3a3d38]">产物与溯源</p>
          <dl className="mt-3 grid grid-cols-[40px_1fr] gap-y-1 text-[11px] leading-4 text-[#555950]">
            <dt>源码</dt><dd>local/packet-parser@{projection.target.sourceArtifactId.slice(-7)}</dd>
            <dt>证据</dt><dd>{projection.artifacts.length} 个内容寻址 Artifact · {projection.evidence.length} 条 Evidence</dd>
            <dt>范围</dt><dd>{projection.target.scope.targets[0]?.value}</dd>
          </dl>
        </div>
        <div className="px-6">
          <p className="text-[12px] font-semibold text-[#3a3d38]">评估结果</p>
          <div className="mt-3 flex items-center gap-3">
            <div className={`grid size-8 place-items-center rounded-lg ${completed ? 'bg-[#edf4df] text-[#6f8b3e]' : 'bg-[#f0f0eb] text-[#8c8e87]'}`}>
              <Icon name={completed ? 'shield' : 'flask'} className="size-5" />
            </div>
            <div>
              <p className="text-[10px] text-[#777a72]">Evaluator</p>
              <p className="mt-0.5 text-[14px] font-medium text-[#2d302c]">{completed ? 'PASS' : 'PENDING'}</p>
            </div>
          </div>
        </div>
        <div className="px-6">
          <p className="text-[12px] font-semibold text-[#3a3d38]">评估说明</p>
          <p className="mt-3 text-[11px] leading-5 text-[#565a52]">
            {evaluation?.summary ?? '静态根因候选已保存；动态结果需要三个外部进程日志与用户确认。'}
          </p>
        </div>
      </section>
    </div>
  )
}

function MetaItem({ label, value, icon }: { label: string; value: string; icon?: IconName }) {
  return (
    <div className="flex min-w-[175px] items-center gap-3 px-5">
      {icon ? <Icon name={icon} className="size-4 text-[#545850]" /> : null}
      <div className="min-w-0">
        <p className="text-[10px] text-[#85887f]">{label}</p>
        <p className="mt-1 max-w-[220px] truncate text-[11px] font-medium text-[#3b3e39]">{value}</p>
      </div>
    </div>
  )
}

function Panel({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#deded9] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,.015)]">
      <div className="mb-3 flex items-center gap-2 text-[#383b36]">
        <Icon name={icon} className="size-[18px]" />
        <h3 className="text-[13px] font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function MilestoneTrack({ projection, onOpenReproduction }: { projection: VulnProjection; onOpenReproduction: () => void }) {
  const hasStatic = Boolean(projection.attackSurface)
  const hasCause = Boolean(projection.rootCause)
  const hasReproduction = Boolean(projection.reproduction)
  const milestones = [
    { title: '阅读固定源码', complete: hasStatic },
    { title: '建立攻击面与假设', complete: hasCause },
    { title: '导入外部 ASan 日志', complete: hasReproduction },
    { title: '记录样本哈希与大小', complete: hasReproduction },
    { title: hasReproduction ? `外部干净进程证据 ${projection.reproduction?.stableRuns}/${projection.reproduction?.totalRuns}` : '外部干净进程证据 0/3', complete: hasReproduction },
  ]
  const firstIncomplete = milestones.findIndex(item => !item.complete)

  return (
    <div className="overflow-hidden rounded-lg border border-[#deded8]">
      {milestones.map((item, index) => {
        const active = index === firstIncomplete
        return (
          <button
            type="button"
            key={item.title}
            onClick={active && index >= 2 ? onOpenReproduction : undefined}
            className={`relative flex h-[52px] w-full items-center gap-3 border-b border-[#e3e3de] px-4 text-left last:border-b-0 ${
              active ? 'bg-[#f0f4df]' : 'bg-white'
            } ${active && index >= 2 ? 'cursor-pointer hover:bg-[#e9efd5]' : 'cursor-default'}`}
          >
            {index > 0 ? <span className="absolute left-[26px] top-0 h-[13px] w-px bg-[#aebc83]" /> : null}
            {index < milestones.length - 1 ? <span className="absolute bottom-0 left-[26px] h-[13px] w-px bg-[#aebc83]" /> : null}
            <span className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium ${
              item.complete ? 'border-[#93a865] bg-white text-[#4f6330]' : active ? 'border-[#7f914f] bg-[#eef3df] text-[#465b28]' : 'border-[#d0d2ca] bg-white text-[#9a9c95]'
            }`}>
              {item.complete ? <Icon name="check" className="size-3.5" /> : index + 1}
            </span>
            <span className={`text-[12px] ${item.complete || active ? 'font-medium text-[#3d403a]' : 'text-[#8b8e86]'}`}>{item.title}</span>
            <span className="ml-auto text-[10px] text-[#898c84]">{item.complete ? formatClock(projection.job.updatedAt) : active ? '待处理' : '—'}</span>
            {item.complete ? <Icon name="check" className="size-4 text-[#718a41]" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function EvidenceRow({
  icon,
  title,
  expanded,
  onClick,
}: {
  icon: IconName
  title: string
  expanded: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center gap-3 border-b border-white/10 px-4 text-left text-[11px] text-[#e2e9e4] transition hover:bg-white/[.035]"
    >
      <Icon name={icon} className="size-[18px] shrink-0" />
      <span className="truncate">{title}</span>
      <Icon name="chevron" className={`ml-auto size-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
    </button>
  )
}

function LearningMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 text-center">
      <p className="text-[10px] text-[#85887f]">{label}</p>
      <p className="mt-1 text-[14px] font-medium text-[#343733]">{value}</p>
    </div>
  )
}

function ReproductionDialog({
  working,
  onClose,
  onSubmit,
}: {
  working: boolean
  onClose: () => void
  onSubmit: (request: VulnReproductionRequest) => Promise<void>
}) {
  const isDesktop = Boolean(window.go?.main?.App)
  const [request, setRequest] = useState<VulnReproductionRequest>(() => isDesktop ? emptyReproductionRequest() : demoReproductionRequest())

  const canSubmit = useMemo(() => (
    request.triggerSha256.trim().length === 64 &&
    request.triggerSize > 0 &&
    request.runs.every(run => run.sanitizerLog.trim().length > 0) &&
    request.cleanRunAttested &&
    request.attestation.trim().length >= 12
  ), [request])

  const updateRun = (index: number, sanitizerLog: string) => {
    setRequest(current => ({
      ...current,
      runs: current.runs.map((run, runIndex) => runIndex === index ? { ...run, sanitizerLog } : run),
    }))
  }

  return (
    <ModalShell title="导入外部复现证据" description="只保存日志、环境指纹和样本哈希；不会接收或执行触发样本。" onClose={onClose}>
      <div className="grid grid-cols-[1fr_130px] gap-3">
        <Field label="触发样本 SHA-256">
          <input
            value={request.triggerSha256}
            onChange={event => setRequest(current => ({ ...current, triggerSha256: event.target.value.trim().toLowerCase() }))}
            className="vuln-input font-mono"
            placeholder="64 位小写十六进制哈希"
          />
        </Field>
        <Field label="字节数">
          <input
            type="number"
            min={1}
            max={4096}
            value={request.triggerSize || ''}
            onChange={event => setRequest(current => ({ ...current, triggerSize: Number(event.target.value) }))}
            className="vuln-input"
          />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="编译器">
          <input value={request.environment.compiler} onChange={event => setRequest(current => ({ ...current, environment: { ...current.environment, compiler: event.target.value } }))} className="vuln-input" />
        </Field>
        <Field label="Sanitizer">
          <input value={request.environment.sanitizer} onChange={event => setRequest(current => ({ ...current, environment: { ...current.environment, sanitizer: event.target.value } }))} className="vuln-input" />
        </Field>
        <Field label="操作系统">
          <input value={request.environment.os} onChange={event => setRequest(current => ({ ...current, environment: { ...current.environment, os: event.target.value } }))} className="vuln-input" />
        </Field>
        <Field label="架构">
          <input value={request.environment.architecture} onChange={event => setRequest(current => ({ ...current, environment: { ...current.environment, architecture: event.target.value } }))} className="vuln-input" />
        </Field>
      </div>
      <div className="mt-4 space-y-3">
        {request.runs.map((run, index) => (
          <Field key={run.number} label={`运行 ${run.number} · Sanitizer 日志`}>
            <textarea
              value={run.sanitizerLog}
              onChange={event => updateRun(index, event.target.value)}
              className="vuln-input min-h-[82px] resize-y font-mono leading-5"
              placeholder="粘贴本次独立进程的完整 Sanitizer 日志"
            />
          </Field>
        ))}
      </div>
      <label className="mt-4 flex items-start gap-3 rounded-xl border border-[#dfe2d5] bg-[#f7f9f1] p-3">
        <input
          type="checkbox"
          checked={request.cleanRunAttested}
          onChange={event => setRequest(current => ({ ...current, cleanRunAttested: event.target.checked }))}
          className="mt-0.5 size-4 accent-[#6e823e]"
        />
        <span className="text-[12px] leading-5 text-[#50554b]">我确认这些日志来自三个独立、干净、仅针对项目内置 fixture 的本地进程。</span>
      </label>
      <Field label="确认说明" className="mt-3">
        <input value={request.attestation} onChange={event => setRequest(current => ({ ...current, attestation: event.target.value }))} className="vuln-input" placeholder="说明日志来源与进程隔离方式" />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-xl border border-[#d8d9d3] px-4 text-[12px] font-medium text-[#555950] hover:bg-[#f4f4f1]">取消</button>
        <button
          type="button"
          disabled={!canSubmit || working}
          onClick={() => void onSubmit(request)}
          className="h-10 rounded-xl bg-[#10261d] px-5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {working ? '正在核验…' : '保存并运行评估器'}
        </button>
      </div>
    </ModalShell>
  )
}

function LearningDialog({
  working,
  onClose,
  onSubmit,
}: {
  working: boolean
  onClose: () => void
  onSubmit: (request: VulnLearningRecordRequest) => Promise<void>
}) {
  const [kind, setKind] = useState<VulnLearningRecordRequest['kind']>('reflection')
  const [content, setContent] = useState('')

  return (
    <ModalShell title="记录学习复盘" description="Human Outcome 只记录可观察的学习行为，不由 Agent 自报。" onClose={onClose}>
      <div className="grid grid-cols-3 gap-2">
        {([
          ['reflection', '根因复盘'],
          ['independent_step', '独立步骤'],
          ['variant', '变体实验'],
        ] as const).map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setKind(value)}
            className={`h-10 rounded-xl border text-[12px] font-medium ${
              kind === value ? 'border-[#8ea15f] bg-[#eff3e2] text-[#4b5f2d]' : 'border-[#dcddd7] text-[#686b64] hover:bg-[#f6f6f3]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Field label="你的记录" className="mt-4">
        <textarea
          value={content}
          onChange={event => setContent(event.target.value)}
          className="vuln-input min-h-[150px] resize-y leading-6"
          placeholder="用自己的话解释根因，或记录你独立完成的判断与变体实验。"
        />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-xl border border-[#d8d9d3] px-4 text-[12px] font-medium text-[#555950] hover:bg-[#f4f4f1]">取消</button>
        <button
          type="button"
          disabled={content.trim().length === 0 || working}
          onClick={() => void onSubmit({ kind, content: content.trim(), concept: 'bounds checking' })}
          className="h-10 rounded-xl bg-[#10261d] px-5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {working ? '正在保存…' : '保存复盘'}
        </button>
      </div>
    </ModalShell>
  )
}

function ModalShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string
  description: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#112017]/35 p-6 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-2xl border border-[#d7d9d1] bg-white p-5 shadow-[0_24px_80px_rgba(10,26,18,.24)]">
        <div className="flex items-start gap-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#2d302b]">{title}</h2>
            <p className="mt-1 text-[12px] leading-5 text-[#777a72]">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto grid size-9 place-items-center rounded-xl border border-[#e0e1dc] text-[#686c64] hover:bg-[#f5f5f2]" aria-label="关闭">
            <Icon name="close" className="size-4" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-medium text-[#555950]">{label}</span>
      {children}
    </label>
  )
}

function emptyReproductionRequest(): VulnReproductionRequest {
  const observedAt = new Date().toISOString()
  return {
    triggerSha256: '',
    triggerSize: 0,
    environment: {
      compiler: '',
      sanitizer: 'AddressSanitizer',
      os: '',
      architecture: '',
    },
    runs: [1, 2, 3].map(number => ({ number, exitCode: 1, sanitizerLog: '', observedAt })),
    cleanRunAttested: false,
    attestation: '',
  }
}

function formatClock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
