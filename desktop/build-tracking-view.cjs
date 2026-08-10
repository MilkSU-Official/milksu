'use strict'

/**
 * Renderer-facing build tracking view for Settings / chrome.
 * Packaged apps read only the sealed Resources/build-tracking.json.
 * Development shells never invent git/hash/tracking values.
 *
 * trackingId is a canonical-field integrity digest only — not a package
 * authenticity signature. Must match scripts/lib/desktop-build-provenance.mjs.
 */

const path = require('node:path')
const { createHash } = require('node:crypto')
const { promises: fs } = require('node:fs')

const BUILD_TRACKING_RESOURCE = 'build-tracking.json'
const BUILD_TRACKING_SCHEMA = 'milksu.build-tracking/v1'
const FULL_SHA = /^[0-9a-f]{40}$/
const FINGERPRINT_SHA = /^[0-9a-f]{64}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const CHANNELS = new Set(['stable', 'beta'])

/**
 * Canonical tracking id — must stay byte-identical to the ESM packaging helper.
 * Integrity check only; not a source-authenticity signature.
 * @param {{
 *   channel: string,
 *   productName: string,
 *   appId: string,
 *   gitBranch: string,
 *   gitCommit: string,
 *   dirty: boolean,
 *   sourceFingerprint: string,
 *   buildTime: string,
 * }} fields
 */
