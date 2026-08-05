const runManifestSchema = 'milksu-run-manifest/v1alpha1'
const scoreboardSchema = 'milksu-agent-scoreboard/v1alpha1'
const deliveryReportSchema = 'milksu-coding-delivery/v1alpha1'

const allowedBaselineStatuses = new Set(['not-run', 'attempted', 'completed'])
const requiredFailureClasses = [
  'tool_execution_failed',
  'background_process_timed_out',
  'turn_cancelled',
]

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function pushIssue(issues, path, message) {
  issues.push({ path, message })
}

function validateBudgetShape(budgets, issues, basePath) {
  if (!isPlainObject(budgets)) {
    pushIssue(issues, basePath, 'must be an object')
    return
  }
  for (const name of ['providerRequests', 'toolCalls', 'reportedTokens', 'elapsedMs', 'externalProviderCostUSD']) {
    const budget = budgets[name]
    if (!isPlainObject(budget)) {
      pushIssue(issues, `${basePath}.${name}`, 'must be present')
      continue
    }
    if (!isFiniteNumber(budget.actual)) pushIssue(issues, `${basePath}.${name}.actual`, 'must be a finite number')
    if (!isFiniteNumber(budget.limit)) pushIssue(issues, `${basePath}.${name}.limit`, 'must be a finite number')
    if (
      isFiniteNumber(budget.actual)
      && isFiniteNumber(budget.limit)
      && budget.actual > budget.limit
    ) {
      pushIssue(issues, `${basePath}.${name}`, 'actual must not exceed limit')
    }
  }
}

function validateRunManifest(runManifest, issues) {
  if (!isPlainObject(runManifest)) {
    pushIssue(issues, 'runManifest', 'must be an object')
    return
  }
  if (runManifest.schemaVersion !== runManifestSchema) {
    pushIssue(issues, 'runManifest.schemaVersion', `must be ${runManifestSchema}`)
  }
  if (!/^[0-9a-f]{64}$/.test(runManifest.task?.fixtureDigestSHA256 ?? '')) {
    pushIssue(issues, 'runManifest.task.fixtureDigestSHA256', 'must be a SHA-256 hex digest')
  }
  if (!runManifest.task?.id) pushIssue(issues, 'runManifest.task.id', 'must be present')
  if (runManifest.task?.requiresExternalNetwork !== false) {
    pushIssue(issues, 'runManifest.task.requiresExternalNetwork', 'must be false for the deterministic local gate')
  }
  if (runManifest.task?.requiresProviderCredential !== false) {
    pushIssue(issues, 'runManifest.task.requiresProviderCredential', 'must be false for the deterministic local gate')
  }

  const initialTools = runManifest.toolSurface?.initialPlan?.tools
  const goTools = runManifest.toolSurface?.goAfterPolicyUpdate?.tools
  if (!Array.isArray(initialTools) || !initialTools.includes('read')) {
    pushIssue(issues, 'runManifest.toolSurface.initialPlan.tools', 'must include read')
  }
  if (!Array.isArray(goTools)) {
    pushIssue(issues, 'runManifest.toolSurface.goAfterPolicyUpdate.tools', 'must be an array')
  } else {
    for (const name of ['bash', 'edit', 'write']) {
      if (!goTools.includes(name)) {
        pushIssue(issues, 'runManifest.toolSurface.goAfterPolicyUpdate.tools', `must include ${name}`)
      }
    }
  }
  validateBudgetShape(runManifest.budgets, issues, 'runManifest.budgets')

  const privacy = runManifest.privacy
  if (!isPlainObject(privacy)) {
    pushIssue(issues, 'runManifest.privacy', 'must be present')
  } else {
    if (privacy.providerCredentialsRead !== false) {
      pushIssue(issues, 'runManifest.privacy.providerCredentialsRead', 'must be false')
    }
    if (privacy.providerCredentialsWritten !== false) {
      pushIssue(issues, 'runManifest.privacy.providerCredentialsWritten', 'must be false')
    }
    if (privacy.externalProviderRequests !== 0) {
      pushIssue(issues, 'runManifest.privacy.externalProviderRequests', 'must be 0')
    }
  }
}

