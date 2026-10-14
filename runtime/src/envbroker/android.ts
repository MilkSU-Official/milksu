import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import { androidPackageInstalled, androidPackageName } from './apk.ts'
import { lookPath, startDetached, type CommandResult } from './docker.ts'
import {
  ANDROID_STUDIO_INSTALL_URL,
  LAB_AVD_PREFIX,
  type AndroidTooling,
  type AndroidToolingStatus,
} from './types.ts'

export const errAndroidBusy = new Error('实验室模拟器都被占用')

export type AndroidRunner = {
  lookPath(name: string): Promise<string>
  combinedOutput(name: string, args: string[], signal?: AbortSignal): Promise<CommandResult>
  startDetached(name: string, args: string[]): Promise<void>
  sdkRoots?: () => string[]
  javaHome?: () => string
}

export type AndroidDevice = {
  avd: string
  serial: string
  port: number
}

function toolExists(path: string): boolean {
  try {
    const info = statSync(path)
    if (!info.isFile()) return false
    if (process.platform === 'win32') return true
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function globDirs(patternPrefix: string, match: (name: string) => boolean): string[] {
  const parent = patternPrefix
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && match(entry.name))
      .map((entry) => join(parent, entry.name))
  } catch {
    return []
  }
}

export function windowsProgramFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = []
  for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
    const value = String(env[key] ?? '').trim()
    if (value) dirs.push(value)
  }
  if (process.platform === 'win32' && dirs.length === 0) {
    dirs.push('C:\\Program Files', 'C:\\Program Files (x86)')
  }
  return unique(dirs)
}

export function androidSDKCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = []
  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const value = String(env[key] ?? '').trim()
    if (value) roots.push(value)
  }
  const home = String(env.HOME || env.USERPROFILE || homedir() || '').trim()
  if (home) {
    roots.push(
      join(home, 'Library', 'Android', 'sdk'),
      join(home, 'Android', 'Sdk'),
      join(home, 'Android', 'sdk'),
    )
  }
  const local = String(env.LOCALAPPDATA ?? '').trim()
  if (local) roots.push(join(local, 'Android', 'Sdk'))
  const profile = String(env.USERPROFILE ?? '').trim()
  if (profile) roots.push(join(profile, 'AppData', 'Local', 'Android', 'Sdk'))
  for (const programFiles of windowsProgramFiles(env)) {
    roots.push(join(programFiles, 'Android', 'android-sdk'))
  }
  roots.push('/opt/android-sdk', '/usr/lib/android-sdk', '/usr/local/android-sdk')
  return unique(roots)
}

export function androidSDKRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return androidSDKCandidates(env).filter((root) => dirExists(root))
}

export function androidSDKRootsWith(override: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = []
  if (override.trim()) roots.push(override.trim())
  roots.push(...androidSDKRoots(env))
  return unique(roots)
}

export function androidStudioJavaCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const homes = [
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/Applications/Android Studio.app/Contents/jre/Contents/Home',
    ...globDirs('/Applications', (name) => name.startsWith('Android Studio') && name.endsWith('.app'))
      .map((app) => join(app, 'Contents', 'jbr', 'Contents', 'Home')),
  ]
  const home = String(env.HOME || homedir() || '').trim()
  if (home) {
    homes.push(
      join(home, 'android-studio', 'jbr'),
      join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'apps', 'AndroidStudio', 'jbr'),
    )
  }
  homes.push('/opt/android-studio/jbr', '/usr/local/android-studio/jbr', '/snap/android-studio/current/jbr')
  for (const programFiles of windowsProgramFiles(env)) {
    homes.push(
      join(programFiles, 'Android', 'Android Studio', 'jbr'),
      join(programFiles, 'Android', 'Android Studio', 'jre'),
    )
  }
  const local = String(env.LOCALAPPDATA ?? '').trim()
  if (local) {
    homes.push(
      join(local, 'Programs', 'Android Studio', 'jbr'),
      join(local, 'Google', 'AndroidStudio', 'jbr'),
    )
  }
  return unique(homes)
}

