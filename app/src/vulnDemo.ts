import type { VulnProjection, VulnReproductionRequest, VulnSummary } from './vulnTypes'

const DEMO_LOG = [
  'ERROR: AddressSanitizer: stack-buffer-overflow',
  'WRITE of size 17 at 0x000000000000 thread T0',
  '#0 parse_packet packet-parser.c:12',
  '#1 main packet-parser.c:24',
  '',
  'Address is located in stack frame of thread T0',
  '  [32, 48) name <== access at offset 48 overflows this variable',
  '',
  'Shadow bytes around the detected address:',
  '  f1 f1 f1 f1 00 00 f2 f2 00 00 00 00',
  '  00 00 00 00 f3 f3 f3 f3 00 00 00 00',
  '',
  'SUMMARY: AddressSanitizer: stack-buffer-overflow in parse_packet',
  'ABORTING',
].join('\n')

export function demoReproductionRequest(): VulnReproductionRequest {
  const now = new Date().toISOString()
  return {
    triggerSha256: 'f1'.repeat(32),
    triggerSize: 19,
    environment: {
      compiler: 'clang 16.0.0',
      sanitizer: 'AddressSanitizer',
      os: 'macOS 14.4 (23E214)',
      architecture: 'arm64',
    },
    runs: [1, 2, 3].map(number => ({
      number,
      exitCode: 1,
      sanitizerLog: DEMO_LOG,
      observedAt: now,
    })),
    cleanRunAttested: true,
    attestation: '我确认这三份日志来自三个独立、干净的本地 fixture 进程。',
  }
}

