import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, 'runtime', 'dist', 'main.cjs')

await mkdir(join(root, 'runtime', 'dist'), { recursive: true })
await cp(
  join(root, 'runtime', 'src', 'envbroker', 'packages'),
  join(root, 'runtime', 'dist', 'envbroker', 'packages'),
  { recursive: true },
)
const shared = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'warning',
  external: ['node:sqlite', 'node-pty'],
}
await esbuild.build({
  ...shared,
  entryPoints: [join(root, 'runtime', 'src', 'main.ts')],
  outfile,
})
process.stdout.write(`runtime bundle ${outfile}\n`)
const pluginMcp = join(root, 'runtime', 'dist', 'plugin-mcp.cjs')
await esbuild.build({
  ...shared,
  entryPoints: [join(root, 'runtime', 'src', 'plugin-mcp.ts')],
  outfile: pluginMcp,
})
process.stdout.write(`plugin-mcp bundle ${pluginMcp}\n`)