export function osJavaCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const homes: string[] = []
  const fromEnv = validJavaHome(String(env.JAVA_HOME ?? ''))
  if (fromEnv) homes.push(fromEnv)
  for (const prefix of ['/opt/homebrew/opt', '/usr/local/opt']) {
    homes.push(join(prefix, 'openjdk', 'libexec', 'openjdk.jdk', 'Contents', 'Home'))
    homes.push(...globDirs(prefix, (name) => name.startsWith('openjdk@'))
      .map((dir) => join(dir, 'libexec', 'openjdk.jdk', 'Contents', 'Home')))
  }
  homes.push(
    ...globDirs('/usr/lib/jvm', (name) => /^java-1[7-9]/.test(name) || /^java-2/.test(name) || /^temurin-1/.test(name)),
  )
  for (const programFiles of windowsProgramFiles(env)) {
    for (const vendor of ['Microsoft', 'Eclipse Adoptium', 'Java', 'AdoptOpenJDK']) {
      homes.push(...globDirs(join(programFiles, vendor), (name) => name.startsWith('jdk-')))
    }
  }
  return unique(homes)
}

function isMacOSJavaStub(java: string): boolean {
  let resolved = java
  try {
    resolved = realpathSync(java)
  } catch {
    resolved = java
  }
  return java === '/usr/bin/java' || resolved === '/usr/bin/java'
}

export function validJavaHome(home: string): string {
  const trimmed = home.trim()
  if (!trimmed) return ''
  const java = join(trimmed, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (process.platform === 'win32') return toolExists(java) ? trimmed : ''
  if (!toolExists(java) || isMacOSJavaStub(java)) return ''
  return trimmed
}

export function androidStudioLaunchPath(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'darwin') {
    const matches = globDirs('/Applications', (name) => name.startsWith('Android Studio') && name.endsWith('.app'))
    if (existsSync('/Applications/Android Studio.app')) return '/Applications/Android Studio.app'
    return matches[0] ?? ''
  }
  if (process.platform === 'win32') {
    for (const programFiles of windowsProgramFiles(env)) {
      const candidate = join(programFiles, 'Android', 'Android Studio', 'bin', 'studio64.exe')
      if (toolExists(candidate)) return candidate
    }
    const local = String(env.LOCALAPPDATA ?? '').trim()
    if (local) {
      const candidate = join(local, 'Programs', 'Android Studio', 'bin', 'studio64.exe')
      if (toolExists(candidate)) return candidate
    }
    return ''
  }
  const looked = lookPath('android-studio', env)
  if (looked) return looked
  for (const candidate of ['/opt/android-studio/bin/studio.sh', '/usr/local/android-studio/bin/studio.sh']) {
    if (toolExists(candidate)) return candidate
  }
  return ''
}

export function androidStudioPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const home of androidStudioJavaCandidates(env)) {
    if (validJavaHome(home) || dirExists(home)) return true
  }
  if (process.platform === 'darwin') {
    if (dirExists('/Applications/Android Studio.app')) return true
    if (globDirs('/Applications', (name) => name.startsWith('Android Studio') && name.endsWith('.app')).length > 0) {
      return true
    }
  }
  const launch = androidStudioLaunchPath(env)
  return Boolean(launch && existsSync(launch))
}

function samePath(left: string, right: string): boolean {
  const a = left.trim()
  const b = right.trim()
  if (!a || !b) return false
  try {
    const cleanLeft = realpathSync(a)
    const cleanRight = realpathSync(b)
    if (process.platform === 'win32') return cleanLeft.toLowerCase() === cleanRight.toLowerCase()
    return cleanLeft === cleanRight
  } catch {
    return a === b
  }
}

export function classifySDKSource(root: string, override: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = root.trim()
  if (!trimmed) return ''
  if (override && samePath(trimmed, override)) return 'settings'
  if (String(env.ANDROID_HOME ?? '').trim() && samePath(trimmed, String(env.ANDROID_HOME))) return 'env'
  if (String(env.ANDROID_SDK_ROOT ?? '').trim() && samePath(trimmed, String(env.ANDROID_SDK_ROOT))) return 'env'
  return 'default'
}

export function classifyJavaSource(home: string, override: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = home.trim()
  if (!trimmed) return ''
  if (override && samePath(trimmed, override)) return 'settings'
  const lower = trimmed.toLowerCase()
  if (lower.includes('android studio') || lower.includes('android-studio') || lower.includes('androidstudio')) {
    return 'android-studio'
  }
  const envHome = validJavaHome(String(env.JAVA_HOME ?? ''))
  if (envHome && samePath(trimmed, envHome)) return 'env'
  if (lower.includes('homebrew') || lower.includes('/opt/homebrew/')) return 'homebrew'
  return 'os'
}

