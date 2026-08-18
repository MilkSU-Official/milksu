import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cuaDriverVersion = '0.14.2'
const cuaDriverTag = `cua-driver-rs-v${cuaDriverVersion}`
const sourceRepository = 'https://github.com/trycua/cua.git'
const sourceCommit = 'ed9d5efcf5f261f4854bf2de0ba06a2b0b4419c4'
const rustVersion = '1.97.1'
const rustTarget = 'x86_64-pc-windows-msvc'
const patchRelativePath = join(
  'third_party',
  'cua-driver',
  'patches',
  'cua-driver-rs-v0.14.2-windows-canonical-process-path.patch',
)
const cargoWorkspaceRelativePath = join('libs', 'cua-driver', 'rust')
const cargoLockRelativePath = join(cargoWorkspaceRelativePath, 'Cargo.lock')
const patchedSourceRelativePath = join(
  cargoWorkspaceRelativePath,
  'crates',
  'platform-windows',
  'src',
  'browser_platform.rs',
)
const licenseRelativePath = 'LICENSE.md'
const expectedPatchSha256 = '25811f122f48ebdf346139c13724ee6f7cfa4ab8e29afad5a49d5bcfe62a96d4'
const expectedCargoLockSha256 = '08325c0e9779b1604bdc707f60c4f85836f2e7e668375112448b3d04a46db3b2'
const expectedPatchedSourceSha256 = '190779e4f349ad7b359e9a51f3c057089e388d716612bbf66f8ebb9a6e15bc8f'
const buildRecipe = 'cua-driver-windows-pinned-source-v1'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function normalizedTextSha256(path) {
  return sha256Text((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'))
}

function systemEnvironment() {
  const environment = {}
  for (const name of [
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATH',
    'PATHEXT',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'PROCESSOR_IDENTIFIER',
  ]) {
    if (process.env[name]) environment[name] = process.env[name]
  }
  return environment
}

function privateBuildEnvironment(paths) {
  const originalProfile = process.env.USERPROFILE || process.env.HOME
  const rustupHome = process.env.RUSTUP_HOME
    || (originalProfile ? join(originalProfile, '.rustup') : undefined)
  const environment = {
    ...systemEnvironment(),
    USERPROFILE: paths.home,
    HOME: paths.home,
    APPDATA: join(paths.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(paths.home, 'AppData', 'Local'),
    TEMP: paths.temp,
    TMP: paths.temp,
    CARGO_HOME: paths.cargoHome,
    CARGO_TARGET_DIR: paths.cargoTarget,
    CARGO_INCREMENTAL: '0',
    CARGO_NET_GIT_FETCH_WITH_CLI: 'false',
    CARGO_TERM_COLOR: 'never',
    CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
  }
  if (rustupHome) environment.RUSTUP_HOME = rustupHome
  return environment
}

async function discoverMsvcEnvironment(paths) {
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const vswhere = join(
    programFilesX86,
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  )
  if (!await exists(vswhere)) {
    throw new Error(`Visual Studio discovery tool is missing: ${vswhere}`)
  }
  const { stdout: installationOutput } = await run(vswhere, [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    'Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre',
    '-property',
    'installationPath',
  ], {
    env: {
      ...systemEnvironment(),
      TEMP: paths.temp,
      TMP: paths.temp,
    },
  })
  const installationPath = installationOutput.trim()
  if (!installationPath) {
    throw new Error('Visual Studio Build Tools with x64 C++ and Spectre libraries are required')
  }
  const developerCommand = join(installationPath, 'Common7', 'Tools', 'VsDevCmd.bat')
  if (!await exists(developerCommand)) {
    throw new Error(`Visual Studio developer environment is missing: ${developerCommand}`)
  }
  const commandProcessor = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
  const environmentScript = join(paths.temp, 'milksu-cua-msvc-environment.cmd')
  await writeFile(environmentScript, [
    `@call "${developerCommand}" -no_logo -arch=x64 -host_arch=x64 >nul`,
    '@if errorlevel 1 exit /b %errorlevel%',
    '@set',
    '',
  ].join('\r\n'), { mode: 0o600 })
  const { stdout: environmentOutput } = await run(commandProcessor, [
    '/d',
    '/c',
    environmentScript,
  ], {
    env: {
      ...systemEnvironment(),
      TEMP: paths.temp,
      TMP: paths.temp,
    },
  })
  const discovered = new Map()
  for (const line of environmentOutput.split(/\r?\n/u)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    discovered.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1))
  }
  const environment = {}
  for (const name of [
    'PATH',
    'INCLUDE',
    'LIB',
    'LIBPATH',
    'VCINSTALLDIR',
    'VCToolsInstallDir',
    'VCToolsVersion',
    'WindowsSdkDir',
    'WindowsSDKVersion',
  ]) {
    const value = discovered.get(name.toLowerCase())
    if (value) environment[name] = value
  }
  if (!environment.INCLUDE || !environment.LIB || !environment.VCToolsInstallDir) {
    throw new Error('Visual Studio developer environment did not provide C++ build paths')
  }
  return { environment, installationPath }
}

function privateGitEnvironment(paths) {
  return {
    ...systemEnvironment(),
    USERPROFILE: paths.home,
    HOME: paths.home,
    XDG_CONFIG_HOME: join(paths.home, '.config'),
    TEMP: paths.temp,
    TMP: paths.temp,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
  }
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 << 20,
    timeout: 20 * 60 * 1000,
    windowsHide: true,
    ...options,
  })
}

