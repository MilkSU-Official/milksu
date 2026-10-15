import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import './domains/vuln.ts'
import { handleOwnedMethod, isOwnedMethod, type HandlerContext } from './handlers.ts'
import { dataDirectory } from './home.ts'
import { persistFeedSnapshot, fetchFeedSnapshot, resolveFeedSnapshotPath } from './vuln/feed.ts'
import { LEARNING_CONTEXT_FILE, writeLearningContext } from './vuln/learning.ts'
import { runPracticeEnvironment, type PracticeCommandRunner } from './vuln/practice.ts'
import { VulnService } from './vuln/service.ts'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'milksu-vuln-'))
}

async function openService(home?: string): Promise<{ home: string; service: VulnService; artifacts: string }> {
  const root = home ?? await tempHome()
  const artifacts = join(root, 'artifacts')
  await mkdir(artifacts, { recursive: true, mode: 0o700 })
  const service = VulnService.open(root, artifacts)
  return { home: root, service, artifacts }
}

function stubCtx(home: string, service: VulnService, hostCall?: HandlerContext['hostCall']): HandlerContext {
  return {
    conversations: {} as HandlerContext['conversations'],
    labJobs: {} as HandlerContext['labJobs'],
    research: {} as HandlerContext['research'],
    engine: {} as HandlerContext['engine'],
    emit: () => {},
    home,
    hostCall,
    vuln: service,
  }
}

test('CVE tracking workspace records learning and reuses the same job', async () => {
  const { service } = await openService()
  try {
    const projection = await service.ensureTrackingWorkspace({
      cveId: ' cve-2023-46604 ',
      title: 'Apache ActiveMQ OpenWire RCE',
      summary: 'User-confirmed advisory reading and dependency impact notes.',
      referenceHref: 'https://nvd.nist.gov/vuln/detail/CVE-2023-46604',
    })
    assert.equal(projection.target.name, 'CVE-2023-46604')
    assert.equal(projection.target.fixture, 'cve-tracking')
    assert.equal(projection.target.scope.targets[0]?.kind, 'origin')
    assert.equal(projection.target.scope.targets[0]?.value, 'https://nvd.nist.gov')
    assert.equal(projection.contractVersion, 'vuln.milksu.dev/v1alpha1')
    assert.equal(projection.job.role, 'vuln.research')
    assert.ok(Array.isArray(projection.learning))
    assert.ok(Array.isArray(projection.events))
    assert.equal(projection.events[0]?.kind, 'job.created')

    const listed = await service.listJobs()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, projection.job.id)
    assert.equal(listed[0].version, 'tracking')
    assert.equal(listed[0].reproductionState, 'awaiting_evidence')

    const got = await service.getJob(projection.job.id)
    assert.equal(got.job.id, projection.job.id)
    assert.equal(got.target.name, 'CVE-2023-46604')

    const recorded = await service.recordLearning(projection.job.id, {
      kind: 'reflection',
      content: '用户确认：公告和补丁版本已核对，当前只记录学习结论，不声明真实资产已验证。',
      concept: 'CVE-2023-46604',
    })
    assert.equal(recorded.learning.length, 1)
    assert.equal(recorded.learning[0].kind, 'reflection')
    assert.equal(recorded.humanOutcome.reflectionCount, 1)

    const reused = await service.ensureTrackingWorkspace({
      cveId: 'CVE-2023-46604',
      title: 'Duplicate request',
    })
    assert.equal(reused.job.id, projection.job.id)
    assert.equal(reused.learning.length, 1)

    const kept = await service.recordLearning(projection.job.id, {
      kind: 'reflection',
      content: '补丁版本另记一条。',
    })
    assert.equal(kept.learning.length, 2)
    const forgotten = await service.forgetLearning(projection.job.id, recorded.learning[0].id)
    assert.equal(forgotten.learning.length, 1)
    assert.equal(forgotten.learning[0].content, '补丁版本另记一条。')
    await assert.rejects(
      () => service.forgetLearning(projection.job.id, recorded.learning[0].id),
      /learning record was not found/,
    )
  } finally {
    service.close()
  }
})

test('asset verification and cancel keep renderer field names', async () => {
  const { service } = await openService()
  try {
    const created = await service.ensureTrackingWorkspace({
      cveId: 'CVE-2023-46604',
      title: 'Apache ActiveMQ OpenWire RCE',
    })
    const projection = await service.recordAssetVerification(created.job.id, {
      name: 'staging activemq broker',
      address: 'tcp://127.0.0.1:61616',
      environment: 'staging',
      status: 'needs_review',
      summary: '用户确认该资产进入影响检查；尚未声明已复现或可被利用。',
    })
    assert.equal(projection.assetVerifications.length, 1)
    const record = projection.assetVerifications[0]
    assert.equal(record.name, 'staging activemq broker')
    assert.equal(record.address, 'tcp://127.0.0.1:61616')
    assert.equal(record.environment, 'staging')
    assert.equal(record.status, 'needs_review')
    await service.cancelJob(created.job.id)
    const cancelled = await service.getJob(created.job.id)
    assert.equal(cancelled.job.status, 'cancelled')
    assert.equal(cancelled.outcome?.status, 'cancelled')
  } finally {
    service.close()
  }
})

