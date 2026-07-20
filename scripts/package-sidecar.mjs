import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeVersion = '24.18.0'
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

  await Promise.all([
    copyFile(runtime.binary, nodeOutput),
    copyFile(runtime.license, join(output, 'NODE-LICENSE')),
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
    pi: { package: '@earendil-works/pi-coding-agent', version: '0.80.2' },
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
  const node = join(output, 'node')
  const workspace = join(repositoryRoot, 'build', 'sidecar-smoke', platform.replace('/', '-'))
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  await mkdir(join(workspace, '.git'), { recursive: true, mode: 0o700 })
  const runtimeArguments = [
    '--permission',
    `--allow-fs-read=${output}`,
    `--allow-fs-read=${workspace}`,
    `--allow-fs-write=${workspace}`,
  ]
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
    [...runtimeArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-smoke","provider":"deepseek","model":"deepseek-v4-flash"}',
      '{"action":"destroy_session","conversationId":"packaged-smoke"}',
      '',
    ].join('\n'),
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  if (!chatRun.stdout.includes('"type":"ready"') || !chatRun.stdout.includes('"type":"session_destroyed"')) {
    throw new Error(`unexpected packaged Chat Sidecar response: ${chatRun.stdout}`)
  }
  process.stdout.write(`${JSON.stringify(response)}\n`)
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
  await chmod(join(destination, 'node'), 0o755)
  await execFileAsync('/usr/bin/codesign', ['--force', '--sign', process.env.MILKSU_CODESIGN_IDENTITY || '-', application])
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