async function verifyPatchAsset(repositoryRoot) {
  const path = join(repositoryRoot, patchRelativePath)
  if (!await exists(path)) throw new Error(`missing pinned Cua patch: ${path}`)
  const digest = await normalizedTextSha256(path)
  if (digest !== expectedPatchSha256) {
    throw new Error(`Cua patch checksum mismatch: expected ${expectedPatchSha256}, got ${digest}`)
  }
  return path
}

async function verifySource(sourceRoot, patchPath, gitEnvironment) {
  if (!await exists(join(sourceRoot, '.git'))) return false
  try {
    const { stdout: head } = await run('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
      env: gitEnvironment,
    })
    if (head.trim() !== sourceCommit) return false
    const { stdout: origin } = await run(
      'git',
      ['-C', sourceRoot, 'remote', 'get-url', 'origin'],
      { env: gitEnvironment },
    )
    if (origin.trim() !== sourceRepository) return false
    if (await sha256(join(sourceRoot, cargoLockRelativePath)) !== expectedCargoLockSha256) {
      return false
    }
    if (
      await normalizedTextSha256(join(sourceRoot, patchedSourceRelativePath))
      !== expectedPatchedSourceSha256
    ) {
      return false
    }
    const { stdout: changedFiles } = await run(
      'git',
      ['-C', sourceRoot, 'diff', '--name-only', '--'],
      { env: gitEnvironment },
    )
    const expectedChangedFile = patchedSourceRelativePath.replaceAll('\\', '/')
    if (changedFiles.trim().replaceAll('\\', '/') !== expectedChangedFile) return false
    await run('git', ['-C', sourceRoot, 'diff', '--check'], { env: gitEnvironment })
    const { stdout: sourceDiff } = await run(
      'git',
      ['-C', sourceRoot, 'diff', '--binary', '--no-ext-diff', '--'],
      { env: gitEnvironment },
    )
    const normalizedDiff = sourceDiff.replaceAll('\r\n', '\n')
    if (sha256Text(normalizedDiff) !== expectedPatchSha256) return false
    if (!await exists(join(sourceRoot, licenseRelativePath))) return false
    const { stdout: reverseCheck } = await run(
      'git',
      ['-C', sourceRoot, 'apply', '--check', '--reverse', patchPath],
      { env: gitEnvironment },
    )
    return reverseCheck.trim() === ''
  } catch {
    return false
  }
}