function avdmanagerInRoot(root: string): string[] {
  const candidates = [
    join(root, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    join(root, 'cmdline-tools', 'latest', 'bin', 'avdmanager.bat'),
  ]
  try {
    for (const entry of readdirSync(join(root, 'cmdline-tools'), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'latest') continue
      const path = join(root, 'cmdline-tools', entry.name, 'bin', 'avdmanager')
      candidates.push(path, `${path}.bat`)
    }
  } catch {
    return candidates
  }
  return candidates
}

export function androidToolCandidatesIn(name: string, sdkRoots: string[]): string[] {
  const candidates: string[] = []
  for (const sdk of sdkRoots) {
    if (name === 'emulator') {
      candidates.push(join(sdk, 'emulator', 'emulator'), join(sdk, 'emulator', 'emulator.exe'))
    } else if (name === 'adb') {
      candidates.push(join(sdk, 'platform-tools', 'adb'), join(sdk, 'platform-tools', 'adb.exe'))
    } else if (name === 'avdmanager') {
      candidates.push(...avdmanagerInRoot(sdk))
    }
  }
  if (name === 'avdmanager') {
    for (const prefix of ['/opt/homebrew', '/usr/local']) {
      candidates.push(...avdmanagerInRoot(join(prefix, 'share', 'android-commandlinetools')))
    }
  }
  return candidates
}

export function firstAndroidSDKRootIn(roots: string[]): string {
  for (const root of roots) {
    if (dirExists(root)) return root
  }
  return roots[0] ?? ''
}

export function androidJavaHome(override = '', env: NodeJS.ProcessEnv = process.env): string {
  if (override.trim()) {
    return validJavaHome(override) || override.trim()
  }
  for (const candidate of androidStudioJavaCandidates(env)) {
    const home = validJavaHome(candidate)
    if (home) return home
  }
  const fromEnv = validJavaHome(String(env.JAVA_HOME ?? ''))
  if (fromEnv) return fromEnv
  for (const candidate of osJavaCandidates(env)) {
    const home = validJavaHome(candidate)
    if (home) return home
  }
  return ''
}

function processEnvFor(sdkRoot: string, javaHome: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (sdkRoot) {
    env.ANDROID_HOME = sdkRoot
    env.ANDROID_SDK_ROOT = sdkRoot
  }
  if (javaHome) {
    env.JAVA_HOME = javaHome
    env.PATH = `${join(javaHome, 'bin')}${delimiter}${env.PATH ?? ''}`
  }
  return env
}

function isAVDManagerCreate(name: string, args: string[]): boolean {
  const base = basename(name).toLowerCase()
  if (base !== 'avdmanager' && base !== 'avdmanager.bat') return false
  return args.join(' ').includes('create avd')
}

export function createExecAndroidRunner(sdkRoot = '', javaHome = ''): AndroidRunner {
  const sdkRoots = () => androidSDKRootsWith(sdkRoot)
  const resolvedJava = () => androidJavaHome(javaHome)
  return {
    sdkRoots,
    javaHome: resolvedJava,
    async lookPath(name) {
      for (const candidate of androidToolCandidatesIn(name, sdkRoots())) {
        if (toolExists(candidate)) return candidate
      }
      const looked = lookPath(name)
      if (looked) return looked
      throw new Error(`${name} not found`)
    },
    combinedOutput(name, args, signal) {
      return new Promise((resolve) => {
        const child = spawn(name, args, {
          env: processEnvFor(firstAndroidSDKRootIn(sdkRoots()), resolvedJava()),
          signal,
        })
        if (isAVDManagerCreate(name, args)) child.stdin.end('no\n')
        const chunks: Buffer[] = []
        child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        child.on('error', (error) => resolve({ output: Buffer.concat(chunks), error, exitCode: 1 }))
        child.on('close', (code) => {
          const output = Buffer.concat(chunks)
          if (code === 0) resolve({ output, exitCode: 0 })
          else resolve({ output, error: new Error(`exit ${code ?? 1}`), exitCode: code ?? 1 })
        })
      })
    },
    startDetached(name, args) {
      return startDetached(name, args, processEnvFor(firstAndroidSDKRootIn(sdkRoots()), resolvedJava()))
    },
  }
}

export function findLabSystemImageIn(sdkRoots: string[]): string {
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
  for (const sdk of sdkRoots) {
    const root = join(sdk, 'system-images')
    let apis: string[]
    try {
      apis = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      continue
    }
    for (let i = apis.length - 1; i >= 0; i -= 1) {
      const api = apis[i]
      for (const tag of ['google_apis', 'google_apis_playstore', 'default']) {
        const candidate = join(root, api, tag, abi)
        if (dirExists(candidate)) return `system-images;${api};${tag};${abi}`
      }
    }
  }
  return ''
}

export function detectLabSystemImage(): string {
  return findLabSystemImageIn(androidSDKRoots())
}

export function labSystemImage(runner: AndroidRunner): string {
  if (runner.sdkRoots) return findLabSystemImageIn(runner.sdkRoots())
  return detectLabSystemImage()
}

export function probeAndroidTooling(tooling: AndroidTooling): AndroidToolingStatus {
  const overrideSDK = String(tooling.sdkRoot ?? '').trim()
  const overrideJava = String(tooling.javaHome ?? '').trim()
  const runner = createExecAndroidRunner(overrideSDK, overrideJava)
  const sdkRoot = firstAndroidSDKRootIn(runner.sdkRoots?.() ?? [])
  const javaHome = runner.javaHome?.() ?? ''
  const status: AndroidToolingStatus = {
    ready: false,
    canStart: false,
    canCreate: false,
    platform: process.platform === 'win32' ? 'windows' : process.platform,
    studioFound: androidStudioPresent(),
    hasLabAvd: false,
    sdkRoot,
    sdkSource: classifySDKSource(sdkRoot, overrideSDK),
    javaHome,
    javaSource: classifyJavaSource(javaHome, overrideJava),
    avdmanager: '',
    emulator: '',
    adb: '',
    systemImage: findLabSystemImageIn(runner.sdkRoots?.() ?? []),
    javaOk: validJavaHome(javaHome) !== '',
    missing: [],
    installUrl: ANDROID_STUDIO_INSTALL_URL,
    autoDetectSdk: overrideSDK === '',
    autoDetectJava: overrideJava === '',
  }
  return statusFromRunner(status, runner)
}

function statusFromRunner(status: AndroidToolingStatus, runner: AndroidRunner): AndroidToolingStatus {
  const next = { ...status, missing: [...status.missing] }
  const roots = runner.sdkRoots?.() ?? androidSDKRoots()
  for (const [name, field] of [['avdmanager', 'avdmanager'], ['emulator', 'emulator'], ['adb', 'adb']] as const) {
    for (const candidate of androidToolCandidatesIn(name, roots)) {
      if (toolExists(candidate)) {
        next[field] = candidate
        break
      }
    }
    if (!next[field]) {
      const looked = lookPath(name)
      if (looked) next[field] = looked
    }
  }
  try {
    next.hasLabAvd = labAVDs(listAvdsSync(next.emulator)).length > 0
  } catch {
    next.hasLabAvd = false
  }
  next.canStart = next.emulator !== '' && next.adb !== ''
  next.canCreate = next.canStart && next.javaOk && next.avdmanager !== '' && next.systemImage !== ''
  if (!next.sdkRoot) next.missing.push('sdk')
  if (!next.emulator) next.missing.push('emulator')
  if (!next.adb) next.missing.push('platform-tools')
  if (!next.avdmanager) next.missing.push('cmdline-tools')
  if (!next.javaOk) next.missing.push('jdk')
  if (!next.systemImage) next.missing.push('system-image')
  next.ready = next.canStart && (next.hasLabAvd || next.canCreate)
  return next
}

function listAvdsSync(emulator: string): string[] {
  if (!emulator) return []
  const result = spawnSync(emulator, ['-list-avds'], { encoding: 'utf8', timeout: 8_000 })
  if (result.status !== 0) return []
  return String(result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name && !name.startsWith('INFO'))
}

export async function listAvds(runner: AndroidRunner, signal?: AbortSignal): Promise<string[]> {
  let emulator: string
  try {
    emulator = await runner.lookPath('emulator')
  } catch {
    throw new Error('没有 Android 模拟器。请先安装 Android SDK')
  }
  const result = await runner.combinedOutput(emulator, ['-list-avds'], signal ?? AbortSignal.timeout(8_000))
  if (result.error) {
    throw new Error(`无法列出 AVD: ${result.output.toString('utf8').trim()}`)
  }
  return result.output.toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name && !name.startsWith('INFO'))
}

