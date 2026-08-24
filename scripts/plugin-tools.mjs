import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [command, ...inputArgs] = process.argv.slice(2)

function run(executable, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${executable} exited with ${code}`)))
  })
}

async function goExecutable() {
  if (process.env.MILKSU_GO) return process.env.MILKSU_GO
  const tools = join(root, 'build', 'tools')
  for (const name of await readdir(tools).catch(() => [])) {
    const candidate = join(tools, name, 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go')
    if (existsSync(candidate)) return candidate
  }
  return 'go'
}

if (!command) throw new Error('usage: node scripts/plugin-tools.mjs <create|keygen|pack|verify|test|dev>')

if (command === 'dev') {
  const noBuild = inputArgs.includes('--no-build')
  const openSettings = inputArgs.includes('--open-settings')
  const appDataArgument = inputArgs.find(value => value.startsWith('--app-data='))
  const appData = appDataArgument ? resolve(appDataArgument.slice('--app-data='.length)) : join(root, 'build', 'plugin-dev-appdata')
  const args = ['scripts/package-electron.mjs', 'start']
  if (noBuild) args.push('--no-build')
  await run(process.execPath, args, {
    env: {
      ...process.env,
      MILKSU_PLUGIN_DEV: '1',
      MILKSU_APPDATA_DIR: appData,
      ...(openSettings ? { MILKSU_OPEN_SETTINGS: 'plugins' } : {}),
    },
  })
} else {
  const args = [...inputArgs]
  if (command === 'test') {
    if (!args.includes('--node')) args.push('--node', process.execPath)
    if (!args.includes('--worker')) args.push('--worker', join(root, 'sidecar', 'plugin-runtime', 'worker.mjs'))
  }
  const go = await goExecutable()
  const environment = { ...process.env }
  if (go.startsWith(join(root, 'build', 'tools'))) {
    const cache = join(root, 'build', 'go-cache')
    const temporary = join(root, 'build', 'go-tmp')
    const goPath = join(root, 'build', 'go-path')
    await Promise.all([mkdir(cache, { recursive: true }), mkdir(temporary, { recursive: true }), mkdir(goPath, { recursive: true })])
    Object.assign(environment, { GOCACHE: cache, GOTMPDIR: temporary, GOPATH: goPath, GOPROXY: 'off' })
  }
  await run(go, ['run', './cmd/milksu-pluginctl', command, ...args], { env: environment })
}
