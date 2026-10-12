import { describe, expect, it } from 'vitest'
import {
  deriveReverseSession,
  isReaToolMessage,
  reaProxyToolNames,
  reaRunningLabel,
} from '@/lib/reverseArtifacts'
import type { Message } from '@/types'

/**
 * Fixtures mirror the shapes recorded from a real REA 6.1.0 run
 * (.tmp-mockups/rea-samples): the proxy tool name, the `{ tool, args }`
 * start payload, and the evidence envelope `{ result, evidence_id, evidence }`
 * returned by analyze_function on an IDA-backed session.
 */

function startMessage(toolCallId: string, tool: string, _args: Record<string, unknown> = {}): Message {
  // 真实形态：全局 mcp 代理的调用标识行（渲染文本），参数不进消息流。
  return {
    id: `${toolCallId}-start`,
    role: 'tool',
    content: `MCP tool · milksu-rea_${tool}`,
    timestamp: 1_000,
    toolName: 'mcp',
    toolCallId,
    status: 'done',
  }
}

function endMessage(toolCallId: string, content: unknown, timestamp = 2_000): Message {
  return {
    id: `${toolCallId}-end`,
    role: 'tool',
    content: typeof content === 'string' ? content : JSON.stringify(content),
    timestamp,
    toolName: 'mcp',
    toolCallId,
    status: 'done',
  }
}

// Trimmed from a real analyze_function result (mcp_analyze-function_ida_result.json).
const analyzeFunctionEnvelope = {
  result: {
    procedure: {
      address: '0x10000062c',
      name: '_main',
      classification: null,
      body: { available: false, reason: 'IDA MCP does not report complete function body ranges.' },
      signature: 'int _main(int argc, const char ** argv, const char ** envp)',
      locals: [],
    },
    pseudocode: 'int _main(int argc, const char **argv, const char **envp) {\n  return 0;\n}',
    assembly: ['0x10000062c: SUB SP, SP, #0x170', '0x100000634: STP X29, X30, [SP, #0x160]'],
    comments: [],
    callers: [],
    callees: [
      { address: '0x100000674', name: '_printf', classification: null, body: null, signature: null, locals: [] },
    ],
    incoming_references: [],
    outgoing_references: [],
    referenced_strings: [],
    referenced_names: [],
    basic_blocks: [],
    native_api: null,
    native_value_flow: null,
    limitations: [],
  },
  evidence_id: 'ev_7f2a91c4',
  evidence: {
    evidence_id: 'ev_7f2a91c4',
    operation: 'analyze_function',
    predicate_type: 'rea.analysis',
    provider: { id: 'ida', name: 'IDA', version: '9.1' },
    subject: { name: 'rea-target', digest: { sha256: 'a'.repeat(64) }, format: 'mach-o', architecture: 'arm64', local_path: '/tmp/rea-target' },
    parameters: { procedure: '0x10000062c' },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [],
    locations: [{ kind: 'address', address: '0x10000062c' }],
    evidence_links: [],
  },
}

const openBinaryResult = {
  path: '/Users/dev/monolith/Monolith.app/Contents/MacOS/Monolith',
  format: 'mach-o',
  kind: 'executable',
  architecture: 'arm64',
  sha256: 'b'.repeat(64),
  loaderArgs: [],
  analysis_provider_binding: {
    provider: { id: 'hopper', name: 'Hopper', version: '5.19' },
    selection_source: 'request',
    analysis_profile: { provider: 'hopper', parameters: {}, digest: 'c'.repeat(64) },
  },
  analysis_run: { run_id: 'ffdd92c2-fe3d-4b08-bf80-cb6250882d4a' },
}