test('owned handlers list/get/save through registerOwnedHandlers', async () => {
  const { home, service } = await openService()
  try {
    const ctx = stubCtx(home, service)
    const empty = await handleOwnedMethod(ctx, 'renderer', 'ListVulnJobs', [])
    assert.deepEqual(empty, [])
    assert.equal(isOwnedMethod('ListVulnJobs'), true)
    assert.equal(isOwnedMethod('FetchCISAKEVFeed'), true)
    const saved = await handleOwnedMethod(ctx, 'renderer', 'EnsureVulnTrackingWorkspace', [{
      cveId: 'CVE-2024-3400',
      title: 'PAN-OS',
    }]) as { job: { id: string }; target: { name: string } }
    assert.equal(saved.target.name, 'CVE-2024-3400')
    const listed = await handleOwnedMethod(ctx, 'renderer', 'ListVulnJobs', []) as Array<{ id: string }>
    assert.equal(listed.length, 1)
    const got = await handleOwnedMethod(ctx, 'renderer', 'GetVulnJob', [saved.job.id]) as { job: { id: string } }
    assert.equal(got.job.id, saved.job.id)
  } finally {
    service.close()
  }
})

test('persist feed snapshot writes raw JSON under data/domain/vuln/feed-snapshots', async () => {
  const root = await tempHome()
  const body = '{"vulnerabilities":[{"cveID":"CVE-2024-3400"}]}'
  const download = await persistFeedSnapshot(root, {
    sourceName: 'CISA KEV',
    sourceUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    retrievedAt: '2026-08-04T07:08:09Z',
    lastModified: 'Tue, 04 Aug 2026 07:08:09 GMT',
    httpStatus: 200,
    contentType: 'application/json',
    body,
  })
  assert.ok(download.snapshotPath?.startsWith(join(root, 'domain', 'vuln', 'feed-snapshots', 'cisa-kev')))
  assert.ok(download.snapshotPath && /20260804T070809Z-/.test(download.snapshotPath))
  assert.equal(download.snapshotSizeBytes, Buffer.byteLength(body))
  const saved = await readFile(download.snapshotPath!, 'utf8')
  assert.equal(saved, body)
  const resolved = await resolveFeedSnapshotPath(root, download.snapshotPath!)
  assert.equal(resolved, download.snapshotPath)
})

test('fetch feed snapshot keeps source timing from fixture HTTP server', async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.accept, 'application/json')
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Last-Modified', 'Mon, 03 Aug 2026 18:55:08 GMT')
    response.end('{"title":"CISA Catalog of Known Exploited Vulnerabilities","vulnerabilities":[]}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('listen failed')
  try {
    const download = await fetchFeedSnapshot('CISA KEV', `http://127.0.0.1:${address.port}/`)
    assert.equal(download.sourceName, 'CISA KEV')
    assert.equal(download.retrievedAt, '2026-08-03T18:55:08Z')
    assert.equal(download.httpStatus, 200)
    assert.match(download.body, /Known Exploited/)
  } finally {
    server.close()
  }
})

test('fetch feed snapshot rejects file URLs', async () => {
  await assert.rejects(
    () => fetchFeedSnapshot('local', 'file:///etc/hosts'),
    /unsupported URL scheme "file"/,
  )
})

test('resolve feed snapshot rejects escape and symlink', async () => {
  const root = await tempHome()
  const outside = join(await tempHome(), 'outside.json')
  await writeFile(outside, '{}', { mode: 0o600 })
  await assert.rejects(() => resolveFeedSnapshotPath(root, outside), /escaped/)
  const directory = join(root, 'domain', 'vuln', 'feed-snapshots', 'nvd')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const linkPath = join(directory, '20260804T070809Z-linked.json')
  try {
    await symlink(outside, linkPath)
  } catch {
    return
  }
  await assert.rejects(() => resolveFeedSnapshotPath(root, linkPath), /symlinks/)
})

test('learning context writes LEARNING.md and redacts secrets', async () => {
  const workspace = await tempHome()
  const secret = 'sk-abcdefghijklmnopqrstuv'
  await writeLearningContext(workspace, 'cve-2023-46604', [
    {
      id: 'learning-late',
      kind: 'reflection',
      concept: '补丁版本',
      content: `用户确认公告已核对，密钥是 ${secret}`,
      createdAt: '2026-09-02T00:00:00Z',
    },
    {
      id: 'learning-early',
      kind: 'independent_step',
      content: '先核对受影响版本。',
      createdAt: '2026-09-01T00:00:00Z',
    },
  ])
  const text = await readFile(join(workspace, LEARNING_CONTEXT_FILE), 'utf8')
  assert.equal(text.includes(secret), false)
  assert.ok(text.indexOf('先核对受影响版本') < text.indexOf('公告已核对'))
  assert.ok(text.includes('CVE-2023-46604'))
  assert.ok(text.includes('[redacted]'))
  await writeLearningContext(workspace, 'CVE-2023-46604', [])
  await assert.rejects(() => readFile(join(workspace, LEARNING_CONTEXT_FILE)), /ENOENT/)
})

