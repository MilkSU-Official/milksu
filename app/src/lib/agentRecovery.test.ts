import { describe, expect, it } from 'vitest'
import {
  agentRecoveryPrompt,
  recoverableAgentFailureId,
} from '@/lib/agentRecovery'
import type { Message } from '@/types'

function message(
  id: string,
  role: Message['role'],
  content: string,
): Message {
  return {
    id,
    role,
    content,
    timestamp: 1,
    status: 'done',
  }
}

describe('agent recovery', () => {
  it('offers recovery for transient network failures without treating configuration errors as resumable', () => {
    expect(recoverableAgentFailureId([
      message(
        'network',
        'assistant',
        '模型或 Agent 网络连接失败。请检查网络、Provider Base URL、本地代理或服务状态；工作区、审批和恢复点已保留，可以稍后继续。',
      ),
    ], false)).toBe('network')

    expect(recoverableAgentFailureId([
      message('english-network', 'assistant', 'Agent 运行失败：dial tcp 127.0.0.1:65533: connect: connection refused'),
    ], false)).toBe('english-network')

    expect(recoverableAgentFailureId([
      message('connection-error', 'assistant', 'Agent 运行失败：Connection error.'),
    ], false)).toBe('connection-error')

    for (const content of [
      'Agent 运行失败：context deadline exceeded',
      'Agent 运行失败：read tcp 127.0.0.1:65533: i/o timeout',
      'Agent 运行失败：net/http: TLS handshake timeout',
    ]) {
      expect(recoverableAgentFailureId([
        message('timeout', 'assistant', content),
      ], false)).toBe('timeout')
    }

    expect(recoverableAgentFailureId([
      message('missing-key', 'assistant', '当前模型没有可用的 API Key，请在“授权与模型”中保存并验证。'),
    ], false)).toBe('')

    expect(recoverableAgentFailureId([
      message('bad-model', 'assistant', '当前模型不受 PI 运行时支持，请在“授权与模型”中更换模型并验证。'),
    ], false)).toBe('')
  })

  it('offers recovery after app, Sidecar, or protocol stops without reusing stale approvals', () => {
    for (const content of [
      'Agent 已停止：sidecar exited',
      'Agent 通信异常：engine.protocol_error: lost framing',
      'Agent 已停止。',
      'Agent 进程已停止，本次整理已中断。',
    ]) {
      expect(recoverableAgentFailureId([
        message('stopped', 'assistant', content),
      ], false)).toBe('stopped')
    }

    expect(recoverableAgentFailureId([
      message('stopped', 'assistant', 'Agent 已停止：sidecar exited'),
      message('newer', 'user', '我改了目标'),
    ], false)).toBe('')
  })

  it('offers recovery for manual interruption, cancellation, and context-window exhaustion', () => {
    for (const content of [
      'Agent 运行失败：用户已中断，本轮工具和工作区状态已保留。',
      'Agent 运行失败：context canceled',
      'Agent 运行失败：operation was canceled',
      'Agent 运行失败：aborted',
      'Agent 运行失败：cancelled by user',
      'Agent 运行失败：context_length_exceeded',
      'Agent 运行失败：maximum context length exceeded',
      'Agent 运行失败：token limit exceeded',
      '自动整理上下文失败，请手动整理后再继续。',
      '上下文过长，正在自动整理…',
    ]) {
      expect(recoverableAgentFailureId([
        message('recoverable', 'assistant', content),
      ], false)).toBe('recoverable')
    }

    expect(recoverableAgentFailureId([
      message('recoverable', 'assistant', 'Agent 运行失败：cancelled by user'),
      message('newer', 'user', '换一个任务'),
    ], false)).toBe('')
  })

  it('resumes CTF from persisted evidence without repeating completed work', () => {
    const prompt = agentRecoveryPrompt(true)
    expect(prompt).toContain('notes.md')
    expect(prompt).toContain('最近一次已完成的工具结果')
    expect(prompt).toContain('不要重复')
    expect(prompt).toContain('不要复用重启前的审批状态')
    expect(prompt).toContain('Endpoint')
    expect(prompt).toContain('最小、可验证')
  })

  it('resumes Coding work without reusing stale approvals after restart', () => {
    const prompt = agentRecoveryPrompt(false)
    expect(prompt).toContain('当前工作区')
    expect(prompt).toContain('不要重复')
    expect(prompt).toContain('不要复用重启前的审批状态')
    expect(prompt).toContain('应用窗口')
    expect(prompt).toContain('外部发布')
    expect(prompt).toContain('网络超时、取消或上下文整理')
    expect(prompt).toContain('最小可验证')
  })
})
