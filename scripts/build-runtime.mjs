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
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'runtime', 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  legalComments: 'none',
  logLevel: 'warning',
  external: ['node:sqlite'],
})
process.stdout.write(`runtime bundle ${outfile}\n`)
