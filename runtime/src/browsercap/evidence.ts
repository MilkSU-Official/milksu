import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const EVIDENCE_RELATIVE_DIR = '.milksu/browser-evidence'
const SESSION_ID_PATTERN = /^browser_[A-Za-z0-9-]{8,128}$/u

export type EvidenceRequest = {
  conversationId: string
  sessionId: string
  workspace: string
}

export function validSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(String(value ?? '').trim())
}

export async function deriveEvidenceDirectory(request: EvidenceRequest): Promise<string> {
  if (!String(request.conversationId ?? '').trim()) {
    throw new Error('Coding 会话标识不能为空')
  }
  const sessionId = String(request.sessionId ?? '').trim()
  if (!sessionId) throw new Error('当前会话没有活跃的浏览器')
  if (!validSessionId(sessionId)) throw new Error('浏览器会话标识无效')
  return deriveDirectory(request.workspace, sessionId)
}

async function deriveDirectory(workspace: string, sessionId: string): Promise<string> {
  workspace = String(workspace ?? '').trim()
  if (!workspace) throw new Error('会话没有已保存的工作区，无法定位浏览器证据')
  if (!isAbsolute(workspace)) throw new Error('会话工作区必须是绝对路径')
  let resolvedWorkspace: string
  try {
    resolvedWorkspace = await realpath(workspace)
  } catch (error) {
    throw new Error(`会话工作区不存在或无法解析: ${error instanceof Error ? error.message : error}`)
  }
  const workspaceInfo = await stat(resolvedWorkspace)
  if (!workspaceInfo.isDirectory()) throw new Error(`会话工作区不是目录: ${resolvedWorkspace}`)

  const evidencePath = join(resolvedWorkspace, EVIDENCE_RELATIVE_DIR, sessionId)
  await verifyDirectoryChain(resolvedWorkspace, evidencePath)
  let resolvedEvidence: string
  try {
    resolvedEvidence = await realpath(evidencePath)
  } catch (error) {
    throw new Error(`浏览器证据目录无法解析: ${error instanceof Error ? error.message : error}`)
  }
  const relativePath = relative(resolvedWorkspace, resolvedEvidence)
  if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('浏览器证据目录逃逸了会话工作区')
  }
  const evidenceInfo = await stat(resolvedEvidence)
  if (!evidenceInfo.isDirectory()) throw new Error('浏览器证据路径不是目录')
  return resolve(evidencePath)
}

async function verifyDirectoryChain(resolvedWorkspace: string, evidencePath: string): Promise<void> {
  const relativePath = relative(resolvedWorkspace, evidencePath)
  if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('浏览器证据路径逃逸了会话工作区')
  }
  let current = resolvedWorkspace
  for (const component of relativePath.split(sep)) {
    if (!component || component === '.') continue
    current = join(current, component)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') throw new Error(`浏览器证据目录不存在: ${current}`)
      throw new Error(`读取浏览器证据目录状态: ${error instanceof Error ? error.message : error}`)
    }
    if (info.isSymbolicLink()) throw new Error(`浏览器证据目录不能是符号链接: ${current}`)
    if (!info.isDirectory()) throw new Error(`浏览器证据路径不是目录: ${current}`)
  }
}
