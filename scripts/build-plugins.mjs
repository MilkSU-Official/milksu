import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { build } from 'esbuild'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const officialRoot = join(repositoryRoot, 'plugins', 'official')
const checkOnly = process.argv.includes('--check')
const maxPackageBytes = 16 * 1024 * 1024
const selectors = new Map([
  [':root', 'default'],
  [':root[data-theme="light"]', 'light'],
  [':root[data-theme="dark"]', 'dark'],
])
const tokenDefinitions = new Map([
  ['--milksu-skin-canvas', ['canvas', 'color']],
  ['--milksu-skin-surface', ['surface', 'color']],
  ['--milksu-skin-foreground', ['foreground', 'color']],
  ['--milksu-skin-muted-foreground', ['muted_foreground', 'color']],
  ['--milksu-skin-accent', ['accent', 'color']],
  ['--milksu-skin-border', ['border', 'color']],
  ['--milksu-skin-background-opacity', ['background_opacity', 'opacity']],
  ['--milksu-skin-background-blur', ['background_blur', 'pixels']],
  ['--milksu-skin-surface-opacity', ['surface_opacity', 'surfaceOpacity']],
])

function parseToken(name, value, kind) {
  const normalized = value.trim()
  if (/url\s*\(|@|var\s*\(/iu.test(normalized)) throw new Error(`${name} cannot reference URLs, at-rules or private variables`)
  if (kind === 'color') {
    if (!/^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,% /+-]+\))$/iu.test(normalized)) {
      throw new Error(`${name} must be a literal #hex/rgb/hsl color`)
    }
    return normalized
  }
  const numeric = kind === 'pixels' ? normalized.replace(/px$/u, '') : normalized
  const parsed = Number(numeric)
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`)
  const ranges = {
    opacity: [0, 0.6], pixels: [0, 24], surfaceOpacity: [0.55, 1],
  }
  const [minimum, maximum] = ranges[kind]
  if (parsed < minimum || parsed > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`)
  return parsed
}

async function compileTheme(pluginDirectory) {
  const sourcePath = join(pluginDirectory, 'theme.css')
  const source = await readFile(sourcePath, 'utf8')
  const ast = postcss.parse(source, { from: sourcePath })
  const output = { default: {}, light: {}, dark: {} }
  ast.walkComments(comment => comment.remove())
  for (const node of ast.nodes) {
    if (node.type !== 'rule') {
      throw node.error('plugin skins may contain only the public :root rules')
    }
  }
  ast.walkRules(rule => {
    if (rule.parent !== ast) throw rule.error('nested rules are not permitted in plugin skins')
    const target = selectors.get(rule.selector.trim())
    if (!target) throw rule.error(`selector ${JSON.stringify(rule.selector)} is not permitted`)
    for (const declaration of rule.nodes ?? []) {
      if (declaration.type !== 'decl') {
        throw declaration.error('plugin skin rules may contain only token declarations')
      }
      if (declaration.important) throw declaration.error('!important is not permitted in plugin skins')
      const definition = tokenDefinitions.get(declaration.prop)
      if (!definition) throw declaration.error(`token ${declaration.prop} is not public`)
      const [key, kind] = definition
      if (Object.hasOwn(output[target], key)) throw declaration.error(`token ${declaration.prop} is duplicated`)
      output[target][key] = parseToken(declaration.prop, declaration.value, kind)
    }
  })
  if (Object.keys(output.default).length === 0) throw new Error(`${sourcePath} must define at least one :root token`)
  return `${JSON.stringify(output, null, 2)}\n`
}

function uint64(value) {
  const result = Buffer.alloc(8)
  result.writeBigUInt64BE(BigInt(value))
  return result
}

