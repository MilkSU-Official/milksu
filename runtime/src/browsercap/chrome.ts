import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export type BrowserUseRuntime = {
  found: boolean
  name?: string
  problem?: string
  nextStep?: string
}

export type ChromeEnv = Record<string, string | undefined>
export type ChromeExists = (path: string) => boolean
export type ChromeLookPath = (name: string) => string | undefined

export function findChrome(env: ChromeEnv = process.env, platform = process.platform): string {
  return findChromeWith(platform, env, (name) => lookPath(name, env, platform, regularFile), regularFile)
}

export function findChromeWith(
  platform: string,
  env: ChromeEnv,
  look: ChromeLookPath,
  exists: ChromeExists,
): string {
  const override = String(env.MILKSU_CHROME_PATH ?? '').trim()
  if (override) {
    if (exists(override)) return override
    throw new Error('MILKSU_CHROME_PATH is not an executable file')
  }
  const seen = new Set<string>()
  for (const candidate of chromeFixedCandidates(platform, env)) {
    if (!candidate || seen.has(candidate) || !exists(candidate)) continue
    seen.add(candidate)
    return candidate
  }
  for (const name of chromePathNames(platform)) {
    const path = look(name)
    if (!path || seen.has(path)) continue
    seen.add(path)
    return path
  }
  for (const candidate of chromeDesktopExecutables(env, exists)) {
    if (!candidate || seen.has(candidate) || !exists(candidate)) continue
    return candidate
  }
  throw new Error('a Chromium-family browser is required for Managed Browser')
}

export function extensionsPage(executable: string): string {
  return browserUseDisplayName(executable) === 'Microsoft Edge' ? 'edge://extensions/' : 'chrome://extensions/'
}

export function browserUseRuntimeStatus(
  platform = process.platform,
  locate: () => string = () => findChrome(),
): BrowserUseRuntime {
  try {
    const path = locate()
    return { found: true, name: browserUseDisplayName(path) }
  } catch {
    return {
      found: false,
      problem: '没有找到 Chrome、Chromium 或 Edge。',
      nextStep: browserUseNextStep(platform),
    }
  }
}

export function browserUseDisplayName(path: string): string {
  const base = basename(path).toLowerCase()
  if (base.includes('msedge') || base.includes('microsoft-edge')) return 'Microsoft Edge'
  if (base.includes('brave')) return 'Brave'
  if (base.includes('google-chrome') || base === 'chrome' || base === 'chrome.exe') return 'Google Chrome'
  return 'Chromium'
}

export function chromeFixedCandidates(platform: string, env: ChromeEnv): string[] {
  const home = String(env.HOME ?? '').trim()
  const kind = chromePlatform(platform)
  if (kind === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  }
  if (kind === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean) as string[]
    const candidates: string[] = []
    for (const root of roots) {
      candidates.push(
        join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      )
    }
    if (env.LOCALAPPDATA) {
      candidates.push(join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
    return candidates
  }
  if (!home) return []
  return [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
    '/snap/bin/chromium',
    '/run/current-system/sw/bin/chromium',
    '/run/current-system/sw/bin/google-chrome-stable',
    '/run/current-system/sw/bin/microsoft-edge',
    join(home, '.nix-profile', 'bin', 'chromium'),
    join(home, '.nix-profile', 'bin', 'google-chrome-stable'),
  ]
}

export function desktopExecPath(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('Exec=')) continue
    const value = line.slice('Exec='.length).trim()
    if (!value) continue
    const fields = value.split(/\s+/u)
    if (fields.length === 0) continue
    const executable = fields[0]!.replace(/^['"]|['"]$/gu, '')
    if (!executable || executable.startsWith('%')) continue
    return executable
  }
  return ''
}

function browserUseNextStep(platform: string): string {
  const kind = chromePlatform(platform)
  if (kind === 'darwin' || kind === 'win32') {
    return '安装 Google Chrome 或 Microsoft Edge，然后重新检测。'
  }
  return '从系统软件源安装 Chromium，然后重新检测。Omarchy 默认已有 Chromium。'
}

function chromePathNames(platform: string): string[] {
  if (chromePlatform(platform) === 'win32') return ['chrome.exe', 'msedge.exe', 'brave.exe']
  return [
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge-stable',
    'microsoft-edge',
    'brave-browser',
  ]
}

function chromeDesktopExecutables(env: ChromeEnv, exists: ChromeExists): string[] {
  const directories: string[] = []
  const home = String(env.HOME ?? homedir()).trim()
  if (home) {
    const dataHome = String(env.XDG_DATA_HOME ?? '').trim() || join(home, '.local', 'share')
    directories.push(join(dataHome, 'applications'))
  }
  const dataDirs = String(env.XDG_DATA_DIRS ?? '').trim() || '/usr/local/share:/usr/share'
  for (const directory of dataDirs.split(':')) {
    const trimmed = directory.trim()
    if (trimmed) directories.push(join(trimmed, 'applications'))
  }
  const names = [
    'google-chrome.desktop',
    'google-chrome-stable.desktop',
    'chromium.desktop',
    'chromium-browser.desktop',
    'org.chromium.Chromium.desktop',
    'microsoft-edge.desktop',
    'microsoft-edge-stable.desktop',
    'brave-browser.desktop',
  ]
  const found: string[] = []
  for (const directory of directories) {
    for (const name of names) {
      const path = join(directory, name)
      if (!exists(path)) continue
      try {
        const executable = desktopExecPath(readFileSync(path, 'utf8'))
        if (executable) found.push(executable)
      } catch {
        // skip unreadable desktop entries
      }
    }
  }
  return found
}

function lookPath(name: string, env: ChromeEnv, platform: string, exists: ChromeExists): string | undefined {
  const pathEnv = String(env.PATH ?? env.Path ?? '')
  const delimiter = chromePlatform(platform) === 'win32' ? ';' : ':'
  for (const directory of pathEnv.split(delimiter)) {
    const trimmed = directory.trim()
    if (!trimmed) continue
    const candidate = join(trimmed, name)
    if (exists(candidate)) return candidate
  }
  return undefined
}

function regularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return existsSync(path)
  }
}

function chromePlatform(platform: string): 'darwin' | 'win32' | 'linux' {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'win32' || platform === 'windows') return 'win32'
  return 'linux'
}