export function labAVDs(names: string[]): string[] {
  return names.filter((name) => name.startsWith(LAB_AVD_PREFIX))
}

export function nextLabAVDName(existing: string[]): string {
  const used = new Set(existing)
  if (!used.has(LAB_AVD_PREFIX)) return LAB_AVD_PREFIX
  for (let i = 2; i < 16; i += 1) {
    const name = `${LAB_AVD_PREFIX}-${i}`
    if (!used.has(name)) return name
  }
  return ''
}

function isMissingJavaRuntimeOutput(text: string): boolean {
  return text.includes('Unable to locate a Java Runtime')
    || text.includes('integer expression expected')
    || text.includes('JAVA_HOME is not set')
    || text.includes('JAVA_HOME is set to an invalid directory')
}

function compactAndroidToolOutput(text: string): string {
  const keep: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.includes('integer expression expected')) continue
    if (line.includes('Please visit http://www.java.com')) continue
    keep.push(line)
  }
  if (keep.length === 0) return text.trim()
  return keep.slice(-3).join(' ')
}

function formatLabAVDCreateError(avd: string, output: Buffer, error?: Error): Error {
  const text = output.toString('utf8').trim()
  if (isMissingJavaRuntimeOutput(text)) {
    return new Error(`创建 ${avd} 失败: 本机没有可用的 Java。请安装 Android Studio，然后在设置 → Lab 点重新检测`)
  }
  const compact = compactAndroidToolOutput(text)
  if (!compact && error) return new Error(`创建 ${avd} 失败: ${error.message}`)
  if (!compact) return new Error(`创建 ${avd} 失败`)
  return new Error(`创建 ${avd} 失败: ${compact}`)
}

