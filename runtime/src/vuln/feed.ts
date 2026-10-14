import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'node:path'
import { formatRFC3339, formatSnapshotStamp } from './ids.ts'
import { CVE_ID_PATTERN } from './ids.ts'
import { pathWithin } from './policy.ts'

export const CISA_KEV_FEED_NAME = 'CISA KEV'
export const CISA_KEV_FEED_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
export const NVD_CVE_FEED_NAME = 'NVD'
export const NVD_CVE_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0'
export const FIRST_EPSS_FEED_NAME = 'FIRST EPSS'
export const FIRST_EPSS_API_URL = 'https://api.first.org/data/v1/epss'
export const OSV_CVE_FEED_NAME = 'OSV'
export const OSV_CVE_API_URL = 'https://api.osv.dev/v1/vulns'
export const GITHUB_ADVISORIES_NAME = 'GitHub Advisory Database'
export const GITHUB_ADVISORIES_API_URL = 'https://api.github.com/advisories'
export const VULHUB_PRACTICE_CATALOG = 'Vulhub Practice Catalog'
export const VULHUB_REPO_API_URL = 'https://api.github.com/repos/vulhub/vulhub'
export const VULHUB_REPO_WEB_URL = 'https://github.com/vulhub/vulhub'
const VULHUB_DEFAULT_BRANCH = 'master'
const MAX_FEED_BYTES = 12 << 20
const USER_AGENT = 'MilkSU-CVE-Learning/0.1'

export type FeedSnapshotDownload = {
  sourceName: string
  sourceUrl: string
  retrievedAt: string
  lastModified: string
  httpStatus: number
  contentType: string
  body: string
  snapshotPath?: string
  snapshotSha256?: string
  snapshotSizeBytes?: number
}

export async function fetchCISAKEVFeed(fetcher: typeof fetch = fetch): Promise<FeedSnapshotDownload> {
  return fetchFeedSnapshot(CISA_KEV_FEED_NAME, CISA_KEV_FEED_URL, fetcher)
}

export async function fetchNVDCVE(cveId: string, apiUrl = NVD_CVE_API_URL, fetcher: typeof fetch = fetch): Promise<FeedSnapshotDownload> {
  const normalized = cveId.trim().toUpperCase()
  if (!CVE_ID_PATTERN.test(normalized)) throw new Error('fetch NVD CVE: invalid CVE id')
  const parsed = parseHttpUrl(apiUrl, 'fetch NVD CVE')
  parsed.searchParams.set('cveId', normalized)
  return fetchFeedSnapshot(NVD_CVE_FEED_NAME, parsed.toString(), fetcher)
}

export async function searchNVDCVEs(
  queryText: string,
  apiUrl = NVD_CVE_API_URL,
  limit = 10,
  fetcher: typeof fetch = fetch,
): Promise<FeedSnapshotDownload> {
  const text = queryText.trim()
  if ([...text].length < 2 || text.length > 160) {
    throw new Error('search NVD CVEs: enter 2 to 160 characters')
  }
  const page = limit < 1 || limit > 20 ? 10 : limit
  const parsed = parseHttpUrl(apiUrl, 'search NVD CVEs')
  const normalized = text.toUpperCase()
  if (CVE_ID_PATTERN.test(normalized)) {
    parsed.searchParams.set('cveId', normalized)
  } else {
    parsed.searchParams.set('keywordSearch', text)
    parsed.searchParams.set('resultsPerPage', String(page))
    parsed.searchParams.set('noRejected', '')
  }
  return fetchFeedSnapshot(NVD_CVE_FEED_NAME, parsed.toString(), fetcher)
}

export async function fetchFIRSTEPSS(cveId: string, apiUrl = FIRST_EPSS_API_URL, fetcher: typeof fetch = fetch): Promise<FeedSnapshotDownload> {
  const normalized = cveId.trim().toUpperCase()
  if (!CVE_ID_PATTERN.test(normalized)) throw new Error('fetch FIRST EPSS: invalid CVE id')
  const parsed = parseHttpUrl(apiUrl, 'fetch FIRST EPSS')
  parsed.searchParams.set('cve', normalized)
  return fetchFeedSnapshot(FIRST_EPSS_FEED_NAME, parsed.toString(), fetcher)
}

