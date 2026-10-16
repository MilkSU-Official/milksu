import assert from 'node:assert/strict'
import test from 'node:test'
import { projectBridgeEvent } from './events.ts'

// R4 桌面可见性：引擎韧性批次（fix/engine-resilience，sidecar 侧发射器随 PR #228
// 进入）emit 的五个新事件必须穿过 projectBridgeEvent 成为渲染层有分支的名字，否则
// 落 default 变成 engine.raw.* 被丢弃。JSON 行取自该分支 harness-events.js /
// harness-bridge-session.js 的实际 emit 形状（与旧 internal/engine 的
// supervisor_engine_resilience_events_test.go 同一素材；Go 运行时已删，本文件是
// TypeScript 运行时里的等价验收）。
function project(rawLine: string) {
  const raw = JSON.parse(rawLine)
  const event = projectBridgeEvent(raw, 'pi')
  // 每次都变的字段（timestamp）与既有字段（schemaVersion/engine）不参与比对，
  // 与旧 Go 测试清零 SchemaVersion/Timestamp/Engine 的做法一致。
  delete (event as Partial<typeof event>).schemaVersion
  delete (event as Partial<typeof event>).timestamp
  delete (event as Partial<typeof event>).engine
  // 渲染器收到的是 JSONL 序列化后的对象：undefined 字段在 JSON.stringify 时被丢弃
  //（等价于旧 Go Event 的 omitempty）。按线上形态比对，不比对象里的 undefined 键。
  return JSON.parse(JSON.stringify(event))
}

test('model_retry start carries attempt counters and the bilingual notice pair', () => {
  assert.deepEqual(
    project('{"type":"model_retry","id":"session-1","phase":"start","attempt":2,"maxRetries":5,"message":"网络波动，重试中 2/5","messageEnglish":"Network trouble, retrying 2/5","errorMessage":"fetch failed","retryAt":1770000000123}'),
    {
      sessionId: 'session-1',
      type: 'model.retry',
      phase: 'start',
      attempt: 2,
      maxRetries: 5,
      errorMessage: 'fetch failed',
      retryAt: 1770000000123,
      notice: '网络波动，重试中 2/5',
      noticeEnglish: 'Network trouble, retrying 2/5',
    },
  )
})

test('model_retry end keeps only the phase and attempt', () => {
  assert.deepEqual(
    project('{"type":"model_retry","id":"session-1","phase":"end","attempt":2}'),
    {
      sessionId: 'session-1',
      type: 'model.retry',
      phase: 'end',
      attempt: 2,
    },
  )
})

test('model_stall becomes model.stall with stallKind connection', () => {
  assert.deepEqual(
    project('{"type":"model_stall","id":"session-1","stage":"generation","provider":"openai","model":"gpt-5","stalledSeconds":90,"hardKillSeconds":180,"message":"连接无响应 90 秒","messageEnglish":"No response from the model connection for 90s"}'),
    {
      sessionId: 'session-1',
      type: 'model.stall',
      stallStage: 'generation',
      stallKind: 'connection',
      stalledSeconds: 90,
      hardKillSeconds: 180,
      notice: '连接无响应 90 秒',
      noticeEnglish: 'No response from the model connection for 90s',
    },
  )
})

test('turn_active start and end project to turn.active with the phase', () => {
  assert.deepEqual(
    project('{"type":"turn_active","id":"session-1","phase":"start"}'),
    { sessionId: 'session-1', type: 'turn.active', phase: 'start' },
  )
  assert.deepEqual(
    project('{"type":"turn_active","id":"session-1","phase":"end"}'),
    { sessionId: 'session-1', type: 'turn.active', phase: 'end' },
  )
})

test('harness_recovery becomes session.recovery with the notice pair', () => {
  assert.deepEqual(
    project('{"type":"harness_recovery","id":"session-1","message":"从断点恢复中","messageEnglish":"Resuming from where the engine left off"}'),
    {
      sessionId: 'session-1',
      type: 'session.recovery',
      notice: '从断点恢复中',
      noticeEnglish: 'Resuming from where the engine left off',
    },
  )
})

test('message_queued carries position, total, submissionId and the queued text', () => {
  assert.deepEqual(
    project('{"type":"message_queued","id":"session-1","submissionId":"sub-1","position":2,"total":3,"mode":"followUp","message":"排队中第 2 位","messageEnglish":"Queued, position 2 of 3","text":"继续刚才的任务"}'),
    {
      sessionId: 'session-1',
      type: 'session.message_queued',
      position: 2,
      total: 3,
      submissionId: 'sub-1',
      text: '继续刚才的任务',
      notice: '排队中第 2 位',
      noticeEnglish: 'Queued, position 2 of 3',
    },
  )
})
