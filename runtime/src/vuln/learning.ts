import { chmod, lstat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LearningRecord } from './types.ts'

export const LEARNING_CONTEXT_FILE = 'LEARNING.md'

const SECRET_KEY = /\bsk-[A-Za-z0-9_-]{12,}\b/g
const SECRET_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi
const SECRET_FLAG = /\b(?:flag|nssctf|ctf)\{[^}\r\n]{1,512}\}/gi

export function userArtifactDirectory(
  env: Record<string, string | undefined> = process.env,
  userHome = homedir(),
): string {
  const override = String(env.MILKSU_USER_ARTIFACTS_DIR ?? '').trim()
  if (override) return override
  if (process.platform === 'win32') return join(userHome, 'MilkSU')
  return join(userHome, 'Documents', 'MilkSU')
}

export async function writeLearningContext(
  workspacePath: string,
  cveId: string,
  records: LearningRecord[],
): Promise<void> {
  const workspace = workspacePath.trim()
  if (!workspace) throw new Error('CVE learning workspace is required')
  const path = join(workspace, LEARNING_CONTEXT_FILE)
  if (records.length === 0) {
    try {
      await unlink(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`remove CVE learning context: ${error instanceof Error ? error.message : error}`)
      }
    }
    return
  }
  const ordered = [...records].sort((left, right) => {
    if (left.createdAt === right.createdAt) return left.id < right.id ? -1 : 1
    return left.createdAt < right.createdAt ? -1 : 1
  })
  const id = cveId.trim().toUpperCase()
  let body = `# ${id ? `${id} ` : ''}已保存的学习记录\n\n`
  body += '这些是用户在这个 CVE 上明确记下的学习记录。它们是先验，不是复现证明，也不是当前材料的事实。采用前要用公告、补丁和这次实验重新核对。\n'
  for (const record of ordered) {
    let title = (record.concept ?? '').trim()
    if (!title) title = (record.kind ?? '').trim()
    if (!title) title = record.id
    body += `\n## ${redactDomainText(title)}\n\n`
    body += `${redactDomainText(record.content.trim())}\n`
    body += `\n- 类型：${redactDomainText((record.kind ?? '').trim())}`
    if (record.createdAt) {
      const stamp = record.createdAt.endsWith('Z') || record.createdAt.includes('+')
        ? record.createdAt.replace(/\.\d+Z$/, 'Z')
        : record.createdAt
      body += `\n- 时间：${stamp}`
    }
    body += '\n'
  }
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('domain memory file must not be a symbolic link')
  } catch (error) {
    if (error instanceof Error && error.message === 'domain memory file must not be a symbolic link') throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`inspect domain memory file: ${error instanceof Error ? error.message : error}`)
    }
  }
  await writeFile(path, body, { mode: 0o600 })
  await chmod(path, 0o600)
}

function redactDomainText(value: string): string {
  return value
    .replace(SECRET_FLAG, '[redacted]')
    .replace(SECRET_KEY, '[redacted]')
    .replace(SECRET_BEARER, '[redacted]')
}
