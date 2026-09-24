/**
 * Keep one MilkSU host window for product-loop.
 * Closes daily Stable and leftover checkout Electron. Leaves Cursor, Beta,
 * helpers, Calculator, and isolated-browser Chromium alone.
 */

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import {
  CdpSession,
  delay,
  killProcessGroup,
  listDesktopCdpTargets,
  repositoryRoot,
} from './desktop-gui-driver.mjs'

const execFileAsync = promisify(execFile)

export function normalizeHostCommand(command) {
  return String(command ?? '').replace(/\\/g, '/')
}

export function classifyMilkSUHostCommand(command, repoRoot = '') {
  const text = normalizeHostCommand(command)
  if (!text.trim()) return 'other'
  if (/Cursor\.app(?:\/|$)|\/Cursor(?:\.exe)?(?:\s|$)/i.test(text)) return 'cursor'
  if (/MilkSU Beta\.app|MilkSU Beta\.exe|MilkSU-Beta/i.test(text)) return 'beta'
  if (/Helper|plugin-container/i.test(text)) return 'helper'
  const repo = normalizeHostCommand(repoRoot)
  if (repo && text.toLowerCase().includes(`${repo.toLowerCase()}/build/bin/`) && /MilkSU\.app\/Contents\/MacOS\/MilkSU/i.test(text)) {
    return 'packaged-repo'
  }
  if (
    /MilkSU\.app\/Contents\/MacOS\/MilkSU(?:\s|$)/i.test(text)
    || /(?:^|\/)MilkSU\.exe(?:\s|$)/i.test(text)
    || /\/opt\/MilkSU\/|MilkSU-Linux/i.test(text)
  ) {
    return 'packaged-stable'
  }
  if (repo && text.toLowerCase().includes(repo.toLowerCase()) && /electron/i.test(text)) {
    return 'unpackaged-repo'
  }
  return 'other'
}

export function parsePsTable(stdout) {
  const rows = []
  for (const line of String(stdout ?? '').split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    })
  }
  return rows
}

export function descendantPids(rows, rootPids) {
  const keep = new Set([...rootPids].map(Number).filter(pid => Number.isInteger(pid) && pid > 0))
  const children = new Map()
  for (const row of rows) {
    const list = children.get(row.ppid) || []
    list.push(row.pid)
    children.set(row.ppid, list)
  }
  const stack = [...keep]
  while (stack.length) {
    const pid = stack.pop()
    for (const child of children.get(pid) || []) {
      if (keep.has(child)) continue
      keep.add(child)
      stack.push(child)
    }
  }
  return keep
}

