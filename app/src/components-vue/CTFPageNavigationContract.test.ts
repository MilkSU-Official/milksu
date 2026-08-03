import { describe, expect, it } from 'vitest'
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
})