export async function fetchOSVCVE(cveId: string, apiUrl = OSV_CVE_API_URL, fetcher: typeof fetch = fetch): Promise<FeedSnapshotDownload> {
  const normalized = cveId.trim().toUpperCase()
  if (!CVE_ID_PATTERN.test(normalized)) throw new Error('fetch OSV CVE: invalid CVE id')
  const parsed = parseHttpUrl(apiUrl, 'fetch OSV CVE')
  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/${encodeURIComponent(normalized)}`
  return fetchFeedSnapshot(OSV_CVE_FEED_NAME, parsed.toString(), fetcher)
}

export async function fetchGitHubAdvisories(
  cveId: string,
  apiUrl = GITHUB_ADVISORIES_API_URL,
  fetcher: typeof fetch = fetch,
): Promise<FeedSnapshotDownload> {
  const normalized = cveId.trim().toUpperCase()
  if (!CVE_ID_PATTERN.test(normalized)) throw new Error('fetch GitHub advisories: invalid CVE id')
  const parsed = parseHttpUrl(apiUrl, 'fetch GitHub advisories')
  parsed.searchParams.set('cve_id', normalized)
  parsed.searchParams.set('per_page', '10')
  return fetchFeedSnapshot(GITHUB_ADVISORIES_NAME, parsed.toString(), fetcher)
}

export async function fetchVulhubPracticeCatalog(
  repoApiUrl = VULHUB_REPO_API_URL,
  repoWebUrl = VULHUB_REPO_WEB_URL,
  branchName = VULHUB_DEFAULT_BRANCH,
  fetcher: typeof fetch = fetch,
): Promise<FeedSnapshotDownload> {
  const api = repoApiUrl.replace(/\/$/, '')
  const web = repoWebUrl.replace(/\/$/, '')
  const branch = branchName || VULHUB_DEFAULT_BRANCH
  const { body: branchBody, headers: branchHeaders } = await fetchGitHubJSON<{ commit?: { sha?: string } }>(
    `${api}/branches/${encodeURIComponent(branch)}`,
    fetcher,
  )
  const commitSha = String(branchBody.commit?.sha ?? '').trim()
  if (!commitSha) throw new Error('fetch Vulhub catalog: GitHub branch response did not include commit sha')
  const { body: tree, headers: treeHeaders } = await fetchGitHubJSON<{
    sha?: string
    truncated?: boolean
    tree?: Array<{ path?: string; type?: string }>
  }>(`${api}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`, fetcher)
  if (tree.truncated) throw new Error('fetch Vulhub catalog: GitHub tree response was truncated')
  let retrievedAt = retrievedAtFromHeaders(treeHeaders)
  if (!retrievedAt) retrievedAt = retrievedAtFromHeaders(branchHeaders)
  const catalog = buildVulhubCatalog(tree, commitSha, branch, web, retrievedAt)
  return {
    sourceName: VULHUB_PRACTICE_CATALOG,
    sourceUrl: web,
    retrievedAt,
    lastModified: treeHeaders.get('Last-Modified') ?? '',
    httpStatus: 200,
    contentType: 'application/json',
    body: `${JSON.stringify(catalog, null, 2)}`,
  }
}

export async function fetchFeedSnapshot(
  sourceName: string,
  sourceUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<FeedSnapshotDownload> {
  const parsed = parseHttpUrl(sourceUrl, 'create vulnerability feed request')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  let response: Response
  try {
    response = await fetcher(parsed.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    })
  } catch (error) {
    throw new Error(`fetch vulnerability feed: ${error instanceof Error ? error.message : error}`)
  } finally {
    clearTimeout(timer)
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`fetch vulnerability feed: unexpected HTTP ${response.status}`)
  }
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mediaType && !mediaType.includes('json')) {
    throw new Error(`fetch vulnerability feed: unexpected content type ${JSON.stringify(contentType)}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_FEED_BYTES) {
    throw new Error(`read vulnerability feed: payload exceeds ${MAX_FEED_BYTES} bytes`)
  }
  return {
    sourceName,
    sourceUrl: parsed.toString(),
    retrievedAt: retrievedAtFromHeaders(response.headers),
    lastModified: response.headers.get('Last-Modified') ?? '',
    httpStatus: response.status,
    contentType,
    body: buffer.toString('utf8'),
  }
}

