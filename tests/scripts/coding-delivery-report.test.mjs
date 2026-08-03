import assert from 'node:assert/strict'
import test from 'node:test'

import { validateCodingDeliveryReport } from '../../scripts/lib/coding-delivery-report.mjs'

const budget = {
  actual: 1,
  limit: 10,
}

const validReport = {
  schemaVersion: 'milksu-coding-delivery/v1alpha1',
  score: 100,
  passed: true,
  runManifest: {
    schemaVersion: 'milksu-run-manifest/v1alpha1',
    task: {
      id: 'coding-delivery/report-cli',
      fixtureDigestSHA256: 'a'.repeat(64),
      requiresExternalNetwork: false,
      requiresProviderCredential: false,
    },
    toolSurface: {
      initialPlan: {
        tools: ['milksu_progress', 'read'],
      },
      goAfterPolicyUpdate: {
        tools: ['bash', 'edit', 'read', 'write'],
      },
    },
    budgets: {
      providerRequests: budget,
      toolCalls: budget,
      reportedTokens: budget,
      elapsedMs: budget,
      externalProviderCostUSD: { actual: 0, limit: 0 },
    },
    privacy: {
      providerCredentialsRead: false,
      providerCredentialsWritten: false,
      externalProviderRequests: 0,
    },
  },
  scoreboard: {
    schemaVersion: 'milksu-agent-scoreboard/v1alpha1',
    candidate: {
      id: 'milksu-coding-runtime',
      taskId: 'coding-delivery/report-cli',
      score: 100,
      passed: true,
    },
    hardGates: {
      resourceBoundary: true,
      workflowCoverage: true,
      planToGo: true,
      backgroundTaskLifecycle: true,
      contextCompaction: true,
      finalDelivery: true,
      providerPlanConsumed: true,
      reliability: true,
      runManifest: true,
    },
    interventions: {
      approvalRequests: 1,
      approvalGrants: 1,
      manualTakeovers: 0,
      rejectedOverreachRequests: 1,
    },
    failures: [
      { class: 'tool_execution_failed', count: 1 },
      { class: 'background_process_timed_out', count: 1 },
      { class: 'turn_cancelled', count: 1 },
    ],
    budgets: {
      providerRequests: budget,
      toolCalls: budget,
      reportedTokens: budget,
      elapsedMs: budget,
      externalProviderCostUSD: { actual: 0, limit: 0 },
    },
    comparisons: [
      {
        id: 'bare-codex-or-pi-baseline',
        status: 'not-run',
        reason: 'Representative baseline runs are tracked separately.',
      },
    ],
  },
}

function clone(value) {
  return structuredClone(value)
}

test('accepts the deterministic coding delivery report contract', () => {
  const result = validateCodingDeliveryReport(clone(validReport))
  assert.deepEqual(result, { ok: true, issues: [] })
})

test('accepts failed reports so the gate can preserve negative evidence', () => {
  const report = clone(validReport)
  report.score = 90
  report.passed = false
  report.scoreboard.candidate.score = 90
  report.scoreboard.candidate.passed = false
  report.scoreboard.hardGates.finalDelivery = false

  const result = validateCodingDeliveryReport(report)

  assert.deepEqual(result, { ok: true, issues: [] })
})

test('rejects a not-run baseline that carries inflated result fields', () => {
  const report = clone(validReport)
  report.scoreboard.comparisons[0].score = 100
  report.scoreboard.comparisons[0].passed = true

  const result = validateCodingDeliveryReport(report)

  assert.equal(result.ok, false)
  assert(result.issues.some(issue => issue.path === 'scoreboard.comparisons[0].score'))
  assert(result.issues.some(issue => issue.path === 'scoreboard.comparisons[0].passed'))
})

test('rejects reports that omit required failure and intervention evidence', () => {
  const report = clone(validReport)
  report.scoreboard.failures = [{ class: 'tool_execution_failed', count: 1 }]
  delete report.scoreboard.interventions.manualTakeovers

  const result = validateCodingDeliveryReport(report)

  assert.equal(result.ok, false)
  assert(result.issues.some(issue => issue.message.includes('background_process_timed_out')))
  assert(result.issues.some(issue => issue.message.includes('turn_cancelled')))
  assert(result.issues.some(issue => issue.path === 'scoreboard.interventions.manualTakeovers'))
})

test('rejects reports that exceed budgets or loosen privacy boundaries', () => {
  const report = clone(validReport)
  report.runManifest.budgets.toolCalls.actual = 11
  report.runManifest.privacy.providerCredentialsRead = true
  report.runManifest.privacy.externalProviderRequests = 1

  const result = validateCodingDeliveryReport(report)

  assert.equal(result.ok, false)
  assert(result.issues.some(issue => issue.path === 'runManifest.budgets.toolCalls'))
  assert(result.issues.some(issue => issue.path === 'runManifest.privacy.providerCredentialsRead'))
  assert(result.issues.some(issue => issue.path === 'runManifest.privacy.externalProviderRequests'))
})

test('rejects passed=true when score is not perfect', () => {
  const report = clone(validReport)
  report.score = 75
  report.scoreboard.candidate.score = 75

  const result = validateCodingDeliveryReport(report)

  assert.equal(result.ok, false)
  assert(result.issues.some(issue => issue.path === 'passed'))
})
