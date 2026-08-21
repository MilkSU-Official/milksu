// Keep in sync with internal/externaleditor/editor.go.

export const DEFAULT_EXTERNAL_EDITOR = 'vscode'

export const EXTERNAL_EDITORS = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'zed', label: 'Zed' },
  { id: 'trae', label: 'Trae' },
  { id: 'vscode-insiders', label: 'VS Code Insiders' },
  { id: 'sublime', label: 'Sublime Text' },
  { id: 'webstorm', label: 'WebStorm' },
  { id: 'idea', label: 'IntelliJ IDEA' },
] as const

export type ExternalEditorId = typeof EXTERNAL_EDITORS[number]['id']

const knownIds = new Set<string>(EXTERNAL_EDITORS.map(editor => editor.id))

export function normalizePreferredExternalEditor(id?: string | null): ExternalEditorId {
  const value = String(id ?? '').trim().toLowerCase()
  if (knownIds.has(value)) return value as ExternalEditorId
  return DEFAULT_EXTERNAL_EDITOR
}

export function externalEditorLabel(id?: string | null): string {
  const normalized = normalizePreferredExternalEditor(id)
  return EXTERNAL_EDITORS.find(editor => editor.id === normalized)?.label ?? 'VS Code'
}