export async function ensureLabAVD(
  runner: AndroidRunner,
  autoCreate: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const names = await listAvds(runner, signal)
  const labs = labAVDs(names)
  if (labs.length > 0) return labs[0]
  if (!autoCreate) {
    throw new Error(`没有名为 ${LAB_AVD_PREFIX} 的实验室模拟器。请在设置 → Lab 开启自动创建，或在 Android Studio 里建这个 AVD`)
  }
  const image = labSystemImage(runner)
  if (!image) {
    throw new Error(`没有实验室模拟器 ${LAB_AVD_PREFIX}，也没有可用来创建它的系统镜像。请打开 Android Studio → SDK Manager 安装系统镜像，然后在设置 → Lab 重新检测。不要用日常手机模拟器`)
  }
  let manager: string
  try {
    manager = await runner.lookPath('avdmanager')
  } catch {
    throw new Error('没有命令行工具。打开 Android Studio → SDK Manager，勾选 Android SDK Command-line Tools，然后在设置 → Lab 重新检测')
  }
  const result = await runner.combinedOutput(
    manager,
    ['create', 'avd', '--force', '--name', LAB_AVD_PREFIX, '--package', image, '--device', 'pixel'],
    signal,
  )
  if (result.error) throw formatLabAVDCreateError(LAB_AVD_PREFIX, result.output, result.error)
  return LAB_AVD_PREFIX
}

export function emulatorPort(serial: string): number {
  const trimmed = serial.trim()
  if (!trimmed.startsWith('emulator-')) return 0
  const port = Number.parseInt(trimmed.slice('emulator-'.length), 10)
  return Number.isFinite(port) ? port : 0
}

export function nextFreeEmulatorPort(usedSerials: Set<string>): number {
  const used = new Set<number>()
  for (const serial of usedSerials) {
    const port = emulatorPort(serial)
    if (port > 0) used.add(port)
  }
  for (let port = 5554; port <= 5584; port += 2) {
    if (!used.has(port)) return port
  }
  return 0
}

async function androidSerialReady(
  runner: AndroidRunner,
  adb: string,
  serial: string,
  signal?: AbortSignal,
): Promise<{ ready: boolean; serial: string }> {
  if (!serial) return { ready: false, serial: '' }
  const result = await runner.combinedOutput(
    adb,
    ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
    signal ?? AbortSignal.timeout(5_000),
  )
  return { ready: !result.error && result.output.includes(Buffer.from('1')), serial }
}

export async function runningLabDevices(
  runner: AndroidRunner,
  adb: string,
  signal?: AbortSignal,
): Promise<AndroidDevice[]> {
  const result = await runner.combinedOutput(adb, ['devices'], signal)
  if (result.error) return []
  const devices: AndroidDevice[] = []
  for (const raw of result.output.toString('utf8').split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('emulator-') || !line.includes('device') || line.includes('offline')) continue
    const serial = line.split(/\s+/)[0]
    if (!serial) continue
    const nameResult = await runner.combinedOutput(adb, ['-s', serial, 'emu', 'avd', 'name'], signal)
    const name = nameResult.output.toString('utf8').split('\n')[0]?.trim() ?? ''
    if (nameResult.error || !name.startsWith(LAB_AVD_PREFIX)) continue
    devices.push({ avd: name, serial, port: emulatorPort(serial) })
  }
  return devices
}