test('record learning mirrors LEARNING.md into an existing CVE workspace', async () => {
  const { service, artifacts } = await openService()
  try {
    const projection = await service.ensureTrackingWorkspace({
      cveId: 'CVE-2023-46604',
      title: 'ActiveMQ',
    })
    const workspace = join(artifacts, 'CVE', 'CVE-2023-46604')
    await mkdir(workspace, { recursive: true, mode: 0o700 })
    await service.recordLearning(projection.job.id, {
      kind: 'independent_step',
      content: '先核对受影响版本。',
    })
    const text = await readFile(join(workspace, LEARNING_CONTEXT_FILE), 'utf8')
    assert.ok(text.includes('先核对受影响版本'))
  } finally {
    service.close()
  }
})

test('practice start uses compose file and persists evidence without credentials', async () => {
  process.env.OPENAI_API_KEY = 'sk-practice-test-secret12345'
  const directory = await tempHome()
  await writeFile(join(directory, 'docker-compose.yml'), `
services:
  learner:
    image: debian:12-slim
    command: ["sh", "-c", "while true; do sleep 5; done"]
networks:
  default:
    internal: true
`)
  const calls: string[] = []
  const runner: PracticeCommandRunner = {
    executables() {
      return { docker: '/usr/bin/docker', compose: '/usr/bin/docker', prefix: ['compose'] }
    },
    async run(_executable, args) {
      calls.push(args.join(' '))
      const joined = args.join(' ')
      if (joined === 'version --format {{.Server.Version}}') {
        return { output: Buffer.from('29.4.3\n'), exitCode: 0 }
      }
      if (joined.includes(' config --quiet')) return { output: Buffer.alloc(0), exitCode: 0 }
      if (joined.includes(' up --detach --remove-orphans')) {
        return { output: Buffer.from('Container milksu-cve-fixture Started\n'), exitCode: 0 }
      }
      if (joined.includes(' ps --format json')) {
        return {
          output: Buffer.from('{"Name":"milksu-cve-fixture-learner-1","Service":"learner","State":"running","Health":""}\n'),
          exitCode: 0,
        }
      }
      return { output: Buffer.alloc(0), exitCode: 0 }
    },
  }
  const dataDir = await tempHome()
  const report = await runPracticeEnvironment(dataDir, {
    cveId: 'CVE-2023-46604',
    environmentId: 'vulhub-cve-2023-46604',
    directory,
    projectName: 'milksu-cve-fixture',
  }, 'start', runner)
  assert.equal(report.schema, 'milksu-vuln-practice-run/v1')
  assert.equal(report.state, 'running')
  assert.equal(report.gates.dockerAvailable, true)
  assert.equal(report.gates.composeFileValidated, true)
  assert.equal(report.gates.started, true)
  assert.equal(report.gates.noCredentialLeak, true)
  assert.equal(report.containerCount, 1)
  assert.ok(report.evidencePath?.includes(join('domain', 'vuln', 'practice-runs', 'cve-2023-46604')))
  assert.ok(calls.some((item) => item.includes('--project-name milksu-cve-fixture')))
  const evidence = await readFile(report.evidencePath!, 'utf8')
  assert.equal(evidence.includes('sk-practice-test-secret12345'), false)
})

test('ChooseVulnerabilityPracticeDirectory sends host_request dialog', async () => {
  const { home, service } = await openService()
  try {
    const calls: Array<{ method: string; payload?: unknown }> = []
    const ctx = stubCtx(home, service, async (method, payload) => {
      calls.push({ method, payload })
      return '/selected/practice'
    })
    const path = await handleOwnedMethod(ctx, 'renderer', 'ChooseVulnerabilityPracticeDirectory', [])
    assert.equal(path, '/selected/practice')
    assert.equal(calls[0]?.method, 'dialog.openDirectory')
  } finally {
    service.close()
  }
})

test('event store schema is sqlite events plus schema_migrations v1', async () => {
  const { home, service } = await openService()
  try {
    await service.ensureTrackingWorkspace({ cveId: 'CVE-2024-0001', title: 't' })
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(dataDirectory(home), 'runtime', 'events.sqlite3'))
    const history = db.prepare('SELECT version, name FROM schema_migrations').get() as { version: number; name: string }
    assert.equal(Number(history.version), 1)
    assert.equal(history.name, 'create events store')
    const count = db.prepare('SELECT count(*) AS count FROM events').get() as { count: number }
    assert.ok(Number(count.count) >= 2)
    db.close()
  } finally {
    service.close()
  }
})
