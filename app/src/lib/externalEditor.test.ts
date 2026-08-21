import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXTERNAL_EDITOR,
  externalEditorLabel,
  normalizePreferredExternalEditor,
} from './externalEditor'

describe('externalEditor', () => {
  it('defaults unknown values to VS Code', () => {
    expect(normalizePreferredExternalEditor(undefined)).toBe(DEFAULT_EXTERNAL_EDITOR)
    expect(normalizePreferredExternalEditor('notepad')).toBe('vscode')
    expect(normalizePreferredExternalEditor(' Cursor ')).toBe('cursor')
    expect(externalEditorLabel('cursor')).toBe('Cursor')
    expect(externalEditorLabel('')).toBe('VS Code')
  })
})
