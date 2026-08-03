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
    expect(appSource).toContain('restoreCTFWorkspaceResumePoint()')
    expect(appSource).toContain('ctfResumeJobId.value = next.jobId')
    expect(appSource).toContain('if (next.conversationId) lastCTFConversationId.value = next.conversationId')
    expect(appSource).toContain(':initial-job-id="ctfResumeJobId"')
    expect(appSource).toContain('@return-ctf="returnToCTFWorkspace"')
  })
})
