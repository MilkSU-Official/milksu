import { describe, expect, it } from 'vitest'
import appSource from './App.vue?raw'

describe('App workspace routing contract', () => {
  it('keeps CTF and CVE workspaces alive across top-level navigation without caching Coding chats', () => {
    expect(appSource).toContain('<KeepAlive include="CTFPage,VulnPage,LabPage">')
    expect(appSource).toContain('<CTFPage')
    expect(appSource).toContain('<VulnPage')

    const keepAliveBlock = appSource.slice(
      appSource.indexOf('<KeepAlive include="CTFPage,VulnPage,LabPage">'),
      appSource.indexOf('</KeepAlive>'),
    )

    expect(keepAliveBlock).toContain('<CTFPage')
    expect(keepAliveBlock).toContain('<VulnPage')
    expect(keepAliveBlock).toContain('<LabPage')
    expect(keepAliveBlock).not.toContain('<ChatPage')
  })

  it('opens the CTF workspace from top-level navigation without trapping users in Agent chat', () => {
    expect(appSource).toContain("section.value === 'chat' && activeCTFConversation.value ? 'ctf' : section.value")
    expect(appSource).toContain('restoreCTFWorkspaceResumePoint()')
    expect(appSource).toContain('ctfResumeJobId.value = next.jobId')
    expect(appSource).toContain('if (next.conversationId) lastCTFConversationId.value = next.conversationId')
    expect(appSource).toContain(':initial-job-id="ctfResumeJobId"')
    expect(appSource).toContain('@return-ctf="returnToCTFWorkspace"')
    expect(appSource).not.toContain('lastCTFReturnSurface')
    expect(appSource).not.toContain('restoreCTFAgentConversation')
    expect(appSource).not.toContain("section.value = 'chat'\n  // Prefer structured domain snapshot")
  })

  it('keeps CTF agent turns on the challenge page instead of embedding Coding', () => {
    expect(appSource).toContain('async function startCTFAgent')
    expect(appSource).toContain('lastCTFConversationId.value = conversations.activeId.value')
    expect(appSource).toContain('@create-conversation="createDossierConversation"')
    const startFn = appSource.slice(
      appSource.indexOf('async function startCTFAgent'),
      appSource.indexOf('function selectDossierConversation'),
    )
    expect(startFn).not.toContain("section.value = 'chat'")
  })

  it('keeps CVE-to-Coding handoffs returnable to the CVE workspace', () => {
    expect(appSource).toContain('const activeVulnerabilityCodingConversationId = ref<string | null>(null)')
    expect(appSource).toContain('const activeVulnerabilityCodingConversation = computed(() =>')
    expect(appSource).toContain('activeVulnerabilityCodingConversationId.value = id')
    expect(appSource).toContain('const vulnerabilityCodingWorkspacePath = ref(\'\')')
    expect(appSource).toContain(':coding-workspace-path="vulnerabilityCodingWorkspacePath"')
    expect(appSource).toContain('@choose-coding-workspace="chooseVulnerabilityCodingWorkspace"')
    expect(appSource).toContain(':vulnerability-session="activeVulnerabilityCodingConversation"')
    expect(appSource).toContain('@return-vuln="returnToVulnerabilityWorkspace"')
    expect(appSource).toContain('@return-lab="returnToLabWorkspace"')
    expect(appSource).toContain('@expand="expandDossierToCoding"')
    expect(appSource).toContain("section.value = 'vuln'")
  })

  it('keeps laboratory jobs on the laboratory page with a bound conversation', () => {
    expect(appSource).toContain('const lastLabConversationId = ref<string | null>(null)')
    expect(appSource).toContain('async function enterLabJob')
    expect(appSource).toContain('async function runLabJob')
    expect(appSource).toContain('@enter="enterLabJob"')
    expect(appSource).toContain('@run="runLabJob"')
    expect(appSource).toContain("@open-lab-settings=\"openSettings('lab')\"")
    expect(appSource).toContain('v-bind="codingAgentBind"')
    expect(appSource).not.toContain('授权测试')
  })

  it('routes linked Coding conversations through the existing conversation store', () => {
    expect(appSource).toContain('function openHistoryConversation(conversationId: string)')
    expect(appSource).toContain('conversations.activeId.value = conversationId')
    expect(appSource).toContain('@open-conversation="openHistoryConversation"')
  })

  it('routes the avatar menu to a real personal profile page', () => {
    expect(appSource).toContain("import('@/components-vue/ProfilePage.vue')")
    expect(appSource).toContain("@profile=\"navigateSection('profile')\"")
    expect(appSource).toContain("v-else-if=\"section === 'profile'\"")
  })
})