function validateScoreboard(scoreboard, report, issues) {
  if (!isPlainObject(scoreboard)) {
    pushIssue(issues, 'scoreboard', 'must be an object')
    return
  }
  if (scoreboard.schemaVersion !== scoreboardSchema) {
    pushIssue(issues, 'scoreboard.schemaVersion', `must be ${scoreboardSchema}`)
  }
  if (scoreboard.candidate?.id !== 'milksu-coding-runtime') {
    pushIssue(issues, 'scoreboard.candidate.id', 'must identify the MilkSU runtime candidate')
  }
  if (scoreboard.candidate?.taskId !== report.runManifest?.task?.id) {
    pushIssue(issues, 'scoreboard.candidate.taskId', 'must match runManifest.task.id')
  }
  if (scoreboard.candidate?.score !== report.score) {
    pushIssue(issues, 'scoreboard.candidate.score', 'must match report.score')
  }
  if (scoreboard.candidate?.passed !== report.passed) {
    pushIssue(issues, 'scoreboard.candidate.passed', 'must match report.passed')
  }
  if (!isPlainObject(scoreboard.hardGates)) {
    pushIssue(issues, 'scoreboard.hardGates', 'must be present')
  } else if (Object.values(scoreboard.hardGates).some(value => typeof value !== 'boolean')) {
    pushIssue(issues, 'scoreboard.hardGates', 'all hard gates must be boolean')
  } else if (report.passed === true && Object.values(scoreboard.hardGates).some(value => value !== true)) {
    pushIssue(issues, 'scoreboard.hardGates', 'all hard gates must be true for a passed report')
  }
  validateBudgetShape(scoreboard.budgets, issues, 'scoreboard.budgets')

  if (!Array.isArray(scoreboard.failures)) {
    pushIssue(issues, 'scoreboard.failures', 'must be an array')
  } else {
    for (const failureClass of requiredFailureClasses) {
      if (!scoreboard.failures.some(failure => failure?.class === failureClass)) {
        pushIssue(issues, 'scoreboard.failures', `must include ${failureClass}`)
      }
    }
  }
  if (!isPlainObject(scoreboard.interventions)) {
    pushIssue(issues, 'scoreboard.interventions', 'must be present')
  } else {
    for (const name of ['approvalRequests', 'approvalGrants', 'manualTakeovers', 'rejectedOverreachRequests']) {
      if (!Number.isInteger(scoreboard.interventions[name]) || scoreboard.interventions[name] < 0) {
        pushIssue(issues, `scoreboard.interventions.${name}`, 'must be a non-negative integer')
      }
    }
  }

  if (!Array.isArray(scoreboard.comparisons) || scoreboard.comparisons.length === 0) {
    pushIssue(issues, 'scoreboard.comparisons', 'must include at least one baseline row')
    return
  }
  for (const [index, comparison] of scoreboard.comparisons.entries()) {
    const base = `scoreboard.comparisons[${index}]`
    if (!comparison?.id) pushIssue(issues, `${base}.id`, 'must be present')
    if (!allowedBaselineStatuses.has(comparison?.status)) {
      pushIssue(issues, `${base}.status`, `must be one of ${[...allowedBaselineStatuses].join(', ')}`)
    }
    if (comparison?.status === 'not-run' && typeof comparison.reason !== 'string') {
      pushIssue(issues, `${base}.reason`, 'must explain why the baseline was not run')
    }
    if (comparison?.status === 'not-run') {
      for (const inflatedField of ['score', 'passed', 'solved', 'completedAt']) {
        if (comparison[inflatedField] !== undefined) {
          pushIssue(issues, `${base}.${inflatedField}`, 'must be absent when baseline status is not-run')
        }
      }
    }
  }
}

export function validateCodingDeliveryReport(report) {
  const issues = []
  if (!isPlainObject(report)) {
    return {
      ok: false,
      issues: [{ path: 'report', message: 'must be an object' }],
    }
  }
  if (report.schemaVersion !== deliveryReportSchema) {
    pushIssue(issues, 'schemaVersion', `must be ${deliveryReportSchema}`)
  }
  if (!isFiniteNumber(report.score) || report.score < 0 || report.score > 100) {
    pushIssue(issues, 'score', 'must be a number from 0 to 100')
  }
  if (typeof report.passed !== 'boolean') {
    pushIssue(issues, 'passed', 'must be boolean')
  }
  if (report.passed === true && report.score !== 100) {
    pushIssue(issues, 'passed', 'must not be true unless score is 100')
  }
  validateRunManifest(report.runManifest, issues)
  validateScoreboard(report.scoreboard, report, issues)
  return {
    ok: issues.length === 0,
    issues,
  }
}

export function assertValidCodingDeliveryReport(report) {
  const validation = validateCodingDeliveryReport(report)
  if (!validation.ok) {
    const details = validation.issues
      .map(issue => `${issue.path}: ${issue.message}`)
      .join('\n')
    throw new Error(`invalid coding delivery report\n${details}`)
  }
  return report
}
