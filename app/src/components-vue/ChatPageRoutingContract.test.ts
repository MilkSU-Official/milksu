import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'

describe('ChatPage routing contract', () => {
  it('shows a CVE handoff badge and return action while preserving a typed topbar module', () => {
    expect(chatPageSource).toContain('vulnerabilitySession?: boolean')
    expect(chatPageSource).toContain('returnVuln: []')
    expect(chatPageSource).toContain('vulnerabilitySession: props.vulnerabilitySession')
    expect(chatPageSource).toContain('const topbarModule = computed')
    expect(chatPageSource).toContain("? 'cve'")
    expect(chatPageSource).toContain("{{ ctfSession ? ctfRoleLabel : 'CVE 接力' }}")
    expect(chatPageSource).toContain('domainTaskPresentation')
    expect(chatPageSource).toContain("domainTaskPresentation.kind === 'ctf' ? $emit('returnCtf') : $emit('returnVuln')")
    expect(chatPageSource).toContain(':module="topbarModule"')
  })

  it('keeps one shared Coding/Pi session with collapsible domain task context for CTF and CVE', () => {
    expect(chatPageSource).toContain("from '@/lib/domainTaskContext'")
    expect(chatPageSource).toContain('presentDomainTaskContext')
    expect(chatPageSource).toContain('refreshCTFDomainTaskContext')
    expect(chatPageSource).toContain('sharedCodingSessionKind')
    expect(chatPageSource).toContain('DomainTaskContextPanel')
    expect(chatPageSource).toContain('domainContextCollapsed')
    expect(chatPageSource).toContain('conversation?.domainTaskContext')
    expect(chatPageSource).toContain('live.networkScopes')
    expect(chatPageSource).toContain('live.challenge?.source?.scope')
    expect(chatPageSource).toContain('<DomainTaskContextPanel')
    expect(chatPageSource).not.toContain('milksu:coding-smoke-open-panel')
    expect(chatPageSource).not.toContain('handleCodingSmokeOpenPanel')
  })

  it('loads CTF domain projection on conversation/job change without waiting for Agent idle', () => {
    expect(chatPageSource).toContain('async function loadCTFDomainProjection()')
    expect(chatPageSource).toContain("invokeCommand<CTFProjection>('get_ctf_job'")
    // Dedicated watcher is only ctfSession + ctfJobId — no running gate.
    expect(chatPageSource).toContain(
      '() => [props.ctfSession, props.conversation?.ctfJobId] as const',
    )
    expect(chatPageSource).toContain('await loadCTFDomainProjection()')
    // Workshop/environment idle path remains separate and still may check !running.
    expect(chatPageSource).toContain('if (ctfSession && jobId && !running)')
  })

  it('uses one right rail for domain context with text PiP collapse and draft-only handoff', () => {
    expect(chatPageSource).toContain('data-testid="single-right-context-rail"')
    expect(chatPageSource).toContain('data-testid="collapse-domain-to-pip"')
    expect(chatPageSource).toContain('折叠为 PiP')
    expect(chatPageSource).toContain("value=\"domain\"")
    expect(chatPageSource).toContain('pendingComposerDraft')
    expect(chatPageSource).toContain('consumePendingDraft')
    expect(chatPageSource).toContain('appendDraftText')
    // Second expanded domain sidebar removed — only PiP remains when collapsed.
    const expandedDomainSidebars = (chatPageSource.match(/domainTaskPresentation && !domainContextCollapsed/g) ?? []).length
    expect(expandedDomainSidebars).toBe(0)
  })

  it('scrolls to the latest message when route context or conversation changes', () => {
    expect(chatPageSource).toContain("window.requestAnimationFrame")
    expect(chatPageSource).toContain('props.conversation?.id')
    expect(chatPageSource).toContain('props.conversation?.messages.length ?? 0')
    expect(chatPageSource).toContain('props.ctfSession')
    expect(chatPageSource).toContain('props.vulnerabilitySession')
    expect(chatPageSource).toContain('scrollArea.value.scrollTop = scrollArea.value.scrollHeight')
  })

  it('quotes confirmed related history into the Coding composer draft without auto-sending it', () => {
    expect(chatPageSource).toContain('const composer = ref<{ appendDraftText')
    expect(chatPageSource).toContain('quoteSessionHistoryToComposer')
    expect(chatPageSource).toContain('confirm-action-label="引用到输入"')
    expect(chatPageSource).toContain('@confirm-result="quoteSessionHistoryToComposer"')
    expect(chatPageSource).toContain("composer.value?.appendDraftText")
    expect(chatPageSource).toContain('redactProviderCredentials(value)')
    expect(chatPageSource).toContain('trimHistoryField(result.snippet)')
    expect(chatPageSource).toContain('已引用到输入框')
    expect(chatPageSource).not.toContain("emit('send', lines.join")
  })

  it('owns Goal interaction in the composer instead of the environment sidebar', () => {
    expect(chatPageSource).toContain(':goal="activeGoal"')
    expect(chatPageSource).toContain(':git-summary="composerGitSummary"')
    expect(chatPageSource).toContain('@start-goal="goalMode = true"')
    expect(chatPageSource).toContain('@consume-goal="goalMode = false"')
    expect(chatPageSource).toContain('@control-goal="controlComposerGoal"')
    expect(chatPageSource).toContain("function controlComposerGoal(action: 'pause' | 'resume' | 'clear')")
    expect(chatPageSource).toContain("if (action === 'pause' && props.running)")
    expect(chatPageSource).not.toContain("{{ goalMode ? '已设为目标' : '设为目标' }}")
    expect(chatPageSource).not.toContain('class="mt-3 rounded-lg bg-primary/[0.07] p-3"')
  })

  it('passes only a real dirty Git projection to the composer summary', () => {
    expect(chatPageSource).toContain('const composerGitSummary = computed')
    expect(chatPageSource).toContain('const composerTaskStepLabel = computed')
    expect(chatPageSource).toContain(':task-step-label="composerTaskStepLabel"')
    expect(chatPageSource).toContain('!git?.isRepository || !git.dirty || git.changedFiles <= 0')
    expect(chatPageSource).toContain('changedFiles: git.changedFiles')
    expect(chatPageSource).toContain('additions: git.additions')
    expect(chatPageSource).toContain('deletions: git.deletions')
  })

  it('shows CTF artifacts in the shared Coding right rail', () => {
    expect(chatPageSource).toContain("import CTFArtifacts from '@/components-vue/CTFArtifacts.vue'")
    expect(chatPageSource).toContain('<SelectItem value="artifacts">产物</SelectItem>')
    expect(chatPageSource).toContain('<CTFArtifacts v-if="ctfProjection" :projection="ctfProjection" />')
    expect(chatPageSource).toContain("if (props.ctfSession) {\n      await loadCTFDomainProjection()")
    expect(chatPageSource).not.toContain('<SelectItem v-if="!ctfSession" value="artifacts">产物</SelectItem>')
  })

  it('uses larger typography in the compact right rail instead of dense caption text', () => {
    expect(chatPageSource).toContain('.context-sidebar :deep(.text-caption)')
    expect(chatPageSource).toContain('font-size: var(--text-body);')
    expect(chatPageSource).toContain('line-height: var(--text-body--line-height);')
  })

  it('keeps Terminal as an independent bottom dock instead of a sidebar page', () => {
    expect(chatPageSource).toContain('function toggleTerminalPanel()')
    expect(chatPageSource).toContain('terminalOpen.value = !terminalOpen.value')
    expect(chatPageSource).toContain("? '关闭底部终端' : '打开底部终端'")
    expect(chatPageSource).toContain('aria-label="底部终端面板"')
    expect(chatPageSource).toContain('@close="terminalOpen = false"')
    expect(chatPageSource).not.toContain("contextPanel === 'terminal'")
    expect(chatPageSource).not.toContain('<SelectItem v-if="!ctfSession" value="terminal">终端</SelectItem>')
    expect(chatPageSource.match(/aria-label="关闭右侧栏"/g) ?? []).toHaveLength(0)
  })
})
