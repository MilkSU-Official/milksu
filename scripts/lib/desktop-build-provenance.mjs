/**
 * Build provenance for packaged MilkSU Stable/Beta.
 *
 * Values must reflect the actual git worktree used for the build.
 * Never forge main/clean.
 *
 * trackingId is a canonical-field integrity / tamper-detection digest only.
 * It is NOT a source-authenticity signature and does not replace package
 * sealing. A package verifier must:
 *   1) run `codesign --verify --deep --strict` on the sealed app,
 *   2) cross-check Info.plist / sealed build-tracking resource for
 *      channel, appId and productName,
 *   3) recompute trackingId from the sealed fields.
 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const BUILD_TRACKING_RESOURCE = 'build-tracking.json'
export const BUILD_TRACKING_SCHEMA = 'milksu.build-tracking/v1'
export const STABLE_APP_ID = 'com.milksu.app'
export const BETA_APP_ID = 'com.milksu.app.beta'

const FULL_SHA = /^[0-9a-f]{40}$/
const FINGERPRINT_SHA = /^[0-9a-f]{64}$/
const CHANNELS = new Set(['stable', 'beta'])
/** Strict UTC form produced by Date#toISOString(). */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * Canonical tracking id: sha256 hex of stable field lines (not free-form JSON).
 * Integrity check only — not an authenticity signature over the package seal.
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
export function computeTrackingId(fields) {
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
export function isStrictIso8601Utc(value) {
  const text = String(value ?? '').trim()
  if (!ISO_UTC.test(text)) return false
  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return false
  // Reject values Date accepts but that are not the canonical toISOString form.
  return new Date(parsed).toISOString() === text
}

/**
 * @param {string} root
 * @param {{ channel: string, productName: string, appId: string, now?: Date }} input
 */
export async function collectBuildTracking(root, input) {
  const channel = String(input.channel ?? '').trim().toLowerCase()
  if (!CHANNELS.has(channel)) {
    throw new Error(`unsupported build channel: ${input.channel}`)
  }
  const appId = String(input.appId ?? '').trim()
  const productName = String(input.productName ?? '').trim()
  if (!appId || !productName) {
    throw new Error('productName and appId are required for build tracking')
  }
  if (channel === 'stable' && appId !== STABLE_APP_ID) {
    throw new Error(`stable appId must be ${STABLE_APP_ID}`)
  }
  if (channel === 'beta' && appId !== BETA_APP_ID) {
    throw new Error(`beta appId must be ${BETA_APP_ID}`)
  }

  const git = await readGitIdentity(root)
  const dirty = git.dirty
  const sourceFingerprint = dirty
    ? await fingerprintDirtyTree(root, git.commit)
    : ''
  const buildTime = (input.now ?? new Date()).toISOString()
  if (!isStrictIso8601Utc(buildTime)) {
    throw new Error(`buildTime is not strict ISO-8601 UTC: ${buildTime}`)
  }
  const base = {
    schema: BUILD_TRACKING_SCHEMA,
    channel,
    productName,
    appId,
    gitBranch: git.branch,
    gitCommit: git.commit,
    dirty,
    sourceFingerprint,
    buildTime,
  }
  return {
    ...base,
    trackingId: computeTrackingId(base),
  }
}

/**
 * @param {string} root
 */
export async function readGitIdentity(root) {
  const commit = (await gitText(root, ['rev-parse', 'HEAD'])).trim().toLowerCase()
  if (!FULL_SHA.test(commit)) {
    throw new Error(`git HEAD is not a full 40-character commit: ${commit}`)
  }

  let branch = (await gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (!branch || branch === 'HEAD') {
    // Detached HEAD: report an explicit, faithful label — never blank or forged main.
    let short = commit.slice(0, 12)
    try {
      const describe = (await gitText(root, [
        'describe',
        '--tags',
        '--always',
        '--dirty=+',
      ])).trim()
      if (describe) short = describe
    } catch {
      // describe is best-effort
    }
    branch = `detached@${short}`
  }

  const status = await gitText(root, ['status', '--porcelain=v1'])
  return {
    branch,
    commit,
    dirty: Boolean(status.trim()),
  }
}

async function gitText(root, args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
      },
      maxBuffer: 8 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    throw new Error(`git ${args.join(' ')} failed: ${error?.message || error}`)
  }
}

/**
 * Map a filesystem mode to the Git deliverable mode bits we care about.
 * Only regular file executable bit and symlink type — never mtime/uid.
 * @param {import('node:fs').Stats} stats
 */
export function gitDeliverableMode(stats) {
  if (stats.isSymbolicLink()) return '120000'
  if (stats.isFile()) {
    // Git tracks only the executable bit among permission bits.
    return (stats.mode & 0o111) ? '100755' : '100644'
  }
  if (stats.isDirectory()) return '040000'
  return `special:${(stats.mode & 0o777777).toString(8)}`
}

/**
 * Fingerprint of the actual dirty source tree (tracked + untracked, excluding build outputs).
 *
 * Workspace boundary: never follow symlinks. Symlinks contribute only their
 * type + link target string. Regular files contribute Git deliverable mode +
 * content. Special files contribute type/mode only (no open/read that could
 * block or leave the repo). Never logs file bodies.
 *
 * @param {string} root
 * @param {string} commit
 */
