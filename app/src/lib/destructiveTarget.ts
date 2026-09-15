/**
 * Parsing and risk assessment for destructive approval requests.
 *
 * The approval card must show what a delete command actually touches. Agents phrase
 * the same intent in many ways (`rm -rf`, `rm -f file`, `find … -delete`, `… | xargs rm`),
 * and a naive parse used to report the whole workspace root for a `find … -delete`,
 * which scared the user. Everything here is pure so it can be unit tested; the parts
 * that need the filesystem or git (existence, size, tracking) are supplied by the
 * backend as measurements and merged in `describeDestructiveRequest`.
 */

export type DestructiveTargetKind = 'file' | 'directory-tree' | 'glob' | 'unknown'

export interface DestructiveTarget {
  /** The text as written in the command. */
  raw: string
  /** Absolute path, when it can be determined. */
  path?: string
  kind: DestructiveTargetKind
  recursive: boolean
  /** Why this target and kind were chosen - shown to the user. */
  reason: string
}

export interface DestructiveFacts {
  /** Measured by the backend: does the path exist, is it an empty directory. */
  exists?: boolean
  emptyDirectory?: boolean
  /** Measured by the backend: files and bytes under the target. */
  fileCount?: number
  totalBytes?: number
  /** Sampled means the backend stopped early; the numbers are a lower bound. */
  sampled?: boolean
  /** Git facts: inside a repository and whether the target is tracked. */
  inGitRepository?: boolean
  gitTracked?: boolean
  /** A rebuildable source exists (same commit reachable, backup present, ...). */
  rebuildable?: boolean
  rebuildSource?: string
  /** Backups found next to the target. */
  backups?: string[]
}

export interface ProtectedMatch {
  protected: boolean
  /** The rule that matched, for display. */
  rule?: string
}

export interface DestructiveAssessment {
  targets: DestructiveTarget[]
  /** Every matched protection rule across all targets. */
  protections: string[]
  /** True when nothing could be determined: never allow by default. */
  undetermined: boolean
  /** The allow button is gated on this: unknown scope or a protected path. */
  canAllow: boolean
  /** Nothing can bring it back (no git tracking, no backup) - shown in red. */
  irrecoverable: boolean
  /** One-line verdict shown at the bottom of the card. */
  verdict: string
  risk: 'low' | 'medium' | 'high'
  /** True when the user data directories are touched. */
  touchesUserData: boolean
}

const USER_DATA_DIRECTORIES = [
  'runtime-data',
  'Documents',
  'Desktop',
]

const PROTECTED_RULES: { rule: string; test: (path: string) => boolean }[] = [
  { rule: '/private/tmp/mairecord-*', test: p => /^\/private\/tmp\/mairecord-/.test(p) },
  { rule: '/private/tmp/milksu-*', test: p => /^\/private\/tmp\/milksu-/.test(p) },
  { rule: 'DerivedData', test: p => /(^|\/)DerivedData(\/|$)/.test(p) },
  { rule: 'runtime-data', test: p => /(^|\/)runtime-data(\/|$)/.test(p) },
  { rule: '~/Documents', test: p => /(^|\/)Documents(\/|$)/.test(p) },
  { rule: '~/Desktop', test: p => /(^|\/)Desktop(\/|$)/.test(p) },
  // Library is protected except for the caches that are explicitly rebuildable.
  {
    rule: '~/Library',
    test: p => /(^|\/)Library(\/|$)/.test(p)
      && !/(^|\/)Library\/Caches(\/|$)/.test(p)
      && !/(^|\/)Library\/Logs(\/|$)/.test(p),
  },
  { rule: 'maiRecord 记录', test: p => /mairecord/i.test(p) && /(record|trainer)/i.test(p) },
]

/** Split a shell-ish command into simple tokens, honouring quotes. */
function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote = ''
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = ''
      else current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = '' }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function isFlag(token: string) {
  return token.startsWith('-')
}

