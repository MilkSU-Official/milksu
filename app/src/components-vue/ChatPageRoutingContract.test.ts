import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'

describe('ChatPage routing contract', () => {
  it('keeps structured domain prompts out of the visible composer while retaining them for submit', () => {
    expect(chatPageSource).toContain('composer.value?.appendDraftText(draft.visibleText || draft.prompt)')
    expect(chatPageSource).toContain('stagedPrompt.prompt')
    expect(chatPageSource).toContain('用户当前请求：${prompt}')
    expect(chatPageSource).toContain("stagedPrompt.conversationId === props.conversation?.id")
  })

  it('shows a CVE handoff badge and return action while preserving a typed topbar module', () => {
    expect(chatPageSource).toContain('vulnerabilitySession?: boolean')
    expect(chatPageSource).toContain('returnVuln: []')
    expect(chatPageSource).toContain('returnLab: []')
    expect(chatPageSource).toContain('vulnerabilitySession: props.vulnerabilitySession')
    expect(chatPageSource).toContain('const topbarModule = computed')
    expect(chatPageSource).toContain("? 'cve'")
    expect(chatPageSource).toContain('domainTaskPresentation')
    expect(chatPageSource).toContain('function returnToDomain()')
    expect(chatPageSource).toContain("emit('returnLab')")
    expect(chatPageSource).toContain("attached?.kind === 'lab'")
    expect(chatPageSource).toContain("? 'lab'")
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

  it('gives the isolated browser real tab create, switch, and close actions', () => {
    expect(chatPageSource).toContain("t('新标签页'")
    expect(chatPageSource).toContain('create_coding_browser_tab')
    expect(chatPageSource).toContain('activate_coding_browser_tab')
    expect(chatPageSource).toContain('close_coding_browser_tab')
    expect(chatPageSource).toContain('createCodingBrowserTab')
    expect(chatPageSource).toContain('ensure_coding_browser')
    expect(chatPageSource).toContain('coding-browser.ready')
    expect(chatPageSource).toContain('codingBrowserViewportSyncKey')
    expect(chatPageSource).toContain('codingBrowserAddressFromStatus')
  })

  it('hides the Coding title until the first message is sent', () => {
    expect(chatPageSource).toContain('const codingDraftIdle = computed')
    expect(chatPageSource).toContain(':hide-identity="codingDraftIdle"')
    expect(chatPageSource).not.toContain('<h2 class="mt-5 text-body font-medium">{{ topbarPresentation.title }}</h2>')
  })

  it('keeps new-chat project picking on the composer instead of a dashboard card', () => {
    expect(chatPageSource).not.toContain('想做什么？')
    expect(chatPageSource).not.toContain('还没有记住的项目')
    expect(chatPageSource).toContain('const codingEmptyHeading = computed')
    expect(chatPageSource).toContain('我们要构建什么')
    expect(chatPageSource).toContain('我们在 ${name} 中构建什么')
    expect(chatPageSource).toContain('clearWorkspace')
    expect(chatPageSource).toContain('LOCAL_CODING_SHELL_ID')
    expect(chatPageSource).toContain('terminalWorkspacePath')
  })

  it('hides the module topbar while the right rail is open and parks terminal plus close there', () => {
    expect(chatPageSource).toContain('const contextRailVisible = computed')
    expect(chatPageSource).toContain('v-if="!dockSurface && !contextRailVisible"')
    expect(chatPageSource).toContain('data-testid="coding-rail-terminal"')
    expect(chatPageSource).toContain('data-testid="coding-rail-toggle"')
    expect(chatPageSource).toContain("t('关闭右侧栏'")
    expect(chatPageSource).toContain("t('打开右侧栏'")
    expect(chatPageSource).not.toContain('刷新${contextPanelTitle}')
  })

  it('uses one right rail for domain context with text PiP collapse and draft-only handoff', () => {
    expect(chatPageSource).toContain('data-testid="single-right-context-rail"')
    expect(chatPageSource).toContain('data-testid="collapse-domain-to-pip"')
    expect(chatPageSource).toContain('收起任务信息')
    expect(chatPageSource).toContain("value=\"domain\"")
    expect(chatPageSource).toContain('pendingComposerDraft')
    expect(chatPageSource).toContain('consumePendingDraft')
    expect(chatPageSource).toContain('appendDraftText')
    // Second expanded domain sidebar removed — only PiP remains when collapsed.
    const expandedDomainSidebars = (chatPageSource.match(/domainTaskPresentation && !domainContextCollapsed/g) ?? []).length
    expect(expandedDomainSidebars).toBe(0)
  })

  it('follows new output only while the user remains near the bottom', () => {
    expect(chatPageSource).toContain("window.requestAnimationFrame")
    expect(chatPageSource).toContain('props.conversation?.id')
    expect(chatPageSource).toContain('props.conversation?.messages.length ?? 0')
    expect(chatPageSource).toContain('props.ctfSession')
    expect(chatPageSource).toContain('props.vulnerabilitySession')
    expect(chatPageSource).toContain('scrollArea.value.scrollTop = scrollArea.value.scrollHeight')
    expect(chatPageSource).toContain('@scroll.passive="handleChatScroll"')
    expect(chatPageSource).toContain('chatAutoScrollPinned.value = nextChatAutoScrollPinned')
    expect(chatPageSource).toContain('if (!force && !chatAutoScrollPinned.value) return')
    expect(chatPageSource).toContain('void scrollChatToBottom(true)')
  })

  it('opens a separate task when the user chooses another directory', () => {
    expect(chatPageSource).not.toContain('workspaceAccessPaths?: string[]')
    expect(chatPageSource).not.toContain("emit('authorizeWorkspace')")
    expect(chatPageSource).toContain("emit('chooseWorkspaceForNewTask')")
    expect(chatPageSource).toContain('新任务使用其他目录')
  })

  it('does not expose single-session related history in the Coding right rail', () => {
    expect(chatPageSource).toContain('appendDraftText: (text: string) => void')
    expect(chatPageSource).toContain('openAddMenu: () => void')
    expect(chatPageSource).toContain("composer.value?.appendDraftText")
    expect(chatPageSource).not.toContain('SessionHistoryPanel')
    expect(chatPageSource).not.toContain('quoteSessionHistoryToComposer')
    expect(chatPageSource).not.toContain('confirm-action-label="引用到输入"')
    expect(chatPageSource).not.toContain('value="history"')
    expect(chatPageSource).not.toContain('相关历史')
  })

  it('projects milksu_progress plans, context meter and run timing on the right rail and composer', () => {
    expect(chatPageSource).toContain("from '@/components-vue/AgentExecutionPlan.vue'")
    expect(chatPageSource).toContain('<AgentExecutionPlan')
    expect(chatPageSource).toContain('class="agent-thread"')
    expect(chatPageSource).toContain('<ChatComposer')
    expect(chatPageSource).toContain(':running="running"')
    expect(chatPageSource).toContain("from '@/components-vue/ContextUsageMeter.vue'")
    expect(chatPageSource).toContain('turnStatus?: SessionTurnSnapshot')
    expect(chatPageSource).toContain('resolveModelContextWindow')
    expect(chatPageSource).toContain(':context-usage="contextUsagePresentation"')
    expect(chatPageSource).not.toContain(':run-elapsed-label=')
    expect(chatPageSource).toContain('data-testid="agent-run-elapsed"')
    expect(chatPageSource).not.toContain('composer-run-elapsed')
    expect(chatPageSource).not.toContain('等待本轮用量')
    // Decorative Mission phases stay on empty CTF/CVE canvas only. Live plans
    // come from milksu_progress; when the model has not published one, the rail
    // stays empty instead of inventing fake phases or tool-call lists.
    expect(chatPageSource).toContain('MissionOperationPanel')
    expect(chatPageSource).not.toContain('AgentTaskSteps')
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
    expect(chatPageSource).toContain('!git?.isRepository || !git.dirty || git.changedFiles <= 0')
    expect(chatPageSource).toContain('changedFiles: git.changedFiles')
    expect(chatPageSource).toContain('additions: git.additions')
    expect(chatPageSource).toContain('deletions: git.deletions')
  })

  it('keeps Coding terminal, git, changes, artifacts and permissions on CTF sessions', () => {
    expect(chatPageSource).not.toContain('v-if="!ctfSession" value="changes"')
    expect(chatPageSource).not.toContain('v-if="!ctfSession" value="artifacts"')
    expect(chatPageSource).not.toContain('v-if="!ctfSession"\n          variant="ghost"\n          size="icon-sm"\n          data-testid="coding-rail-terminal"')
    expect(chatPageSource).not.toContain('<section v-if="!ctfSession" class="border-b border-border px-4 py-4">')
    expect(chatPageSource).toContain('codingEnvironment.value = await invokeCommand<CodingEnvironmentSnapshot>')
    expect(chatPageSource).not.toContain('if (props.ctfSession) {\n    codingEnvironment.value = null')
  })

  it('keeps Terminal as an independent bottom dock instead of a sidebar page', () => {
    expect(chatPageSource).toContain('function toggleTerminalPanel()')
    expect(chatPageSource).toContain('terminalOpen.value = !terminalOpen.value')
    expect(chatPageSource).toContain("t('关闭底部终端'")
    expect(chatPageSource).toContain("t('打开底部终端'")
    expect(chatPageSource).toContain("t('底部终端面板'")
    expect(chatPageSource).toContain('@close="terminalOpen = false"')
    expect(chatPageSource).toContain('<SquareTerminal class="size-4" />')
    expect(chatPageSource).not.toContain('<PanelBottomOpen')
    expect(chatPageSource).not.toContain('<PanelBottomClose')
    expect(chatPageSource).not.toContain("contextPanel === 'terminal'")
    expect(chatPageSource).not.toContain('<SelectItem v-if="!ctfSession" value="terminal">终端</SelectItem>')
    expect(chatPageSource).toContain("t('调整终端高度'")
    expect(chatPageSource).toContain('startTerminalResize')
  })

  it('automatically starts an explicitly requested Computer Use scope when one target is visible', () => {
    expect(chatPageSource).toContain('const canStartOnlyVisibleTarget = Boolean(')
    expect(chatPageSource).toContain('scopedComputerUseTargets.value.length === 1')
    expect(chatPageSource).toContain('await startComputerUse()')
    expect(chatPageSource).toContain('requestComputerUseReveal')
    expect(chatPageSource).toContain("emit('expand')")
  })

  it('guides missing Computer Use permissions in one polling dialog and resumes the same scope', () => {
    expect(chatPageSource).toContain('CodingComputerUsePermissionDialog')
    expect(chatPageSource).toContain('computerUsePermissionDialogOpen.value = true')
    expect(chatPageSource).toContain("'get_coding_computer_use_status'")
    expect(chatPageSource).toContain('@poll="pollComputerUsePermissions"')
    expect(chatPageSource).toContain('@complete="handleComputerUsePermissionComplete"')
    expect(chatPageSource).toContain('await continueComputerUseScope()')
  })

  it('preserves colons inside custom relay model ids', () => {
    // Manual model keys are parsed by parseComposerModelKey so source + model
    // segments (including colons in custom relay ids) stay intact.
    expect(chatPageSource).toContain('parseComposerModelKey')
    expect(chatPageSource).toContain('encodeComposerModelKey')
  })

  it('reuses the latest persisted user attachments when retrying a failed turn', () => {
    expect(chatPageSource).toContain(".find(message => message.role === 'user')")
    expect(chatPageSource).toContain('lastUserMessage?.attachments')
    expect(chatPageSource).toContain("agentRecoveryPrompt(props.ctfSession)")
  })
})