export async function fingerprintDirtyTree(root, commit) {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '-z', '-c', '-o', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    },
  )
  const files = stdout.split('\0').filter(Boolean).sort()
  const hash = createHash('sha256')
  hash.update(String(commit).toLowerCase())
  hash.update('\n')
  for (const relative of files) {
    if (shouldSkipFingerprintPath(relative)) continue
    hash.update(relative)
    hash.update('\0')
    const absolute = join(root, relative)
    try {
      // lstat: do not follow symlinks out of the repository.
      const stats = await fs.lstat(absolute)
      const mode = gitDeliverableMode(stats)
      if (stats.isSymbolicLink()) {
        const target = await fs.readlink(absolute)
        hash.update('symlink\0')
        hash.update(mode)
        hash.update('\0')
        hash.update(String(target))
        hash.update('\0')
        continue
      }
      if (stats.isFile()) {
        hash.update('file\0')
        hash.update(mode)
        hash.update('\0')
        const body = await fs.readFile(absolute)
        hash.update(body)
        hash.update('\0')
        continue
      }
      // Device nodes, sockets, fifos, directories that slipped into ls-files, etc.
      // Do not open or read them.
      hash.update('special\0')
      hash.update(mode)
      hash.update('\0')
    } catch {
      // Deleted tracked path still dirty; include a stable tombstone without content.
      hash.update('missing\0')
    }
  }
  return hash.digest('hex')
}

export function shouldSkipFingerprintPath(relative) {
  const value = String(relative).replaceAll('\\', '/')
  // build/ covers build/desktop generated packaging artifacts.
  // app/dist/ is Vite production output; deleting tracked .gitkeep during build
  // must not change sourceFingerprint between Stable and Beta in one session.
  // Do not special-case stale paths like build/appicon-beta.png — if such an
  // untracked product reappears outside build/, provenance dirty detection should see it.
  return value.startsWith('build/')
    || value === 'app/dist'
    || value.startsWith('app/dist/')
    || value.startsWith('node_modules/')
    || value.startsWith('app/node_modules/')
    || value.startsWith('desktop/node_modules/')
    || value.startsWith('.agent-worktrees/')
    || value.startsWith('.tmp/')
}

/**
 * @param {unknown} value
 * @param {{ expectedChannel?: string, expectedAppId?: string }} [options]
 * @returns {string[]}
 */
export function validateBuildTracking(value, options = {}) {
  const issues = []
  if (!value || typeof value !== 'object') {
    return ['build tracking document is missing']
  }
  const doc = /** @type {Record<string, unknown>} */ (value)
  if (doc.schema !== BUILD_TRACKING_SCHEMA) {
    issues.push(`schema must be ${BUILD_TRACKING_SCHEMA}`)
  }

  const channel = String(doc.channel ?? '').trim().toLowerCase()
  if (!CHANNELS.has(channel)) {
    issues.push(`channel must be stable|beta, got ${doc.channel}`)
  }
  if (options.expectedChannel && channel !== options.expectedChannel) {
    issues.push(`channel expected ${options.expectedChannel}, got ${channel}`)
  }

  const appId = String(doc.appId ?? '').trim()
  if (!appId) issues.push('appId is required')
  if (options.expectedAppId && appId !== options.expectedAppId) {
    issues.push(`appId expected ${options.expectedAppId}, got ${appId}`)
  }
  if (channel === 'stable' && appId && appId !== STABLE_APP_ID) {
    issues.push(`stable appId must be ${STABLE_APP_ID}`)
  }
  if (channel === 'beta' && appId && appId !== BETA_APP_ID) {
    issues.push(`beta appId must be ${BETA_APP_ID}`)
  }

  const productName = String(doc.productName ?? '').trim()
  if (!productName) issues.push('productName is required')

  const commit = String(doc.gitCommit ?? '').trim().toLowerCase()
  if (!FULL_SHA.test(commit)) {
    issues.push('gitCommit must be a full 40-character hex SHA')
  }

  const branch = String(doc.gitBranch ?? '').trim()
  if (!branch) {
    issues.push('gitBranch is required')
  }

  if (typeof doc.dirty !== 'boolean') {
    issues.push('dirty must be a boolean')
  }

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
    issues.push('trackingId must be a 64-character hex digest')
  } else {
    // Recompute integrity digest over canonical declared fields only.
    // This detects field tampering; it does not prove package authenticity.
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
 * @param {string} filePath
 * @param {Record<string, unknown>} tracking
 */
export async function writeBuildTrackingFile(filePath, tracking) {
  const issues = validateBuildTracking(tracking)
  if (issues.length) {
    throw new Error(`refusing to write invalid build tracking: ${issues.join('; ')}`)
  }
  await fs.writeFile(filePath, `${JSON.stringify(tracking, null, 2)}\n`, 'utf8')
}

/**
 * @param {string} filePath
 */
export async function readBuildTrackingFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}
