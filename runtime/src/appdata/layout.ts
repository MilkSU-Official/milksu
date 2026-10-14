import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { secureRoot, writeJSONAtomically } from './fs.ts'

export const DATA_LAYOUT_FILE = 'data-layout.json'
export const DATA_LAYOUT_SCHEMA = 'milksu-data-layout/v1'
export const CURRENT_DATA_LAYOUT_VERSION = 2
const MAX_DATA_LAYOUT_BYTES = 16 * 1024

export type DataLayout = {
  schema: string
  version: number
  updatedAt: string
}

export async function readDataLayout(directory: string): Promise<DataLayout> {
  const root = await secureRoot(directory)
  return readDataLayoutFile(join(root, DATA_LAYOUT_FILE))
}

export async function ensureDataLayout(directory: string): Promise<void> {
  const path = join(directory, DATA_LAYOUT_FILE)
  let layout: DataLayout
  try {
    layout = await readDataLayoutFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await writeJSONAtomically(path, {
        schema: DATA_LAYOUT_SCHEMA,
        version: CURRENT_DATA_LAYOUT_VERSION,
        updatedAt: new Date().toISOString(),
      } satisfies DataLayout)
      return
    }
    throw error
  }
  if (layout.schema !== DATA_LAYOUT_SCHEMA) {
    throw new Error(`unsupported MilkSU data layout schema ${JSON.stringify(layout.schema)}; expected ${JSON.stringify(DATA_LAYOUT_SCHEMA)}`)
  }
  if (layout.version > CURRENT_DATA_LAYOUT_VERSION) {
    throw new Error(
      `MilkSU data layout version ${layout.version} is newer than this app supports (${CURRENT_DATA_LAYOUT_VERSION}); upgrade MilkSU instead of opening it with an older build`,
    )
  }
  if (layout.version < 0) {
    throw new Error(`invalid MilkSU data layout version ${layout.version}`)
  }
  if (layout.version < CURRENT_DATA_LAYOUT_VERSION) {
    layout.version = CURRENT_DATA_LAYOUT_VERSION
    layout.updatedAt = new Date().toISOString()
    await writeJSONAtomically(path, layout)
  }
}

async function readDataLayoutFile(path: string): Promise<DataLayout> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${DATA_LAYOUT_FILE} must be a regular file`)
  }
  if (info.size > MAX_DATA_LAYOUT_BYTES) {
    throw new Error(`${DATA_LAYOUT_FILE} is larger than ${MAX_DATA_LAYOUT_BYTES} bytes`)
  }
  const raw = await readFile(path, 'utf8')
  const layout = JSON.parse(raw) as DataLayout
  if (layout.schema !== DATA_LAYOUT_SCHEMA) {
    throw new Error(`unsupported MilkSU data layout schema ${JSON.stringify(layout.schema)}`)
  }
  return layout
}