async function packageDigest(directory) {
  const files = []
  const caseFoldedPaths = new Map()
  let totalBytes = 0
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`plugin package contains symlink: ${path}`)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        const payload = await readFile(path)
        totalBytes += payload.byteLength
        if (totalBytes > maxPackageBytes) {
          throw new Error(`plugin package is larger than ${maxPackageBytes} bytes: ${directory}`)
        }
        const packagePath = relative(directory, path).split(sep).join('/')
        const foldedPath = packagePath.toLowerCase()
        const previous = caseFoldedPaths.get(foldedPath)
        if (previous && previous !== packagePath) {
          throw new Error(`plugin package paths collide across filesystems: ${previous} and ${packagePath}`)
        }
        caseFoldedPaths.set(foldedPath, packagePath)
        files.push({ path: packagePath, payload })
      }
      else throw new Error(`plugin package contains non-regular entry: ${path}`)
    }
  }
  await walk(directory)
  // Go sort.Strings compares UTF-8 bytes. JavaScript's default Array#sort uses
  // UTF-16 code units, which diverges for some non-ASCII package paths.
  files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
  const hash = createHash('sha256')
  for (const file of files) {
    const encodedPath = Buffer.from(file.path)
    hash.update(uint64(encodedPath.byteLength))
    hash.update(encodedPath)
    hash.update(uint64(file.payload.byteLength))
    hash.update(file.payload)
  }
  return hash.digest('hex')
}

async function safeGeneratedPath(directory, requestedPath) {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new Error('generated plugin path must be a non-empty string')
  }
  const candidate = resolve(directory, requestedPath)
  const relativePath = relative(directory, candidate)
  if (
    relativePath === ''
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`generated plugin path escapes its package: ${requestedPath}`)
  }
  let current = directory
  for (const segment of relativePath.split(sep)) {
    current = join(current, segment)
    const info = await lstat(current).catch(error => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (!info) break
    if (info.isSymbolicLink()) {
      throw new Error(`generated plugin path contains a symlink: ${current}`)
    }
    if (current !== candidate && !info.isDirectory()) {
      throw new Error(`generated plugin path parent is not a directory: ${current}`)
    }
  }
  return candidate
}

async function installGenerated(directory, requestedPath, content) {
  const path = await safeGeneratedPath(directory, requestedPath)
  if (checkOnly) {
    const current = await readFile(path, 'utf8').catch(() => '')
    if (current !== content) throw new Error(`generated plugin artifact is stale: ${path}`)
    return
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, { mode: 0o600 })
}

const pluginDirectories = []
for (const entry of await readdir(officialRoot, { withFileTypes: true })) {
  if (entry.isDirectory()) pluginDirectories.push(join(officialRoot, entry.name))
  else if (!entry.isFile() || entry.name !== 'plugins.lock.json') {
    throw new Error(`unexpected entry in official plugin root: ${entry.name}`)
  }
}
pluginDirectories.sort()
const lockEntries = []
for (const pluginDirectory of pluginDirectories) {
  const manifest = JSON.parse(await readFile(join(pluginDirectory, 'plugin.json'), 'utf8'))
  if (manifest.id !== pluginDirectory.split(sep).at(-1)) throw new Error(`plugin directory must match id: ${manifest.id}`)
  if (manifest.theme?.source) {
    await installGenerated(pluginDirectory, manifest.theme.source, await compileTheme(pluginDirectory))
  }
  if (manifest.ui?.settingsEntry) {
    const source = join(pluginDirectory, 'src', 'settings.ts')
    const destination = await safeGeneratedPath(pluginDirectory, manifest.ui.settingsEntry)
    if (checkOnly) {
      const result = await build({ entryPoints: [source], bundle: true, format: 'esm', platform: 'browser', write: false, minify: true, legalComments: 'none' })
      const expected = result.outputFiles[0].text
      const current = await readFile(destination, 'utf8').catch(() => '')
      if (current !== expected) throw new Error(`generated plugin artifact is stale: ${destination}`)
    } else {
      await mkdir(dirname(destination), { recursive: true })
      await build({ entryPoints: [source], outfile: destination, bundle: true, format: 'esm', platform: 'browser', minify: true, legalComments: 'none' })
    }
  }
  lockEntries.push({ id: manifest.id, version: manifest.version, sha256: await packageDigest(pluginDirectory) })
}
const lock = `${JSON.stringify({ apiVersion: 'milksu.plugin-lock/v1', plugins: lockEntries }, null, 2)}\n`
await installGenerated(officialRoot, 'plugins.lock.json', lock)
