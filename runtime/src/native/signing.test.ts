import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_HOST_BUNDLE_ID, type SigningStatus } from '../computercap/types.ts'
import {
  parseCodesignOutput,
  platformSigningStatus,
  signingSubjectPath,
} from './signing.ts'

const ADHOC_CODESIGN = `
Executable=/Users/dev/MilkSU.app/Contents/MacOS/MilkSU
Identifier=com.milksu.app
Format=app bundle with Mach-O thin (arm64)
Signature=adhoc
TeamIdentifier=not set
`.trim()

const DEVELOPER_ID_CODESIGN = `
Executable=/Applications/MilkSU.app/Contents/MacOS/MilkSU
Identifier=com.milksu.app
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=900 flags=0x10000(runtime) hashes=20+7 location=embedded
Signature size=8982
Authority=Developer ID Application: Example (TEAMID1)
TeamIdentifier=TEAMID1
`.trim()

const CMS_CODESIGN = `
Identifier=com.milksu.app
Signature=CMS
TeamIdentifier=ABCD1234
`.trim()

const INVALID_IDENTIFIER_CODESIGN = `
Identifier=com.milksu.app/invalid
Signature=adhoc
TeamIdentifier=not set
`.trim()

test('signingSubjectPath returns the .app bundle for Contents/MacOS binaries', () => {
  assert.equal(
    signingSubjectPath('/Applications/MilkSU.app/Contents/MacOS/MilkSU'),
    '/Applications/MilkSU.app',
  )
  assert.equal(
    signingSubjectPath('/Applications/MilkSU.app/Contents/MacOS/MilkSU Helper'),
    '/Applications/MilkSU.app',
  )
  assert.equal(
    signingSubjectPath('/Applications//MilkSU.app/Contents/MacOS/MilkSU'),
    '/Applications/MilkSU.app',
  )
  assert.equal(signingSubjectPath('/usr/local/bin/node'), '/usr/local/bin/node')
})

test('parseCodesignOutput reads Identifier, adhoc Signature, and TeamIdentifier', () => {
  const status: SigningStatus = {
    bundleId: DEFAULT_HOST_BUNDLE_ID,
    signature: 'unknown',
    teamIdentifier: 'unknown',
    stableIdentity: false,
  }
  parseCodesignOutput(ADHOC_CODESIGN, status)
  assert.equal(status.bundleId, 'com.milksu.app')
  assert.equal(status.signature, 'adhoc')
  assert.equal(status.teamIdentifier, 'not set')
})

test('parseCodesignOutput treats a non-adhoc Signature line as signed', () => {
  const status: SigningStatus = {
    bundleId: DEFAULT_HOST_BUNDLE_ID,
    signature: 'unknown',
    teamIdentifier: 'unknown',
    stableIdentity: false,
  }
  parseCodesignOutput(CMS_CODESIGN, status)
  assert.equal(status.signature, 'signed')
  assert.equal(status.teamIdentifier, 'ABCD1234')
})

test('parseCodesignOutput ignores an invalid Identifier', () => {
  const status: SigningStatus = {
    bundleId: DEFAULT_HOST_BUNDLE_ID,
    signature: 'unknown',
    teamIdentifier: 'unknown',
    stableIdentity: false,
  }
  parseCodesignOutput(INVALID_IDENTIFIER_CODESIGN, status)
  assert.equal(status.bundleId, DEFAULT_HOST_BUNDLE_ID)
  assert.equal(status.signature, 'adhoc')
})

test('platformSigningStatus on non-darwin is unknown and does not inspect', async () => {
  const status = await platformSigningStatus({
    platform: 'linux',
    env: { MILKSU_DESKTOP_APP_ID: 'com.milksu.app' },
    inspect: async () => {
      throw new Error('codesign must not run off darwin')
    },
  })
  assert.deepEqual(status, {
    bundleId: 'com.milksu.app',
    signature: 'unknown',
    stableIdentity: false,
  })
})

test('platformSigningStatus falls back to com.milksu.app without MILKSU_DESKTOP_APP_ID', async () => {
  const status = await platformSigningStatus({
    platform: 'win32',
    env: {},
  })
  assert.equal(status.bundleId, DEFAULT_HOST_BUNDLE_ID)
  assert.equal(status.signature, 'unknown')
  assert.equal(status.stableIdentity, false)
})

test('platformSigningStatus marks Developer ID output as a stable identity', async () => {
  const status = await platformSigningStatus({
    platform: 'darwin',
    execPath: '/Applications/MilkSU.app/Contents/MacOS/MilkSU',
    env: { MILKSU_DESKTOP_APP_ID: 'com.milksu.app' },
    inspect: async () => DEVELOPER_ID_CODESIGN,
  })
  assert.equal(status.bundleId, 'com.milksu.app')
  assert.equal(status.executablePath, '/Applications/MilkSU.app')
  assert.equal(status.signature, 'signed')
  assert.equal(status.teamIdentifier, 'TEAMID1')
  assert.equal(status.stableIdentity, true)
  assert.equal(status.problem, undefined)
})

test('platformSigningStatus marks adhoc output as unstable', async () => {
  const status = await platformSigningStatus({
    platform: 'darwin',
    execPath: '/Users/dev/MilkSU.app/Contents/MacOS/MilkSU',
    env: { MILKSU_DESKTOP_APP_ID: 'com.milksu.app' },
    inspect: async () => ADHOC_CODESIGN,
  })
  assert.equal(status.signature, 'adhoc')
  assert.equal(status.teamIdentifier, 'not set')
  assert.equal(status.stableIdentity, false)
  assert.match(String(status.problem), /Developer ID/)
})

test('platformSigningStatus treats a failed inspect as unsigned', async () => {
  const status = await platformSigningStatus({
    platform: 'darwin',
    execPath: '/Applications/MilkSU.app/Contents/MacOS/MilkSU',
    env: { MILKSU_DESKTOP_APP_ID: 'com.milksu.app' },
    inspect: async () => {
      throw new Error('code object is not signed at all')
    },
  })
  assert.equal(status.signature, 'unsigned')
  assert.equal(status.stableIdentity, false)
  assert.match(String(status.problem), /codesign/)
})

test('platformSigningStatus treats a successful inspect without Signature= as signed', async () => {
  const status = await platformSigningStatus({
    platform: 'darwin',
    execPath: '/Applications/MilkSU.app/Contents/MacOS/MilkSU',
    env: { MILKSU_DESKTOP_APP_ID: 'com.milksu.app' },
    inspect: async () => 'Identifier=com.milksu.app\nTeamIdentifier=TEAMID1\n',
  })
  assert.equal(status.signature, 'signed')
  assert.equal(status.teamIdentifier, 'TEAMID1')
  assert.equal(status.stableIdentity, true)
})
