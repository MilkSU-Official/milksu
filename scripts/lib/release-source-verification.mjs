export const RELEASE_VERIFICATION_SCHEMA = 'milksu.release-source-verification/v1'

export const RELEASE_VERIFICATION_STEPS = Object.freeze([
  Object.freeze({ id: 'go-test', command: 'go', args: ['test', './...'] }),
  Object.freeze({ id: 'app-test', command: 'npm', args: ['--prefix', 'app', 'test'] }),
  Object.freeze({ id: 'sidecar-test', command: 'npm', args: ['run', 'test:sidecar'] }),
  Object.freeze({ id: 'app-lint', command: 'npm', args: ['--prefix', 'app', 'run', 'lint'] }),
  Object.freeze({ id: 'app-build', command: 'npm', args: ['--prefix', 'app', 'run', 'build'] }),
  Object.freeze({ id: 'docs-build', command: 'npm', args: ['run', 'docs:build'] }),
])

const fullCommitPattern = /^[0-9a-f]{40}$/u
const versionPattern = /^\d+\.\d+\.\d+$/u

export function validateReleaseSourceState(state) {
  const issues = []
  if (state.branch !== 'main') issues.push(`branch must be main, got ${state.branch || '<empty>'}`)
  if (!fullCommitPattern.test(state.commit ?? '')) issues.push('HEAD must be a full Git commit')
  if (state.originCommit !== state.commit) issues.push('HEAD must already be pushed to origin/main')
  if (String(state.trackedStatus ?? '').trim()) issues.push('tracked worktree changes must be committed')
  if (!versionPattern.test(state.rootVersion ?? '')) issues.push('root version must be a stable semantic version')
  if (state.desktopVersion !== state.rootVersion) issues.push('root and desktop versions must match')
  return issues
}

export function validateReleaseVerificationReceipt(receipt, state) {
  const issues = validateReleaseSourceState(state)
  if (receipt?.schema !== RELEASE_VERIFICATION_SCHEMA) issues.push('release verification receipt schema is stale')
  if (receipt?.commit !== state.commit) issues.push('release verification receipt belongs to another commit')
  if (receipt?.version !== state.rootVersion) issues.push('release verification receipt belongs to another version')
  if (receipt?.passed !== true) issues.push('release verification receipt is not successful')
  const expectedSteps = RELEASE_VERIFICATION_STEPS.map(step => step.id)
  const actualSteps = Array.isArray(receipt?.steps) ? receipt.steps.map(step => step.id) : []
  if (actualSteps.length !== expectedSteps.length
      || actualSteps.some((step, index) => step !== expectedSteps[index])) {
    issues.push('release verification receipt does not cover the current canonical suite')
  }
  return issues
}

export function buildReleaseWorkflowDispatches({
  commit,
  version,
  uploadRelease = false,
  useSelfHosted = false,
  /** Opt into expensive GitHub-hosted / self-hosted macOS CI. Default: skip; use local macOS release. */
  includeMacosCloud = false,
  releaseTitle = `MilkSU ${version} 内测版`,
  releaseNotes = `MilkSU ${version} 内测版`,
  minimumVersion = '0.1.0',
}) {
  if (!fullCommitPattern.test(commit ?? '')) throw new Error('commit must be a full Git commit')
  const dispatches = []
  if (includeMacosCloud) {
    dispatches.push({
      workflow: 'macos-release.yml',
      args: [
        'workflow', 'run', 'macos-release.yml', '--ref', 'main',
        '-f', `source_commit=${commit}`,
        '-f', `upload_release=${uploadRelease}`,
        '-f', `use_self_hosted=${useSelfHosted}`,
        '-f', `release_title=${releaseTitle}`,
        '-f', `release_notes=${releaseNotes}`,
        '-f', `minimum_version=${minimumVersion}`,
      ],
    })
  }
  dispatches.push(
    {
      workflow: 'windows-release.yml',
      args: [
        'workflow', 'run', 'windows-release.yml', '--ref', 'main',
        '-f', `source_commit=${commit}`,
      ],
    },
    {
      workflow: 'linux-release.yml',
      args: [
        'workflow', 'run', 'linux-release.yml', '--ref', 'main',
        '-f', `source_commit=${commit}`,
      ],
    },
  )
  return dispatches
}
