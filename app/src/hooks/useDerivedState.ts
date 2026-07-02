import type { Engagement, TaskType, TaskState, PentestState, ReconState } from '../types'

export function deriveTaskState(engagement: Engagement, taskType: TaskType): TaskState | undefined {
  switch (taskType) {
    case 'pentest': return derivePentest(engagement)
    case 'recon': return deriveRecon(engagement)
    default: return undefined
  }
}

function derivePentest(e: Engagement): PentestState {
  const allHosts = e.targets.flatMap(t => t.hosts)
  const ports = allHosts.flatMap(h =>
    h.services.map(s => ({ port: s.port, service: s.service, state: s.state }))
  )
  const vulnerabilities = allHosts.flatMap(h =>
    h.vulnerabilities.map(v => ({ severity: v.severity, title: v.title, detail: v.description }))
  )
  const tools_used = [...new Set(
    e.attack_paths.flatMap(p => p.steps.map(s => s.tool)).filter(Boolean)
  )]

  return {
    target: e.scope.join(', '),
    phase: 0,
    vulnerabilities,
    ports,
    tools_used,
  }
}

function deriveRecon(e: Engagement): ReconState {
  const allHosts = e.targets.flatMap(t => t.hosts)
  const hosts = allHosts.map(h => ({
    ip: h.ip,
    hostname: h.hostnames[0],
    os: h.os ?? undefined,
  }))
  const ports = allHosts.flatMap(h =>
    h.services.map(s => ({
      host: h.ip,
      port: s.port,
      service: s.service,
      version: s.version ?? undefined,
    }))
  )

  return {
    scope: e.scope,
    hosts,
    ports,
    findings: e.notes,
  }
}
