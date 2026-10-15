import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { GrantStore } from './grants.ts'
import { computerUseSessionRoot, computerUseSocket } from './hostpath.ts'
import {
  cleanupEndpoint,
  copyDriverBundle,
  defaultCommandFactory,
  driverEnvironment,
  ensureDriverSandbox,
  findRepositoryRoot,
  inspectDriverFile,
  missingDriverResult,
  newSessionId,
  preparedDriverPath,
  resolveDriverBinary,
  runReviewedWindowsBuild,
  rustcLooksUsable,
  sidecarBuildCandidate,
  sourceBuildRuntimeCandidate,
  stopChild,
  verifyDriverVersion,
  waitForChildExit,
  waitForEndpoint,
  windowsBuildScript,
  type CommandFactory,
} from './driver.ts'
import {
  cleanupRuntimeDirectory,
  createRuntimeDirectory,
  defaultTarget,
  filterValidTargets,
  resolveGrantedTarget,
  sessionDirectory,
  sessionManifestForTarget,
  validBundleId,
  validConversationId,
} from './policy.ts'
import {
  DEFAULT_HOST_BUNDLE_ID,
  DRIVER_VERSION,
  LINUX_COMPUTER_USE_PROBLEM,
  MISSING_DRIVER_PROBLEM,
  linuxPortalDesktopTarget,
  linuxPortalSigning,
  parsePermissionKind,
  permissionsReady,
  publicStatus,
  type Descriptor,
  type LinuxDesktopInfo,
  type PermissionKind,
  type Permissions,
  type PrepareOptions,
  type PrepareResult,
  type SigningStatus,
  type Status,
  type Target,
  type TargetSelection,
} from './types.ts'

export type ManagerOptions = {
  binaryPath?: string
  targetPid?: number
  hostBundleId?: string
  os?: string
  home?: string
  sidecarDir?: string
  grantDirectory?: string
  startTimeoutMs?: number
  permissionProbe?: (prompt: boolean) => Promise<Permissions>
  permissionOpen?: (kind: PermissionKind) => Promise<void>
  signingProbe?: () => Promise<SigningStatus>
  targetProvider?: () => Promise<Target[]>
  hostExecutable?: (pid: number) => Promise<string>
  commandFactory?: CommandFactory
  linuxPortal?: () => Promise<boolean>
  linuxDesktop?: () => Promise<LinuxDesktopInfo>
  startPortal?: (socketPath: string) => Promise<void>
  stopPortal?: () => Promise<void>
}

type Session = {
  conversationId: string
  sessionId: string
  socketPath: string
  directory: string
  startedAt: Date
  child?: ChildProcess
  exit?: Promise<number | null>
  phase: string
  problem: string
  stopping: boolean
  target: Target
  portal?: boolean
}

class Mutex {
  private locked = false
  private readonly waiters: Array<() => void> = []

  async lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  unlock(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.locked = false
  }
}

export class Manager {
  private readonly mu = new Mutex()
  private binaryPath: string
  private readonly targetPid: number
  private hostBundleId: string
  private readonly os: string
  private readonly home: string
  private readonly sidecarDir: string
  private readonly startTimeoutMs: number
  private readonly grants: GrantStore
  private readonly permissionProbe: (prompt: boolean) => Promise<Permissions>
  private readonly permissionOpen: (kind: PermissionKind) => Promise<void>
  private readonly signingProbe: () => Promise<SigningStatus>
  private readonly targetProvider: () => Promise<Target[]>
  private readonly hostExecutable: (pid: number) => Promise<string>
  private readonly commandFactory: CommandFactory
  private readonly linuxPortal: () => Promise<boolean>
  private readonly linuxDesktop: () => Promise<LinuxDesktopInfo>
  private readonly startPortal?: (socketPath: string) => Promise<void>
  private readonly stopPortal?: () => Promise<void>
  private active: Session | null = null
  private readonly implicitRestoreFailed = new Set<string>()