function computeTrackingId(fields) {
  const channel = String(fields.channel ?? '').trim().toLowerCase()
  const productName = String(fields.productName ?? '').trim()
  const appId = String(fields.appId ?? '').trim()
  const gitBranch = String(fields.gitBranch ?? '').trim()
  const gitCommit = String(fields.gitCommit ?? '').trim().toLowerCase()
  const dirty = fields.dirty === true
  const sourceFingerprint = dirty
    ? String(fields.sourceFingerprint ?? '').trim().toLowerCase()
    : ''
  const buildTime = String(fields.buildTime ?? '').trim()
  const payload = [
    `schema=${BUILD_TRACKING_SCHEMA}`,
    `channel=${channel}`,
    `productName=${productName}`,
    `appId=${appId}`,
    `gitBranch=${gitBranch}`,
    `gitCommit=${gitCommit}`,
    `dirty=${dirty ? '1' : '0'}`,
    `sourceFingerprint=${sourceFingerprint}`,
    `buildTime=${buildTime}`,
  ].join('\n')
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * @param {string} value
 */
function isStrictIso8601Utc(value) {
  const text = String(value ?? '').trim()
  if (!ISO_UTC.test(text)) return false
  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return false
  return new Date(parsed).toISOString() === text
}

/**
 * @param {unknown} value
 * @param {{ expectedChannel?: string, expectedAppId?: string, expectedProductName?: string }} [options]
 * @returns {string[]}
 */
function validateSealedBuildTracking(value, options = {}) {
  const issues = []
  if (!value || typeof value !== 'object') return ['build tracking document is missing']
  const doc = value
  if (doc.schema !== BUILD_TRACKING_SCHEMA) {
    issues.push(`schema must be ${BUILD_TRACKING_SCHEMA}`)
  }
  const channel = String(doc.channel ?? '').trim().toLowerCase()
  if (!CHANNELS.has(channel)) issues.push(`channel must be stable|beta, got ${doc.channel}`)
  if (options.expectedChannel && channel !== options.expectedChannel) {
    issues.push(`channel expected ${options.expectedChannel}, got ${channel}`)
  }
  const appId = String(doc.appId ?? '').trim()
  if (!appId) issues.push('appId is required')
  if (options.expectedAppId && appId !== options.expectedAppId) {
    issues.push(`appId expected ${options.expectedAppId}, got ${appId}`)
  }
  const productName = String(doc.productName ?? '').trim()
  if (!productName) issues.push('productName is required')
  if (options.expectedProductName && productName !== options.expectedProductName) {
    issues.push(`productName expected ${options.expectedProductName}, got ${productName}`)
  }
  const commit = String(doc.gitCommit ?? '').trim().toLowerCase()
  if (!FULL_SHA.test(commit)) issues.push('gitCommit must be a full 40-character hex SHA')
  const branch = String(doc.gitBranch ?? '').trim()
  if (!branch) issues.push('gitBranch is required')
  if (typeof doc.dirty !== 'boolean') issues.push('dirty must be a boolean')
  const fingerprint = String(doc.sourceFingerprint ?? '').trim().toLowerCase()
  if (doc.dirty === true) {
    if (!FINGERPRINT_SHA.test(fingerprint)) {
      issues.push('dirty builds require a 64-character sourceFingerprint')
    }
  } else if (fingerprint) {
    issues.push('clean builds must not set sourceFingerprint')
  }
  const buildTime = String(doc.buildTime ?? '').trim()
  if (!isStrictIso8601Utc(buildTime)) {
    issues.push('buildTime must be strict ISO-8601 UTC (YYYY-MM-DDTHH:mm:ss.sssZ)')
  }
  const trackingId = String(doc.trackingId ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(trackingId)) {
    issues.push('trackingId must be a 64-character hex integrity digest')
  } else {
    const expected = computeTrackingId({
      channel,
      productName,
      appId,
      gitBranch: branch,
      gitCommit: commit,
      dirty: doc.dirty === true,
      sourceFingerprint: fingerprint,
      buildTime,
    })
    if (trackingId !== expected) {
      issues.push('trackingId does not match recomputed canonical integrity digest')
    }
  }
  return issues
}

/**
 * Explicit development / unpackaged provenance. Never forges git hash or tracking.
 * @param {{ channel: string, productName: string, appId: string }} identity
 */
function developmentBuildTracking(identity) {
  return {
    schema: BUILD_TRACKING_SCHEMA,
    packaged: false,
    provenanceSource: 'development/unpackaged',
    channel: identity.channel,
    productName: identity.productName,
    appId: identity.appId,
    gitBranch: 'development/unpackaged',
    gitCommit: '',
    dirty: false,
    sourceFingerprint: '',
    buildTime: '',
    trackingId: '',
    missing: true,
    development: true,
  }
}

/**
 * Packaged app without usable sealed provenance.
 * Branch/hash/tracking stay empty so UI shows unavailable — never fake development labels.
 * @param {{ channel: string, productName: string, appId: string }} identity
 * @param {'packaged/missing' | 'packaged/invalid'} provenanceSource
 * @param {string[]} [validationIssues]
 */
function packagedUnavailableBuildTracking(identity, provenanceSource, validationIssues = []) {
  return {
    schema: BUILD_TRACKING_SCHEMA,
    packaged: true,
    provenanceSource,
    channel: identity.channel,
    productName: identity.productName,
    appId: identity.appId,
    gitBranch: '',
    gitCommit: '',
    dirty: false,
    sourceFingerprint: '',
    buildTime: '',
    trackingId: '',
    missing: true,
    development: false,
    validationIssues,
  }
}

/**
 * @param {{
 *   isPackaged: boolean,
 *   resourcesPath?: string,
 *   identity: { channel: string, productName: string, appId: string },
 *   readFile?: (path: string, encoding: string) => Promise<string>,
 * }} input
 */
async function loadBuildTrackingView(input) {
  const identity = input.identity
  if (!input.isPackaged) {
    return developmentBuildTracking(identity)
  }

  const sealedPath = path.join(String(input.resourcesPath || ''), BUILD_TRACKING_RESOURCE)
  const readFile = input.readFile || ((file, encoding) => fs.readFile(file, encoding))
  try {
    const raw = await readFile(sealedPath, 'utf8')
    const parsed = JSON.parse(raw)
    const issues = validateSealedBuildTracking(parsed, {
      expectedChannel: identity.channel,
      expectedAppId: identity.appId,
      expectedProductName: identity.productName,
    })
    if (issues.length) {
      return packagedUnavailableBuildTracking(identity, 'packaged/invalid', issues)
    }
    return {
      schema: BUILD_TRACKING_SCHEMA,
      packaged: true,
      provenanceSource: 'packaged/sealed',
      channel: String(parsed.channel).trim().toLowerCase(),
      productName: String(parsed.productName).trim(),
      appId: String(parsed.appId).trim(),
      gitBranch: String(parsed.gitBranch).trim(),
      gitCommit: String(parsed.gitCommit).trim().toLowerCase(),
      dirty: parsed.dirty === true,
      sourceFingerprint: parsed.dirty === true
        ? String(parsed.sourceFingerprint || '').trim().toLowerCase()
        : '',
      buildTime: String(parsed.buildTime).trim(),
      trackingId: String(parsed.trackingId).trim().toLowerCase(),
      missing: false,
      development: false,
    }
  } catch (error) {
    return packagedUnavailableBuildTracking(
      identity,
      'packaged/missing',
      [`sealed build-tracking unreadable: ${error?.message || error}`],
    )
  }
}

module.exports = {
  BUILD_TRACKING_RESOURCE,
  BUILD_TRACKING_SCHEMA,
  computeTrackingId,
  isStrictIso8601Utc,
  validateSealedBuildTracking,
  developmentBuildTracking,
  packagedUnavailableBuildTracking,
  loadBuildTrackingView,
}
