import type {
  TaskType, TaskState,
  PentestState, CtfState, ReconState, ReverseState,
  EMPTY_PENTEST as _EP,
} from '../types'
import { TASK_TYPES } from '../types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Shield, Flag, Network, Binary,
  Target, AlertTriangle, CheckCircle2, Circle,
  ChevronRight, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const TASK_ICONS: Record<TaskType, React.ReactNode> = {
  chat: null,
  pentest: <Shield className="size-4" />,
  ctf: <Flag className="size-4" />,
  recon: <Network className="size-4" />,
  reverse: <Binary className="size-4" />,
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-blue-400 text-white',
  info: 'bg-gray-400 text-white',
}

interface Props {
  taskType: TaskType
  taskState?: TaskState
  onClose: () => void
}

export function TaskPanel({ taskType, taskState, onClose }: Props) {
  if (taskType === 'chat') return null

  const typeInfo = TASK_TYPES.find(t => t.id === taskType)
  if (!typeInfo) return null

  return (
    <div className="w-80 h-full border-l border-border flex flex-col bg-sidebar shrink-0">
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2">
          {TASK_ICONS[taskType]}
          <span className="text-sm font-medium">{typeInfo.label}</span>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {taskType === 'pentest' && <PentestPanel state={taskState as PentestState | undefined} phases={typeInfo.phases!} />}
        {taskType === 'ctf' && <CtfPanel state={taskState as CtfState | undefined} phases={typeInfo.phases!} />}
        {taskType === 'recon' && <ReconPanel state={taskState as ReconState | undefined} phases={typeInfo.phases!} />}
        {taskType === 'reverse' && <ReversePanel state={taskState as ReverseState | undefined} phases={typeInfo.phases!} />}
      </div>
    </div>
  )
}