export async function persistFeedSnapshot(
  root: string,
  download: FeedSnapshotDownload,
): Promise<FeedSnapshotDownload> {
  const dataRoot = root.trim()
  if (!dataRoot) throw new Error('persist vulnerability feed snapshot: data directory is required')
  const body = Buffer.from(download.body ?? '', 'utf8')
  if (body.length === 0) throw new Error('persist vulnerability feed snapshot: body is empty')
  const digest = createHash('sha256').update(body).digest('hex')
  const sourceSlug = feedSnapshotSourceSlug(download.sourceName)
  const timestamp = feedSnapshotTimestamp(download.retrievedAt, download.lastModified)
  const directory = join(dataRoot, 'domain', 'vuln', 'feed-snapshots', sourceSlug)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${timestamp}-${digest.slice(0, 16)}.json`)
  const tmpPath = `${path}.tmp`
  await writeFile(tmpPath, body, { mode: 0o600 })
  try {
    await rename(tmpPath, path)
  } catch (error) {
    try {
      await unlink(tmpPath)
    } catch {
      // ignore
    }
    throw new Error(`commit vulnerability feed snapshot: ${error instanceof Error ? error.message : error}`)
  }
  try {
    await chmod(path, 0o600)
  } catch {
    // ignore
  }
  return {
    ...download,
    snapshotPath: path,
    snapshotSha256: digest,
    snapshotSizeBytes: body.length,
  }
}

export async function resolveFeedSnapshotPath(root: string, snapshotPath: string): Promise<string> {
  const dataRoot = root.trim()
  const path = snapshotPath.trim()
  if (!dataRoot) throw new Error('resolve CVE Feed snapshot: data directory is required')
  if (!path) throw new Error('resolve CVE Feed snapshot: snapshot path is required')
  if (!isAbsolute(dataRoot)) throw new Error('resolve CVE Feed snapshot: data directory must be absolute')
  if (!isAbsolute(path)) throw new Error('resolve CVE Feed snapshot: snapshot path must be absolute')
  const base = join(dataRoot, 'domain', 'vuln', 'feed-snapshots')
  if (extname(path) !== '.json') throw new Error('resolve CVE Feed snapshot: snapshot must be a JSON file')
  if (!pathWithin(base, path)) {
    throw new Error('resolve CVE Feed snapshot: snapshot escaped the feed snapshot directory')
  }
  await verifyFeedSnapshotFileChain(base, path)
  return path
}

async function verifyFeedSnapshotFileChain(base: string, snapshotPath: string): Promise<void> {
  const baseInfo = await lstat(base)
  if (baseInfo.isSymbolicLink()) throw new Error('resolve CVE Feed snapshot: snapshot root cannot be a symlink')
  if (!baseInfo.isDirectory()) throw new Error('resolve CVE Feed snapshot: snapshot root is not a directory')
  const relativePath = relative(base, snapshotPath)
  if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('resolve CVE Feed snapshot: snapshot escaped the feed snapshot directory')
  }
  let current = base
  const parts = relativePath.split(sep)
  for (const [index, part] of parts.entries()) {
    if (!part || part === '.') continue
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) {
      throw new Error('resolve CVE Feed snapshot: snapshot path cannot contain symlinks')
    }
    if (index === parts.length - 1) {
      if (!info.isFile()) throw new Error('resolve CVE Feed snapshot: snapshot is not a regular file')
      continue
    }
    if (!info.isDirectory()) throw new Error('resolve CVE Feed snapshot: snapshot parent is not a directory')
  }
  const info = await stat(snapshotPath)
  if (!info.isFile()) throw new Error('resolve CVE Feed snapshot: snapshot is not a regular file')
}

function parseHttpUrl(sourceUrl: string, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(sourceUrl.trim())
  } catch (error) {
    throw new Error(`${label}: invalid URL: ${error instanceof Error ? error.message : error}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label}: unsupported URL scheme ${JSON.stringify(parsed.protocol.replace(/:$/, ''))}`)
  }
  if (!parsed.host) throw new Error(`${label}: URL host is required`)
  return parsed
}

async function fetchGitHubJSON<T>(
  sourceUrl: string,
  fetcher: typeof fetch,
): Promise<{ body: T; headers: Headers }> {
  const parsed = parseHttpUrl(sourceUrl, 'create GitHub request')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  let response: Response
  try {
    response = await fetcher(parsed.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    })
  } catch (error) {
    throw new Error(`fetch GitHub JSON: ${error instanceof Error ? error.message : error}`)
  } finally {
    clearTimeout(timer)
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`fetch GitHub JSON: unexpected HTTP ${response.status}`)
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mediaType && !mediaType.includes('json')) {
    throw new Error(`fetch GitHub JSON: unexpected content type ${JSON.stringify(contentType)}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_FEED_BYTES) {
    throw new Error(`read GitHub JSON: payload exceeds ${MAX_FEED_BYTES} bytes`)
  }
  return { body: JSON.parse(buffer.toString('utf8')) as T, headers: response.headers }
}

