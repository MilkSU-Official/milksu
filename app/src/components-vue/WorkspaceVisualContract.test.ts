import { describe, expect, it } from 'vitest'
import ctfChallengeDeskSource from './CTFChallengeDesk.vue?raw'
import vulnPageSource from './VulnPage.vue?raw'
import workspaceDetailTitleSource from './WorkspaceDetailTitle.vue?raw'

describe('Workspace visual contract', () => {
  it('uses one shared detail title component for CTF and CVE detail panes', () => {
    expect(workspaceDetailTitleSource).toContain('data-workspace-detail-title')
    expect(workspaceDetailTitleSource).toContain('workspace-detail-title mt-3 text-2xl font-semibold')
    expect(workspaceDetailTitleSource).toContain('<h2')

    expect(ctfChallengeDeskSource).toContain("import WorkspaceDetailTitle from '@/components-vue/WorkspaceDetailTitle.vue'")
    expect(ctfChallengeDeskSource).toContain('<WorkspaceDetailTitle :title="selectedNssctf.title" />')
    expect(ctfChallengeDeskSource).toContain('<WorkspaceDetailTitle :title="selectedCtfshow.title" />')

    expect(vulnPageSource).toContain("import WorkspaceDetailTitle from '@/components-vue/WorkspaceDetailTitle.vue'")
    expect(vulnPageSource).toContain('<WorkspaceDetailTitle class="mt-4" :title="dashboard.selected.value.title" />')
    expect(vulnPageSource).not.toContain('text-xl font-semibold leading-8')
  })
})