function classify(raw: string, cwd: string): DestructiveTarget {
  // A variable or a command substitution means the real target is decided at run time.
  // Treating `/$(cat where)` as a concrete absolute path made a clear delete look safe.
  if (/\$\(|`|\$\{|\$[A-Za-z_]/.test(raw)) {
    return {
      raw,
      kind: 'unknown',
      recursive: true,
      reason: '目标含变量或命令替换，无法确定',
    }
  }
  if (raw.includes('*') || raw.includes('?')) {
    return { raw, kind: 'glob', recursive: true, reason: '通配表达式，作用范围由实际匹配决定' }
  }
  if ((raw === '~' || raw.startsWith('~/')) && !homeDirectory()) {
    return { raw, kind: 'unknown', recursive: true, reason: '无法展开家目录' }
  }
  const path = absolute(raw, cwd)
  return { raw, path, kind: 'directory-tree', recursive: true, reason: '目录及其内容' }
}

/**
 * The renderer runs sandboxed (contextIsolation on, nodeIntegration off), so `process` may
 * not exist here at all. Read it defensively and report "unknown" instead of guessing: a
 * wrong home directory would show the reader a path that is not the one being deleted.
 */
function homeDirectory(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env
  const home = env?.HOME ?? env?.USERPROFILE
  return home ? home.replace(/\/+$/, '') : undefined
}

function absolute(raw: string, cwd: string): string | undefined {
  if (!raw || raw === '.' || raw === './') return cwd
  if (raw.startsWith('/')) return raw
  if (raw === '~') return homeDirectory() ?? raw
  if (raw.startsWith('~/')) {
    // With no home directory the target cannot be pinned down, so it stays undetermined
    // (the card then refuses to offer "allow") rather than turning `~/x` into `/x`.
    const home = homeDirectory()
    return home ? `${home}${raw.slice(1)}` : undefined
  }
  if (raw.startsWith('-')) return undefined
  return `${cwd.replace(/\/$/, '')}/${raw.replace(/^\.\//, '')}`
}

/**
 * Split a command on top-level `;`, `&&`, `||` and newlines, ignoring separators that
 * sit inside quotes. Daily commands look like `cd x; rm -rf y; echo done`, and the old
 * parser refused all of them as "undetermined".
 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      current += char
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    const pair = text.slice(index, index + 2)
    if (char === ';' || char === '\n') {
      parts.push(current)
      current = ''
      continue
    }
    if (pair === '&&' || pair === '||') {
      parts.push(current)
      current = ''
      index += 1
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map(part => part.trim()).filter(Boolean)
}

/** Command substitutions that may hide a delete: `$(…)` and backticks. */
function substitutions(text: string): string[] {
  const found: string[] = []
  const pattern = /\$\(([^()]*)\)|`([^`]*)`/g
  let match = pattern.exec(text)
  while (match) {
    found.push(match[1] ?? match[2] ?? '')
    match = pattern.exec(text)
  }
  return found
}

/**
 * Work out what a command deletes. Returns an empty list (with an `unknown` target)
 * when the scope cannot be established - callers must treat that as "not allowed".
 */
export function parseDestructiveTargets(command: string, cwd = '/'): DestructiveTarget[] {
  const text = command.trim()
  if (!text) return []
  const segments = splitTopLevel(text)
  const collected: DestructiveTarget[] = []
  for (const segment of segments) {
    collected.push(...parseSingleCommand(segment, cwd))
    for (const inner of substitutions(segment)) {
      collected.push(...parseSingleCommand(inner, cwd))
    }
  }
  return collected
}

// Wrappers that change nothing about what is deleted: `sudo rm -rf x`, `env A=b rm -rf x`.
const commandWrappers = new Set(['sudo', 'command', 'nice', 'ionice', 'nohup', 'env', 'doas', 'time'])

function stripWrappers(tokens: string[]): string[] {
  let index = 0
  while (index < tokens.length && commandWrappers.has(tokens[index] ?? '')) {
    index += 1
    // `env NAME=value …` keeps a run of assignments after it.
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')) index += 1
  }
  return index === 0 ? tokens : tokens.slice(index)
}

/** `sh -c "rm -rf x"`, `bash -lc '…'`: judge the script the shell would run. */
function shellCommandScript(tokens: string[], text: string): string | undefined {
  const head = (tokens[0] ?? '').split(/[\\/]/).at(-1)
  if (!head || !['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(head)) return undefined
  const flagIndex = tokens.findIndex((token, index) => index > 0 && token === '-c')
  if (flagIndex >= 0 && tokens[flagIndex + 1]) return tokens.slice(flagIndex + 1).join(' ')
  // `bash -lc "…"` keeps the script inside the flag.
  const combined = tokens.slice(1).find(token => /^-[A-Za-z]*c$/.test(token))
  if (combined) {
    const script = text.slice(text.indexOf(combined) + combined.length).trim()
    if (script) return script.replace(/^['"]|['"]$/g, '')
  }
  return undefined
}

function parseSingleCommand(text: string, cwd: string): DestructiveTarget[] {
  const rawTokens = tokenize(text)
  if (!rawTokens.length) return []
  const script = shellCommandScript(rawTokens, text)
  if (script?.trim()) return parseSingleCommand(script, cwd)
  const tokens = stripWrappers(rawTokens)
  if (!tokens.length) return []

  // `… | xargs rm` deletes whatever the upstream command produced: not determinable.
  if (/\|\s*xargs\s+rm/.test(text) || /\bxargs\b[^|]*\brm\b/.test(text)) {
    return [{
      raw: text,
      kind: 'unknown',
      recursive: true,
      reason: '目标来自管道输出（xargs），无法从命令本身确定',
    }]
  }

  if (tokens[0] === 'rm') {
    const operands = tokens.slice(1).filter(token => !isFlag(token))
    const recursive = /(^|\s)-[a-z]*r/i.test(text)
    if (!operands.length) {
      return [{ raw: text, kind: 'unknown', recursive, reason: '没有可识别的删除目标' }]
    }
    return operands.map(operand => {
      const target = classify(operand, cwd)
      if (target.kind === 'glob') return target
      return recursive
        ? { ...target, reason: '递归删除（-r/-R）' }
        : { ...target, kind: 'file', recursive: false, reason: '单个文件（未递归）' }
    })
  }

  const findIndex = tokens.indexOf('find')
  if (findIndex >= 0 && tokens.includes('-delete')) {
    const root = tokens[findIndex + 1]
    if (!root || isFlag(root)) {
      return [{
        raw: text,
        kind: 'unknown',
        recursive: true,
        reason: 'find 缺少可识别的起始目录',
      }]
    }
    const limited = tokens.some(token => token === '-name' || token === '-size' || token === '!')
    const target = classify(root, cwd)
    if (target.kind === 'glob') return [target]
    return [{
      ...target,
      reason: limited
        ? 'find -delete（带 -name/-size/! 限定，仅匹配项被删）'
        : 'find -delete（整个起始目录树）',
    }]
  }

  if (/\btruncate\b|\b>\s*\S+/.test(text) && !/rm\b/.test(text)) {
    return []
  }

  if (/\b(rm|unlink|shred|rmdir|truncate)\b|\bfind\b[^|]*-delete|\bxargs\b|\bgit\s+clean\b|Remove-Item|del\s/i.test(text)) {
    // Last resort before giving up: when the text names exactly one absolute path and no
    // variables, the target IS knowable even if the command shape was unfamiliar
    // (a wrapper we do not list, a quoting style we do not expect). Without this, a clear
    // `rm -rf "/abs/path"` from an unexpected shape kept reporting "target undetermined"
    // and could never be approved.
    const paths = [...new Set((text.match(/\/[^\s"';|&)]+/g) ?? []).filter(path => path.length > 1))]
    if (paths.length === 1 && !/\$\(|`|\$\{|\$[A-Za-z_]/.test(text)) {
      const only = classify(paths[0], cwd)
      if (only.kind !== 'unknown') {
        return [{ ...only, recursive: true, reason: '递归删除（-r/-R）' }]
      }
    }
    return [{
      raw: text,
      kind: 'unknown',
      recursive: true,
      reason: '无法从命令本身确定删除目标',
    }]
  }
  // Not a delete at all (echo/cd/export/…): nothing to assess.
  return []
}

/**
 * The card's `content` is written for people ("规范化目标：… 影响：… 原始命令：…"), so parsing it
 * as a shell command made a clear absolute target look undetermined. Judge the structured
 * input the tool actually sent instead.
 */
function parseApprovalInput(raw?: string): { command: string; paths: string[] } | undefined {
  const text = String(raw ?? '').trim()
  if (!text.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const command = typeof parsed.command === 'string' ? parsed.command.trim() : ''
    const paths: string[] = []
    const targets = Array.isArray(parsed.normalizedTargets) ? parsed.normalizedTargets : []
    for (const entry of targets) {
      if (!entry || typeof entry !== 'object') continue
      const path = (entry as { path?: unknown }).path
      if (typeof path === 'string' && path.trim()) paths.push(path.trim())
    }
    const single = typeof parsed.path === 'string' ? parsed.path.trim() : ''
    if (single) paths.push(single)
    if (command || paths.length) return { command, paths }
  } catch {
    // Not structured input at all.
  }
  return undefined
}

export interface ApprovalAssessment extends DestructiveAssessment {
  /** True when the request carried nothing structured to check. */
  unverified?: boolean
}

export function assessApprovalRequest(
  input: { content?: string; approvalInput?: string },
  facts: DestructiveFacts[] = [],
): ApprovalAssessment {
  const structured = parseApprovalInput(input.approvalInput)
  if (!structured) {
    // Older or unexpected requests: fall back to the text, but say so.
    const fallback = assessDestructiveRequest(String(input.content ?? ''), facts)
    return {
      ...fallback,
      unverified: true,
      verdict: `${fallback.verdict}（无法核验：该请求没有携带结构化输入）`,
    }
  }
  const fromPaths = structured.paths.length
    ? `rm -rf ${structured.paths.map(path => JSON.stringify(path)).join(' ')}`
    : ''
  const first = structured.command
    ? assessDestructiveRequest(structured.command, facts)
    : undefined
  if (first && !first.undetermined && first.targets.length) return first
  if (fromPaths) {
    const fromTargets = assessDestructiveRequest(fromPaths, facts)
    if (!fromTargets.undetermined && fromTargets.targets.length) return fromTargets
  }
  return first ?? assessDestructiveRequest(String(input.content ?? ''), facts)
}

export function protectedMatch(path: string | undefined): ProtectedMatch {
  if (!path) return { protected: false }
  for (const entry of PROTECTED_RULES) {
    if (entry.test(path)) return { protected: true, rule: entry.rule }
  }
  return { protected: false }
}

export function touchesUserData(path: string | undefined): boolean {
  if (!path) return false
  return USER_DATA_DIRECTORIES.some(directory => (
    new RegExp(`(^|/)${directory}(/|$)`).test(path)
  ))
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * Merge the parsed targets with measured facts into what the card shows.
 * `undetermined` is the gate for the "allow" button: no reason, no allow.
 */
/**
 * Approval requests carry the tool input, not always a shell command: a `bash` call arrives
 * as {"command":"rm -rf x"} and the deletion tool as {"path":"/x","purpose":"…"}.
 * Reading that JSON as if it were a command made a perfectly clear absolute path look
 * "undetermined", so unwrap it before parsing.
 */
export function normalizeAssessmentInput(text: string): string {
  let value = String(text ?? '').trim()
  for (let pass = 0; pass < 3; pass += 1) {
    if (value.startsWith('{')) {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>
        const command = typeof parsed.command === 'string' ? parsed.command.trim() : ''
        if (command) {
          value = command
          continue
        }
        const path = typeof parsed.path === 'string' ? parsed.path.trim() : ''
        if (path) {
          value = `rm -rf ${JSON.stringify(path)}`
          continue
        }
        // An argv shape describes the same execution as a command string.
        const argv = Array.isArray(parsed.argv)
          ? parsed.argv
          : Array.isArray(parsed.args)
            ? parsed.args
            : null
        if (argv?.length) {
          value = argv.map(item => String(item)).join(' ')
          continue
        }
      } catch {
        // Not JSON after all: treat the text as the command.
      }
      break
    }
    // A JSON string literal carries the real command with its escaping resolved.
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
      try {
        const decoded = JSON.parse(value) as unknown
        if (typeof decoded === 'string' && decoded.trim()) {
          value = decoded.trim()
          continue
        }
      } catch {
        // Not a JSON string after all: fall through to plain unwrapping.
      }
    }
    // A command that arrives wrapped in its own quotes is a single shell word: unwrap it,
    // otherwise `"rm -rf /x"` reads as one token and the target looks undetermined.
    const quote = value[0]
    if (value.length > 1 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1).trim()
      continue
    }
    break
  }
  return value
}

