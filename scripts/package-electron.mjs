import { spawn } from 'node:child_process'
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const action = process.argv[2] || 'build'

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
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

async function buildRuntime() {
  await run('npm', ['--prefix', 'app', 'run', 'build'])
  await mkdir(join(root, 'build', 'desktop'), { recursive: true })
  const backend = join(root, 'build', 'desktop', 'milksu-backend')
  await run('go', ['build', '-trimpath', '-o', backend, '.'])
  await chmod(backend, 0o755)
}

async function buildApp() {
  await buildRuntime()
  await run('npm', ['--prefix', 'desktop', 'run', 'pack:mac'])
  const candidates = [
    join(root, 'build', 'electron', 'mac-arm64', 'MilkSU.app'),
    join(root, 'build', 'electron', 'mac', 'MilkSU.app'),
  ]
  let resolvedSource = ''
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      resolvedSource = candidate
      break
    }
  }
  if (!resolvedSource) throw new Error('electron-builder did not produce MilkSU.app')
  await run('node', [
    'scripts/package-sidecar.mjs',
    'install',
    '--platform=darwin/arm64',
    `--bin=${join(resolvedSource, 'Contents', 'MacOS', 'MilkSU')}`,
  ])
  const output = join(root, 'build', 'bin', 'MilkSU.app')
  await mkdir(dirname(output), { recursive: true })
  await rm(output, { recursive: true, force: true })
	await rename(resolvedSource, output)
}

if (action === 'start') {
  await buildRuntime()
  await run('npm', ['--prefix', 'desktop', 'start'])
} else if (action === 'build') {
  await buildApp()
} else {
  throw new Error(`unsupported Electron package action: ${action}`)
}
