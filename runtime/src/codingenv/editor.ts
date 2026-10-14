import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { lookPath, resolveWorkspaceFile, runHosted } from './paths.ts'
import { stat } from 'node:fs/promises'

export const DEFAULT_EDITOR_ID = 'vscode'

type Editor = {
  id: string
  label: string
  darwinApps: string[]
  windowsExe: string[]
  windowsDirs: string[][]
  linuxCommands: string[]
}

const catalog: Editor[] = [
  { id: 'vscode', label: 'VS Code', darwinApps: ['Visual Studio Code'], windowsExe: ['Code.exe', 'code.cmd', 'code'], windowsDirs: [['Programs', 'Microsoft VS Code']], linuxCommands: ['code'] },
  { id: 'cursor', label: 'Cursor', darwinApps: ['Cursor'], windowsExe: ['Cursor.exe', 'cursor.cmd', 'cursor'], windowsDirs: [['Programs', 'cursor'], ['Programs', 'Cursor']], linuxCommands: ['cursor'] },
  { id: 'windsurf', label: 'Windsurf', darwinApps: ['Windsurf'], windowsExe: ['Windsurf.exe', 'windsurf.cmd', 'windsurf'], windowsDirs: [['Programs', 'Windsurf']], linuxCommands: ['windsurf'] },
  { id: 'zed', label: 'Zed', darwinApps: ['Zed'], windowsExe: ['Zed.exe', 'zed.exe', 'zed'], windowsDirs: [['Programs', 'Zed']], linuxCommands: ['zed'] },
  { id: 'trae', label: 'Trae', darwinApps: ['Trae'], windowsExe: ['Trae.exe', 'trae.exe'], windowsDirs: [['Programs', 'Trae']], linuxCommands: ['trae'] },
  { id: 'vscode-insiders', label: 'VS Code Insiders', darwinApps: ['Visual Studio Code - Insiders'], windowsExe: ['Code - Insiders.exe', 'code-insiders.cmd', 'code-insiders'], windowsDirs: [['Programs', 'Microsoft VS Code Insiders']], linuxCommands: ['code-insiders'] },
  { id: 'sublime', label: 'Sublime Text', darwinApps: ['Sublime Text'], windowsExe: ['sublime_text.exe', 'subl.exe'], windowsDirs: [['Programs', 'Sublime Text'], ['Programs', 'Sublime Text 3']], linuxCommands: ['subl', 'sublime_text'] },
  { id: 'webstorm', label: 'WebStorm', darwinApps: ['WebStorm'], windowsExe: ['webstorm64.exe', 'webstorm.exe'], windowsDirs: [['JetBrains', 'WebStorm']], linuxCommands: ['webstorm'] },
  { id: 'idea', label: 'IntelliJ IDEA', darwinApps: ['IntelliJ IDEA', 'IntelliJ IDEA CE'], windowsExe: ['idea64.exe', 'idea.exe'], windowsDirs: [['JetBrains', 'IntelliJ IDEA']], linuxCommands: ['idea'] },
]

const byID = new Map(catalog.map((editor) => [editor.id, editor]))

export function normalizeEditorID(id: string): string {
  const trimmed = id.trim().toLowerCase()
  return byID.has(trimmed) ? trimmed : DEFAULT_EDITOR_ID
}

export type EditorDeps = {
  lookPath?: (name: string) => Promise<string | null>
  launch?: (command: string, args: string[], wait: boolean) => Promise<void>
  exists?: (path: string) => boolean
}

async function defaultLaunch(command: string, args: string[], wait: boolean): Promise<void> {
  if (!wait) {
    const { spawn } = await import('node:child_process')
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return
  }
  const result = await runHosted(command, args, { timeoutMs: 15_000 })
  if (result.code !== 0) {
    const detail = result.output.trim()
    throw new Error(detail || `launch failed: ${command}`)
  }
}

async function openTarget(absolute: string): Promise<string> {
  try {
    const info = await stat(absolute)
    if (!info.isFile() && !info.isDirectory()) throw new Error('local path is not a file or directory')
    return absolute
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof Error && error.message === 'local path is not a file or directory') throw error
      throw new Error(`open workspace file: ${error instanceof Error ? error.message : error}`)
    }
  }
  const parent = join(absolute, '..')
  try {
    const parentInfo = await stat(parent)
    if (!parentInfo.isDirectory()) throw new Error('workspace file is unavailable')
  } catch {
    throw new Error('workspace file is unavailable')
  }
  return parent
}

function windowsCandidates(editor: Editor): string[] {
  const roots = [
    process.env.LOCALAPPDATA ?? '',
    process.env.ProgramFiles ?? '',
    process.env['ProgramFiles(x86)'] ?? '',
  ]
  const candidates: string[] = []
  for (const root of roots) {
    if (!root.trim()) continue
    for (const dir of editor.windowsDirs) {
      const base = join(root, ...dir)
      for (const exe of editor.windowsExe) {
        if (!exe.toLowerCase().endsWith('.exe')) continue
        candidates.push(join(base, exe))
      }
    }
  }
  return candidates
}

export async function openCodingFileInEditor(
  workspace: string,
  relativePath: string,
  editorID: string,
  deps: EditorDeps = {},
): Promise<void> {
  const absolute = await resolveWorkspaceFile(workspace, relativePath)
  const target = await openTarget(absolute)
  const editor = byID.get(normalizeEditorID(editorID)) ?? catalog[0]
  const launch = deps.launch ?? defaultLaunch
  const lookup = deps.lookPath ?? lookPath
  const exists = deps.exists ?? existsSync
  try {
    switch (process.platform) {
      case 'darwin': {
        let last: Error | undefined
        for (const name of editor.darwinApps) {
          try {
            await launch('open', ['-a', name, target], true)
            return
          } catch (error) {
            last = error instanceof Error ? error : new Error(String(error))
          }
        }
        throw last ?? new Error('missing application')
      }
      case 'win32': {
        for (const candidate of windowsCandidates(editor)) {
          if (!exists(candidate)) continue
          try {
            await launch(candidate, [target], false)
            return
          } catch {
            // try PATH next
          }
        }
        let last: Error | undefined
        for (const name of editor.windowsExe) {
          const resolved = await lookup(name)
          if (!resolved) {
            last = new Error('missing application')
            continue
          }
          try {
            await launch(resolved, [target], false)
            return
          } catch (error) {
            last = error instanceof Error ? error : new Error(String(error))
          }
        }
        throw last ?? new Error('missing application')
      }
      default: {
        let last: Error | undefined
        for (const name of editor.linuxCommands) {
          const resolved = await lookup(name)
          if (!resolved) {
            last = new Error('missing application')
            continue
          }
          try {
            await launch(resolved, [target], false)
            return
          } catch (error) {
            last = error instanceof Error ? error : new Error(String(error))
          }
        }
        throw last ?? new Error('missing application')
      }
    }
  } catch {
    throw new Error(`找不到 ${editor.label}`)
  }
}
