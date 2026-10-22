import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const requireFromHere = createRequire(import.meta.url)

function run(root, command, args, options = {}) {
  let executable = command
  let commandArgs = args
  if (process.platform === 'win32' && command === 'npm') {
    const npmCLI = String(process.env.npm_execpath ?? '').trim()
    if (!npmCLI) throw new Error('npm_execpath is required for native Windows runs')
    executable = process.execPath
    commandArgs = [npmCLI, ...args]
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, commandArgs, {
      cwd: root,
      stdio: 'inherit',
      ...options,
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with status ${code}`))
    })
  })
}

async function exists(candidate) {
  try {
    await stat(candidate)
    return true
  } catch {
    return false
  }
}

function resolvePackageFile(root, specifier) {
  try {
    return requireFromHere.resolve(specifier, { paths: [join(root, 'desktop'), root] })
  } catch {
    return ''
  }
}

function electronVersion(desktopPackage) {
  return String(desktopPackage?.devDependencies?.electron ?? '').replace(/^[^\d]*/, '').trim()
}

function nodeIncludeDir(root) {
  const candidates = [
    join(dirname(process.execPath), '..', 'include', 'node'),
    join(root, 'node_modules', 'node-gyp', 'src'),
  ]
  return candidates[0]
}

export function nativeAddonResources(root) {
  const extras = []
  const names = []
  if (process.platform === 'darwin') {
    names.push(
      'macos-screen-permission.node',
      'macos-keychain.node',
      'macos-windows.node',
    )
  }
  if (process.platform === 'win32') names.push('windows-windows.node')
  for (const name of names) {
    extras.push({
      from: join(root, 'build', 'desktop', name),
      to: name,
    })
  }
  extras.push({
    from: join(root, 'build', 'desktop', 'node_modules', 'node-pty'),
    to: 'node-pty',
  })
  return extras
}

async function compileDarwinAddon(root, outName, source, frameworks, weakFrameworks = []) {
  const args = [
    '-shared',
    '-undefined', 'dynamic_lookup',
    '-fobjc-arc',
    '-fblocks',
    '-I', nodeIncludeDir(root),
  ]
  for (const name of frameworks) {
    args.push('-framework', name)
  }
  for (const name of weakFrameworks) {
    args.push('-weak_framework', name)
  }
  args.push('-o', join(root, 'build', 'desktop', outName), join(root, 'desktop', 'native', source))
  await run(root, '/usr/bin/clang', args)
}

async function rebuildNodePtyForElectron(root, version) {
  const source = join(root, 'node_modules', 'node-pty')
  if (!await exists(source)) {
    throw new Error(`node-pty is missing at ${source}`)
  }
  const destDir = join(root, 'build', 'desktop', 'node_modules')
  const dest = join(destDir, 'node-pty')
  await mkdir(destDir, { recursive: true })
  await rm(dest, { recursive: true, force: true })
  await cp(source, dest, { recursive: true })
  let ptyVersion = ''
  try {
    const ptyPackage = JSON.parse(await readFile(join(dest, 'package.json'), 'utf8'))
    ptyVersion = String(ptyPackage.version ?? '').trim()
  } catch {
    ptyVersion = ''
  }
  await writeFile(
    join(root, 'build', 'desktop', 'package.json'),
    `${JSON.stringify({
      name: 'milksu-desktop-native',
      private: true,
      dependencies: ptyVersion ? { 'node-pty': ptyVersion } : { 'node-pty': '*' },
    }, null, 2)}\n`,
  )
  // @electron/rebuild@4 的 exports 只暴露 ./lib/main.js，子路径解析会被 exports map 拦截；
  // 从包入口解析结果推导 cli.js 的实际磁盘路径（纯路径拼接不经过 exports 检查）。
  const rebuildEntry = resolvePackageFile(root, '@electron/rebuild')
  const rebuildCli = resolvePackageFile(root, '@electron/rebuild/lib/cli.js')
    || (rebuildEntry ? join(dirname(rebuildEntry), 'cli.js') : '')
  if (!rebuildCli) {
    throw new Error('@electron/rebuild is required to rebuild node-pty for Electron')
  }
  if (!version) {
    throw new Error('desktop/package.json is missing devDependencies.electron')
  }
  await run(root, process.execPath, [
    rebuildCli,
    '--version', version,
    '--module-dir', join(root, 'build', 'desktop'),
    '--only', 'node-pty',
    '--force',
  ])
}

async function compileWindowsWindowsAddon(root, version) {
  const work = join(root, 'build', 'desktop', 'windows-windows-gyp')
  await mkdir(work, { recursive: true })
  await copyFile(
    join(root, 'desktop', 'native', 'windows-windows.c'),
    join(work, 'windows-windows.c'),
  )
  await writeFile(
    join(work, 'binding.gyp'),
    `${JSON.stringify({
      targets: [{
        target_name: 'windows_windows',
        sources: ['windows-windows.c'],
        libraries: ['-luser32', '-lkernel32'],
      }],
    }, null, 2)}\n`,
  )
  const nodeGyp = resolvePackageFile(root, 'node-gyp/bin/node-gyp.js')
  if (!nodeGyp) {
    throw new Error('node-gyp is required to compile windows-windows.node')
  }
  if (!version) {
    throw new Error('desktop/package.json is missing devDependencies.electron')
  }
  await run(work, process.execPath, [
    nodeGyp,
    'rebuild',
    `--target=${version}`,
    '--arch=x64',
    '--dist-url=https://electronjs.org/headers',
  ], { cwd: work })
  const built = join(work, 'build', 'Release', 'windows_windows.node')
  if (!await exists(built)) {
    throw new Error(`windows-windows.node was not produced at ${built}`)
  }
  await copyFile(built, join(root, 'build', 'desktop', 'windows-windows.node'))
}

export async function compileNativeAddons(root) {
  await mkdir(join(root, 'build', 'desktop'), { recursive: true })
  const desktopPackage = JSON.parse(await readFile(join(root, 'desktop', 'package.json'), 'utf8'))
  const version = electronVersion(desktopPackage)
  await rebuildNodePtyForElectron(root, version)
  if (process.platform === 'darwin') {
    await compileDarwinAddon(
      root,
      'macos-screen-permission.node',
      'macos-screen-permission.m',
      ['CoreGraphics', 'Foundation'],
      ['ScreenCaptureKit'],
    )
    await compileDarwinAddon(
      root,
      'macos-keychain.node',
      'macos-keychain.m',
      ['Security', 'CoreFoundation'],
    )
    await compileDarwinAddon(
      root,
      'macos-windows.node',
      'macos-windows.m',
      ['AppKit', 'CoreGraphics', 'Foundation'],
    )
  }
  if (process.platform === 'win32') {
    await compileWindowsWindowsAddon(root, version)
  }
}

export { fileURLToPath }
