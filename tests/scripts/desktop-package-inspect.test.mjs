import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  BETA_APP_ID,
  BETA_PRODUCT_NAME,
  STABLE_APP_ID,
  STABLE_PRODUCT_NAME,
  resolveDesktopStartPlan,
  packagedAppPath,
} from '../../scripts/lib/desktop-channel.mjs'
import {
  BUILD_TRACKING_SCHEMA,
  computeTrackingId,
  writeBuildTrackingFile,
} from '../../scripts/lib/desktop-build-provenance.mjs'
import {
  codesignExecutablePathIssues,
  inspectCodesignExecutablePaths,
  inspectPackagedApp,
} from '../../scripts/lib/desktop-package-inspect.mjs'

const execFileAsync = promisify(execFile)
const root = join(tmpdir(), 'milksu-package-inspect-root')

function trackingFor(channel, overrides = {}) {
  const productName = channel === 'beta' ? BETA_PRODUCT_NAME : STABLE_PRODUCT_NAME
  const appId = channel === 'beta' ? BETA_APP_ID : STABLE_APP_ID
  const base = {
    schema: BUILD_TRACKING_SCHEMA,
    channel,
    productName,
    appId,
    gitBranch: 'agent/ctf-cve-channel-bootstrap',
    gitCommit: 'a34883f13f4ce376c919e05e1aa52b67af93e4cd',
    dirty: true,
    sourceFingerprint: 'ab'.repeat(32),
    buildTime: '2026-08-10T12:00:00.000Z',
    ...overrides,
  }
  return {
    ...base,
    trackingId: computeTrackingId(base),
  }
}