export function selectForeignMilkSUHosts(rows, options = {}) {
  const repoRoot = options.repoRoot || repositoryRoot
  const keepPids = options.keepPids instanceof Set ? options.keepPids : new Set(options.keepPids || [])
  return rows
    .filter(row => {
      if (keepPids.has(row.pid)) return false
      if (/milksu(?:-beta)?:\/\//i.test(row.command)) return false
      const kind = classifyMilkSUHostCommand(row.command, repoRoot)
      return kind === 'unpackaged-repo' || kind === 'packaged-repo' || kind === 'packaged-stable'
    })
    .map(row => ({
      ...row,
      kind: classifyMilkSUHostCommand(row.command, repoRoot),
    }))
}

export function describeExclusiveWindows(result = {}) {
  const remaining = Number(result.remaining ?? 0)
  const closed = Number(result.closed ?? 0)
  if (!closed) return remaining <= 1 ? '窗口只留测试窗' : `窗口仍有 ${remaining} 扇，没清干净`
  const kinds = (result.closedKinds || []).join('、')
  return kinds
    ? `窗口关掉 ${closed} 扇（${kinds}），只留测试窗`
    : `窗口关掉 ${closed} 扇，只留测试窗`
}

function keepPortsFrom(options = {}) {
  const ports = new Set()
  const driver = options.driver
  const port = Number(driver?.preferredPort ?? driver?.target?.port ?? options.port ?? 0)
  if (Number.isInteger(port) && port > 0) ports.add(port)
  for (const item of options.ports || []) {
    const value = Number(item)
    if (Number.isInteger(value) && value > 0) ports.add(value)
  }
  return ports
}

function keepPidsFrom(options = {}, rows = []) {
  const roots = new Set()
  const driver = options.driver
  const childPid = Number(driver?.startedChild?.pid ?? options.pid ?? 0)
  if (Number.isInteger(childPid) && childPid > 0) roots.add(childPid)
  for (const item of options.pids || []) {
    const value = Number(item)
    if (Number.isInteger(value) && value > 0) roots.add(value)
  }
  return descendantPids(rows, roots)
}

export function ancestorPids(rows, pids, repoRoot = '') {
  const byPid = new Map(rows.map(row => [row.pid, row]))
  const keep = new Set()
  for (const raw of pids || []) {
    let pid = Number(raw)
    const seen = new Set()
    while (Number.isInteger(pid) && pid > 1 && !seen.has(pid)) {
      seen.add(pid)
      keep.add(pid)
      const row = byPid.get(pid)
      if (!row?.ppid || row.ppid <= 1) break
      const parent = byPid.get(row.ppid)
      if (!parent) break
      const kind = classifyMilkSUHostCommand(parent.command, repoRoot)
      const command = normalizeHostCommand(parent.command)
      const harness = /(?:^|\/)(npm|node|electron)(?:\.exe)?(?:\s|$)/i.test(command)
        || (repoRoot && command.toLowerCase().includes(String(repoRoot).toLowerCase()))
      if (kind === 'packaged-stable' || kind === 'cursor' || kind === 'beta' || kind === 'helper') break
      if (!harness && kind === 'other') break
      pid = row.ppid
    }
  }
  return keep
}

export function mergeKeepPids(processKeep, portKeep, rows = [], repoRoot = '') {
  const roots = new Set()
  for (const pid of [...(processKeep || []), ...(portKeep || [])]) {
    const value = Number(pid)
    if (Number.isInteger(value) && value > 0) roots.add(value)
  }
  return descendantPids(rows, ancestorPids(rows, roots, repoRoot))
}

async function pidsListeningOnPorts(ports) {
  const wanted = [...ports].map(Number).filter(port => Number.isInteger(port) && port > 0)
  if (!wanted.length) return new Set()
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalAddress 127.0.0.1 -State Listen -ErrorAction SilentlyContinue | Where-Object { @(${wanted.join(',')}) -contains $_.LocalPort } | ForEach-Object { $_.OwningProcess }`,
      ], {
        encoding: 'utf8',
        timeout: 8_000,
      })
      return new Set(String(stdout).split(/\s+/).map(Number).filter(pid => Number.isInteger(pid) && pid > 0))
    } catch {
      return new Set()
    }
  }
  const keep = new Set()
  for (const port of wanted) {
    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
        encoding: 'utf8',
        timeout: 5_000,
      })
      for (const line of stdout.split('\n')) {
        const match = line.trim().match(/^\S+\s+(\d+)\s+/)
        if (match) keep.add(Number(match[1]))
      }
    } catch {
      // Port already gone.
    }
  }
  return keep
}

async function listProcessRows() {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1} {2}" -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }',
    ], {
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    return parsePsTable(stdout)
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  return parsePsTable(stdout)
}

export async function claimProductLoopProtocol(options = {}) {
  if (process.platform !== 'darwin') return { ok: true, detail: '' }
  const repoRoot = options.repoRoot || repositoryRoot
  const keeper = `${repoRoot}/build/bin/MilkSU.app`
  const binary = `${keeper}/Contents/MacOS/MilkSU`
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  let dump = ''
  try {
    const listed = await execFileAsync(lsregister, ['-dump'], { encoding: 'utf8', timeout: 20_000, maxBuffer: 32 * 1024 * 1024 })
    dump = listed.stdout
  } catch {
    return { ok: false, detail: '读不到协议登记' }
  }
  const paths = new Set()
  for (const line of dump.split('\n')) {
    const match = line.match(/path:\s+(\/.*MilkSU\.app)\s+\(/)
    if (match) paths.add(match[1])
  }
  for (const appPath of paths) {
    if (appPath === keeper) continue
    await execFileAsync(lsregister, ['-u', appPath], { timeout: 10_000 }).catch(() => {})
  }
  await execFileAsync(lsregister, ['-f', keeper], { timeout: 10_000 }).catch(() => {})
  await execFileAsync(binary, [], {
    env: { ...process.env, MILKSU_REGISTER_PROTOCOL: '1' },
    timeout: 20_000,
  }).catch(() => {})
  return { ok: true, detail: 'milksu 协议交给仓库测试包' }
}

export async function listMilkSUHostProcesses(options = {}) {
  const rows = await listProcessRows().catch(() => [])
  const portPids = await pidsListeningOnPorts(keepPortsFrom(options))
  const keepPids = mergeKeepPids(
    keepPidsFrom(options, rows),
    portPids,
    rows,
    options.repoRoot || repositoryRoot,
  )
  const hosts = selectForeignMilkSUHosts(rows, {
    repoRoot: options.repoRoot || repositoryRoot,
    keepPids: new Set(),
  })
  return {
    rows,
    keepPids,
    hosts,
    foreign: hosts.filter(row => !keepPids.has(row.pid)),
  }
}

export async function closeCdpBrowser(port) {
  const value = Number(port)
  if (!Number.isInteger(value) || value <= 0) return false
  try {
    const response = await fetch(`http://127.0.0.1:${value}/json/version`, {
      signal: AbortSignal.timeout(400),
    })
    if (!response.ok) return false
    const version = await response.json()
    const url = String(version?.webSocketDebuggerUrl ?? '')
    if (!url) return false
    const session = new CdpSession(url)
    await session.open()
    await session.send('Browser.close').catch(() => {})
    session.close()
    return true
  } catch {
    return false
  }
}