async function prepareSource(paths, patchPath) {
  const gitEnvironment = privateGitEnvironment(paths)
  if (await verifySource(paths.source, patchPath, gitEnvironment)) return

  await rm(paths.source, { recursive: true, force: true })
  await mkdir(paths.source, { recursive: true, mode: 0o700 })
  await run('git', ['-C', paths.source, 'init', '--quiet'], { env: gitEnvironment })
  await run('git', ['-C', paths.source, 'config', 'core.autocrlf', 'false'], {
    env: gitEnvironment,
  })
  await run('git', ['-C', paths.source, 'config', 'core.safecrlf', 'true'], {
    env: gitEnvironment,
  })
  await run('git', ['-C', paths.source, 'config', 'core.longpaths', 'true'], {
    env: gitEnvironment,
  })
  await run('git', ['-C', paths.source, 'config', 'core.hooksPath', 'NUL'], {
    env: gitEnvironment,
  })
  await run('git', ['-C', paths.source, 'remote', 'add', 'origin', sourceRepository], {
    env: gitEnvironment,
  })
  await run(
    'git',
    ['-C', paths.source, 'fetch', '--no-tags', '--depth=1', 'origin', sourceCommit],
    { env: gitEnvironment },
  )
  await run('git', ['-C', paths.source, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], {
    env: gitEnvironment,
  })
  if (await sha256(join(paths.source, cargoLockRelativePath)) !== expectedCargoLockSha256) {
    throw new Error('pinned Cua Cargo.lock checksum mismatch before patching')
  }
  await run('git', ['-C', paths.source, 'apply', '--check', patchPath], {
    env: gitEnvironment,
  })
  await run('git', ['-C', paths.source, 'apply', patchPath], { env: gitEnvironment })
  if (!await verifySource(paths.source, patchPath, gitEnvironment)) {
    throw new Error('pinned Cua source failed post-patch provenance verification')
  }
}

async function selectInstalledRustToolchain(paths) {
  const environment = privateBuildEnvironment(paths)
  const { stdout } = await run('rustup', ['toolchain', 'list'], { env: environment })
  const installed = stdout
    .split(/\r?\n/u)
    .map(line => line.trim().split(/\s+/u)[0])
    .filter(Boolean)
    .sort((left, right) => {
      const leftPinned = left.startsWith(`${rustVersion}-`) ? 0 : 1
      const rightPinned = right.startsWith(`${rustVersion}-`) ? 0 : 1
      return leftPinned - rightPinned
    })
  for (const candidate of installed) {
    try {
      const { stdout: versionOutput } = await run(
        'rustup',
        ['run', candidate, 'rustc', '--version'],
        { env: environment },
      )
      if (versionOutput.trim().startsWith(`rustc ${rustVersion} `)) return candidate
    } catch {
      // Continue to another already-installed toolchain. No download is attempted.
    }
  }
  throw new Error(`Cua Windows build requires an installed rustc ${rustVersion} toolchain`)
}

async function toolchain(paths) {
  const rustupToolchain = await selectInstalledRustToolchain(paths)
  const environment = {
    ...privateBuildEnvironment(paths),
    RUSTUP_TOOLCHAIN: rustupToolchain,
  }
  const [{ stdout: rustcOutput }, { stdout: cargoOutput }] = await Promise.all([
    run('rustc', ['--version'], { cwd: paths.cargoWorkspace, env: environment }),
    run('cargo', ['--version'], { cwd: paths.cargoWorkspace, env: environment }),
  ])
  const rustcVersion = rustcOutput.trim()
  const cargoVersion = cargoOutput.trim()
  if (!rustcVersion.startsWith(`rustc ${rustVersion} `)) {
    throw new Error(`Cua Windows build requires rustc ${rustVersion}, got ${rustcVersion}`)
  }
  return { environment, rustupToolchain, rustcVersion, cargoVersion }
}