/**
 * A command may create the very directory it deletes. The pre-flight check then sees a
 * missing (or tiny) target and waves it through, which is how
 * `mkdir -p X; …; rm -rf X` deleted 1200 freshly written files.
 */
function createdPrefixes(command: string): string[] {
  const prefixes: string[] = []
  const unquote = (value: string) => value.replace(/^['"]|['"]$/g, '')
  for (const match of command.matchAll(/mkdir\s+(?:-p\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const value = unquote(match[1] ?? '').trim()
    if (value) prefixes.push(value)
  }
  for (const match of command.matchAll(/>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const value = unquote(match[1] ?? '').trim()
    if (!value || value.startsWith('&')) continue
    const parent = value.replace(/\/[^/]*$/, '')
    if (parent) prefixes.push(parent)
  }
  return prefixes
}

export function assessDestructiveRequest(
  command: string,
  facts: DestructiveFacts[] = [],
  cwd = '/',
): DestructiveAssessment {
  const targets = parseDestructiveTargets(normalizeAssessmentInput(command), cwd)
    // The parser expands substitutions to judge the outer command; a target that still
    // contains one cannot be pinned down, whatever shape it arrived in.
    .map(target => (/\$\(|`|\$\{|\$[A-Za-z_]/.test(String(target.raw ?? ''))
      ? {
          ...target,
          kind: 'unknown' as const,
          reason: '目标含变量或命令替换，无法确定',
        }
      : target))
    // Creating the target earlier in the same command makes its current state meaningless.
    .map(target => {
      const path = String(target.path ?? '')
      if (!path) return target
      const created = createdPrefixes(normalizeAssessmentInput(command)).some(prefix => (
        path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
      ))
      return created
        ? {
            ...target,
            kind: 'unknown' as const,
            reason: '同一条命令里先创建了该目标再删除，执行前无法确定其内容',
          }
        : target
    })
  const protections: string[] = []
  let touchesUserDataFlag = false
  // "Undetermined" only means we saw a delete whose target we cannot pin down. A
  // command with no delete at all is not a destructive request and is not gated here.
  let undetermined = targets.some(target => target.kind === 'unknown')

  targets.forEach((target, index) => {
    const match = protectedMatch(target.path)
    if (match.protected && match.rule) protections.push(match.rule)
    if (touchesUserData(target.path)) touchesUserDataFlag = true
    const fact = facts[index]
    if (target.kind === 'unknown') undetermined = true
    if (fact && fact.gitTracked === false && fact.inGitRepository) {
      // in a repo but untracked: git cannot bring it back
    }
  })

  const untracked = facts.some(fact => fact.inGitRepository && fact.gitTracked === false)
  const rebuildable = facts.some(fact => fact.rebuildable)
  const irrecoverable = !rebuildable && facts.length > 0
  const missing = facts.some((fact, index) => fact.exists === false && targets[index]?.kind !== 'unknown')

  // Risk is informational: it no longer decides whether the reader may allow. Only an
  // unknown target or a protected path is refused outright.
  let risk: DestructiveAssessment['risk'] = 'low'
  if (protections.length || touchesUserDataFlag) risk = 'high'
  else if (untracked && !rebuildable) risk = 'medium'
  else if (undetermined || missing) risk = 'medium'

  const parts: string[] = []
  if (protections.length) parts.push(`命中受保护清单（${protections.join('、')}）`)
  else if (touchesUserDataFlag) parts.push('落在用户数据目录')
  else if (untracked && !rebuildable) parts.push('未跟踪且无备份，无法恢复')
  else if (undetermined) parts.push('目标无法确定')
  else if (missing) parts.push('目标不存在')
  else if (rebuildable) parts.push('可重建，未触及用户数据')
  else parts.push('目标明确，未触及用户数据')

  const size = facts.find(fact => typeof fact.totalBytes === 'number' && typeof fact.fileCount === 'number')
  if (size) {
    parts.push(`${size.fileCount} 个文件 / ${formatBytes(size.totalBytes ?? 0)}${size.sampled ? '（仅采样）' : ''}`)
  }

  return {
    targets,
    protections,
    undetermined,
    // The allow button is gated on this: unknown scope or a protected path, nothing else.
    canAllow: !undetermined && protections.length === 0,
    irrecoverable,
    verdict: `风险：${risk === 'high' ? '高' : risk === 'medium' ? '中' : '低'}（${parts.join('；')}）`,
    risk,
    touchesUserData: touchesUserDataFlag,
  }
}
