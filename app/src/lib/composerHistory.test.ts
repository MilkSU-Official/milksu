import { describe, expect, it } from 'vitest'
import {
  captureComposerSnapshot,
  isComposerHistoryKey,
  redoComposerHistory,
  undoComposerHistory,
} from './composerHistory'

describe('composerHistory', () => {
  it('captures the pre-edit snapshot and ignores duplicates', () => {
    expect(captureComposerSnapshot([''], 'hello')).toEqual({
      history: ['', 'hello'],
      future: [],
    })
    expect(captureComposerSnapshot(['hello'], 'hello')).toEqual({
      history: ['hello'],
      future: [],
    })
  })

  it('undoes then redoes the current editor html', () => {
    const undone = undoComposerHistory(['one', 'two'], [], 'three')
    expect(undone).toEqual({
      history: ['one'],
      future: ['three'],
      html: 'two',
    })
    expect(redoComposerHistory(undone!.history, undone!.future, undone!.html)).toEqual({
      history: ['one', 'two'],
      future: [],
      html: 'three',
    })
    expect(undoComposerHistory([], [], 'only')).toBeNull()
    expect(redoComposerHistory([], [], 'only')).toBeNull()
  })

  it('recognizes standard undo and redo shortcuts', () => {
    const key = (init: Partial<KeyboardEvent>) => init as KeyboardEvent
    expect(isComposerHistoryKey(key({ key: 'z', metaKey: true }))).toBe('undo')
    expect(isComposerHistoryKey(key({ key: 'z', ctrlKey: true }))).toBe('undo')
    expect(isComposerHistoryKey(key({ key: 'z', metaKey: true, shiftKey: true }))).toBe('redo')
    expect(isComposerHistoryKey(key({ key: 'y', ctrlKey: true }))).toBe('redo')
    expect(isComposerHistoryKey(key({ key: 'z' }))).toBeNull()
  })
})
