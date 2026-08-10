import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  BETA_APP_ID,
  BUILD_TRACKING_SCHEMA,
  STABLE_APP_ID,
  collectBuildTracking,
  computeTrackingId,
  fingerprintDirtyTree,
  isStrictIso8601Utc,
  readGitIdentity,
  shouldSkipFingerprintPath,
  validateBuildTracking,
} from '../../scripts/lib/desktop-build-provenance.mjs'

const execFileAsync = promisify(execFile)

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_AUTHOR_NAME: 'MilkSU Test',
      GIT_AUTHOR_EMAIL: 'test@milksu.local',
      GIT_COMMITTER_NAME: 'MilkSU Test',
      GIT_COMMITTER_EMAIL: 'test@milksu.local',
    },
  })
  return stdout.trim()
}

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'milksu-provenance-'))
  await git(root, ['init'])
  await git(root, ['checkout', '-b', 'agent/provenance-fixture'])
  // Keep the fixture clean after commit: ignore build outputs and never leave
  // untracked product files at seed time.
  await writeFile(join(root, '.gitignore'), 'build/\n.tmp/\nnode_modules/\n', 'utf8')
  await writeFile(join(root, 'README.md'), 'seed\n', 'utf8')
  await writeFile(join(root, 'src.txt'), 'alpha\n', 'utf8')
  await writeFile(join(root, 'tool.sh'), '#!/bin/sh\necho tool\n', 'utf8')
  await chmod(join(root, 'tool.sh'), 0o644)
  await mkdir(join(root, 'build'), { recursive: true })
  await writeFile(join(root, 'build', 'noise.bin'), 'build-output\n', 'utf8')
  await git(root, ['add', '.gitignore', 'README.md', 'src.txt', 'tool.sh'])
  await git(root, ['commit', '-m', 'seed'])
  const commit = await git(root, ['rev-parse', 'HEAD'])
  const status = await git(root, ['status', '--porcelain=v1'])
  if (status) {
    throw new Error(`fixture repo is not clean after seed: ${status}`)
  }
  return { root, commit }
}

async function withRepo(run) {
  const repo = await makeRepo()
  try {
    return await run(repo)
  } finally {
    await rm(repo.root, { recursive: true, force: true })
  }
}

test('clean worktree reports branch, full HEAD, clean, empty fingerprint', async () => {
  await withRepo(async ({ root, commit }) => {
    const identity = await readGitIdentity(root)
    assert.equal(identity.branch, 'agent/provenance-fixture')
    assert.equal(identity.commit, commit.toLowerCase())
    assert.equal(identity.commit.length, 40)
    assert.equal(identity.dirty, false)

    const tracking = await collectBuildTracking(root, {
      channel: 'stable',
      productName: 'MilkSU',
      appId: STABLE_APP_ID,
      now: new Date('2026-08-10T12:00:00.000Z'),
    })
    assert.equal(tracking.gitBranch, 'agent/provenance-fixture')
    assert.equal(tracking.gitCommit, commit.toLowerCase())
    assert.equal(tracking.dirty, false)
    assert.equal(tracking.sourceFingerprint, '')
    assert.equal(tracking.channel, 'stable')
    assert.equal(tracking.appId, STABLE_APP_ID)
    assert.equal(tracking.buildTime, '2026-08-10T12:00:00.000Z')
    assert.deepEqual(validateBuildTracking(tracking, {
      expectedChannel: 'stable',
      expectedAppId: STABLE_APP_ID,
    }), [])
    assert.equal(
      tracking.trackingId,
      computeTrackingId(tracking),
    )
  })
})

test('tracked edit, deletion and untracked file change dirty fingerprint', async () => {
  await withRepo(async ({ root, commit }) => {
    const cleanFp = await fingerprintDirtyTree(root, commit)

    await writeFile(join(root, 'src.txt'), 'alpha-edited\n', 'utf8')
    const editedIdentity = await readGitIdentity(root)
    assert.equal(editedIdentity.dirty, true)
    const editedTracking = await collectBuildTracking(root, {
      channel: 'beta',
      productName: 'MilkSU Beta',
      appId: BETA_APP_ID,
      now: new Date('2026-08-10T12:01:00.000Z'),
    })
    assert.equal(editedTracking.dirty, true)
    assert.match(editedTracking.sourceFingerprint, /^[0-9a-f]{64}$/)
    assert.notEqual(editedTracking.sourceFingerprint, cleanFp)
    assert.deepEqual(validateBuildTracking(editedTracking, {
      expectedChannel: 'beta',
      expectedAppId: BETA_APP_ID,
    }), [])
    const afterEditFp = editedTracking.sourceFingerprint

    await rm(join(root, 'src.txt'))
    const deletedTracking = await collectBuildTracking(root, {
      channel: 'beta',
      productName: 'MilkSU Beta',
      appId: BETA_APP_ID,
      now: new Date('2026-08-10T12:02:00.000Z'),
    })
    assert.equal(deletedTracking.dirty, true)
    assert.notEqual(deletedTracking.sourceFingerprint, afterEditFp)
    const afterDeleteFp = deletedTracking.sourceFingerprint

    await writeFile(join(root, 'notes.untracked'), 'hello\n', 'utf8')
    const untrackedTracking = await collectBuildTracking(root, {
      channel: 'beta',
      productName: 'MilkSU Beta',
      appId: BETA_APP_ID,
      now: new Date('2026-08-10T12:03:00.000Z'),
    })
    assert.equal(untrackedTracking.dirty, true)
    assert.notEqual(untrackedTracking.sourceFingerprint, afterDeleteFp)

    // build/ output must not affect fingerprint
    await writeFile(join(root, 'build', 'noise.bin'), 'changed-build-output\n', 'utf8')
    const buildIgnored = await collectBuildTracking(root, {
      channel: 'beta',
      productName: 'MilkSU Beta',
      appId: BETA_APP_ID,
      now: new Date('2026-08-10T12:04:00.000Z'),
    })
    assert.equal(buildIgnored.sourceFingerprint, untrackedTracking.sourceFingerprint)
  })
})

