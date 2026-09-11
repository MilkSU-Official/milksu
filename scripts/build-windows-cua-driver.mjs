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
const cuaDriverVersion = '0.27.0'
const cuaDriverTag = `cua-driver-rs-v${cuaDriverVersion}`
const sourceRepository = 'https://github.com/trycua/cua.git'
const sourceCommit = '082de4344b731ae4738ddc6a6f13f21bb3c49a85'
const rustVersion = '1.97.1'
const rustTarget = 'x86_64-pc-windows-msvc'
const cargoWorkspaceRelativePath = join('libs', 'cua-driver', 'rust')
const cargoLockRelativePath = join(cargoWorkspaceRelativePath, 'Cargo.lock')
const windowsPlatformSourceRelativePath = join(
  cargoWorkspaceRelativePath,
  'crates',
  'platform-windows',
  'src',
  'browser_platform.rs',
)
const licenseRelativePath = 'LICENSE.md'
// Upstream * text=auto checks out CRLF on Windows. Hash after LF normalization
// so the pin matches the git blob, not the working-tree line endings.
const expectedCargoLockSha256 = '1200667c238ea4b425e7ab0b1e3bfa1c49b93158ae90bd52a15d5e78c2871678'
const expectedWindowsPlatformSourceSha256 = '509e8467489b4201c947779dced4af267bdd68bd1a588a6d249404ef948fc53f'
const buildRecipe = 'cua-driver-windows-pinned-source-v2'

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

async function verifySource(sourceRoot, gitEnvironment) {
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
    if (
      await normalizedTextSha256(join(sourceRoot, cargoLockRelativePath))
      !== expectedCargoLockSha256
    ) {
      return false
    }
    if (
      await normalizedTextSha256(join(sourceRoot, windowsPlatformSourceRelativePath))
      !== expectedWindowsPlatformSourceSha256
    ) {
      return false
    }
    const { stdout: changedFiles } = await run(
      'git',
      ['-C', sourceRoot, 'diff', '--name-only', '--'],
      { env: gitEnvironment },
    )
    if (changedFiles.trim() !== '') return false
    if (!await exists(join(sourceRoot, licenseRelativePath))) return false
    return true
  } catch {
    return false
  }
}

async function prepareSource(paths) {
  const gitEnvironment = privateGitEnvironment(paths)
  if (await verifySource(paths.source, gitEnvironment)) return

  await rm(paths.source, { recursive: true, force: true })
  await mkdir(paths.source, { recursive: true, mode: 0o700 })
  await run('git', ['-C', paths.source, 'init', '--quiet'], { env: gitEnvironment })
  await run('git', ['-C', paths.source, 'config', 'core.autocrlf', 'false'], {
    env: gitEnvironment,
  })
  await run('git', ['-C', paths.source, 'config', 'core.eol', 'lf'], {
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
  const cargoLockSha256 = await normalizedTextSha256(join(paths.source, cargoLockRelativePath))
  if (cargoLockSha256 !== expectedCargoLockSha256) {
    throw new Error(
      `pinned Cua Cargo.lock checksum mismatch: expected ${expectedCargoLockSha256}, got ${cargoLockSha256}`,
    )
  }
  const windowsPlatformSourceSha256 = await normalizedTextSha256(
    join(paths.source, windowsPlatformSourceRelativePath),
  )
  if (windowsPlatformSourceSha256 !== expectedWindowsPlatformSourceSha256) {
    throw new Error(
      `pinned Cua Windows platform source checksum mismatch: expected ${expectedWindowsPlatformSourceSha256}, got ${windowsPlatformSourceSha256}`,
    )
  }
  if (!await verifySource(paths.source, gitEnvironment)) {
    throw new Error('pinned Cua source failed provenance verification')
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
    throw new Error('the Cua Driver source build is Windows-only')
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

  await prepareSource(paths)
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
  const expectedReceipt = {
    buildRecipe,
    version: cuaDriverVersion,
    tag: cuaDriverTag,
    sourceRepository,
    sourceCommit,
    cargoLockSha256: expectedCargoLockSha256,
    windowsPlatformSource: windowsPlatformSourceRelativePath.replaceAll('\\', '/'),
    windowsPlatformSourceSha256: expectedWindowsPlatformSourceSha256,
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
    build: {
      recipe: buildRecipe,
      rustupToolchain,
      rustcVersion,
      cargoVersion,
      target: rustTarget,
      cargoLockSha256: expectedCargoLockSha256,
      windowsPlatformSourceSha256: expectedWindowsPlatformSourceSha256,
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