  constructor(options: ManagerOptions = {}) {
    this.binaryPath = String(options.binaryPath ?? '').trim()
    this.targetPid = options.targetPid && options.targetPid > 1 ? options.targetPid : process.pid
    this.os = normalizeOs(options.os)
    this.home = String(options.home ?? '').trim()
    this.sidecarDir = String(options.sidecarDir ?? process.env.MILKSU_SIDECAR_DIR ?? '').trim()
    this.startTimeoutMs = options.startTimeoutMs && options.startTimeoutMs > 0
      ? options.startTimeoutMs
      : this.os === 'linux' ? 90_000 : 16_000
    this.grants = new GrantStore(String(options.grantDirectory ?? '').trim())
    this.permissionProbe = options.permissionProbe ?? (async () => ({ accessibility: false, screenRecording: false }))
    this.permissionOpen = options.permissionOpen ?? (async () => {})
    this.signingProbe = options.signingProbe ?? (async () => ({
      bundleId: DEFAULT_HOST_BUNDLE_ID,
      signature: 'unknown',
      stableIdentity: false,
    }))
    this.targetProvider = options.targetProvider ?? (async () => [])
    this.hostExecutable = options.hostExecutable ?? (async () => '')
    this.commandFactory = options.commandFactory ?? defaultCommandFactory
    this.linuxPortal = options.linuxPortal ?? (async () => false)
    this.linuxDesktop = options.linuxDesktop ?? (async () => ({
      available: false,
      problem: LINUX_COMPUTER_USE_PROBLEM,
    }))
    this.startPortal = options.startPortal
    this.stopPortal = options.stopPortal
    const host = String(options.hostBundleId ?? '').trim()
    this.hostBundleId = validBundleId(host) ? host : resolveHostBundleId(process.env)
  }

  hostBundle(): string {
    return validBundleId(this.hostBundleId) ? this.hostBundleId : DEFAULT_HOST_BUNDLE_ID
  }

  async status(): Promise<Status> {
    await this.mu.lock()
    try {
      const permissions = await this.permissionProbe(false)
      return publicStatus(await this.statusLocked(permissions))
    } finally {
      this.mu.unlock()
    }
  }

  async statusForConversation(conversationId: string): Promise<Status> {
    const status = await this.status()
    try {
      const loaded = await this.grants.load(String(conversationId ?? '').trim())
      status.authorized = loaded.exists
      if (loaded.exists) status.grantedTarget = loaded.grant.target
      return publicStatus(status)
    } catch (error) {
      status.authorized = true
      status.problem = error instanceof Error ? error.message : String(error)
      return publicStatus(status)
    }
  }