export function createDemoVulnProjection(complete = false, id: string = crypto.randomUUID()): VulnProjection {
  const createdAt = new Date(Date.now() - 55 * 60_000).toISOString()
  const updatedAt = new Date().toISOString()
  const sourceArtifact = {
    id: `artifact-source-${id}`,
    jobId: id,
    source: 'builtin:vuln/packet-parser/parser.c',
    sha256: '3f1a7c2'.padEnd(64, '0'),
    mediaType: 'text/x-c; charset=utf-8',
    size: 858,
    relativePath: `${id}/3f1a7c2/parser.c`,
  }
  const readmeArtifact = {
    id: `artifact-readme-${id}`,
    jobId: id,
    source: 'builtin:vuln/packet-parser/README.md',
    sha256: 'a3'.repeat(32),
    mediaType: 'text/markdown; charset=utf-8',
    size: 379,
    relativePath: `${id}/a3/readme.md`,
  }
  const staticEvidence = {
    id: `evidence-static-${id}`,
    claim: '本地固定版本源码包含未校验的长度字段到栈缓冲区复制路径',
    observationIds: [`observation-static-${id}`],
    artifactIds: [sourceArtifact.id],
    provenance: 'builtin fixture source reviewed by deterministic MilkSU source inspector',
  }
  const reproductionRequest = demoReproductionRequest()
  const reproductionArtifact = {
    id: `artifact-reproduction-${id}`,
    jobId: id,
    sourceActionId: `action-reproduction-${id}`,
    source: `action:action-reproduction-${id}`,
    sha256: 'b7'.repeat(32),
    mediaType: 'application/vnd.milksu.vuln-reproduction+json',
    size: 2419,
    relativePath: `${id}/b7/reproduction.json`,
  }
  const reproductionEvidence = {
    id: `evidence-reproduction-${id}`,
    claim: '外部复现证据包包含三个独立运行记录与同一 Sanitizer 指纹',
    observationIds: [`observation-reproduction-${id}`],
    artifactIds: [reproductionArtifact.id],
    provenance: 'user-imported local reproduction evidence; trigger bytes were not admitted or executed',
  }

  return {
    contractVersion: 'vuln.milksu.dev/v1alpha1',
    job: {
      id,
      title: 'packet-parser · local-v1',
      role: 'vuln.research',
      collaborationMode: 'copilot',
      status: complete ? 'succeeded' : 'running',
      createdAt,
      updatedAt,
    },
    target: {
      id: `target-${id}`,
      name: 'packet-parser',
      version: 'local-v1',
      component: 'parse_packet(const uint8_t*, size_t)',
      fixture: 'builtin local fixture',
      collaborationMode: 'copilot',
      scope: {
        id: `scope-${id}`,
        source: 'builtin:vuln/packet-parser',
        purpose: 'authorized local vulnerability research learning',
        targets: [{ kind: 'lab', value: 'packet-parser@local-v1' }],
        grantedBy: 'local-user',
        createdAt,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        revocable: true,
      },
      sourceArtifactId: sourceArtifact.id,
      readmeArtifactId: readmeArtifact.id,
      admittedAt: createdAt,
    },
    attackSurface: {
      id: `surface-${id}`,
      entryPoint: 'main → parse_packet',
      input: '用户提供的本地 packet sample',
      dataFlow: '前 2 字节 → declared → memcpy 长度',
      sink: 'memcpy(name, data + 2, declared)',
      sourceLine: 12,
      summary: '本地文件的长度字段到达固定大小栈缓冲区复制操作。',
      recordedAt: createdAt,
      evidenceIds: [staticEvidence.id],
    },
    hypotheses: [{
      id: `hypothesis-${id}`,
      statement: '未验证 payload_len <= sizeof(name) 可能造成栈缓冲区越界写。',
      status: complete ? 'verified_by_external_reproduction_evidence' : 'supported_by_static_evidence',
      rationale: 'name 只有 16 字节，而 declared 由输入前两个字节控制并直接作为 memcpy 长度。',
      nextExperiment: complete
        ? '在不查看原始样本内容的前提下，设计一个长度边界变体并记录预期结果。'
        : '导入三个干净本地进程产生的 Sanitizer 日志与同一触发样本哈希。',
      recordedAt: updatedAt,
      evidenceIds: complete ? [staticEvidence.id, reproductionEvidence.id] : [staticEvidence.id],
    }],
    experiments: [
      {
        id: `step-static-${id}`,
        number: 1,
        name: 'inspect-fixed-source',
        description: '读取固定本地源码并记录攻击面、候选根因与下一步复现要求',
        status: 'completed',
        action: {
          id: `action-static-${id}`,
          stepId: `step-static-${id}`,
          capability: 'vuln.source-review',
          name: 'vuln.inspect_source',
          input: { artifactId: sourceArtifact.id },
          rationale: '先保存并检查版本固定的源码证据。',
          expectedEffect: {
            class: 'read_local',
            idempotencyKey: `vuln:inspect:${sourceArtifact.sha256}`,
            cleanup: 'none',
            approval: 'builtin scope',
            scopeCheck: 'packet-parser@local-v1',
          },
          status: 'completed',
        },
        observations: [{
          id: `observation-static-${id}`,
          actionId: `action-static-${id}`,
          summary: '2 字节长度字段直接控制对 16 字节栈缓冲区的 memcpy 长度。',
          mediaType: 'application/vnd.milksu.source-review+json',
          complete: true,
        }],
        artifactIds: [sourceArtifact.id],
      },
    ],
    reproduction: complete ? {
      id: `reproduction-${id}`,
      triggerSha256: reproductionRequest.triggerSha256,
      triggerSize: reproductionRequest.triggerSize,
      environment: reproductionRequest.environment,
      runs: reproductionRequest.runs,
      stableRuns: 3,
      totalRuns: 3,
      fingerprint: 'addresssanitizer:stack-buffer-overflow:parse_packet',
      summary: '三份外部 ASan 日志都包含一致的 stack-buffer-overflow / parse_packet 指纹；用户确认它们来自三个干净本地进程。',
      cleanRunAttested: true,
      attestation: reproductionRequest.attestation,
      recordedAt: updatedAt,
      evidenceIds: [reproductionEvidence.id],
      artifactIds: [reproductionArtifact.id],
    } : undefined,
    rootCause: {
      id: `rootcause-${id}`,
      summary: '长度字段缺少目标缓冲区上界校验。',
      technicalDetail: 'parse_packet 只验证源数据长度，没有验证 16 字节目标 name 的容量。',
      impact: '固定本地 fixture 中存在输入可控的越界写路径；不推断外部产品影响。',
      exploitability: '未评估；本工作台不开发利用链。',
      sourceLine: 12,
      status: 'static_cause_identified',
      recordedAt: createdAt,
      evidenceIds: [staticEvidence.id],
    },
    artifacts: complete ? [sourceArtifact, readmeArtifact, reproductionArtifact] : [sourceArtifact, readmeArtifact],
    evidence: complete ? [staticEvidence, reproductionEvidence] : [staticEvidence],
    evaluations: complete ? [{
      id: `evaluation-${id}`,
      evaluator: 'vuln-external-reproduction-evidence',
      version: '1',
      verdict: 'pass',
      score: 1,
      summary: '三份外部 ASan 日志的指纹一致，且已记录用户的干净进程确认。',
      evidenceIds: [reproductionEvidence.id],
    }] : [],
    learning: complete ? [{
      id: `learning-${id}`,
      kind: 'reflection',
      content: '长度字段同时受源数据长度和目标缓冲区容量约束；这里只检查了前者。',
      concept: 'bounds checking',
      createdAt: updatedAt,
    }] : [],
    assetVerifications: [],
    humanOutcome: {
      goal: '能解释长度字段为什么越过目标缓冲区，并独立完成一个变体实验。',
      reflectionCount: complete ? 1 : 0,
      independentSteps: complete ? 3 : 0,
      variantCount: 0,
      summary: complete ? '已完成 1 次复盘、3 个独立步骤和 0 个变体实验。' : '尚未记录学习复盘。',
    },
    outcome: complete ? {
      status: 'succeeded',
      summary: '外部三次复现证据已由确定性评估器核验。',
      evaluationId: `evaluation-${id}`,
    } : undefined,
    events: [],
  }
}

export function summarizeDemoVuln(projection: VulnProjection): VulnSummary {
  return {
    id: projection.job.id,
    title: projection.job.title,
    version: projection.target.version,
    status: projection.job.status,
    hypothesisCount: projection.hypotheses.length,
    reproductionState: projection.reproduction
      ? `${projection.reproduction.stableRuns}/${projection.reproduction.totalRuns}`
      : 'awaiting_evidence',
    verdict: projection.evaluations.at(-1)?.verdict,
    updatedAt: projection.job.updatedAt,
  }
}
