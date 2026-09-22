/**
 * Shared product-loop surface scanner. Looks at captured DOM / a11y text and
 * known error chrome after GUI operations. Not imported by App startup.
 *
 * Unexpected error-level copy, red destructive chrome, or implementation leaks
 * are a hard anomaly (FAIL). SKIP / expectedMiss never hides a leak.
 */

import { redactProcessText } from '../../sidecar/dsh/redact.js'
import { CASES } from './product-loop-catalog.mjs'

export const SURFACE_SCAN_PREFIX = '表面异常：'

/**
 * Cases may allow a *kind* of user-facing chrome they are asserting.
 * Leaks (raw AbortError, No API key for tokenflux/…, JSON dumps) are never allowed.
 */
export const SURFACE_ALLOW = Object.freeze({
  'login-gate': ['missing-key'],
  'login-github-active': ['missing-key', 'form-error'],
  'login-skip-local': ['missing-key'],
  'account-model-fileloop': ['missing-key', 'quota'],
  'settings-custom-relay': ['form-error'],
  'companion-dispatch-confirm': ['confirm'],
  'companion-core': ['cancelled', 'empty-reply'],
  'companion-fuzz-recovery': ['cancelled'],
  'coding-pi-stop': ['cancelled'],
  'coding-dsh-stop': ['cancelled'],
  'session-delete': ['confirm'],
  'workspace-lab-settings': ['status'],
  'workspace-lab-status': ['status'],
  'settings-lab': ['status'],
  'workspace-cve-severity': ['badge'],
  'desktop-cu-status': ['status'],
})