describe('deriveReverseSession', () => {
  it('returns an empty session without rea traffic', () => {
    const session = deriveReverseSession([
      { id: '1', role: 'user', content: 'hello', timestamp: 1 },
    ])
    expect(session.hasTraffic).toBe(false)
    expect(session.target).toBeNull()
    expect(session.evidence).toHaveLength(0)
  })

  it('captures the target, provider, and run id from open_binary', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'open_binary', { path: openBinaryResult.path }),
      endMessage('call-1', { result: openBinaryResult }),
    ])
    expect(session.target?.name).toBe('Monolith')
    expect(session.target?.format).toBe('mach-o')
    expect(session.target?.architecture).toBe('arm64')
    expect(session.target?.providerName).toBe('Hopper')
    expect(session.target?.providerVersion).toBe('5.19')
    expect(session.target?.runId).toBe('ffdd92c2-fe3d-4b08-bf80-cb6250882d4a')
    expect(session.target?.closed).toBe(false)
  })

  it('fills overview counts and keeps the target after binary_overview', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'open_binary', {}),
      endMessage('call-1', { result: openBinaryResult }),
      startMessage('call-2', 'binary_overview', {}),
      endMessage('call-2', { result: { document: 'Monolith', procedure_count: 1284, string_count: 89, segment_count: 4, segments: [] } }, 3_000),
    ])
    expect(session.target?.procedureCount).toBe(1284)
    expect(session.target?.stringCount).toBe(89)
    expect(session.target?.segmentCount).toBe(4)
  })

  it('builds a dossier with assembly, references, and evidence identity', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'analyze_function', { procedure: '0x10000062c' }),
      endMessage('call-1', analyzeFunctionEnvelope, 4_000),
    ])
    expect(session.dossiers).toHaveLength(1)
    const dossier = session.dossiers[0]!
    expect(dossier.name).toBe('_main')
    expect(dossier.address).toBe('0x10000062c')
    expect(dossier.bodyAvailable).toBe(false)
    expect(dossier.bodyReason).toContain('body ranges')
    expect(dossier.assembly).toHaveLength(2)
    expect(dossier.evidenceId).toBe('ev_7f2a91c4')
    expect(dossier.callees[0]?.name).toBe('_printf')
    // callees enter the function list so the browser accumulates the investigation
    expect(session.functions.map(fn => fn.name)).toContain('_printf')
    const entry = session.evidence[0]!
    expect(entry.evidenceId).toBe('ev_7f2a91c4')
    expect(entry.confidence).toBe('observed')
    expect(entry.provider).toBe('IDA')
    expect(entry.isError).toBe(false)
    expect(entry.oversized).toBe(false)
  })

  it('accumulates listed procedures from list_procedures', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'list_procedures', {}),
      endMessage('call-1', { result: [
        { address: '0x1f4c', value: 'validateSignature:withPublicKey:' },
        { address: '0x1e02', value: 'rotationTableAt:seed:' },
      ] }),
    ])
    expect(session.functions).toHaveLength(2)
    expect(session.functions[0]?.via).toBe('listed')
  })

  it('records unknowns from list_unknowns items', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'list_unknowns', {}),
      endMessage('call-1', { result: { items: [
        {
          unknown_id: 'unk_' + 'd'.repeat(64),
          question: '0x3d84 处的跳转表未解析',
          status: 'open',
          severity: 'medium',
        },
      ] } }),
    ])
    expect(session.unknowns).toHaveLength(1)
    expect(session.unknowns[0]?.status).toBe('open')
    expect(session.unknowns[0]?.severity).toBe('medium')
  })

  it('captures export receipts', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'export_evidence_bundle', { path: '/ws/evidence.json' }),
      endMessage('call-1', { result: { path: '/ws/evidence.json', bytes: 794_000, records: 12, unknowns: 2 } }),
    ])
    expect(session.exports[0]?.records).toBe(12)
    expect(session.exports[0]?.bytes).toBe(794_000)
  })

  it('marks a running call and a closed target', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'open_binary', {}),
      endMessage('call-1', { result: openBinaryResult }),
      startMessage('call-2', 'close_binary', {}),
      endMessage('call-2', { result: { closed: true } }, 5_000),
      startMessage('call-3', 'analyze_function', { procedure: '_main' }),
    ])
    expect(session.target?.closed).toBe(true)
    expect(session.runningTool).toBe('analyze_function')
    expect(reaRunningLabel(session)).toBeTruthy()
  })

  it('degrades truncated payloads to oversized timeline entries', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'analyze_javascript_application', { path: '/ws/app.asar' }),
      endMessage('call-1', '{"result":{"statistics":{"modules":109244}'),
    ])
    expect(session.evidence).toHaveLength(1)
    expect(session.evidence[0]?.oversized).toBe(true)
    expect(session.evidence[0]?.summary).toBe('analyze_javascript_application')
    expect(session.dossiers).toHaveLength(0)
  })

  it('parses javascript application summaries into module counts', () => {
    const session = deriveReverseSession([
      startMessage('call-1', 'analyze_javascript_application', { path: '/ws/app.asar' }),
      endMessage('call-1', { result: {
        input_path: '/ws/app.asar',
        format: 'asar',
        root_artifact_sha256: 'e'.repeat(64),
        inventory_manifest_id: 'agm_' + 'f'.repeat(64),
        inventory_graph_sha256: '0'.repeat(64),
        graph: { schema: 'JavaScriptApplicationGraph', graph_id: 'jag_' + 'a'.repeat(64), root_node_ids: [], nodes: new Array(15), edges: [], coverage: { status: 'partial' }, limitations: [] },
        summary: { browser_windows: 2, ipc: { operations: 9, literal_channels: 4 } },
        statistics: { modules: 120, parsed_javascript_files: 18, findings: 6 },
        limitations: [],
        semantic_graph: null,
      } }),
    ])
    expect(session.target?.format).toBe('asar')
    expect(session.target?.moduleCount).toBe(120)
    expect(session.target?.ipcChannelCount).toBe(4)
  })

  it('ignores non-rea tool traffic', () => {
    const session = deriveReverseSession([
      { id: 'x', role: 'tool', content: '{"tool":"capa_analyze"}', timestamp: 1, toolName: 'capa_analyze', toolCallId: 'other', status: 'done' },
    ])
    expect(session.hasTraffic).toBe(false)
  })

  it('ignores global mcp calls into other servers', () => {
    const message = {
      id: 'x',
      role: 'tool' as const,
      content: JSON.stringify({ tool: 'some_other_server_tool', args: {} }),
      timestamp: 1,
      toolName: 'mcp',
      toolCallId: 'other-server',
      status: 'running' as const,
    }
    expect(isReaToolMessage(message)).toBe(false)
    const session = deriveReverseSession([message])
    expect(session.hasTraffic).toBe(false)
  })

  it('accepts the global mcp proxy carrying a rea call marker', () => {
    const message = {
      id: 'x',
      role: 'tool' as const,
      content: 'MCP tool · milksu-rea_analyze_function',
      timestamp: 1,
      toolName: 'mcp',
      toolCallId: 'rea-global',
      status: 'done' as const,
    }
    expect(isReaToolMessage(message)).toBe(true)
  })

  it('ignores mcp metadata answers like tool search and server listing', () => {
    const search = {
      id: 's',
      role: 'tool' as const,
      content: 'Found 8 tools matching "analyze_javascript_application":\n\nmilksu-rea_analyze_javascript_application\n  Reconstruct one local ASAR…',
      timestamp: 1,
      toolName: 'mcp',
      toolCallId: 'meta-search',
      status: 'done' as const,
    }
    const listing = {
      id: 'l',
      role: 'tool' as const,
      content: 'milksu-rea (18 tools (lazy: tools from cache, not connected yet — mcp({ connect: "milksu-rea" }) to connect)):',
      timestamp: 2,
      toolName: 'mcp',
      toolCallId: 'meta-list',
      status: 'done' as const,
    }
    expect(isReaToolMessage(search)).toBe(false)
    expect(isReaToolMessage(listing)).toBe(false)
    const session = deriveReverseSession([search, listing])
    expect(session.hasTraffic).toBe(false)
  })

  it('captures an export receipt from a real rendered mcp result', () => {
    const session = deriveReverseSession([
      {
        id: 'e1',
        role: 'tool',
        content: 'MCP tool · milksu-rea_export_evidence_bundle',
        timestamp: 1_000,
        toolName: 'mcp',
        toolCallId: 'export-call',
        status: 'done',
      },
      {
        id: 'e2',
        role: 'tool',
        content: '{"result":{"path":"/Users/dev/ws/rea-demo-evidence-bundle.zip","bytes":793779,"records":1,"unknowns":0}}\nstructuredContent:\n{\n  "result": {\n',
        timestamp: 2_000,
        toolName: 'mcp',
        toolCallId: 'export-call',
        status: 'done',
      },
    ])
    expect(session.exports).toHaveLength(1)
    expect(session.exports[0]?.records).toBe(1)
    expect(session.evidence[0]?.evidenceId).toBeUndefined()
  })
})