export async function allocateAndroidDevice(
  runner: AndroidRunner,
  heldDevices: Set<string>,
  heldSerials: Set<string>,
  autoCreate: boolean,
  signal?: AbortSignal,
): Promise<AndroidDevice> {
  await ensureLabAVD(runner, autoCreate, signal)
  let adb: string
  try {
    adb = await runner.lookPath('adb')
  } catch {
    throw new Error('没有 adb。请安装 Android platform-tools')
  }
  for (const device of await runningLabDevices(runner, adb, signal)) {
    if (heldDevices.has(device.avd) || heldSerials.has(device.serial)) continue
    const ready = await androidSerialReady(runner, adb, device.serial, signal)
    if (ready.ready) return device
  }
  const names = await listAvds(runner, signal)
  const labs = labAVDs(names)
  const running = new Set((await runningLabDevices(runner, adb, signal)).map((device) => device.avd))
  let pick = labs.find((name) => !heldDevices.has(name) && !running.has(name)) ?? ''
  if (!pick) {
    if (!autoCreate) throw errAndroidBusy
    const next = nextLabAVDName(labs)
    if (!next) throw errAndroidBusy
    const image = labSystemImage(runner)
    if (!image) throw errAndroidBusy
    let manager: string
    try {
      manager = await runner.lookPath('avdmanager')
    } catch {
      throw errAndroidBusy
    }
    const created = await runner.combinedOutput(
      manager,
      ['create', 'avd', '--force', '--name', next, '--package', image, '--device', 'pixel'],
      signal,
    )
    if (created.error) throw formatLabAVDCreateError(next, created.output, created.error)
    pick = next
  }
  const port = nextFreeEmulatorPort(heldSerials)
  if (!port) throw errAndroidBusy
  const emulator = await runner.lookPath('emulator')
  await runner.startDetached(emulator, ['-avd', pick, '-port', String(port), '-netdelay', 'none', '-netspeed', 'full', '-gpu', 'auto'])
  const serial = `emulator-${port}`
  const deadline = Date.now() + 3 * 60_000
  while (true) {
    const ready = await androidSerialReady(runner, adb, serial, signal)
    if (ready.ready) return { avd: pick, serial, port }
    if (Date.now() > deadline) throw new Error(`实验室模拟器 ${pick} 启动超时`)
    if (signal?.aborted) throw new Error(String(signal.reason ?? 'aborted'))
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

export async function androidStatus(
  runner: AndroidRunner,
  serial: string,
  signal?: AbortSignal,
): Promise<{ serial: string; state: string; error?: Error }> {
  let adb: string
  try {
    adb = await runner.lookPath('adb')
  } catch {
    return { serial: '', state: 'stopped', error: new Error('没有 adb') }
  }
  if (serial) {
    const ready = await androidSerialReady(runner, adb, serial, signal)
    if (ready.ready) return { serial: ready.serial, state: 'ready' }
    return { serial, state: 'stopped' }
  }
  for (const device of await runningLabDevices(runner, adb, signal)) {
    const ready = await androidSerialReady(runner, adb, device.serial, signal)
    if (ready.ready) return { serial: ready.serial, state: 'ready' }
  }
  return { serial: '', state: 'stopped' }
}

export async function stopAndroid(runner: AndroidRunner, serial: string, signal?: AbortSignal): Promise<void> {
  const adb = await runner.lookPath('adb')
  if (!serial) return
  await runner.combinedOutput(adb, ['-s', serial, 'emu', 'kill'], signal)
}

export async function openAndroidStudio(): Promise<'spawned' | 'install'> {
  const path = androidStudioLaunchPath()
  if (!path) return 'install'
  if (process.platform === 'darwin') await startDetached('open', [path])
  else await startDetached(path, [])
  return 'spawned'
}

export async function androidStatusRequiresPackage(
  runner: AndroidRunner,
  serial: string,
  launcher: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const pkg = androidPackageName(launcher)
  if (!pkg) return true
  return androidPackageInstalled(runner, serial, pkg, signal)
}
