import { describe, expect, it } from 'vitest'
import appSource from './App.vue?raw'

describe('App workspace routing contract', () => {
  it('keeps CTF and CVE workspaces alive across top-level navigation without caching Coding chats', () => {
    expect(appSource).toContain('<KeepAlive include="CTFPage,VulnPage">')
    expect(appSource).toContain('<CTFPage')
    expect(appSource).toContain('<VulnPage')

    const keepAliveBlock = appSource.slice(
      appSource.indexOf('<KeepAlive include="CTFPage,VulnPage">'),
      appSource.indexOf('</KeepAlive>'),
    )

    expect(keepAliveBlock).toContain('<CTFPage')
    expect(keepAliveBlock).toContain('<VulnPage')
    expect(keepAliveBlock).not.toContain('<ChatPage')
  })

  it('restores CTF by resume point and returns CTF Agent chats to the CTF sidebar section', () => {
    expect(appSource).toContain("section.value === 'chat' && activeCTFConversation.value ? 'ctf' : section.value")
    expect(appSource).toContain("type CTFReturnSurface = 'workspace' | 'agent'")
    expect(appSource).toContain("const lastCTFReturnSurface = ref<CTFReturnSurface>('workspace')")
    expect(appSource).toContain("if (lastCTFReturnSurface.value === 'agent' && restoreCTFAgentConversation()) return")
    expect(appSource).toContain('function restoreCTFAgentConversation()')
    expect(appSource).toContain("lastCTFReturnSurface.value = 'agent'")
    expect(appSource).toContain("lastCTFReturnSurface.value = 'workspace'")
    expect(appSource).toContain('restoreCTFWorkspaceResumePoint()')
    expect(appSource).toContain('ctfResumeJobId.value = next.jobId')
    expect(appSource).toContain('if (next.conversationId) lastCTFConversationId.value = next.conversationId')
    expect(appSource).toContain(':initial-job-id="ctfResumeJobId"')
    expect(appSource).toContain('@return-ctf="returnToCTFWorkspace"')
  })

  it('keeps CVE-to-Coding handoffs returnable to the CVE workspace', () => {
    expect(appSource).toContain('const activeVulnerabilityCodingConversationId = ref<string | null>(null)')
    expect(appSource).toContain('const activeVulnerabilityCodingConversation = computed(() =>')
    expect(appSource).toContain('activeVulnerabilityCodingConversationId.value = conversations.activeId.value')
    expect(appSource).toContain(':vulnerability-session="activeVulnerabilityCodingConversation"')
    expect(appSource).toContain('@return-vuln="returnToVulnerabilityWorkspace"')
    expect(appSource).toContain("section.value = 'vuln'")
  })
})
