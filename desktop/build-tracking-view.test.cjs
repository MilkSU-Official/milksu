'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const {
  computeTrackingId,
  isStrictIso8601Utc,
  loadBuildTrackingView,
  validateSealedBuildTracking,
} = require('./build-tracking-view.cjs')

async function loadEsmCompute() {
  return import(pathToFileURL(
    path.join(__dirname, '..', 'scripts', 'lib', 'desktop-build-provenance.mjs'),
  ).href)
}

const stableIdentity = {
  channel: 'stable',
  productName: 'MilkSU',
  appId: 'com.milksu.app',
}

const betaIdentity = {
  channel: 'beta',
  productName: 'MilkSU Beta',
  appId: 'com.milksu.app.beta',
}

function sealedFields(overrides = {}) {
  return {
    channel: 'beta',
    productName: 'MilkSU Beta',
    appId: 'com.milksu.app.beta',
    gitBranch: 'agent/ctf-cve-channel-bootstrap',
    gitCommit: 'a34883f13f4ce376c919e05e1aa52b67af93e4cd',
    dirty: true,
    sourceFingerprint: 'ab'.repeat(32),
    buildTime: '2026-08-10T12:00:00.000Z',
    ...overrides,
  }
}

function sealedDoc(overrides = {}) {
  const fields = sealedFields(overrides)
  return {
    schema: 'milksu.build-tracking/v1',
    ...fields,
    trackingId: computeTrackingId(fields),
  }
}

test('CJS computeTrackingId stays byte-identical to ESM packaging helper', async () => {
  const esm = await loadEsmCompute()
  const fields = sealedFields()
  assert.equal(computeTrackingId(fields), esm.computeTrackingId(fields))
  const clean = sealedFields({ dirty: false, sourceFingerprint: '' })
  assert.equal(computeTrackingId(clean), esm.computeTrackingId(clean))
})

test('development shell never forges git commit or tracking id', async () => {
  const view = await loadBuildTrackingView({
    isPackaged: false,
    identity: stableIdentity,
  })
  assert.equal(view.packaged, false)
  assert.equal(view.development, true)
  assert.equal(view.provenanceSource, 'development/unpackaged')
  assert.equal(view.gitBranch, 'development/unpackaged')
  assert.equal(view.gitCommit, '')
  assert.equal(view.trackingId, '')
  assert.equal(view.missing, true)
})

test('packaged shell reads only sealed resources path and validates integrity digest', async () => {
  const doc = sealedDoc()
  const view = await loadBuildTrackingView({
    isPackaged: true,
    resourcesPath: '/App/Contents/Resources',
    identity: betaIdentity,
    readFile: async file => {
      assert.equal(file, '/App/Contents/Resources/build-tracking.json')
      return `${JSON.stringify(doc)}\n`
    },
  })
  assert.equal(view.packaged, true)
  assert.equal(view.development, false)
  assert.equal(view.missing, false)
  assert.equal(view.channel, 'beta')
  assert.equal(view.gitCommit, 'a34883f13f4ce376c919e05e1aa52b67af93e4cd')
  assert.equal(view.trackingId, computeTrackingId(sealedFields()))
})

test('tampered sealed field with old trackingId becomes packaged/invalid with empty git fields', async () => {
  const honest = sealedDoc()
  const tampered = {
    ...honest,
    gitCommit: 'ffffffffffffffffffffffffffffffffffffffff',
    // keep old trackingId so integrity digest fails
  }
  const view = await loadBuildTrackingView({
    isPackaged: true,
    resourcesPath: '/App/Contents/Resources',
    identity: betaIdentity,
    readFile: async () => JSON.stringify(tampered),
  })
  assert.equal(view.packaged, true)
  assert.equal(view.development, false)
  assert.equal(view.missing, true)
  assert.equal(view.provenanceSource, 'packaged/invalid')
  assert.equal(view.gitBranch, '')
  assert.equal(view.gitCommit, '')
  assert.equal(view.trackingId, '')
  assert.notEqual(view.gitBranch, 'development/unpackaged')
  assert.ok(view.validationIssues.some(issue => issue.includes('trackingId')))
})

test('packaged shell with wrong sealed channel is packaged/invalid without development labels', async () => {
  const view = await loadBuildTrackingView({
    isPackaged: true,
    resourcesPath: '/App/Contents/Resources',
    identity: betaIdentity,
    readFile: async () => JSON.stringify(sealedDoc({
      channel: 'stable',
      appId: 'com.milksu.app',
      productName: 'MilkSU',
    })),
  })
  assert.equal(view.provenanceSource, 'packaged/invalid')
  assert.equal(view.gitBranch, '')
  assert.equal(view.gitCommit, '')
  assert.equal(view.trackingId, '')
  assert.equal(view.development, false)
})

test('packaged shell missing sealed resource leaves branch/hash empty', async () => {
  const view = await loadBuildTrackingView({
    isPackaged: true,
    resourcesPath: '/App/Contents/Resources',
    identity: stableIdentity,
    readFile: async () => {
      throw new Error('ENOENT')
    },
  })
  assert.equal(view.packaged, true)
  assert.equal(view.missing, true)
  assert.equal(view.provenanceSource, 'packaged/missing')
  assert.equal(view.gitBranch, '')
  assert.equal(view.gitCommit, '')
  assert.equal(view.trackingId, '')
  assert.equal(view.development, false)
  assert.equal(view.gitBranch, '')
  assert.notEqual(view.gitBranch, 'development/unpackaged')
})

test('buildTime requires strict calendar-valid ISO-8601 UTC', () => {
  assert.equal(isStrictIso8601Utc('2026-08-10T12:00:00.000Z'), true)
  assert.equal(isStrictIso8601Utc('2026-02-30T12:00:00.000Z'), false)
  assert.equal(isStrictIso8601Utc('2026-08-10'), false)
  assert.equal(isStrictIso8601Utc('2026-08-10T12:00:00Z'), false)
  assert.ok(validateSealedBuildTracking(sealedDoc({
    buildTime: '2026-02-30T12:00:00.000Z',
    trackingId: computeTrackingId(sealedFields({ buildTime: '2026-02-30T12:00:00.000Z' })),
  })).some(issue => issue.includes('buildTime')))
})

test('validateSealedBuildTracking rejects short commits and forged integrity digests', () => {
  assert.ok(validateSealedBuildTracking(sealedDoc({
    gitCommit: '1add25e',
    trackingId: 'ff'.repeat(32),
  })).some(issue => issue.includes('gitCommit')))

  const honest = sealedDoc()
  assert.ok(validateSealedBuildTracking({
    ...honest,
    trackingId: 'ff'.repeat(32),
  }).some(issue => issue.includes('trackingId')))
})
