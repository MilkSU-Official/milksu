import { describe, expect, it } from 'vitest'
import { planFileDrop, selectableDropFiles, type DropFileItem } from './composerFileDrop'

function named(name: string): File {
  return { name } as File
}

describe('selectableDropFiles', () => {
  it('keeps files and drops directories before the accept slice', () => {
    const folder = named('dir')
    const first = named('a.txt')
    const second = named('b.txt')
    const items: { length: number; [index: number]: DropFileItem } = {
      length: 3,
      0: { kind: 'file', getAsFile: () => folder, webkitGetAsEntry: () => ({ isDirectory: true }) },
      1: { kind: 'file', getAsFile: () => first, webkitGetAsEntry: () => ({ isDirectory: false }) },
      2: { kind: 'file', getAsFile: () => second, webkitGetAsEntry: () => ({ isDirectory: false }) },
    }
    const selected = selectableDropFiles([folder, first, second], items)
    expect(selected.folders).toBe(1)
    expect(selected.files.map(file => file.name)).toEqual(['a.txt', 'b.txt'])
    const plan = planFileDrop({
      fileCount: selected.files.length + selected.folders,
      pendingCount: 7,
      folderCount: selected.folders,
    })
    expect(plan).toMatchObject({ accept: 1, overflow: 1, folders: 1 })
    expect(selected.files.slice(0, plan.accept).map(file => file.name)).toEqual(['a.txt'])
  })

  it('returns the raw file list when entries cannot be classified', () => {
    const file = named('a.txt')
    const selected = selectableDropFiles([file], {
      length: 1,
      0: { kind: 'file', getAsFile: () => file },
    })
    expect(selected.folders).toBe(0)
    expect(selected.files).toEqual([file])
  })
})