function buildVulhubCatalog(
  tree: { sha?: string; tree?: Array<{ path?: string; type?: string }> },
  commitSha: string,
  branchName: string,
  repoWebUrl: string,
  retrievedAt: string,
) {
  const composeDirs = new Set<string>()
  for (const entry of tree.tree ?? []) {
    if (entry.type !== 'blob' || !entry.path) continue
    if (!isComposePath(entry.path)) continue
    const directory = pathDirectory(entry.path)
    if (directory) composeDirs.add(directory)
  }
  const keys: Array<{ cveId: string; directory: string }> = []
  for (const directory of composeDirs) {
    const matches = directory.match(/CVE-\d{4}-\d{4,}/gi) ?? []
    for (const match of matches) {
      keys.push({ cveId: match.toUpperCase(), directory })
    }
  }
  keys.sort((left, right) => {
    if (left.cveId === right.cveId) return left.directory < right.directory ? -1 : 1
    return left.cveId < right.cveId ? -1 : 1
  })
  const shortSha = commitSha.length > 12 ? commitSha.slice(0, 12) : commitSha
  const revision = `vulhub/vulhub ${branchName} ${shortSha} · GitHub tree ${tree.sha ?? ''} · ${retrievedAt}`
  const items = keys.map((key) => {
    const component = key.directory.split('/')[0] || 'Vulhub'
    return {
      cveId: key.cveId,
      title: `Vulhub · ${component} · ${key.cveId} Docker Compose`,
      directory: key.directory,
      sourceLabel: `vulhub/${key.directory}`,
      sourceHref: `${repoWebUrl}/tree/${encodeURIComponent(commitSha)}/${escapeGitHubPath(key.directory)}`,
      revision,
      ports: ['待确认端口（需读取 docker-compose.yml）'],
      resources: '待确认镜像缓存、CPU、内存和磁盘占用；启动前由用户确认。',
      network: '默认仅允许本机 loopback；不继承平台 Cookie、Token、浏览器会话或 Provider Credential。',
      cleanup: '停止 compose project，清理临时容器/卷；保留用户笔记和学习证据。',
      safety: [
        '只读 GitHub catalog 同步只绑定目录，不拉取镜像、不启动容器。',
        '开放端口、运行触发输入或访问外部目标都需要用户逐次确认。',
        '练习成功只代表本地学习完成，不证明任何真实资产可被利用。',
      ],
      matchReason: `GitHub 只读目录树发现 ${key.directory} 含 Docker Compose 与 ${key.cveId}；仅作为本地隔离练习候选。`,
      environmentId: `vulhub-${key.cveId.toLowerCase().replaceAll('_', '-')}`,
    }
  })
  return {
    sourceName: VULHUB_PRACTICE_CATALOG,
    sourceUrl: repoWebUrl,
    retrievedAt,
    revision,
    commit: commitSha,
    itemCount: items.length,
    items,
  }
}

function isComposePath(path: string): boolean {
  return path.endsWith('/docker-compose.yml')
    || path.endsWith('/docker-compose.yaml')
    || path.endsWith('/compose.yml')
    || path.endsWith('/compose.yaml')
}

function pathDirectory(path: string): string {
  for (const marker of ['/docker-compose.', '/compose.']) {
    const index = path.indexOf(marker)
    if (index >= 0) return path.slice(0, index)
  }
  return ''
}

function escapeGitHubPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function retrievedAtFromHeaders(headers: Headers): string {
  for (const key of ['Last-Modified', 'Date']) {
    const value = headers.get(key)
    if (!value) continue
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return formatRFC3339(new Date(parsed))
  }
  return formatRFC3339()
}

function feedSnapshotSourceSlug(sourceName: string): string {
  const slug = sourceName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'feed'
}

function feedSnapshotTimestamp(...values: string[]): string {
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed)) return formatSnapshotStamp(new Date(parsed))
    const safe = trimmed.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-+|-+$/g, '')
    if (safe) return safe.length > 32 ? safe.slice(0, 32) : safe
  }
  return formatSnapshotStamp(new Date())
}


