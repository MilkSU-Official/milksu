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

  it('shows the six-track Judge acceptance state without overstating CTF readiness', () => {
    expect(ctfChallengeDeskSource).toContain('<details')
    expect(ctfChallengeDeskSource).toContain('aria-label="CTF 六赛道真实验收"')
    expect(ctfChallengeDeskSource).toContain('六赛道真实验收')
    expect(ctfChallengeDeskSource).toContain('展开查看缺失赛道')
    expect(ctfChallengeDeskSource).toContain('默认解题界面只保留题面、Agent/实验和当前授权/提交')
    expect(ctfChallengeDeskSource).toContain('仍是通用能力 smoke')
    expect(ctfChallengeDeskSource).toContain('acceptance.judgeVerifiedTracks')
    expect(ctfChallengeDeskSource).toContain('acceptance.requiredTracks')
    expect(ctfChallengeDeskSource).toContain('acceptanceStatusText(track.status)')
    expect(ctfChallengeDeskSource).toContain('一题成功只算赛道 smoke，不能描述为完整 CTF 成绩')
    expect(ctfChallengeDeskSource).toContain('真实题目、材料、轨迹、Judge 回执、恢复和复盘证据')
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