const LEAK_RULES = [
  { id: 'request-aborted', re: /\bRequest aborted\b/i },
  { id: 'abort-error', re: /\bAbortError\b/ },
  { id: 'object-object', re: /\[object Object\]/i },
  { id: 'companion-host', re: /companion-host-\d+/i },
  { id: 'unknown-host', re: /unknown companion host request/i },
  { id: 'no-api-key-debug', re: /No API key for \S+/i },
  { id: 'session-not-ready', re: /companion session is not ready|companion prompt is required|companion model not found|companion provider and model are required/i },
  { id: 'stack-frame', re: /\bat (?:Object|Module|async |[A-Za-z.]+ \()/ },
  { id: 'stack-path', re: /\bat [^\n]*(?:\/Users\/|\/home\/|C:\\Users\\)/ },
  { id: 'sidecar-path', re: /sidecar\/(?:pi|companion|dsh)\// },
  { id: 'cdp-internal', re: /\bCDP WebSocket closed\b|\bRuntime\.evaluate\b/ },
  { id: 'errno', re: /\b(?:EPIPE|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT)\b/ },
  { id: 'ws-closed', re: /WebSocket (?:is )?closed/i },
]

const SETTINGS_JSON = /companion_float_enabled|tokenflux\.dev\/v1/i
const JSONISH = /[{[]/
const SETTINGS_ENVELOPE = /"ok"\s*:|"settings"\s*:|"relay"\s*:/

const LOCALIZED_MISSING_KEY = /当前模型没有可用的 API Key|No API key is available for the current model|当前没有可用的账户或个人模型来源|No account or personal model source is available|当前模型没有可用凭据|No credentials are available for the current model/
const LOCALIZED_QUOTA = /余额不足|额度已用完|quota is exhausted|account balance is insufficient|insufficient quota/
const LOCALIZED_CANCELLED = /这一轮已取消。?|本轮已停止。?|This turn was cancelled\.?|This turn was stopped\.?/
const LOCALIZED_EMPTY_REPLY = /这一轮没有回复|This turn did not produce a reply/
const LOCALIZED_CONFIRM = /有一条命令在等你确认|退出 MilkSU 需要你确认|重启 MilkSU 需要你确认|有一项设置更改在等你确认|有一批转达在等你确认|这次操作需要你点头|A command is waiting|needs your confirmation|Quitting MilkSU|Relaunching MilkSU|A settings change is waiting|A batch relay is waiting/
const FORM_LOGIN = /登录没有完成|Sign-in did not complete/
const STATUS_COPY = /未检测|重新检测|not detected|not found|unavailable|辅助功能|屏幕录制|Accessibility|Screen recording|Wayland|不能自己贴坐标/
const BADGE_COPY = /^(严重|高危|中危|低危|Critical|High|Medium|Low|未知|Unknown)$/i
const BENIGN_CHROME = /^(删除|归档|取消|确认|永久删除|Delete|Archive|Cancel|Confirm|撤回|Withdraw|开新对话|New chat)$/i
const GIT_STAT = /^[+\-−]\d+$/
const ENGLISH_ERROR = /\b(?:Request aborted|AbortError|TypeError:|ReferenceError:|Failed to (?:fetch|execute|load)|undefined is not|Cannot read propert|WebSocket (?:is )?closed|EPIPE|No API key for|companion session is not ready)\b/

const ERRORISH = /失败|错误|报错|异常|无法|连不上|没有可用|Error|Failed|Exception|aborted|EPIPE|ECONN|undefined is not|WebSocket closed|stack|trace/i

export function emptySurfaceScan() {
  return {
    fail: false,
    summary: '',
    hits: [],
    onlyExpectedMiss: false,
  }
}

export function surfaceAllowKinds(caseId) {
  const fromCatalog = CASES[caseId]?.allowSurface
  const listed = SURFACE_ALLOW[caseId] || []
  return [...new Set([...(Array.isArray(fromCatalog) ? fromCatalog : []), ...listed])]
}

export function isSurfaceLeakText(text) {
  return Boolean(matchLeak(text))
}

function matchLeak(text) {
  const value = String(text ?? '')
  if (!value.trim()) return null
  for (const rule of LEAK_RULES) {
    if (rule.re.test(value)) return rule.id
  }
  if (SETTINGS_JSON.test(value) && JSONISH.test(value) && SETTINGS_ENVELOPE.test(value)) {
    return 'settings-json'
  }
  if (/^[{\[]/.test(value.trim()) && SETTINGS_JSON.test(value)) {
    return 'settings-json'
  }
  return null
}

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function snapshotHay(snapshot = {}) {
  const findings = Array.isArray(snapshot.findings)
    ? snapshot.findings.map(item => String(item?.text ?? '')).join('\n')
    : ''
  return [
    snapshot.text,
    ...(Array.isArray(snapshot.aria) ? snapshot.aria : []),
    snapshot.caption,
    findings,
  ].filter(Boolean).join('\n')
}

function isBenignChrome(text) {
  const value = compactText(text)
  if (!value) return true
  if (BENIGN_CHROME.test(value)) return true
  if (GIT_STAT.test(value)) return true
  if (BADGE_COPY.test(value)) return true
  return false
}

function classifyAllowedKind(text) {
  const value = compactText(text)
  if (!value) return ''
  if (LOCALIZED_CONFIRM.test(value)) return 'confirm'
  if (LOCALIZED_CANCELLED.test(value)) return 'cancelled'
  if (LOCALIZED_EMPTY_REPLY.test(value)) return 'empty-reply'
  if (LOCALIZED_MISSING_KEY.test(value) && !/No API key for \S+/i.test(value)) return 'missing-key'
  if (LOCALIZED_QUOTA.test(value) && !matchLeak(value)) return 'quota'
  if (FORM_LOGIN.test(value)) return 'form-error'
  if (STATUS_COPY.test(value) && !matchLeak(value)) return 'status'
  if (BADGE_COPY.test(value)) return 'badge'
  return ''
}

function localeOf(snapshot) {
  const raw = String(snapshot?.locale ?? '').toLowerCase()
  if (raw.startsWith('en')) return 'en'
  return 'zh'
}

function pushHit(hits, hit) {
  const text = compactText(hit.text).slice(0, 220)
  if (!text) return
  const key = `${hit.severity}|${hit.kind}|${hit.surface || ''}|${text}`
  if (hits.some(item => `${item.severity}|${item.kind}|${item.surface || ''}|${item.text}` === key)) return
  hits.push({
    severity: hit.severity,
    kind: hit.kind,
    surface: hit.surface || '',
    phase: hit.phase || '',
    text: redactProcessText(text, 220),
    allowed: Boolean(hit.allowed),
  })
}

function allowKind(kind, options = {}) {
  if (!kind) return false
  const allowed = new Set([
    ...surfaceAllowKinds(options.caseId),
    ...(Array.isArray(options.allow) ? options.allow : []),
  ])
  if (kind === 'form-error' && options.result === 'PASS') return false
  if ((options.result === 'SKIP' || options.expectedMiss) && (kind === 'missing-key' || kind === 'quota')) {
    return true
  }
  return allowed.has(kind)
}

/**
 * Scan one surface snapshot (DOM text, a11y labels, structured findings).
 * Deterministic: regex + role/class. No vision model.
 */
export function scanProductLoopSurface(snapshot = {}, options = {}) {
  const hits = []
  const surface = String(snapshot.surface || options.surface || '')
  const phase = String(options.phase || '')
  const locale = localeOf(snapshot)
  const findings = Array.isArray(snapshot.findings) ? snapshot.findings : []

  for (const finding of findings) {
    const text = compactText(finding?.text)
    if (!text || isBenignChrome(text)) continue
    const leak = matchLeak(text)
    if (leak) {
      pushHit(hits, {
        severity: 'leak',
        kind: leak,
        surface: surface || finding.surface,
        phase,
        text,
      })
      continue
    }
    if (locale === 'zh' && ENGLISH_ERROR.test(text)) {
      pushHit(hits, {
        severity: 'leak',
        kind: 'unlocalized-en',
        surface: surface || finding.surface,
        phase,
        text,
      })
      continue
    }
    const kind = classifyAllowedKind(text)
      || (finding.kind === 'confirm' || finding.role === 'alertdialog' ? 'confirm' : '')
      || (finding.kind === 'alert' || finding.kind === 'destructive' || finding.kind === 'toast' || finding.kind === 'companion-bubble' || finding.kind === 'companion-error'
        ? 'error-chrome'
        : '')
    if (!kind) continue
    if (kind === 'error-chrome' && !ERRORISH.test(text) && finding.kind !== 'companion-bubble' && finding.kind !== 'companion-error' && finding.kind !== 'alert' && finding.kind !== 'toast') {
      continue
    }
    const allowed = allowKind(kind === 'error-chrome' ? '' : kind, options)
    if (allowed) {
      pushHit(hits, {
        severity: 'allowed',
        kind,
        surface: surface || finding.surface,
        phase,
        text,
        allowed: true,
      })
      continue
    }
    if (kind === 'confirm' && allowKind('confirm', options)) {
      pushHit(hits, {
        severity: 'allowed',
        kind: 'confirm',
        surface: surface || finding.surface,
        phase,
        text,
        allowed: true,
      })
      continue
    }
    pushHit(hits, {
      severity: kind === 'error-chrome' || finding.kind === 'companion-bubble' || finding.kind === 'companion-error' || finding.kind === 'alert' || finding.kind === 'toast'
        ? 'error'
        : 'error',
      kind: kind || finding.kind || 'error-chrome',
      surface: surface || finding.surface,
      phase,
      text,
    })
  }

  const hay = snapshotHay(snapshot)
  const leak = matchLeak(hay)
  if (leak && !hits.some(item => item.kind === leak && item.severity === 'leak')) {
    const excerpt = excerptAround(hay, LEAK_RULES.find(rule => rule.id === leak)?.re || /./)
    pushHit(hits, {
      severity: 'leak',
      kind: leak,
      surface,
      phase,
      text: excerpt,
    })
  }
  if (locale === 'zh' && ENGLISH_ERROR.test(hay) && !hits.some(item => item.severity === 'leak')) {
    pushHit(hits, {
      severity: 'leak',
      kind: 'unlocalized-en',
      surface,
      phase,
      text: excerptAround(hay, ENGLISH_ERROR),
    })
  }
  if (LOCALIZED_MISSING_KEY.test(hay) && !/No API key for \S+/i.test(hay) && !allowKind('missing-key', options)) {
    pushHit(hits, {
      severity: 'error',
      kind: 'missing-key',
      surface,
      phase,
      text: excerptAround(hay, LOCALIZED_MISSING_KEY),
    })
  }

  return finalizeHits(hits)
}

export function scanProductLoopSurfaces(snapshots = [], options = {}) {
  const hits = []
  for (const snapshot of snapshots) {
    const part = scanProductLoopSurface(snapshot, options)
    for (const hit of part.hits) pushHit(hits, hit)
  }
  return finalizeHits(hits)
}

export function mergeSurfaceScans(...scans) {
  const hits = []
  for (const scan of scans) {
    for (const hit of scan?.hits || []) pushHit(hits, hit)
  }
  return finalizeHits(hits)
}

function finalizeHits(hits) {
  const unexpected = hits.filter(item => item.severity === 'leak' || item.severity === 'error')
  const missOnly = unexpected.length > 0
    && unexpected.every(item => item.kind === 'missing-key' || item.kind === 'quota')
  const first = unexpected[0]
  return {
    fail: unexpected.length > 0,
    summary: first
      ? `${SURFACE_SCAN_PREFIX}${first.surface ? `${first.surface} · ` : ''}${first.text}`
      : '',
    hits,
    onlyExpectedMiss: missOnly,
  }
}

function excerptAround(hay, re) {
  const text = String(hay ?? '')
  const match = text.match(re)
  if (!match || match.index == null) return compactText(text).slice(0, 180)
  const start = Math.max(0, match.index - 20)
  return compactText(text.slice(start, match.index + match[0].length + 80)).slice(0, 180)
}

/**
 * Upgrade PASS / SKIP to FAIL when the surface has an unexpected leak or error.
 * expectedMiss SKIP still fails on leaks and on unrelated red/error chrome.
 */
export function applySurfaceScan(record, scan, options = {}) {
  if (!record || !scan) return record
  const unexpected = (scan.hits || []).filter(item => item.severity === 'leak' || item.severity === 'error')
  if (unexpected.length) {
    record.anomalies = unexpected
  } else if (!record.anomalies) {
    record.anomalies = []
  }
  if (!scan.fail) return record
  const leaks = unexpected.filter(item => item.severity === 'leak')
  const relatedMiss = scan.onlyExpectedMiss
    && (record.result === 'SKIP' || record.expectedMiss === true || options.expectedMiss === true)
    && leaks.length === 0
  if (relatedMiss) return record
  const summary = scan.summary || SURFACE_SCAN_PREFIX
  const detail = String(record.detail || '')
  if (!detail.includes(SURFACE_SCAN_PREFIX)) {
    record.detail = redactProcessText(detail ? `${detail}；${summary}` : summary, 500)
  }
  if (record.result === 'PASS' || record.result === 'SKIP') {
    record.result = 'FAIL'
  }
  return record
}

export function adoptEvidence(record, evidence) {
  if (!record) return record
  if (Array.isArray(evidence)) {
    record.screenshots = evidence
    return record
  }
  if (evidence && typeof evidence === 'object') {
    if (Array.isArray(evidence.screenshots)) record.screenshots = evidence.screenshots
    if (evidence.scan) applySurfaceScan(record, evidence.scan, { caseId: record.id, result: record.result })
  }
  return record
}

/**
 * In-page collector. Must stay a closed function so CDP can toString() it.
 * Visible nodes only. Color check uses computed style, not a screenshot model.
 */
export function collectVisibleSurfaceSnapshot() {
  function visible(node) {
    if (!node || node.nodeType !== 1) return false
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const box = node.getBoundingClientRect()
    return box.width > 1 && box.height > 1
  }
  function textOf(node) {
    return String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
  }
  function rgb(color) {
    const match = String(color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) } : null
  }
  function looksRed(color) {
    const value = rgb(color)
    if (!value) return false
    return value.r > 140 && value.r > value.g + 40 && value.r > value.b + 40
  }
  function classOf(node) {
    return String(node.className && node.className.baseVal != null ? node.className.baseVal : node.className || '')
  }
  const findings = []
  const seen = new Set()
  function add(kind, node, extra) {
    const text = textOf(node)
    if (!text) return
    const key = `${kind}:${text}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({
      kind,
      text: text.slice(0, 280),
      role: node.getAttribute('role') || '',
      className: classOf(node).slice(0, 160),
      ...(extra || {}),
    })
  }
  const locale = document.documentElement.lang || ''
  for (const node of document.querySelectorAll('[role="alertdialog"]')) {
    if (visible(node)) add('confirm', node)
  }
  for (const node of document.querySelectorAll('[role="alert"], [aria-live="assertive"]')) {
    if (visible(node)) add('alert', node)
  }
  for (const node of document.querySelectorAll('.text-destructive, [data-slot="alert"], [data-variant="destructive"], [data-type="error"]')) {
    if (visible(node)) add('destructive', node)
  }
  for (const node of document.querySelectorAll('[data-sonner-toast], [data-radix-toast], [data-slot="toast"]')) {
    if (visible(node)) add('toast', node)
  }
  for (const node of document.querySelectorAll('.companion-pet-bubble')) {
    if (visible(node)) add('companion-bubble', node)
  }
  for (const node of document.querySelectorAll('.companion-chat-error, .companion-chat-error-row')) {
    if (visible(node)) add('companion-error', node)
  }
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT)
  let node = walker.currentNode
  while (node) {
    if (node !== document.body && node !== document.documentElement && visible(node)) {
      const style = window.getComputedStyle(node)
      const text = textOf(node)
      if (
        looksRed(style.color)
        && text
        && text.length < 200
        && (node.childElementCount === 0 || text.length < 80)
        && /失败|错误|报错|异常|无法|连不上|Error|Failed|Exception|aborted|EPIPE|No API key/i.test(text)
      ) {
        add('red-text', node)
      }
    }
    node = walker.nextNode()
  }
  return {
    url: location.href,
    title: document.title,
    locale,
    text: String(document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    aria: Array.from(document.querySelectorAll('[aria-label]'))
      .map(item => item.getAttribute('aria-label') || '')
      .filter(Boolean)
      .slice(0, 80),
    findings,
  }
}

export async function inspectProductLoopSurfaces(driver, options = {}) {
  if (!driver) return emptySurfaceScan()
  const {
    CdpSession,
    listDesktopCdpTargets,
    isCompanionSurface,
    isMainProductSurface,
  } = await import('./desktop-gui-driver.mjs')
  const port = driver.preferredPort
  const targets = await listDesktopCdpTargets({ port }).catch(() => [])
  const snapshots = []
  for (const target of targets) {
    if (!isMainProductSurface(target) && !isCompanionSurface(target)) continue
    const session = new CdpSession(target.webSocketDebuggerUrl)
    try {
      await session.open()
      const snap = await session.evaluate(`(${collectVisibleSurfaceSnapshot.toString()})()`)
      if (snap && typeof snap === 'object') {
        snapshots.push({
          ...snap,
          surface: isCompanionSurface(target) ? 'companion' : 'main',
        })
      }
    } catch {
      // Hidden or tearing-down surfaces.
    } finally {
      session.close()
    }
  }
  return scanProductLoopSurfaces(snapshots, options)
}
