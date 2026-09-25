import { describe, expect, it } from 'vitest'
import {
  computeTranscriptWindow,
  slideTranscriptStart,
  tailTranscriptStart,
  TRANSCRIPT_WINDOW_CAP,
} from '@/lib/transcriptWindow'

describe('transcriptWindow', () => {
  it('puts the tail window at the end', () => {
    expect(tailTranscriptStart(1000)).toBe(1000 - TRANSCRIPT_WINDOW_CAP)
    expect(tailTranscriptStart(TRANSCRIPT_WINDOW_CAP)).toBe(0)
    expect(tailTranscriptStart(3)).toBe(0)
    expect(tailTranscriptStart(0)).toBe(0)
  })

  it('mounts the whole transcript while it fits the cap', () => {
    const window = computeTranscriptWindow(120, 0)
    expect(window).toMatchObject({ start: 0, end: 120, size: 120, hiddenBefore: 0, hiddenAfter: 0 })
  })

  it('clamps the start into range and caps the size', () => {
    expect(computeTranscriptWindow(1000, -5).start).toBe(0)
    expect(computeTranscriptWindow(1000, 5000)).toMatchObject({
      start: 999,
      end: 1000,
      size: 1,
      hiddenBefore: 999,
      hiddenAfter: 0,
    })
    const window = computeTranscriptWindow(1000, 300)
    expect(window).toMatchObject({
      start: 300,
      end: 700,
      size: TRANSCRIPT_WINDOW_CAP,
      hiddenBefore: 300,
      hiddenAfter: 300,
    })
  })

  it('slides earlier until the start and later until the tail', () => {
    expect(slideTranscriptStart(600, 'earlier', 1000)).toBe(480)
    expect(slideTranscriptStart(50, 'earlier', 1000)).toBe(0)
    expect(slideTranscriptStart(0, 'earlier', 1000)).toBe(0)
    expect(slideTranscriptStart(480, 'later', 1000)).toBe(600)
    expect(slideTranscriptStart(600, 'later', 1000)).toBe(tailTranscriptStart(1000))
    expect(slideTranscriptStart(0, 'later', 120)).toBe(0)
  })
})