async function verifyRuntime(binary, paths) {
  const environment = {
    ...systemEnvironment(),
    USERPROFILE: paths.home,
    APPDATA: join(paths.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(paths.home, 'AppData', 'Local'),
    TEMP: paths.temp,
    TMP: paths.temp,
    PATH: join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
  }
  const { stdout } = await run(binary, ['--version'], {
    cwd: paths.runtime,
    env: environment,
    timeout: 10_000,
    maxBuffer: 1 << 20,
  })
  if (stdout.trim() !== `cua-driver ${cuaDriverVersion}`) {
    throw new Error(`unexpected source-built Cua Driver version: ${stdout.trim()}`)
  }
}

function buildPaths(repositoryRoot) {
  const root = join(
    repositoryRoot,
    'build',
    'sidecar-cache',
    `cua-windows-${cuaDriverVersion}`,
  )
  return {
    root,
    source: join(root, 's'),
    cargoHome: join(root, 'h'),
    cargoTarget: join(root, 't'),
    runtime: join(root, 'r'),
    home: join(root, 'u'),
    temp: join(root, 'tmp'),
    receipt: join(root, 'build.json'),
    get cargoWorkspace() {
      return join(this.source, cargoWorkspaceRelativePath)
    },
    get builtBinary() {
      return join(this.cargoTarget, rustTarget, 'release', 'cua-driver.exe')
    },
    get runtimeBinary() {
      return join(this.runtime, 'cua-driver.exe')
    },
    get runtimeLicense() {
      return join(this.runtime, 'LICENSE.md')
    },
  }
}

async function cachedReceiptIsValid(paths, expectedReceipt) {
  if (!await exists(paths.receipt) || !await exists(paths.runtimeBinary)) return false
  try {
    const receipt = JSON.parse(await readFile(paths.receipt, 'utf8'))
    for (const [name, value] of Object.entries(expectedReceipt)) {
      if (receipt[name] !== value) return false
    }
    return receipt.binarySha256 === await sha256(paths.runtimeBinary)
      && receipt.licenseSha256 === await sha256(paths.runtimeLicense)
  } catch {
    return false
  }
}

export async function buildWindowsCuaDriver({
  repositoryRoot = defaultRepositoryRoot,
  runTests = false,
} = {}) {
  if (process.platform !== 'win32') {
    throw new Error('the patched Cua Driver source build is Windows-only')
  }
  repositoryRoot = resolve(repositoryRoot)
  const paths = buildPaths(repositoryRoot)
  await Promise.all([
    mkdir(paths.cargoHome, { recursive: true, mode: 0o700 }),
    mkdir(paths.cargoTarget, { recursive: true, mode: 0o700 }),
    mkdir(paths.runtime, { recursive: true, mode: 0o700 }),
    mkdir(paths.home, { recursive: true, mode: 0o700 }),
    mkdir(join(paths.home, 'AppData', 'Roaming'), { recursive: true, mode: 0o700 }),
    mkdir(join(paths.home, 'AppData', 'Local'), { recursive: true, mode: 0o700 }),
    mkdir(paths.temp, { recursive: true, mode: 0o700 }),
  ])

  const patchPath = await verifyPatchAsset(repositoryRoot)
  await prepareSource(paths, patchPath)
  const {
    environment,
    rustupToolchain,
    rustcVersion,
    cargoVersion,
  } = await toolchain(paths)
  const msvc = await discoverMsvcEnvironment(paths)
  const { stdout: sourceDateEpochOutput } = await run(
    'git',
    ['-C', paths.source, 'show', '-s', '--format=%ct', 'HEAD'],
    { env: privateGitEnvironment(paths) },
  )
  const buildEnvironment = {
    ...environment,
    ...msvc.environment,
    SOURCE_DATE_EPOCH: sourceDateEpochOutput.trim(),
    GIT_HASH: sourceCommit,
  }

  try {
    await run('cargo', ['fetch', '--locked', '--target', rustTarget], {
      cwd: paths.cargoWorkspace,
      env: buildEnvironment,
    })
  } catch (onlineError) {
    try {
      await run('cargo', ['fetch', '--offline', '--locked', '--target', rustTarget], {
        cwd: paths.cargoWorkspace,
        env: buildEnvironment,
      })
    } catch (offlineError) {
      throw new AggregateError(
        [onlineError, offlineError],
        'locked Cua dependencies were unavailable online and absent from the project cache',
      )
    }
  }
  if (runTests) {
    await run('cargo', [
      'test',
      '--offline',
      '--locked',
      '--target',
      rustTarget,
      '-p',
      'platform-windows',
      'process_identity_uses_manifest_canonical_executable_path',
    ], {
      cwd: paths.cargoWorkspace,
      env: buildEnvironment,
    })
  }

  const expectedReceipt = {
    buildRecipe,
    version: cuaDriverVersion,
    tag: cuaDriverTag,
    sourceRepository,
    sourceCommit,
    patch: patchRelativePath.replaceAll('\\', '/'),
    patchSha256: expectedPatchSha256,
    cargoLockSha256: expectedCargoLockSha256,
    patchedSource: patchedSourceRelativePath.replaceAll('\\', '/'),
    patchedSourceSha256: expectedPatchedSourceSha256,
    rustupToolchain,
    rustcVersion,
    cargoVersion,
    target: rustTarget,
    visualStudioInstallation: msvc.installationPath,
    vcToolsVersion: msvc.environment.VCToolsVersion || '',
  }
  if (!await cachedReceiptIsValid(paths, expectedReceipt)) {
    await run('cargo', [
      'build',
      '--offline',
      '--locked',
      '--release',
      '--target',
      rustTarget,
      '-p',
      'cua-driver',
    ], {
      cwd: paths.cargoWorkspace,
      env: buildEnvironment,
    })
    if (!await exists(paths.builtBinary)) {
      throw new Error(`source-built Cua Driver output is missing: ${paths.builtBinary}`)
    }
    await Promise.all([
      copyFile(paths.builtBinary, paths.runtimeBinary),
      copyFile(join(paths.source, licenseRelativePath), paths.runtimeLicense),
    ])
    await chmod(paths.runtimeBinary, 0o755)
    await verifyRuntime(paths.runtimeBinary, paths)
    const receipt = {
      ...expectedReceipt,
      binarySha256: await sha256(paths.runtimeBinary),
      licenseSha256: await sha256(paths.runtimeLicense),
    }
    await writeFile(paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
  } else {
    await verifyRuntime(paths.runtimeBinary, paths)
  }

  const receipt = JSON.parse(await readFile(paths.receipt, 'utf8'))
  return {
    binary: paths.runtimeBinary,
    license: paths.runtimeLicense,
    tag: cuaDriverTag,
    sourceCommit,
    binarySha256: receipt.binarySha256,
    patch: {
      file: patchRelativePath.replaceAll('\\', '/'),
      sha256: expectedPatchSha256,
    },
    build: {
      recipe: buildRecipe,
      rustupToolchain,
      rustcVersion,
      cargoVersion,
      target: rustTarget,
      cargoLockSha256: expectedCargoLockSha256,
      patchedSourceSha256: expectedPatchedSourceSha256,
      receipt: relative(repositoryRoot, paths.receipt).replaceAll('\\', '/'),
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || 'build'
  if (!['build', 'verify'].includes(command)) {
    throw new Error(`unknown Cua Driver build command: ${command}`)
  }
  process.stdout.write(`${JSON.stringify(
    await buildWindowsCuaDriver({ runTests: command === 'verify' }),
    null,
    2,
  )}\n`)
}
