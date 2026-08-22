import { describe, expect, it } from 'vitest'
import {
  codingWorkspaceLabel,
  LOCAL_CODING_SHELL_ID,
  shouldRememberCodingProject,
} from '@/lib/codingProjectMemory'

describe('codingProjectMemory', () => {
  it('labels the user home as ~ and keeps project folder names', () => {
    expect(codingWorkspaceLabel('', '/Users/milksu')).toBe('')
    expect(codingWorkspaceLabel('/Users/milksu', '/Users/milksu')).toBe('~')
    expect(codingWorkspaceLabel('/Users/milksu/code/milksu', '/Users/milksu')).toBe('milksu')
    expect(LOCAL_CODING_SHELL_ID).toBe('local-shell')
  })

  it('does not remember generated scratch workspaces', () => {
    expect(shouldRememberCodingProject('/tmp/MilkSU/Coding/新编码任务-abcd1234')).toBe(false)
    expect(shouldRememberCodingProject('/Users/milksu/Documents/MilkSU/Lab/de54a03a244266c4')).toBe(false)
    expect(shouldRememberCodingProject('/Users/milksu/code/milksu')).toBe(true)
  })

  it('does not use hash folders as project labels', () => {
    expect(codingWorkspaceLabel('/Users/milksu/Documents/MilkSU/Lab/de54a03a244266c4')).toBe('')
    expect(codingWorkspaceLabel('/Users/milksu/code/milksu', '/Users/milksu')).toBe('milksu')
  })
})
