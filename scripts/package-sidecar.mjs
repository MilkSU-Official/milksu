import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeVersion = '24.18.0'
const archifyCommit = '7b49d0b715fd4ba48116bcdecd1ba3789a279613'
const piLspVersion = '0.29.0'
const piRetryVersion = '0.31.0'
const piBackgroundTasksVersion = '0.1.10'
const systemOcrVersion = '1.1.0'
const systemOcrNativePackages = {
  'darwin/arm64': '@napi-rs/system-ocr-darwin-arm64',
  'darwin/amd64': '@napi-rs/system-ocr-darwin-x64',
}
const nodeArchives = {
  'darwin/arm64': {
    file: `node-v${nodeVersion}-darwin-arm64.tar.xz`,
    sha256: '4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6',
  },
  'darwin/amd64': {
    file: `node-v${nodeVersion}-darwin-x64.tar.xz`,
    sha256: '4a3b6bc81542154430825128d9a279e8b364e8d90581544e506ef7579fd1ab6f',
  },
}

function argument(name, fallback = undefined) {
  const prefix = `--${name}=`
  const inline = process.argv.find(value => value.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function currentPlatform() {
  const arch = process.arch === 'x64' ? 'amd64' : process.arch
  return `${process.platform}/${arch}`
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function sha256(path) {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`)
  await writeFile(destination, Buffer.from(await response.arrayBuffer()), { mode: 0o600 })
}

async function officialNodeRuntime(platform) {
  const archive = nodeArchives[platform]
  if (!archive) throw new Error(`unsupported Sidecar platform: ${platform}`)
  const cache = join(repositoryRoot, 'build', 'sidecar-cache', platform.replace('/', '-'))
  const archivePath = join(cache, archive.file)
  const runtimeRoot = join(cache, `node-v${nodeVersion}`)
  const runtimeBinary = join(runtimeRoot, 'bin', 'node')
  await mkdir(cache, { recursive: true, mode: 0o700 })

  let archiveValid = await exists(archivePath) && await sha256(archivePath) === archive.sha256
  if (!archiveValid) {
    await download(`https://nodejs.org/download/release/v${nodeVersion}/${archive.file}`, archivePath)
    archiveValid = await sha256(archivePath) === archive.sha256
  }
  if (!archiveValid) throw new Error(`official Node archive checksum mismatch: ${archive.file}`)

  if (!await exists(runtimeBinary)) {
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
    const archiveDirectory = archive.file.replace(/\.tar\.xz$/, '')
    await execFileAsync('/usr/bin/tar', [
      '-xJf', archivePath,
      '-C', runtimeRoot,
      '--strip-components=1',
      `${archiveDirectory}/bin/node`,
      `${archiveDirectory}/LICENSE`,
    ])
  }
  return { binary: runtimeBinary, license: join(runtimeRoot, 'LICENSE'), archive }
}

async function bundleBridge(entry, outfile) {
  await build({
    entryPoints: [join(repositoryRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['@napi-rs/system-ocr'],
    banner: { js: "const __import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
    define: { 'import.meta.url': '__import_meta_url' },
    legalComments: 'eof',
    logLevel: 'info',
  })
}

async function runWithInput(executable, argumentsList, input, options) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, argumentsList, { ...options, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', code => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise({ stdout, stderr })
      else rejectPromise(new Error(`Sidecar exited with ${code}: ${stderr}`))
    })
    child.stdin.end(input)
  })
}

async function buildSidecar(platform) {
  const runtime = await officialNodeRuntime(platform)
  const output = join(repositoryRoot, 'build', 'sidecar', platform.replace('/', '-'))
  await mkdir(output, { recursive: true, mode: 0o700 })
  const nodeOutput = join(output, 'node')
  const chatOutput = join(output, 'chat-bridge.cjs')
  const securityOutput = join(output, 'security-bridge.cjs')
  const archifySource = join(repositoryRoot, 'third_party', 'archify', 'archify')
  const archifyOutput = join(output, 'skills', 'archify')
  const licenseOutput = join(output, 'THIRD_PARTY-LICENSES')
  const archifyPackage = JSON.parse(await readFile(join(archifySource, 'package.json'), 'utf8'))
  const systemOcrNativePackage = systemOcrNativePackages[platform]
  if (!systemOcrNativePackage) {
    throw new Error(`system OCR does not support Sidecar platform: ${platform}`)
  }
  const systemOcrSource = join(repositoryRoot, 'node_modules', '@napi-rs', 'system-ocr')
  const systemOcrNativeSource = join(
    repositoryRoot,
    'node_modules',
    ...systemOcrNativePackage.split('/'),
  )
  if (!await exists(systemOcrSource) || !await exists(systemOcrNativeSource)) {
    throw new Error(
      `system OCR packages are incomplete for ${platform}; run npm install on the target architecture`,
    )
  }
  const systemOcrOutputRoot = join(output, 'node_modules', '@napi-rs')
  const { stdout: checkedOutArchifyCommit } = await execFileAsync(
    'git',
    ['-C', join(repositoryRoot, 'third_party', 'archify'), 'rev-parse', 'HEAD'],
  )
  if (checkedOutArchifyCommit.trim() !== archifyCommit) {
    throw new Error(
      `Archify checkout mismatch: expected ${archifyCommit}, got ${checkedOutArchifyCommit.trim()}`,
    )
  }

  await rm(archifyOutput, { recursive: true, force: true })
  await rm(systemOcrOutputRoot, { recursive: true, force: true })
  await mkdir(dirname(archifyOutput), { recursive: true, mode: 0o700 })
  await mkdir(systemOcrOutputRoot, { recursive: true, mode: 0o700 })
  await mkdir(licenseOutput, { recursive: true, mode: 0o700 })
  await cp(archifySource, archifyOutput, { recursive: true })
  await Promise.all([
    copyFile(runtime.binary, nodeOutput),
    copyFile(runtime.license, join(output, 'NODE-LICENSE')),
    copyFile(
      join(repositoryRoot, 'third_party', 'licenses', 'pi-MIT.txt'),
      join(licenseOutput, 'pi-MIT.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'third_party', 'licenses', 'narumitw-pi-extensions-MIT.txt'),
      join(licenseOutput, 'narumitw-pi-extensions-MIT.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'node_modules', 'pi-better-background-tasks', 'LICENSE'),
      join(licenseOutput, 'pi-better-background-tasks-MIT.txt'),
    ),
    copyFile(
      join(systemOcrSource, 'LICENSE'),
      join(licenseOutput, 'napi-rs-system-ocr-MIT.txt'),
    ),
    cp(systemOcrSource, join(systemOcrOutputRoot, 'system-ocr'), { recursive: true }),
    cp(
      systemOcrNativeSource,
      join(systemOcrOutputRoot, systemOcrNativePackage.split('/')[1]),
      { recursive: true },
    ),
    writeFile(join(output, 'package.json'), `${JSON.stringify({
      name: '@earendil-works/pi-coding-agent',
      version: '0.80.2',
      type: 'commonjs',
      private: true,
    }, null, 2)}\n`, { mode: 0o600 }),
    bundleBridge('bridge.js', chatOutput),
    bundleBridge('security-bridge.js', securityOutput),
  ])
  await Promise.all([
    chmod(nodeOutput, 0o755),
    chmod(chatOutput, 0o644),
    chmod(securityOutput, 0o644),
  ])

  const manifest = {
    schema: 'milksu-sidecar/v1alpha1',
    platform,
    node: {
      version: nodeVersion,
      archive: runtime.archive.file,
      archiveSha256: runtime.archive.sha256,
      binarySha256: await sha256(nodeOutput),
    },
    pi: {
      package: '@earendil-works/pi-coding-agent',
      version: '0.80.2',
      license: 'MIT',
      licenseFile: 'THIRD_PARTY-LICENSES/pi-MIT.txt',
    },
    skills: {
      archify: {
        package: 'tt-a1i/archify',
        version: archifyPackage.version,
        commit: archifyCommit,
        license: archifyPackage.license,
        licenseFile: 'skills/archify/LICENSE',
        path: 'skills/archify',
      },
    },
    extensions: {
      piLsp: {
        package: '@narumitw/pi-lsp',
        version: piLspVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/narumitw-pi-extensions-MIT.txt',
        scope: 'coding-only',
      },
      piRetry: {
        package: '@narumitw/pi-retry',
        version: piRetryVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/narumitw-pi-extensions-MIT.txt',
        scope: 'coding-only',
      },
      piBackgroundTasks: {
        package: 'pi-better-background-tasks',
        version: piBackgroundTasksVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/pi-better-background-tasks-MIT.txt',
        scope: 'coding-only',
      },
      localOcr: {
        package: '@napi-rs/system-ocr',
        version: systemOcrVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/napi-rs-system-ocr-MIT.txt',
        scope: 'coding-attachments',
      },
    },
    esbuild: { version: '0.28.1' },
    bridges: {
      chat: { file: 'chat-bridge.cjs', sha256: await sha256(chatOutput) },
      security: { file: 'security-bridge.cjs', sha256: await sha256(securityOutput) },
    },
  }
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return output
}

async function smokeSidecar(platform) {
  const output = await buildSidecar(platform)
  for (const licensePath of [
    join(output, 'NODE-LICENSE'),
    join(output, 'THIRD_PARTY-LICENSES', 'pi-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'narumitw-pi-extensions-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'pi-better-background-tasks-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'napi-rs-system-ocr-MIT.txt'),
    join(output, 'skills', 'archify', 'LICENSE'),
  ]) {
    if (!await exists(licensePath)) {
      throw new Error(`packaged Sidecar is missing license file: ${licensePath}`)
    }
  }
  const node = join(output, 'node')
  const workspace = join(repositoryRoot, 'build', 'sidecar-smoke', platform.replace('/', '-'))
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  await mkdir(join(workspace, '.git'), { recursive: true, mode: 0o700 })
  const ocrFixture = join(workspace, 'ocr-fixture.png')
  await copyFile(
    join(repositoryRoot, 'docs', 'design', 'milksu-coding-composer-layout-reference.png'),
    ocrFixture,
  )
  const runtimeArguments = [
    '--permission',
    `--allow-fs-read=${output}`,
    `--allow-fs-read=${workspace}`,
    `--allow-fs-write=${workspace}`,
  ]
  const chatRuntimeArguments = [
    ...runtimeArguments,
    '--allow-addons',
    '--allow-child-process',
    '--allow-fs-read=/bin/bash',
    '--allow-fs-read=/bin/sh',
    '--allow-fs-read=/usr/bin/env',
    '--allow-fs-read=/usr/bin/sandbox-exec',
  ]
  const ocrLoad = await runWithInput(
    node,
    [
      ...runtimeArguments,
      '--allow-addons',
      '-e',
      "const {recognize}=require('@napi-rs/system-ocr');"
        + "recognize(process.argv[1],1,['zh-Hans','en-US']).then(result=>{"
        + "if(!result.text)throw new Error('empty OCR result');"
        + "process.stdout.write(`system-ocr-ready:${result.text.length}`)});",
      ocrFixture,
    ],
    '',
    { cwd: output, env: { ...process.env, HOME: output } },
  )
  if (!ocrLoad.stdout.startsWith('system-ocr-ready:')) {
    throw new Error(`packaged system OCR did not load: ${ocrLoad.stdout}${ocrLoad.stderr}`)
  }
  const securityRun = await runWithInput(
    node,
    [...runtimeArguments, join(output, 'security-bridge.cjs')],
    '{"action":"protocol_info","requestId":"packaged-smoke"}\n',
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  const response = JSON.parse(securityRun.stdout.trim())
  if (response.protocol !== 'milksu-security-engine/v1alpha1' || response.inheritedTools?.length !== 0) {
    throw new Error(`unexpected packaged Security Sidecar response: ${securityRun.stdout}`)
  }
  const chatRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-smoke","executionMode":"go","approvalPolicy":"workspace-auto"}',
      '{"action":"destroy_session","conversationId":"packaged-smoke"}',
      '',
    ].join('\n'),
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  const chatResponses = chatRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const ready = chatResponses.find(value => value.type === 'ready')
  const coreExpectedTools = [
    'read',
    'bash',
    'edit',
    'write',
    'grep',
    'find',
    'ls',
  ]
  const expectedTools = [
    ...coreExpectedTools,
    'bg_task',
    'bg_status',
    'lsp_diagnostics',
  ]
  const ctfRequestedTools = [...coreExpectedTools, 'ctf_inspect']
  if (
    !ready
    || !expectedTools.every(tool => ready.tools?.includes(tool))
    || ready.tools?.includes('lsp_fix')
    || ready.executionMode !== 'go'
    || ready.approvalPolicy !== 'workspace-auto'
    || !ready.skills?.includes('archify')
    || !ready.extensions?.includes('pi-lsp')
    || !ready.extensions?.includes('pi-retry')
    || !ready.extensions?.includes('pi-background-tasks')
    || !chatResponses.some(value => value.type === 'session_destroyed')
  ) {
    throw new Error(`unexpected packaged Chat Sidecar response: ${chatRun.stdout}`)
  }
  const planRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-plan","executionMode":"plan","approvalPolicy":"workspace-auto"}',
      '{"action":"destroy_session","conversationId":"packaged-plan"}',
      '',
    ].join('\n'),
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  const planResponses = planRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const planReady = planResponses.find(value => value.type === 'ready')
  if (
    !planReady
    || ['bash', 'edit', 'write', 'bg_task', 'lsp_fix'].some(tool => planReady.tools?.includes(tool))
    || !['read', 'grep', 'find', 'ls', 'bg_status', 'lsp_diagnostics'].every(tool => planReady.tools?.includes(tool))
    || planReady.executionMode !== 'plan'
  ) {
    throw new Error(`unexpected packaged Plan response: ${planRun.stdout}`)
  }
  const nonGitWorkspace = join(
    repositoryRoot,
    'build',
    'sidecar-smoke-non-git',
    platform.replace('/', '-'),
  )
  await mkdir(nonGitWorkspace, { recursive: true, mode: 0o700 })
  const nonGitArguments = [
    '--permission',
    `--allow-fs-read=${output}`,
    `--allow-fs-read=${nonGitWorkspace}`,
    `--allow-fs-write=${nonGitWorkspace}`,
    '--allow-child-process',
    '--allow-fs-read=/bin/bash',
    '--allow-fs-read=/bin/sh',
    '--allow-fs-read=/usr/bin/env',
    '--allow-fs-read=/usr/bin/sandbox-exec',
  ]
  const nonGitRun = await runWithInput(
    node,
    [...nonGitArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-non-git","executionMode":"plan","approvalPolicy":"workspace-auto"}',
      '{"action":"destroy_session","conversationId":"packaged-non-git"}',
      '',
    ].join('\n'),
    { cwd: nonGitWorkspace, env: { ...process.env, HOME: nonGitWorkspace } },
  )
  const nonGitResponses = nonGitRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  if (
    !nonGitResponses.some(value => value.type === 'ready')
    || !nonGitResponses.some(value => value.type === 'session_destroyed')
    || nonGitResponses.some(value => value.type === 'error')
  ) {
    throw new Error(`unexpected packaged non-Git workspace response: ${nonGitRun.stdout}`)
  }
  const ctfWorkspace = join(workspace, 'ctf-coach')
  await mkdir(join(ctfWorkspace, '.git'), { recursive: true, mode: 0o700 })
  await writeFile(join(ctfWorkspace, 'challenge.json'), `${JSON.stringify({
    schemaVersion: 'ctf-workspace.milksu.dev/v1alpha1',
    source: { scope: { targets: [{ kind: 'directory', value: 'workspace' }] } },
    policy: {
      mode: 'coach',
      allowedTools: ctfRequestedTools,
      execution: {
        workspaceOnly: true,
        defaultCommandTimeoutSeconds: 120,
        maxCommandTimeoutSeconds: 300,
        maxToolEventOutputBytes: 60000,
      },
    },
  }, null, 2)}\n`, { mode: 0o600 })
  const ctfRuntimeArguments = [
    '--permission',
    `--allow-fs-read=${output}`,
    `--allow-fs-read=${ctfWorkspace}`,
    `--allow-fs-write=${ctfWorkspace}`,
    '--allow-child-process',
    '--allow-fs-read=/bin/bash',
    '--allow-fs-read=/bin/sh',
    '--allow-fs-read=/usr/bin/env',
    '--allow-fs-read=/usr/bin/sandbox-exec',
  ]
  const ctfChatRun = await runWithInput(
    node,
    [...ctfRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-ctf-coach"}',
      '{"action":"destroy_session","conversationId":"packaged-ctf-coach"}',
      '',
    ].join('\n'),
    { cwd: ctfWorkspace, env: { ...process.env, HOME: ctfWorkspace } },
  )
  const ctfChatResponses = ctfChatRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const ctfReady = ctfChatResponses.find(value => value.type === 'ready')
  const coachTools = ['read', 'edit', 'write', 'grep', 'find', 'ls', 'ctf_inspect']
  if (
    !ctfReady
    || ctfReady.tools?.includes('bash')
    || ctfReady.tools?.includes('lsp_diagnostics')
    || ctfReady.tools?.includes('lsp_fix')
    || ctfReady.skills?.includes('archify')
    || ctfReady.extensions?.includes('pi-lsp')
    || ctfReady.extensions?.includes('pi-retry')
    || !coachTools.every(tool => ctfReady.tools?.includes(tool))
    || !ctfChatResponses.some(value => value.type === 'session_destroyed')
  ) {
    throw new Error(`unexpected packaged CTF Coach response: ${ctfChatRun.stdout}`)
  }
  const bashProbe = await runWithInput(
    node,
    [
      ...chatRuntimeArguments,
      '-e',
      [
        'const { existsSync } = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        'if (!existsSync("/bin/bash")) throw new Error("bash is unavailable");',
        'const child = spawn("/bin/bash", ["-c", "printf packaged-bash-ok"]);',
        'child.stdout.pipe(process.stdout);',
        'child.stderr.pipe(process.stderr);',
        'child.on("close", code => { if (code) process.exitCode = code; });',
      ].join(' '),
    ],
    '',
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  if (bashProbe.stdout !== 'packaged-bash-ok') {
    throw new Error(`unexpected packaged Bash probe: ${bashProbe.stdout}\n${bashProbe.stderr}`)
  }
  const { stdout: codingDeliveryOutput } = await execFileAsync(
    process.execPath,
    [join(repositoryRoot, 'scripts', 'test-coding-agent-delivery.mjs')],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MILKSU_CODING_SIDECAR_NODE: node,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
    },
  )
  const codingDelivery = JSON.parse(codingDeliveryOutput)
  if (!codingDelivery.passed || codingDelivery.score !== 100) {
    throw new Error(`packaged Coding delivery failed: ${codingDeliveryOutput}`)
  }
  process.stdout.write(`${JSON.stringify({
    ...response,
    codingDeliveryScore: codingDelivery.score,
  })}\n`)
}

async function installSidecar(platform, binaryPath) {
  if (!binaryPath) throw new Error('--bin is required for Sidecar installation')
  const source = await buildSidecar(platform)
  const absoluteBinary = resolve(repositoryRoot, binaryPath)
  if (!absoluteBinary.includes('.app/Contents/MacOS/')) {
    throw new Error(`Wails macOS binary path was not recognised: ${absoluteBinary}`)
  }
  const contents = dirname(dirname(absoluteBinary))
  const destination = join(contents, 'Resources', 'milksu-sidecar')
  const application = dirname(contents)
  const distributableFiles = [
    'node',
    'chat-bridge.cjs',
    'security-bridge.cjs',
    'manifest.json',
    'package.json',
    'NODE-LICENSE',
  ]
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true, mode: 0o700 })
  await Promise.all(distributableFiles.map(file => copyFile(join(source, file), join(destination, file))))
  await cp(join(source, 'skills'), join(destination, 'skills'), { recursive: true })
  await cp(
    join(source, 'THIRD_PARTY-LICENSES'),
    join(destination, 'THIRD_PARTY-LICENSES'),
    { recursive: true },
  )
  await cp(join(source, 'node_modules'), join(destination, 'node_modules'), { recursive: true })
  const installedOcrPackage = join(
    destination,
    'node_modules',
    ...systemOcrNativePackages[platform].split('/'),
  )
  for (const requiredPath of [
    join(destination, 'THIRD_PARTY-LICENSES', 'napi-rs-system-ocr-MIT.txt'),
    installedOcrPackage,
  ]) {
    if (!await exists(requiredPath)) {
      throw new Error(`installed Sidecar is missing OCR runtime artifact: ${requiredPath}`)
    }
  }
  await chmod(join(destination, 'node'), 0o755)
  await execFileAsync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    process.env.MILKSU_CODESIGN_IDENTITY || '-',
    application,
  ])
  process.stdout.write(`Installed MilkSU Sidecar into ${destination}\n`)
}

const command = process.argv[2] ?? 'build'
const platform = argument('platform', currentPlatform())
if (command === 'build') {
  process.stdout.write(`${await buildSidecar(platform)}\n`)
} else if (command === 'smoke') {
  await smokeSidecar(platform)
} else if (command === 'install') {
  await installSidecar(platform, argument('bin'))
} else {
  throw new Error(`unknown Sidecar packaging command: ${command}`)
}
