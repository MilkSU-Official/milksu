import { describe, expect, it } from 'vitest'
import ctfChallengeDeskSource from './CTFChallengeDesk.vue?raw'
import ctfPageSource from './CTFPage.vue?raw'

describe('CTFPage navigation contract', () => {
  it('uses the strong catalog return path from CTF sessions', () => {
    expect(ctfPageSource).toContain('@return-catalog="showProblems"')
    expect(ctfPageSource).toContain('<Button variant="ghost" size="sm" @click="showProblems">')
    expect(ctfPageSource).toContain('<Button variant="outline" size="sm" @click="showProblems">')
    expect(ctfPageSource).toContain('<Button class="mt-5" @click="showProblems">选择一道题</Button>')
  })

  it('clears both NSSCTF and CTFshow problem selection before returning to the catalog list', () => {
    const showProblemsStart = ctfPageSource.indexOf('function showProblems()')
    const showProblemsEnd = ctfPageSource.indexOf('async function scrollWorkspaceToLatest()', showProblemsStart)
    const showProblemsSource = ctfPageSource.slice(showProblemsStart, showProblemsEnd)

    expect(showProblemsSource).toContain("source.value = 'public'")
    expect(showProblemsSource).toContain('selectedSeries.value = null')
    expect(showProblemsSource).toContain('selectedProblem.value = null')
    expect(showProblemsSource).toContain('selectedCTFShowProblemID.value = null')
    expect(showProblemsSource).toContain("screen.value = 'challenge'")
    expect(showProblemsSource).toContain("if (activeBank.value === 'ctfshow') void ctfshow.refresh()")
    expect(showProblemsSource).toContain('else void loadPublicCatalog(1)')
  })

  it('does not expose six-track smoke / Judge-count acceptance as a user surface', () => {
    expect(ctfChallengeDeskSource).not.toContain('aria-label="CTF 六赛道真实验收"')
    expect(ctfChallengeDeskSource).not.toContain('六赛道真实验收')
    expect(ctfChallengeDeskSource).not.toContain('通用能力 smoke')
    expect(ctfChallengeDeskSource).not.toContain('acceptance.judgeVerifiedTracks')
    expect(ctfChallengeDeskSource).not.toContain('acceptance.requiredTracks')
    expect(ctfChallengeDeskSource).not.toContain('acceptanceStatusText(track.status)')
    expect(ctfChallengeDeskSource).not.toContain('准备 {{ readiness }}/3')
    expect(ctfChallengeDeskSource).toContain('在 Coding 中打开')
  })

  it('opens Coding context without model readiness and without readiness 1/3 strip', () => {
    expect(ctfPageSource).toContain('async function openCodingContext()')
    expect(ctfPageSource).toContain('openCodingContext')
    expect(ctfPageSource).not.toContain('训练准备')
    expect(ctfPageSource).not.toContain('readinessCount')
    expect(ctfPageSource).not.toContain('{{ readinessCount }}/3')
    // modelReady only gates the Agent turn messaging, not openCodingContext itself.
    const openCodingContextStart = ctfPageSource.indexOf('async function openCodingContext()')
    const openCodingContextEnd = ctfPageSource.indexOf('async function openCodingAgent()', openCodingContextStart)
    const openCodingBody = ctfPageSource.slice(openCodingContextStart, openCodingContextEnd)
    expect(openCodingBody).not.toContain('modelReady')
    expect(openCodingBody).toContain("prepare_ctf_agent_workspace")
  })

  it('quotes confirmed related history into the debrief draft instead of saving CTF memory directly', () => {
    expect(ctfPageSource).toContain('quoteSessionHistoryToDebrief')
    expect(ctfPageSource).toContain('confirm-action-label="引用到复盘"')
    expect(ctfPageSource).toContain('@confirm-result="quoteSessionHistoryToDebrief"')
    expect(ctfPageSource).toContain(':reflection-seed="historyReflectionSeed"')
    expect(ctfPageSource).toContain('redactProviderCredentials(value)')
    expect(ctfPageSource).toContain('保存复盘后才可沉淀为记忆')
    expect(ctfPageSource).not.toContain("quoteSessionHistoryToDebrief(result); saveTrainingMemory")
  })
})
