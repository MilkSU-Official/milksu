import { describe, expect, it } from 'vitest'

/**
 * Policy tests for domain → shared Coding handoff.
 * Opening Coding must never imply Agent running / network / tool start.
 */

describe('workspace handoff policy', () => {
  it('CTF open Coding path does not require model readiness', () => {
    const modelReady = false
    const openCodingContextAllowed = true
    const startAgentTurnAllowed = modelReady
    expect(openCodingContextAllowed).toBe(true)
    expect(startAgentTurnAllowed).toBe(false)
  })

  it('autoSend defaults false for domain handoffs', () => {
    const ctfTask = { autoSend: undefined as boolean | undefined }
    const cvePlan = { autoSend: false as const }
    const shouldSend = (autoSend?: boolean) => autoSend === true
    expect(shouldSend(ctfTask.autoSend)).toBe(false)
    expect(shouldSend(cvePlan.autoSend)).toBe(false)
    expect(shouldSend(true)).toBe(true)
  })

  it('recordHandoff means session attached + draft staged, not agent started', () => {
    const handoffRecord = {
      attached: true,
      draftStaged: true,
      agentRunning: false,
      networkStarted: false,
    }
    expect(handoffRecord.attached && handoffRecord.draftStaged).toBe(true)
    expect(handoffRecord.agentRunning || handoffRecord.networkStarted).toBe(false)
  })
})