function PhaseTracker({ phases, current }: { phases: string[]; current: number }) {
  return (
    <div className="space-y-1">
      {phases.map((phase, i) => (
        <div key={phase} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs">
          {i < current ? (
            <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
          ) : i === current ? (
            <ChevronRight className="size-3.5 text-primary shrink-0 animate-pulse" />
          ) : (
            <Circle className="size-3.5 text-muted-foreground/30 shrink-0" />
          )}
          <span className={i <= current ? 'text-foreground font-medium' : 'text-muted-foreground'}>{phase}</span>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-xs text-muted-foreground/50 italic px-1">{message}</p>
}


function PentestPanel({ state, phases }: { state?: PentestState; phases: string[] }) {
  const target = state?.target || ''
  const phase = state?.phase ?? 0
  const vulns = state?.vulnerabilities ?? []
  const ports = state?.ports ?? []
  const tools = state?.tools_used ?? []

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Target className="size-3" />
            Target
          </CardTitle>
        </CardHeader>
        <CardContent>
          {target ? (
            <p className="text-sm font-mono">{target}</p>
          ) : (
            <EmptyState message="No target set. Tell the agent what to scan." />
          )}
        </CardContent>
      </Card>

      <div>
        <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Phase</p>
        <PhaseTracker phases={phases} current={phase} />
      </div>

      <Separator />

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest">Vulnerabilities</p>
          {vulns.length > 0 && (
            <Badge variant="outline" className="text-[10px]">{vulns.length}</Badge>
          )}
        </div>
        {vulns.length === 0 ? (
          <EmptyState message="No vulnerabilities discovered yet." />
        ) : (
          <div className="space-y-1.5">
            {vulns.map((v, i) => (
              <div key={i} className="flex items-start gap-2 px-2 py-1.5 bg-muted/50 rounded-md">
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_COLORS[v.severity]}`}>
                  {v.severity}
                </span>
                <span className="text-xs flex-1">{v.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <div>
        <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Open Ports</p>
        {ports.length === 0 ? (
          <EmptyState message="No ports discovered yet." />
        ) : (
          <div className="space-y-1">
            {ports.map((p, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-1 text-xs bg-muted/50 rounded-md">
                <span className="font-mono">{p.port}</span>
                <span className="text-muted-foreground">{p.service}</span>
                <span className={`text-[10px] ${p.state === 'open' ? 'text-emerald-500' : 'text-muted-foreground'}`}>{p.state}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {tools.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Tools Used</p>
            <div className="flex flex-wrap gap-1">
              {tools.map(t => (
                <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}


function CtfPanel({ state, phases }: { state?: CtfState; phases: string[] }) {
  const challenge = state?.challenge || ''
  const category = state?.category || ''
  const points = state?.points
  const flags = state?.flags ?? []
  const solved = state?.solved ?? false

  return (
    <>
      <Card size="sm" className={solved ? 'border-emerald-200 bg-emerald-50/30' : ''}>
        <CardHeader>
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Flag className="size-3" />
            Challenge
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {challenge ? (
            <>
              <p className="text-sm font-medium">{challenge}</p>
              <div className="flex items-center gap-2">
                {category && <Badge variant="secondary" className="text-[10px]">{category}</Badge>}
                {points !== null && <span className="text-xs text-muted-foreground">{points} pts</span>}
              </div>
            </>
          ) : (
            <EmptyState message="No challenge set. Describe the CTF problem." />
          )}
        </CardContent>
      </Card>

      <div>
        <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Progress</p>
        <PhaseTracker phases={phases} current={solved ? phases.length : Math.min(flags.length, phases.length - 1)} />
      </div>

      <Separator />

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest">Flags</p>
          {solved && <Badge className="bg-emerald-500 text-[10px]">Solved</Badge>}
        </div>
        {flags.length === 0 ? (
          <EmptyState message="No flags captured yet." />
        ) : (
          <div className="space-y-1">
            {flags.map((f, i) => (
              <div key={i} className="px-2 py-1.5 bg-muted/50 rounded-md">
                <p className="text-xs font-mono break-all">{f}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}


function ReconPanel({ state, phases }: { state?: ReconState; phases: string[] }) {
  const scope = state?.scope ?? []
  const hosts = state?.hosts ?? []
  const ports = state?.ports ?? []
  const findings = state?.findings ?? []

  const activePhase = ports.length > 0 ? 2 : hosts.length > 0 ? 1 : scope.length > 0 ? 0 : 0

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Network className="size-3" />
            Scope
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scope.length > 0 ? (
            <div className="space-y-0.5">
              {scope.map((s, i) => (
                <p key={i} className="text-xs font-mono">{s}</p>
              ))}
            </div>
          ) : (
            <EmptyState message="No targets in scope. Provide IP ranges or domains." />
          )}
        </CardContent>
      </Card>

      <div>
        <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Phase</p>
        <PhaseTracker phases={phases} current={activePhase} />
      </div>

      <Separator />

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest">Hosts</p>
          {hosts.length > 0 && <Badge variant="outline" className="text-[10px]">{hosts.length}</Badge>}
        </div>
        {hosts.length === 0 ? (
          <EmptyState message="No hosts discovered yet." />
        ) : (
          <div className="space-y-1">
            {hosts.map((h, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-1.5 bg-muted/50 rounded-md text-xs">
                <span className="font-mono">{h.ip}</span>
                {h.hostname && <span className="text-muted-foreground truncate ml-2">{h.hostname}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest">Services</p>
          {ports.length > 0 && <Badge variant="outline" className="text-[10px]">{ports.length}</Badge>}
        </div>
        {ports.length === 0 ? (
          <EmptyState message="No services enumerated yet." />
        ) : (
          <div className="space-y-1">
            {ports.map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded-md text-xs">
                <span className="font-mono shrink-0">{p.host}:{p.port}</span>
                <span className="text-muted-foreground truncate">{p.service}{p.version ? ` ${p.version}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {findings.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Findings</p>
            <div className="space-y-1">
              {findings.map((f, i) => (
                <div key={i} className="flex items-start gap-1.5 px-2 py-1.5 bg-muted/50 rounded-md">
                  <AlertTriangle className="size-3 text-amber-500 shrink-0 mt-0.5" />
                  <span className="text-xs">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}


function ReversePanel({ state, phases }: { state?: ReverseState; phases: string[] }) {
  const binary = state?.binary || ''
  const arch = state?.arch || ''
  const prot = state?.protections ?? { nx: false, canary: false, pie: false, relro: 'none' }
  const functions = state?.functions ?? []
  const findings = state?.findings ?? []

  const activePhase = findings.length > 0 ? 3 : functions.length > 0 ? 2 : binary ? 1 : 0

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Binary className="size-3" />
            Binary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {binary ? (
            <>
              <p className="text-sm font-mono break-all">{binary}</p>
              {arch && <Badge variant="secondary" className="text-[10px]">{arch}</Badge>}
            </>
          ) : (
            <EmptyState message="No binary loaded. Provide a file path." />
          )}
        </CardContent>
      </Card>

      <div>
        <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Phase</p>
        <PhaseTracker phases={phases} current={activePhase} />
      </div>

      <Separator />

      {binary && (
        <>
          <div>
            <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Protections</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: 'NX', on: prot.nx },
                { label: 'Canary', on: prot.canary },
                { label: 'PIE', on: prot.pie },
                { label: `RELRO: ${prot.relro}`, on: prot.relro !== 'none' },
              ].map(p => (
                <div key={p.label} className={`px-2 py-1.5 rounded-md text-xs text-center ${
                  p.on ? 'bg-red-50 text-red-600 font-medium' : 'bg-muted/50 text-muted-foreground'
                }`}>
                  {p.label}
                </div>
              ))}
            </div>
          </div>
          <Separator />
        </>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest">Functions</p>
          {functions.length > 0 && <Badge variant="outline" className="text-[10px]">{functions.length}</Badge>}
        </div>
        {functions.length === 0 ? (
          <EmptyState message="No functions analyzed yet." />
        ) : (
          <div className="space-y-1">
            {functions.map((f, i) => (
              <div key={i} className="px-2 py-1.5 bg-muted/50 rounded-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-medium">{f.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{f.address}</span>
                </div>
                {f.note && <p className="text-[10px] text-muted-foreground mt-0.5">{f.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {findings.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Findings</p>
            <div className="space-y-1">
              {findings.map((f, i) => (
                <div key={i} className="flex items-start gap-1.5 px-2 py-1.5 bg-muted/50 rounded-md">
                  <AlertTriangle className="size-3 text-amber-500 shrink-0 mt-0.5" />
                  <span className="text-xs">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}