async function writeMinimalApp({
  channel = 'beta',
  productName,
  appId,
  tracking,
  iconName = 'app.icns',
  executableName,
  mutateAfterSign,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'milksu-min-app-'))
  const name = productName || (channel === 'beta' ? BETA_PRODUCT_NAME : STABLE_PRODUCT_NAME)
  const id = appId || (channel === 'beta' ? BETA_APP_ID : STABLE_APP_ID)
  const execName = executableName || name
  const appPath = join(dir, `${name}.app`)
  const contents = join(appPath, 'Contents')
  const macos = join(contents, 'MacOS')
  const resources = join(contents, 'Resources')
  await mkdir(macos, { recursive: true })
  await mkdir(resources, { recursive: true })
  await writeFile(join(macos, execName), '#!/bin/sh\necho milksu-fixture\n', 'utf8')
  await chmod(join(macos, execName), 0o755)
  await writeFile(join(resources, iconName), 'icns-fixture', 'utf8')
  // TCC-bearing Go runtime must exist and share the channel codesign identifier.
  const backendName = 'milksu-backend'
  await writeFile(join(resources, backendName), '#!/bin/sh\necho backend\n', 'utf8')
  await chmod(join(resources, backendName), 0o755)
  await execFileAsync('/usr/bin/codesign', [
    '--force',
    '--sign', '-',
    '--identifier', id,
    join(resources, backendName),
  ])
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${id}</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleExecutable</key><string>${execName}</string>
  <key>CFBundleIconFile</key><string>${iconName.replace(/\\.icns$/u, '')}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`
  await writeFile(join(contents, 'Info.plist'), plist, 'utf8')
  const doc = tracking || trackingFor(channel, { productName: name, appId: id })
  await writeBuildTrackingFile(join(resources, 'build-tracking.json'), doc)
  await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', appPath])
  if (typeof mutateAfterSign === 'function') {
    await mutateAfterSign({ appPath, resources, contents })
  }
  return { dir, appPath, tracking: doc }
}

test('inspectPackagedApp accepts ad-hoc signed minimal beta app with sealed tracking', async () => {
  const { dir, appPath } = await writeMinimalApp({ channel: 'beta' })
  try {
    const result = await inspectPackagedApp(appPath, 'beta')
    assert.equal(result.ok, true, result.issues.join('; '))
    assert.equal(result.plist.bundleId, BETA_APP_ID)
    assert.equal(result.tracking.channel, 'beta')
    assert.equal(result.codesign.identifier, BETA_APP_ID)
    assert.equal(result.backend?.identifier, BETA_APP_ID)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspectPackagedApp rejects milksu-backend codesign Identifier a.out', async () => {
  const { dir, appPath } = await writeMinimalApp({
    channel: 'stable',
    mutateAfterSign: async ({ appPath: path, resources }) => {
      const backend = join(resources, 'milksu-backend')
      // Re-sign without --identifier so codesign falls back to a.out-like identity.
      await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'a.out', backend])
      await execFileAsync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', path])
    },
  })
  try {
    const result = await inspectPackagedApp(appPath, 'stable')
    assert.equal(result.ok, false)
    assert.ok(
      result.issues.some(issue => issue.includes('milksu-backend codesign Identifier expected')),
      result.issues.join('; '),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspectPackagedApp rejects wrong expected channel and wrong bundle id', async () => {
  const { dir, appPath } = await writeMinimalApp({ channel: 'beta' })
  try {
    const wrongChannel = await inspectPackagedApp(appPath, 'stable')
    assert.equal(wrongChannel.ok, false)
    assert.ok(wrongChannel.issues.some(issue => /channel|CFBundleIdentifier|Identifier/i.test(issue)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  // Wrong CFBundleIdentifier must fail even if the bundle is re-signed after mutation.
  const fixture = await writeMinimalApp({ channel: 'beta' })
  try {
    const fs = await import('node:fs/promises')
    const plistPath = join(fixture.appPath, 'Contents', 'Info.plist')
    let plist = await fs.readFile(plistPath, 'utf8')
    plist = plist.replaceAll(BETA_APP_ID, 'com.example.notmilksu')
    await fs.writeFile(plistPath, plist)
    const trackingPath = join(fixture.appPath, 'Contents', 'Resources', 'build-tracking.json')
    const raw = JSON.parse(await fs.readFile(trackingPath, 'utf8'))
    raw.appId = 'com.example.notmilksu'
    raw.trackingId = computeTrackingId(raw)
    await fs.writeFile(trackingPath, `${JSON.stringify(raw, null, 2)}\n`)
    await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', fixture.appPath])
    const result = await inspectPackagedApp(fixture.appPath, 'beta')
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(issue => /CFBundleIdentifier|Identifier|appId/i.test(issue)))
  } finally {
    await rm(fixture.dir, { recursive: true, force: true })
  }
})

test('inspectPackagedApp rejects tampered sealed tracking after codesign', async () => {
  const { dir, appPath } = await writeMinimalApp({
    channel: 'beta',
    mutateAfterSign: async ({ resources }) => {
      const path = join(resources, 'build-tracking.json')
      const raw = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'))
      raw.gitCommit = 'ffffffffffffffffffffffffffffffffffffffff'
      // keep old trackingId so integrity digest fails
      await (await import('node:fs/promises')).writeFile(path, `${JSON.stringify(raw, null, 2)}\n`)
    },
  })
  try {
    const result = await inspectPackagedApp(appPath, 'beta')
    assert.equal(result.ok, false)
    // Either codesign seal breaks or tracking integrity fails (both acceptable refusals).
    assert.ok(result.issues.length >= 1)
    assert.ok(
      result.issues.some(issue =>
        /codesign --verify|trackingId|build tracking|gitCommit/i.test(issue),
      ),
      result.issues.join('; '),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspectPackagedApp rejects missing build-tracking resource', async () => {
  const { dir, appPath } = await writeMinimalApp({
    channel: 'stable',
    mutateAfterSign: async ({ resources }) => {
      await rm(join(resources, 'build-tracking.json'), { force: true })
    },
  })
  try {
    const result = await inspectPackagedApp(appPath, 'stable')
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(issue => /build tracking missing|codesign --verify/i.test(issue)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspectPackagedApp rejects invalid expected channel without silent stable fallback', async () => {
  const { dir, appPath } = await writeMinimalApp({ channel: 'beta' })
  try {
    const result = await inspectPackagedApp(appPath, 'canary')
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(issue => /unsupported desktop channel|channel is required/i.test(issue)))
    assert.equal(result.channel, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function rewritePlistString(plistPath, key, value) {
  let plist = await readFile(plistPath, 'utf8')
  const pattern = new RegExp(
    `(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`,
    'u',
  )
  assert.match(plist, pattern, `plist missing ${key}`)
  plist = plist.replace(pattern, `$1${value}$3`)
  await writeFile(plistPath, plist, 'utf8')
}

test('inspectPackagedApp rejects CFBundleName or DisplayName mismatch after re-sign', async () => {
  const nameFixture = await writeMinimalApp({ channel: 'beta' })
  try {
    const plistPath = join(nameFixture.appPath, 'Contents', 'Info.plist')
    await rewritePlistString(plistPath, 'CFBundleName', 'Not MilkSU Beta')
    await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', nameFixture.appPath])
    const result = await inspectPackagedApp(nameFixture.appPath, 'beta')
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(issue => /CFBundleName expected MilkSU Beta/i.test(issue)), result.issues.join('; '))
  } finally {
    await rm(nameFixture.dir, { recursive: true, force: true })
  }

  const displayFixture = await writeMinimalApp({ channel: 'beta' })
  try {
    const plistPath = join(displayFixture.appPath, 'Contents', 'Info.plist')
    await rewritePlistString(plistPath, 'CFBundleDisplayName', 'Not MilkSU Beta')
    await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', displayFixture.appPath])
    const result = await inspectPackagedApp(displayFixture.appPath, 'beta')
    assert.equal(result.ok, false)
    assert.ok(
      result.issues.some(issue => /CFBundleDisplayName expected MilkSU Beta/i.test(issue)),
      result.issues.join('; '),
    )
  } finally {
    await rm(displayFixture.dir, { recursive: true, force: true })
  }
})

test('inspectPackagedApp rejects non-executable CFBundleExecutable', async () => {
  const { dir, appPath } = await writeMinimalApp({ channel: 'beta' })
  try {
    const execPath = join(appPath, 'Contents', 'MacOS', BETA_PRODUCT_NAME)
    await chmod(execPath, 0o644)
    await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', appPath])
    const result = await inspectPackagedApp(appPath, 'beta')
    assert.equal(result.ok, false)
    assert.ok(
      result.issues.some(issue => /CFBundleExecutable is not executable/i.test(issue)),
      result.issues.join('; '),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('codesignExecutablePathIssues compares already-canonical paths exactly', () => {
  const expected = '/private/var/folders/x/MilkSU Beta.app/Contents/MacOS/MilkSU Beta'
  assert.deepEqual(codesignExecutablePathIssues(expected, expected), [])

  // Pure helper does not special-case /var vs /private/var; that is inspector realpath's job.
  const varForm = '/var/folders/x/MilkSU Beta.app/Contents/MacOS/MilkSU Beta'
  assert.ok(
    codesignExecutablePathIssues(varForm, expected).some(issue =>
      issue.includes('codesign Executable must equal'),
    ),
  )

  const outsideLookalike = `/evil/prefix${expected}`
  assert.ok(
    codesignExecutablePathIssues(outsideLookalike, expected).some(issue =>
      issue.includes('codesign Executable must equal'),
    ),
  )
})

test('inspectCodesignExecutablePaths accepts /var and /private/var for the same real file', async () => {
  const { dir, appPath } = await writeMinimalApp({ channel: 'beta' })
  try {
    const expectedLogical = resolvePath(appPath, 'Contents', 'MacOS', BETA_PRODUCT_NAME)
    const expectedReal = await (await import('node:fs/promises')).realpath(expectedLogical)
    // macOS often reports one form via tmpdir and the other via codesign/realpath.
    const varForm = expectedReal.startsWith('/private/var/')
      ? expectedReal.slice('/private'.length)
      : expectedReal.startsWith('/var/')
        ? `/private${expectedReal}`
        : expectedReal

    // Both logical appPath and an alternate /var|/private/var spelling of the same
    // executable must pass after realpath — without substring matching.
    const okSame = await inspectCodesignExecutablePaths(expectedReal, appPath, BETA_PRODUCT_NAME)
    assert.deepEqual(okSame, [], okSame.join('; '))

    if (varForm !== expectedReal) {
      const okAlias = await inspectCodesignExecutablePaths(varForm, appPath, BETA_PRODUCT_NAME)
      assert.deepEqual(okAlias, [], okAlias.join('; '))
    }

    // True outside lookalike path that merely embeds the app path string still fails.
    const outsideDir = await mkdtemp(join(tmpdir(), 'milksu-exec-lookalike-'))
    const decoyApp = join(outsideDir, 'MilkSU Beta.app', 'Contents', 'MacOS')
    await mkdir(decoyApp, { recursive: true })
    const decoyExec = join(decoyApp, BETA_PRODUCT_NAME)
    await writeFile(decoyExec, '#!/bin/sh\necho decoy\n', 'utf8')
    await chmod(decoyExec, 0o755)
    const outsideIssues = await inspectCodesignExecutablePaths(
      decoyExec,
      appPath,
      BETA_PRODUCT_NAME,
    )
    assert.ok(
      outsideIssues.some(issue => issue.includes('codesign Executable must equal')),
      outsideIssues.join('; '),
    )
    await rm(outsideDir, { recursive: true, force: true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspectPackagedApp accepts temp app when codesign reports /private/var path form', async () => {
  // Regression for reviewer machine: tmpdir may be /var/folders while codesign -dv
  // returns /private/var/folders for the same inode.
  const { dir, appPath } = await writeMinimalApp({ channel: 'beta' })
  try {
    const result = await inspectPackagedApp(appPath, 'beta')
    assert.equal(result.ok, true, result.issues.join('; '))
    assert.ok(result.codesign?.executable)
    const expectedLogical = resolvePath(appPath, 'Contents', 'MacOS', BETA_PRODUCT_NAME)
    const expectedReal = await (await import('node:fs/promises')).realpath(expectedLogical)
    const reportedReal = await (await import('node:fs/promises')).realpath(result.codesign.executable)
    assert.equal(reportedReal, expectedReal)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('start:beta plan refuses missing/unverified package and never builds', () => {
  const missing = resolveDesktopStartPlan('beta', {
    root,
    packagedAppExists: false,
  })
  assert.equal(missing.mode, 'refuse')
  assert.equal(missing.needsBuild, false)
  assert.equal(missing.forbidsElectronDot, true)
  assert.equal(missing.command, '')
  assert.match(missing.refuseReason, /never builds/i)

  const unverified = resolveDesktopStartPlan('beta', {
    root,
    packagedAppExists: true,
    identityVerified: false,
    identityIssues: ['codesign --verify --deep --strict failed'],
  })
  assert.equal(unverified.mode, 'refuse')
  assert.equal(unverified.needsBuild, false)
  assert.match(unverified.refuseReason, /identity|codesign/i)

  const ready = resolveDesktopStartPlan('beta', {
    root,
    packagedAppExists: true,
    identityVerified: true,
  })
  assert.equal(ready.mode, 'packaged')
  assert.equal(ready.needsBuild, false)
  assert.deepEqual(ready.args, ['-n', packagedAppPath(root, 'beta')])
  assert.ok(!JSON.stringify(ready).includes('electron .'))
})