test('symlink fingerprint hashes link target only and never follows outside repo', async () => {
  await withRepo(async ({ root, commit }) => {
    const outside = await mkdtemp(join(tmpdir(), 'milksu-provenance-outside-'))
    try {
      const secretPath = join(outside, 'secret.txt')
      await writeFile(secretPath, 'outside-secret-v1\n', 'utf8')
      const linkPath = join(root, 'escape.link')
      await symlink(secretPath, linkPath)
      await git(root, ['add', 'escape.link'])

      const fp1 = await fingerprintDirtyTree(root, commit)
      assert.match(fp1, /^[0-9a-f]{64}$/)

      // Changing the outside secret content must NOT change the fingerprint.
      await writeFile(secretPath, 'outside-secret-v2-CHANGED\n', 'utf8')
      const fpAfterSecretEdit = await fingerprintDirtyTree(root, commit)
      assert.equal(fpAfterSecretEdit, fp1)

      // Changing the link target string must change the fingerprint.
      const otherOutside = join(outside, 'other.txt')
      await writeFile(otherOutside, 'other\n', 'utf8')
      await rm(linkPath)
      await symlink(otherOutside, linkPath)
      const fpAfterRetarget = await fingerprintDirtyTree(root, commit)
      assert.notEqual(fpAfterRetarget, fp1)

      // Relative in-repo symlink target string is hashed, not followed content.
      await rm(linkPath)
      await symlink('src.txt', linkPath)
      const fpRel = await fingerprintDirtyTree(root, commit)
      await writeFile(join(root, 'src.txt'), 'alpha-but-symlink-not-followed-for-link-entry\n', 'utf8')
      // The symlink entry itself still points at "src.txt"; fingerprint of the
      // symlink row stays the same. Content change of src.txt is a separate path.
      const fpRelSameLink = await fingerprintDirtyTree(root, commit)
      // overall fingerprint changes because src.txt content changed, but that is
      // the file entry — ensure symlink path still did not require reading target.
      assert.notEqual(fpRelSameLink, fpRel)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

test('mode-only executable bit change alters dirty fingerprint', async () => {
  await withRepo(async ({ root, commit }) => {
    const before = await fingerprintDirtyTree(root, commit)
    // chmod only — content unchanged. Git sees typechange/mode as dirty.
    await chmod(join(root, 'tool.sh'), 0o755)
    const identity = await readGitIdentity(root)
    assert.equal(identity.dirty, true, 'executable bit change must dirty the worktree')
    const after = await fingerprintDirtyTree(root, commit)
    assert.notEqual(after, before, 'mode-only change must not collide with previous fingerprint')

    const tracking = await collectBuildTracking(root, {
      channel: 'stable',
      productName: 'MilkSU',
      appId: STABLE_APP_ID,
      now: new Date('2026-08-10T12:10:00.000Z'),
    })
    assert.equal(tracking.dirty, true)
    assert.equal(tracking.sourceFingerprint, after)
    assert.deepEqual(validateBuildTracking(tracking), [])
  })
})

test('detached HEAD is faithful and never blank or forged as main', async () => {
  await withRepo(async ({ root, commit }) => {
    await git(root, ['checkout', '--detach', 'HEAD'])
    const identity = await readGitIdentity(root)
    assert.equal(identity.commit, commit.toLowerCase())
    assert.notEqual(identity.branch, '')
    assert.notEqual(identity.branch, 'main')
    assert.match(identity.branch, /^detached@/)

    const tracking = await collectBuildTracking(root, {
      channel: 'stable',
      productName: 'MilkSU',
      appId: STABLE_APP_ID,
      now: new Date('2026-08-10T12:05:00.000Z'),
    })
    assert.equal(tracking.gitBranch, identity.branch)
    assert.deepEqual(validateBuildTracking(tracking), [])
  })
})

test('validateBuildTracking rejects integrity-digest tampering and mismatched channel/appId', () => {
  const base = {
    schema: BUILD_TRACKING_SCHEMA,
    channel: 'beta',
    productName: 'MilkSU Beta',
    appId: BETA_APP_ID,
    gitBranch: 'agent/ctf-cve-channel-bootstrap',
    gitCommit: 'a34883f13f4ce376c919e05e1aa52b67af93e4cd',
    dirty: true,
    sourceFingerprint: 'ab'.repeat(32),
    buildTime: '2026-08-10T12:00:00.000Z',
  }
  const good = {
    ...base,
    trackingId: computeTrackingId(base),
  }
  assert.deepEqual(validateBuildTracking(good, {
    expectedChannel: 'beta',
    expectedAppId: BETA_APP_ID,
  }), [])

  // trackingId is an integrity digest over declared fields, not a package seal.
  const forgedIntegrityDigest = {
    ...good,
    trackingId: 'ff'.repeat(32),
  }
  assert.ok(
    validateBuildTracking(forgedIntegrityDigest).some(issue => issue.includes('trackingId')),
    'tampered trackingId integrity digest must be rejected even if hex-shaped',
  )

  const shortCommit = {
    ...good,
    gitCommit: '1add25e',
    trackingId: computeTrackingId({ ...base, gitCommit: '1add25e' }),
  }
  assert.ok(validateBuildTracking(shortCommit).some(issue => issue.includes('gitCommit')))

  const wrongChannel = {
    ...good,
    channel: 'stable',
    appId: STABLE_APP_ID,
    productName: 'MilkSU',
    trackingId: computeTrackingId({
      ...base,
      channel: 'stable',
      appId: STABLE_APP_ID,
      productName: 'MilkSU',
    }),
  }
  assert.ok(validateBuildTracking(wrongChannel, {
    expectedChannel: 'beta',
    expectedAppId: BETA_APP_ID,
  }).length >= 1)

  const dirtyNoFp = {
    ...base,
    sourceFingerprint: '',
    trackingId: computeTrackingId({ ...base, sourceFingerprint: '' }),
  }
  assert.ok(
    validateBuildTracking(dirtyNoFp).some(issue => issue.includes('sourceFingerprint')),
  )

  const cleanWithFp = {
    ...base,
    dirty: false,
    sourceFingerprint: 'ab'.repeat(32),
    trackingId: computeTrackingId({
      ...base,
      dirty: false,
      sourceFingerprint: 'ab'.repeat(32),
    }),
  }
  assert.ok(
    validateBuildTracking(cleanWithFp).some(issue => issue.includes('sourceFingerprint')),
  )
})

test('buildTime accepts only strict ISO-8601 UTC from toISOString', () => {
  assert.equal(isStrictIso8601Utc('2026-08-10T12:00:00.000Z'), true)
  assert.equal(isStrictIso8601Utc('2026-08-10'), false)
  assert.equal(isStrictIso8601Utc('2026-08-10T12:00:00Z'), false)
  assert.equal(isStrictIso8601Utc('August 10, 2026'), false)
  assert.equal(isStrictIso8601Utc('2026-08-10 12:00:00'), false)
  assert.equal(isStrictIso8601Utc('2026-08-10T12:00:00.000+00:00'), false)

  const base = {
    schema: BUILD_TRACKING_SCHEMA,
    channel: 'stable',
    productName: 'MilkSU',
    appId: STABLE_APP_ID,
    gitBranch: 'main',
    gitCommit: '1add25ec965ac1f7cd2fcd1993ee2507bd5855b7',
    dirty: false,
    sourceFingerprint: '',
    buildTime: '2026-08-10T12:00:00.000Z',
  }
  const good = { ...base, trackingId: computeTrackingId(base) }
  assert.deepEqual(validateBuildTracking(good), [])

  for (const badTime of [
    '2026-08-10',
    '2026-08-10T12:00:00Z',
    'August 10, 2026',
    '2026/08/10 12:00:00',
  ]) {
    const bad = {
      ...base,
      buildTime: badTime,
      trackingId: computeTrackingId({ ...base, buildTime: badTime }),
    }
    assert.ok(
      validateBuildTracking(bad).some(issue => issue.includes('buildTime')),
      `expected reject for buildTime=${badTime}`,
    )
  }
})

test('shouldSkipFingerprintPath excludes build outputs and app/dist production assets', () => {
  assert.equal(shouldSkipFingerprintPath('app/dist/.gitkeep'), true)
  assert.equal(shouldSkipFingerprintPath('app/dist/index.html'), true)
  assert.equal(shouldSkipFingerprintPath('app/dist/assets/app.js'), true)
  assert.equal(shouldSkipFingerprintPath('build/desktop/appicon-beta.png'), true)
  assert.equal(shouldSkipFingerprintPath('app/src/App.vue'), false)
  assert.equal(shouldSkipFingerprintPath('desktop/main.cjs'), false)
  assert.equal(shouldSkipFingerprintPath('scripts/package-electron.mjs'), false)
})

