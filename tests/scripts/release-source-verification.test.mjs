import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RELEASE_VERIFICATION_SCHEMA,
  RELEASE_VERIFICATION_STEPS,
  buildReleaseWorkflowDispatches,
  validateReleaseSourceState,
  validateReleaseVerificationReceipt,
} from '../../scripts/lib/release-source-verification.mjs'

const state = {
  branch: 'main',
  commit: 'a'.repeat(40),
  originCommit: 'a'.repeat(40),
  trackedStatus: '',
  rootVersion: '26.817.2',
  desktopVersion: '26.817.2',
}

function receipt() {
  return {
    schema: RELEASE_VERIFICATION_SCHEMA,
    passed: true,
    commit: state.commit,
    version: state.rootVersion,
    steps: RELEASE_VERIFICATION_STEPS.map(step => ({ id: step.id, durationMs: 1 })),
  }
}

test('accepts a clean pushed main source with matching package versions', () => {
  assert.deepEqual(validateReleaseSourceState(state), [])
  assert.deepEqual(validateReleaseVerificationReceipt(receipt(), state), [])
})

test('rejects dirty, unpushed or stale verification state', () => {
  const issues = validateReleaseVerificationReceipt(receipt(), {
    ...state,
    originCommit: 'b'.repeat(40),
    trackedStatus: ' M package.json',
  })
  assert(issues.some(issue => issue.includes('origin/main')))
  assert(issues.some(issue => issue.includes('tracked worktree')))

  const stale = receipt()
  stale.steps.pop()
  assert(validateReleaseVerificationReceipt(stale, state)
    .some(issue => issue.includes('canonical suite')))
})

test('dispatches Windows and Linux by default; macOS stays local', () => {
  const dispatches = buildReleaseWorkflowDispatches({
    commit: state.commit,
    version: state.rootVersion,
    uploadRelease: false,
  })
  assert.deepEqual(dispatches.map(dispatch => dispatch.workflow), [
    'windows-release.yml',
    'linux-release.yml',
  ])
  for (const dispatch of dispatches) {
    assert(dispatch.args.includes(`source_commit=${state.commit}`))
  }
})

test('opt-in cloud macOS still uses the same immutable source commit', () => {
  const dispatches = buildReleaseWorkflowDispatches({
    commit: state.commit,
    version: state.rootVersion,
    uploadRelease: false,
    includeMacosCloud: true,
  })
  assert.deepEqual(dispatches.map(dispatch => dispatch.workflow), [
    'macos-release.yml',
    'windows-release.yml',
    'linux-release.yml',
  ])
  assert(dispatches[0].args.includes(`source_commit=${state.commit}`))
  assert(dispatches[0].args.includes('upload_release=false'))
})
