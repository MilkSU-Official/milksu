import type {
  CTFAgentWorkspacePolicy,
  CTFChallengeRequest,
  CTFCollaborationMode,
  CTFProjection,
  CTFSummary,
} from './ctfTypes'

const policies = {
  coach: {
    label: '教练',
    autonomy: 'guided',
    startBehavior: '先陈述你的观察；Agent 每轮只给一个最小必要提示。',
    candidateRule: '用户尚未形成自己的推理前，不主动交付完整解法。',
    allowedTools: [
      'read', 'edit', 'write', 'grep', 'find', 'ls',
      'ctf_capabilities', 'ctf_decode', 'ctf_triage', 'ctf_inspect',
    ],
    budget: { maxTurns: 48, maxWallMinutes: 60, maxWrongSubmissions: 2 },
  },
  copilot: {
    label: '搭档',
    autonomy: 'joint',
    startBehavior: '共同列出假设，一次执行一个可解释实验。',
    candidateRule: '候选必须附带可复核的命令、观察与不确定性。',
    allowedTools: [
      'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
      'ctf_capabilities', 'ctf_decode', 'ctf_triage', 'ctf_inspect',
    ],
    budget: { maxTurns: 36, maxWallMinutes: 50, maxWrongSubmissions: 3 },
  },
  delegate: {
    label: '代理',
    autonomy: 'independent',
    startBehavior: '在授权范围与预算内连续推进，遇到边界或重复失败时停止。',
    candidateRule: '独立候选必须同时交付证据、失败路径和剩余不确定性。',
    allowedTools: [
      'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
      'ctf_capabilities', 'ctf_decode', 'ctf_triage', 'ctf_inspect',
    ],
    budget: { maxTurns: 24, maxWallMinutes: 45, maxWrongSubmissions: 3 },
  },
} as const

function previewPolicy(
  mode: CTFCollaborationMode,
  targets: CTFChallengeRequest['sourceTargets'] = [],
): CTFAgentWorkspacePolicy {
  const policy = policies[mode]
  const allowedTools: string[] = [...policy.allowedTools]
  if (targets.some(target => target.kind === 'origin')) allowedTools.push('ctf_http')
  if (targets.some(target => target.kind === 'socket')) allowedTools.push('ctf_socket')
  return {
    mode,
    ...policy,
    allowedTools,
    budget: { ...policy.budget },
    execution: {
      workspaceOnly: true,
      defaultCommandTimeoutSeconds: 120,
      maxCommandTimeoutSeconds: 300,
      maxToolEventOutputBytes: 60000,
    },
  }
}

export function createPreviewCTFProjection(request: CTFChallengeRequest): CTFProjection {
  const now = new Date().toISOString()
  const id = `ctf-preview-${Date.now()}`
  const policy = previewPolicy(request.collaborationMode, request.sourceTargets)
  return {
    contractVersion: 'ctf-projection.milksu.dev/v1alpha1',
    job: {
      id,
      title: request.title,
      role: 'ctf-challenge',
      collaborationMode: request.collaborationMode,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    },
    challenge: {
      id: `challenge-${id}`,
      title: request.title,
      statement: request.statement,
      category: request.category,
      collaborationMode: request.collaborationMode,
      externalPlatform: request.externalPlatform,
      externalAttemptId: request.externalAttemptId,
      trackName: request.trackName || 'CTF 真实题库训练',
      humanGoal: request.humanGoal || '完成这道题并复述关键证据。',
      source: {
        kind: request.sourceKind || 'local-preview',
        uri: request.sourceUri,
        scope: {
          id: `scope-${id}`,
          source: request.sourceUri || 'browser-preview',
          purpose: 'CTF challenge training',
          targets: request.sourceTargets || [],
          grantedBy: 'user',
          createdAt: now,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          revocable: true,
        },
      },
      materials: [],
      knowledgePoints: request.knowledgePoints,
      agentPolicy: policy,
      judgeType: request.externalPlatform || 'manual',
      judgeVersion: 'browser-preview',
      admittedAt: now,
    },
    attempts: [],
    experiments: [],
    artifacts: [],
    evidence: [],
    evaluations: [],
    agentRuns: [],
    agentCandidates: [],
    submissions: [],
    judgeReceipts: [],
    learning: [],
    humanOutcome: {
      goal: request.humanGoal || '完成这道题并复述关键证据。',
      knowledgePoints: request.knowledgePoints,
      hintCount: 0,
      reflectionCount: 0,
      independentSteps: 0,
      summary: '训练已建立，等待第一条观察。',
    },
    debrief: {
      status: 'in_progress',
      summary: '训练进行中。',
      keyObservations: [],
      failureBranches: [],
      candidates: [],
      knowledgePoints: request.knowledgePoints,
      hintCount: 0,
      reflectionCount: 0,
      independentSteps: 0,
      evidenceCount: 0,
      artifactCount: 0,
      needsReflection: false,
      recommendedNextAction: policy.startBehavior,
    },
    events: [{
      schemaVersion: 1,
      eventId: `event-${id}`,
      jobId: id,
      sequence: 1,
      kind: 'job.created',
      occurredAt: now,
      payload: { source: 'browser-preview' },
    }],
  }
}

export function summarizePreviewCTF(projection: CTFProjection): CTFSummary {
  return {
    id: projection.job.id,
    title: projection.job.title,
    category: projection.challenge.category,
    status: projection.job.status,
    experimentCount: projection.experiments.length,
    verdict: projection.evaluations.at(-1)?.verdict,
    pendingSubmission: projection.agentCandidates.length > projection.submissions.length,
    pendingJudge: projection.submissions.at(-1)?.verdict === 'needs_review'
      || projection.submissions.at(-1)?.verdict === 'inconclusive',
    updatedAt: projection.job.updatedAt,
  }
}