  async restore(conversationId: string, implicit = false): Promise<{ status: Status; authorized: boolean }> {
    const id = String(conversationId ?? '').trim()
    if (!validConversationId(id)) throw new Error('invalid Coding conversation id')
    if (this.descriptor(id)) {
      return { status: await this.statusForConversation(id), authorized: true }
    }
    if (implicit && this.implicitRestoreFailed.has(id)) {
      return { status: await this.statusForConversation(id), authorized: true }
    }
    let loaded: { grant: { target: Target }; exists: boolean }
    try {
      loaded = await this.grants.load(id)
    } catch (error) {
      const status = await this.statusForConversation(id)
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { status, authorized: true })
    }
    if (!loaded.exists) {
      return { status: await this.statusForConversation(id), authorized: false }
    }
    await this.mu.lock()
    const active = this.active
    if (active && active.conversationId !== id) {
      const permissions = await this.permissionProbe(false)
      const status = publicStatus(await this.statusLocked(permissions))
      this.mu.unlock()
      throw Object.assign(new Error('Computer Use is already attached to another visible Coding task'), { status })
    }
    this.mu.unlock()
    if (active) {
      const transition = await this.waitForRestoreTransition(id)
      if (transition.ready) return { status: transition.status, authorized: true }
      await this.stop(id, false)
    }
    const targets = await this.targets()
    const target = resolveGrantedTarget(loaded.grant.target, targets)
    try {
      await this.start(id, { pid: target.pid, windowId: target.windowId })
    } catch (error) {
      if (implicit) this.implicitRestoreFailed.add(id)
      throw error
    }
    return { status: await this.statusForConversation(id), authorized: true }
  }

  async restoreImplicit(conversationId: string): Promise<{ status: Status; authorized: boolean }> {
    return this.restore(conversationId, true)
  }

  async requestPermission(kind: PermissionKind): Promise<Status> {
    parsePermissionKind(kind)
    await this.mu.lock()
    const permissions = await this.permissionProbe(false)
    const status = publicStatus(await this.statusLocked(permissions))
    const os = this.os
    this.mu.unlock()
    if (os === 'darwin') await this.permissionOpen(kind)
    return status
  }

  async targets(): Promise<Target[]> {
    if (this.os === 'linux') {
      if (!await this.linuxPortal()) {
        const info = await this.linuxDesktop()
        throw new Error(info.problem || LINUX_COMPUTER_USE_PROBLEM)
      }
      return [linuxPortalDesktopTarget()]
    }
    if (this.os !== 'darwin' && this.os !== 'windows') {
      throw new Error('Computer Use is unavailable on this platform')
    }
    const listed = await this.targetProvider()
    const hostExecutable = await this.hostExecutable(this.targetPid).catch(() => '')
    return filterValidTargets(listed, this.hostBundle(), this.targetPid, hostExecutable)
  }

  async start(conversationId: string, selection: TargetSelection): Promise<Status> {
    const id = String(conversationId ?? '').trim()
    if (!validConversationId(id)) throw new Error('invalid Coding conversation id')
    await this.mu.lock()
    this.implicitRestoreFailed.delete(id)
    if (this.active) {
      const permissions = await this.permissionProbe(false)
      const status = publicStatus(await this.statusLocked(permissions))
      const same = this.active.conversationId === id
      const phase = this.active.phase
      this.mu.unlock()
      if (same && phase === 'ready') return status
      if (same && phase === 'starting') {
        const transition = await this.waitForRestoreTransition(id)
        if (transition.ready) return transition.status
        throw new Error('Computer Use session did not become ready')
      }
      throw Object.assign(new Error('Computer Use is already attached to another visible Coding task'), { status })
    }
    if (this.os === 'linux') {
      this.mu.unlock()
      return this.startLinuxPortal(id, selection)
    }
    if (this.os !== 'darwin' && this.os !== 'windows') {
      const permissions = await this.permissionProbe(false)
      const status = publicStatus(await this.statusLocked(permissions))
      this.mu.unlock()
      throw Object.assign(new Error('Computer Use is unavailable on this platform'), { status })
    }
    const permissions = await this.permissionProbe(false)
    if (!permissionsReady(permissions)) {
      const status = publicStatus(await this.statusLocked(permissions))
      this.mu.unlock()
      throw Object.assign(new Error('请先明确授予 MilkSU 辅助功能与屏幕录制权限，再启动可见会话'), { status })
    }
    let target: Target
    try {
      target = await this.resolveTargetLocked(selection)
    } catch (error) {
      const status = publicStatus(await this.statusLocked(permissions))
      this.mu.unlock()
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { status })
    }
    if (
      this.os === 'windows'
      && (!String(target.executablePath ?? '').trim() || !isAbsoluteExecutable(target.executablePath ?? ''))
    ) {
      const status = publicStatus(await this.statusLocked(permissions))
      this.mu.unlock()
      throw Object.assign(new Error('选择的 Windows App 缺少稳定的可执行文件身份'), { status })
    }
    let binaryPath = ''
    try {
      binaryPath = await this.resolveBinaryLocked()
    } catch {
      this.mu.unlock()
      const prepared = await this.prepare({})
      if (!prepared.ready) {
        const status = await this.status()
        if (!status.problem) status.problem = prepared.problem
        throw Object.assign(new Error(prepared.problem || MISSING_DRIVER_PROBLEM), { status })
      }
      await this.mu.lock()
      binaryPath = await this.resolveBinaryLocked()
    }
    try {
      await verifyDriverVersion(
        binaryPath,
        driverEnvironment(this.os, dirname(binaryPath), this.hostBundle()),
        this.commandFactory,
      )
    } catch (error) {
      const status = publicStatus(await this.statusLocked(permissions))
      this.mu.unlock()
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { status })
    }
    const sessionId = newSessionId()
    const runtimeRoot = computerUseSessionRoot()
    const directory = sessionDirectory(runtimeRoot, sessionId)
    try {
      await createRuntimeDirectory(runtimeRoot, directory)
    } catch (error) {
      this.mu.unlock()
      throw error
    }
    const manifestPath = join(directory, 'session-policy.yaml')
    try {
      await writeFile(manifestPath, sessionManifestForTarget(target, this.os), { mode: 0o600 })
    } catch (error) {
      await cleanupRuntimeDirectory(runtimeRoot, directory)
      this.mu.unlock()
      throw new Error(`write Computer Use bounded policy: ${error instanceof Error ? error.message : error}`)
    }
    const socketPath = computerUseSocket(sessionId)
    await cleanupEndpoint(socketPath)
    await ensureDriverSandbox(directory)
    const hostBundle = this.hostBundle()
    const child = this.commandFactory({
      command: binaryPath,
      args: [
        'serve',
        '--embedded',
        '--host-bundle-id',
        hostBundle,
        '--socket',
        socketPath,
        '--permission-mode',
        'bounded',
        '--session-policy',
        manifestPath,
        '--approve-session-policy',
      ],
      env: driverEnvironment(this.os, directory, hostBundle),
      stdio: 'ignore-stdout',
    })
    const exit = waitForChildExit(child)
    const active: Session = {
      conversationId: id,
      sessionId,
      socketPath,
      directory,
      startedAt: new Date(),
      child,
      exit,
      phase: 'starting',
      problem: '',
      stopping: false,
      target,
    }
    this.active = active
    void exit.then(() => this.onChildExit(active))
    this.mu.unlock()

    try {
      await waitForEndpoint(socketPath, this.startTimeoutMs, exit)
    } catch (error) {
      await this.stop(id, false)
      const status = await this.statusForConversation(id)
      throw Object.assign(
        new Error(`start Computer Use private driver: ${error instanceof Error ? error.message : error}`),
        { status },
      )
    }
    await this.mu.lock()
    if (this.active === active && active.phase === 'starting') active.phase = 'ready'
    const ready = publicStatus(await this.statusLocked(await this.permissionProbe(false)))
    this.mu.unlock()
    try {
      await this.grants.save(id, ready.target)
    } catch (error) {
      await this.stop(id, false)
      const status = await this.statusForConversation(id)
      throw Object.assign(
        new Error(`persist Computer Use task authorization: ${error instanceof Error ? error.message : error}`),
        { status },
      )
    }
    ready.authorized = true
    ready.grantedTarget = ready.target
    return ready
  }

  async stop(conversationId: string, revoke = true): Promise<Status> {
    const id = String(conversationId ?? '').trim()
    if (!validConversationId(id)) {
      const status = await this.status()
      throw Object.assign(new Error('invalid Coding conversation id'), { status })
    }
    await this.mu.lock()
    const active = this.active
    if (active && active.conversationId !== id) {
      const permissions = await this.permissionProbe(false)
      const status = publicStatus(await this.statusLocked(permissions))
      this.mu.unlock()
      throw Object.assign(new Error('Computer Use session belongs to another Coding task'), { status })
    }
    this.mu.unlock()
    if (revoke) await this.grants.delete(id)
    this.implicitRestoreFailed.delete(id)
    if (!active) return this.statusForConversation(id)
    await this.mu.lock()
    active.stopping = true
    active.phase = 'stopping'
    this.mu.unlock()
    if (active.portal) await this.stopPortal?.().catch(() => {})
    if (active.child) {
      await stopChild(active.child, false)
      await Promise.race([active.exit ?? Promise.resolve(null), sleep(3000)])
      if (active.child.exitCode === null) {
        await stopChild(active.child, true)
        await Promise.race([active.exit ?? Promise.resolve(null), sleep(1000)])
      }
    } else if (active.exit) {
      await Promise.race([active.exit, sleep(1000)])
    }
    await cleanupEndpoint(active.socketPath)
    await cleanupRuntimeDirectory(computerUseSessionRoot(), active.directory)
    await this.mu.lock()
    if (this.active === active) this.active = null
    const permissions = await this.permissionProbe(false)
    let status = publicStatus(await this.statusLocked(permissions))
    this.mu.unlock()
    if (!revoke) status = await this.statusForConversation(id)
    return status
  }

  async revoke(conversationId: string): Promise<void> {
    const id = String(conversationId ?? '').trim()
    if (!validConversationId(id)) throw new Error('invalid Coding conversation id')
    await this.grants.delete(id)
  }

  descriptor(conversationId: string): Descriptor | undefined {
    const active = this.active
    if (!active || active.phase !== 'ready' || active.conversationId !== String(conversationId ?? '').trim()) {
      return undefined
    }
    return {
      sessionId: active.sessionId,
      socketPath: active.socketPath,
      targetBundleId: active.target.bundleId,
      targetName: active.target.name,
      targetPid: active.target.pid,
      targetWindowId: active.target.windowId,
    }
  }

  ownsConversation(conversationId: string): boolean {
    return Boolean(this.active && this.active.conversationId === String(conversationId ?? '').trim())
  }

  async close(): Promise<void> {
    const active = this.active
    if (active) await this.stop(active.conversationId, false)
  }

  async prepare(options: PrepareOptions = {}): Promise<PrepareResult> {
    if (this.os === 'linux') {
      if (await this.linuxPortal()) {
        return {
          ready: true,
          source: 'xdg-desktop-portal',
          version: DRIVER_VERSION,
          nextStep: '启动 Computer Use 时，GNOME 会弹出桌面共享授权。',
        }
      }
      const info = await this.linuxDesktop()
      const problem = info.problem || LINUX_COMPUTER_USE_PROBLEM
      return {
        ready: false,
        version: DRIVER_VERSION,
        problem,
        nextStep: '在 GNOME Wayland 上使用系统桌面共享；Hyprland 仍不可用。',
      }
    }
    if (this.os !== 'darwin' && this.os !== 'windows') {
      return {
        ready: false,
        version: DRIVER_VERSION,
        problem: LINUX_COMPUTER_USE_PROBLEM,
        nextStep: '在 macOS、Windows 或 GNOME Wayland 上使用 Computer Use。',
      }
    }
    try {
      const path = await this.resolveBinaryLocked()
      return { ready: true, source: 'already', path, version: DRIVER_VERSION }
    } catch {
      // copy from sidecar / build cache
    }
    for (const source of this.prepareCopySources()) {
      if (!await inspectDriverFile(source)) continue
      try {
        const path = await this.installPreparedDriver(source)
        return { ready: true, source: 'copied', path, version: DRIVER_VERSION }
      } catch {
        continue
      }
    }
    const root = findRepositoryRoot()
    const recipe = root ? windowsBuildScript(root) : ''
    if (!options.allowBuild || this.os !== 'windows' || !recipe) {
      return missingDriverResult(
        recipe,
        recipe
          ? '在 MilkSU 仓库里运行 node scripts/build-windows-cua-driver.mjs，再重试 prepare_computer_use_driver。不要运行 Cua 官方 install.ps1。'
          : '请重装带 Sidecar 的 MilkSU，让安装包自带审阅过的 Cua Driver。',
      )
    }
    if (!await rustcLooksUsable()) {
      return {
        ready: false,
        version: DRIVER_VERSION,
        problem: MISSING_DRIVER_PROBLEM,
        recipe,
        nextStep: '本机缺少 rustc 1.97。先安装该工具链，再调用 prepare_computer_use_driver。不要运行 Cua 官方安装脚本。',
      }
    }
    try {
      await runReviewedWindowsBuild(root)
    } catch (error) {
      return {
        ready: false,
        version: DRIVER_VERSION,
        problem: error instanceof Error ? error.message : String(error),
        recipe,
        nextStep: '根据构建错误补齐 Visual Studio C++ 或 MinGW 后重试 prepare_computer_use_driver。不要运行 Cua 官方安装脚本。',
      }
    }
    let source = sourceBuildRuntimeCandidate(root, this.os)
    if (!await inspectDriverFile(source)) source = sidecarBuildCandidate(this.os)
    if (!await inspectDriverFile(source)) {
      return {
        ready: false,
        version: DRIVER_VERSION,
        problem: MISSING_DRIVER_PROBLEM,
        recipe,
        nextStep: '构建完成但未找到 cua-driver.exe。检查 build/sidecar-cache 后重试。',
      }
    }
    try {
      const path = await this.installPreparedDriver(source)
      return { ready: true, source: 'built', path, version: DRIVER_VERSION }
    } catch (error) {
      return {
        ready: false,
        version: DRIVER_VERSION,
        problem: error instanceof Error ? error.message : String(error),
        recipe,
        nextStep: '构建产物无法写入本机 Driver 目录。检查用户配置目录权限后重试。',
      }
    }
  }

  private prepareCopySources(): string[] {
    const name = this.os === 'windows' ? 'cua-driver.exe' : 'cua-driver'
    const sources: string[] = []
    if (this.sidecarDir) sources.push(join(this.sidecarDir, name))
    sources.push(sidecarBuildCandidate(this.os))
    const root = findRepositoryRoot()
    if (root) sources.push(sourceBuildRuntimeCandidate(root, this.os))
    return sources
  }

  private async installPreparedDriver(source: string): Promise<string> {
    const destination = preparedDriverPath(this.home, this.os)
    await copyDriverBundle(source, destination)
    await verifyDriverVersion(
      destination,
      driverEnvironment(this.os, dirname(destination), this.hostBundle()),
      this.commandFactory,
    )
    this.binaryPath = destination
    return destination
  }

  private async startLinuxPortal(conversationId: string, selection: TargetSelection): Promise<Status> {
    if (!await this.linuxPortal()) {
      const status = await this.status()
      throw Object.assign(new Error(status.problem || LINUX_COMPUTER_USE_PROBLEM), { status })
    }
    const target = linuxPortalDesktopTarget()
    if (
      selection.pid !== 0
      && selection.windowId !== 0
      && (selection.pid !== target.pid || selection.windowId !== target.windowId)
    ) {
      const status = await this.status()
      throw Object.assign(new Error('Linux Computer Use 锁定整桌面，不能选择单个窗口'), { status })
    }
    if (!this.startPortal) {
      const status = await this.status()
      throw Object.assign(new Error('Computer Use portal is unavailable'), { status })
    }
    const sessionId = newSessionId()
    const runtimeRoot = computerUseSessionRoot()
    const directory = sessionDirectory(runtimeRoot, sessionId)
    await createRuntimeDirectory(runtimeRoot, directory)
    const socketPath = computerUseSocket(sessionId)
    await cleanupEndpoint(socketPath)
    try {
      await this.startPortal(socketPath)
    } catch (error) {
      await cleanupRuntimeDirectory(runtimeRoot, directory)
      const status = await this.status()
      throw Object.assign(
        new Error(`GNOME 桌面共享未授权或已取消：${error instanceof Error ? error.message : error}`),
        { status },
      )
    }
    await this.mu.lock()
    if (this.active) {
      this.mu.unlock()
      await this.stopPortal?.().catch(() => {})
      await cleanupRuntimeDirectory(runtimeRoot, directory)
      const status = await this.status()
      throw Object.assign(new Error('Computer Use is already attached to another visible Coding task'), { status })
    }
    this.active = {
      conversationId,
      sessionId,
      socketPath,
      directory,
      startedAt: new Date(),
      phase: 'ready',
      problem: '',
      stopping: false,
      target,
      portal: true,
    }
    const status = publicStatus(await this.statusLocked({ accessibility: true, screenRecording: true }))
    this.mu.unlock()
    try {
      await this.grants.save(conversationId, status.target)
    } catch (error) {
      await this.stop(conversationId, false)
      const next = await this.statusForConversation(conversationId)
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { status: next })
    }
    status.authorized = true
    status.grantedTarget = status.target
    return status
  }

  private async resolveTargetLocked(selection: TargetSelection): Promise<Target> {
    if (selection.pid <= 1 || selection.windowId <= 0) {
      throw new Error('请选择一个当前可见的 App 窗口')
    }
    const listed = await this.targetProvider()
    const hostExecutable = await this.hostExecutable(this.targetPid).catch(() => '')
    for (const target of filterValidTargets(listed, this.hostBundle(), this.targetPid, hostExecutable)) {
      if (target.pid === selection.pid && target.windowId === selection.windowId) return target
    }
    throw new Error('选择的 App 窗口已不可见，请刷新后重新选择')
  }

  private async resolveBinaryLocked(): Promise<string> {
    const path = await resolveDriverBinary({
      binaryPath: this.binaryPath,
      os: this.os,
      home: this.home,
      sidecarDir: this.sidecarDir,
    })
    this.binaryPath = path
    return path
  }

  private async statusLocked(permissions: Permissions): Promise<Status> {
    let hostBundle = this.hostBundle()
    const signing = await this.signingProbe()
    if (!validBundleId(String(signing.bundleId ?? '').trim())) {
      signing.bundleId = hostBundle
    } else if (!validBundleId(this.hostBundleId)) {
      this.hostBundleId = String(signing.bundleId).trim()
      hostBundle = this.hostBundleId
    }
    const status: Status = {
      available: false,
      enabled: false,
      authorized: false,
      phase: 'disabled',
      driverVersion: DRIVER_VERSION,
      target: defaultTarget(this.targetPid, hostBundle),
      permissions,
      signing,
    }
    try {
      await this.resolveBinaryLocked()
      status.available = true
    } catch {
      status.available = false
    }
    if (this.os === 'linux') {
      if (!await this.linuxPortal()) {
        const info = await this.linuxDesktop()
        status.available = false
        status.phase = 'unavailable'
        status.problem = info.problem || LINUX_COMPUTER_USE_PROBLEM
        return status
      }
      status.available = true
      status.signing = linuxPortalSigning()
      if (!permissions.accessibility && !permissions.screenRecording) {
        status.permissions = { accessibility: true, screenRecording: true }
      }
      if (!this.active) return status
    } else if (this.os !== 'darwin' && this.os !== 'windows') {
      status.available = false
      status.phase = 'unavailable'
      status.problem = LINUX_COMPUTER_USE_PROBLEM
      return status
    }
    if (!status.available) {
      status.phase = 'unavailable'
      status.problem = MISSING_DRIVER_PROBLEM
    }
    if (!this.active) return status
    status.enabled = this.active.phase === 'ready'
    status.conversationId = this.active.conversationId
    status.sessionId = this.active.sessionId
    status.phase = this.active.phase
    status.startedAt = this.active.startedAt.toISOString()
    status.target = this.active.target
    status.problem = this.active.problem || status.problem
    return status
  }

  private async waitForRestoreTransition(conversationId: string): Promise<{ status: Status; ready: boolean }> {
    for (;;) {
      if (this.descriptor(conversationId)) {
        return { status: await this.statusForConversation(conversationId), ready: true }
      }
      await this.mu.lock()
      const active = this.active
      if (!active) {
        this.mu.unlock()
        return { status: await this.statusForConversation(conversationId), ready: false }
      }
      if (active.conversationId !== conversationId) {
        const permissions = await this.permissionProbe(false)
        const status = publicStatus(await this.statusLocked(permissions))
        this.mu.unlock()
        throw Object.assign(new Error('Computer Use is already attached to another visible Coding task'), { status })
      }
      const transitioning = active.phase === 'starting' || active.phase === 'stopping'
      this.mu.unlock()
      if (!transitioning) return { status: await this.statusForConversation(conversationId), ready: false }
      await sleep(25)
    }
  }

  private async onChildExit(active: Session): Promise<void> {
    await this.mu.lock()
    try {
      if (this.active !== active) return
      if (active.stopping) {
        active.phase = 'stopped'
        return
      }
      active.phase = 'failed'
      active.problem = '嵌入式 Computer Use Driver 已意外停止；旧会话不会自动重放操作。'
    } finally {
      this.mu.unlock()
    }
  }
}

function normalizeOs(value?: string): string {
  const os = String(value ?? process.platform).trim()
  if (os === 'win32') return 'windows'
  if (os === 'darwin' || os === 'linux' || os === 'windows') return os
  return process.platform === 'win32' ? 'windows' : process.platform
}

function resolveHostBundleId(env: NodeJS.ProcessEnv): string {
  for (const key of ['MILKSU_DESKTOP_APP_ID', 'CUA_DRIVER_HOST_BUNDLE_ID']) {
    const value = String(env[key] ?? '').trim()
    if (validBundleId(value)) return value
  }
  return DEFAULT_HOST_BUNDLE_ID
}

function isAbsoluteExecutable(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