function killHost(row, signal) {
  if (process.platform === 'win32') {
    spawn('taskkill', signal === 'SIGKILL'
      ? ['/PID', String(row.pid), '/T', '/F']
      : ['/PID', String(row.pid), '/T'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(row.pid, signal)
  } catch {
    // Already gone.
  }
}

async function terminateHosts(rows, signal) {
  for (const row of rows) {
    if (row.kind === 'unpackaged-repo' && row.pid) {
      killProcessGroup({ pid: row.pid, exitCode: null }, signal)
    }
    killHost(row, signal)
  }
}

function kindLabels(rows) {
  const labels = {
    'packaged-stable': '日常安装包',
    'packaged-repo': '仓库测试包',
    'unpackaged-repo': '残留 Electron',
  }
  return [...new Set(rows.map(row => labels[row.kind] || row.kind))]
}

/**
 * Close every MilkSU host that is not the bound product-loop window.
 * When keep is empty, close all of them so the next launch is the only window.
 */
export async function keepExclusiveMilkSUWindow(options = {}) {
  const keepPorts = keepPortsFrom(options)
  const listed = await listMilkSUHostProcesses(options)
  const foreign = listed.foreign
  const targets = await listDesktopCdpTargets().catch(() => [])
  const foreignPorts = [...new Set(targets.map(target => target.port))]
    .filter(port => !keepPorts.has(port))

  for (const port of foreignPorts) {
    await closeCdpBrowser(port)
  }

  await terminateHosts(foreign, 'SIGTERM')
  const deadline = Date.now() + Number(options.timeoutMs || 8_000)
  let remaining = foreign
  while (Date.now() < deadline) {
    const next = await listMilkSUHostProcesses(options)
    remaining = next.foreign
    if (!remaining.length) break
    await delay(250)
  }
  if (remaining.length) await terminateHosts(remaining, 'SIGKILL')
  await delay(200)
  const after = await listMilkSUHostProcesses(options)
  const result = {
    closed: foreign.length,
    closedKinds: kindLabels(foreign),
    remaining: after.hosts.length,
    kept: after.keepPids.size,
    detail: '',
  }
  result.detail = describeExclusiveWindows(result)
  if (options.log !== false && result.closed) {
    process.stdout.write(`WINDOW ${result.detail}\n`)
  }
  return result
}

export function startProductLoopHostWatch(options = {}) {
  const intervalMs = Number(options.intervalMs || 4_000)
  const state = { anomaly: '' }
  const timer = setInterval(() => {
    const watchOptions = typeof options.getOptions === 'function' ? options.getOptions() : options
    listMilkSUHostProcesses(watchOptions)
      .then(async listed => {
        if (!listed.foreign.length || !listed.keepPids?.size) return
        const detail = `多开了 ${listed.foreign.length} 扇 MilkSU（${kindLabels(listed.foreign).join('、')}）`
        process.stdout.write(`WATCH ${detail}\n`)
        await keepExclusiveMilkSUWindow({ ...watchOptions, log: true })
        const after = await listMilkSUHostProcesses(watchOptions)
        if (after.foreign.length) state.anomaly = `还开着 ${after.foreign.length} 扇 MilkSU（${kindLabels(after.foreign).join('、')}）`
      })
      .catch(() => {})
  }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return {
    stop() {
      clearInterval(timer)
    },
    take() {
      const detail = state.anomaly
      state.anomaly = ''
      return detail
    },
  }
}
