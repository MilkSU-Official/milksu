import { useMemo } from 'react'
import ContextRail from '@/components/ContextRail'
import ReverseArtifactsPanel from '@/components/ReverseArtifactsPanel'
import { useT } from '@/hooks/useUiLocale'
import { reaProxyToolName } from '@/lib/reverseArtifacts'
import type { Message } from '@/types'

/**
 * Static preview for the reverse-artifacts rail panel, fed with shapes taken
 * from a real REA 6.1.0 run. Dev-only surface behind reverse-preview.html;
 * not part of the production entry.
 */

let clock = 1_700_000_000_000
function nextTime(): number {
  clock += 90_000
  return clock
}

function toolMessages(calls: { tool: string; args: Record<string, unknown>; result: unknown }[]): Message[] {
  const messages: Message[] = []
  let index = 0
  for (const call of calls) {
    index += 1
    messages.push({
      id: `preview-start-${index}`,
      role: 'tool',
      content: JSON.stringify({ tool: call.tool, args: call.args }),
      timestamp: nextTime(),
      toolName: reaProxyToolName,
      toolCallId: `preview-${index}`,
      status: 'running',
    })
    messages.push({
      id: `preview-end-${index}`,
      role: 'tool',
      content: typeof call.result === 'string' ? call.result : JSON.stringify(call.result),
      timestamp: nextTime(),
      toolName: reaProxyToolName,
      toolCallId: `preview-${index}`,
      status: 'done',
    })
  }
  return messages
}

const previewCalls = [
  {
    tool: 'open_binary',
    args: { path: '/Users/dev/monolith/Monolith.app' },
    result: {
      result: {
        path: '/Users/dev/monolith/Monolith.app/Contents/MacOS/Monolith',
        format: 'mach-o',
        kind: 'executable',
        architecture: 'arm64',
        sha256: '9c1f'.padEnd(64, '0'),
        analysis_provider_binding: { provider: { id: 'hopper', name: 'Hopper', version: '5.19' } },
        analysis_run: { run_id: 'ffdd92c2-fe3d-4b08-bf80-cb6250882d4a' },
      },
    },
  },
  {
    tool: 'binary_overview',
    args: {},
    result: { result: { document: 'Monolith', procedure_count: 1284, string_count: 89, segment_count: 4, segments: [] } },
  },
  {
    tool: 'list_procedures',
    args: {},
    result: { result: [
      { address: '0x1f4c', value: 'validateSignature:withPublicKey:' },
      { address: '0x1e02', value: 'rotationTableAt:seed:' },
      { address: '0x1c9a', value: 'currentLicenseState' },
      { address: '0x3a10', value: 'ml_crypto_verify_ed25519' },
      { address: '0x3b88', value: 'ml_feature_gate_check' },
      { address: '0x52c0', value: 'serializePayload' },
    ] },
  },
  {
    tool: 'analyze_function',
    args: { procedure: 'validateSignature:withPublicKey:' },
    result: {
      result: {
        procedure: {
          address: '0x1f4c',
          name: 'validateSignature:withPublicKey:',
          classification: null,
          body: { available: true, provenance: 'hopper', ranges: [{ start: 0x1f4c, end: 0x2039 }], total_bytes: 237 },
          signature: 'bool -[MLLicenseValidator validateSignature:(NSData *)sig withPublicKey:(NSData *)pub]',
          locals: [],
        },
        pseudocode: [
          'bool validateSignature(NSData *sig, NSData *pub) {',
          '  uint8_t rotated[0x40];',
          '  /* rotation table seed, see ev_7f2a91c4 */',
          '  NSData *pubKey = [self embeddedPublicKey];',
          '  if (sig.length != 0x40) return false;',
          '  int ok = ml_crypto_verify_ed25519(pubKey, rotated, sig);',
          '  if (!ok) {',
          '    [telemetry note:"license.invalid"];',
          '    return false;',
          '  }',
          '  return true;',
          '}',
        ].join('\n'),
        assembly: [
          '0x1f4c: STP X28, X27, [SP, #-0x60]!',
          '0x1f50: STP X26, X25, [SP, #0x10]',
          '0x1f54: STP X24, X23, [SP, #0x20]',
          '0x1f58: MOV X20, x0',
          '0x1f5c: BL _ml_feature_gate_check',
          '0x1f60: CBZ W0, 0x2030',
          '0x1f64: LDR X0, [X20, #0x88]',
          '0x1f68: BL _objc_msgSend',
        ],
        comments: [],
        callers: [
          { address: '0x40b2', name: 'applicationDidFinishLaunching:' },
          { address: '0x6e14', name: 'ml_license_poll' },
        ],
        callees: [
          { address: '0x1e02', name: 'rotationTableAt:seed:' },
          { address: '0x3a10', name: 'ml_crypto_verify_ed25519' },
          { address: '0x11220', name: '_memcmp' },
        ],
        incoming_references: [],
        outgoing_references: [],
        referenced_strings: [{ address: '0x30040', value: 'license.invalid', source_address: '0x1fa8' }],
        referenced_names: [],
        basic_blocks: [],
        native_api: null,
        native_value_flow: null,
        limitations: ['Pseudocode reflects Hopper 5.19 recovery and may differ from original source.'],
      },
      evidence_id: 'ev_7f2a91c4',
      evidence: {
        evidence_id: 'ev_7f2a91c4',
        operation: 'analyze_function',
        predicate_type: 'rea.analysis',
        provider: { id: 'hopper', name: 'Hopper', version: '5.19' },
        subject: { name: 'Monolith', format: 'mach-o', architecture: 'arm64' },
        parameters: { procedure: 'validateSignature:withPublicKey:' },
        confidence: 'observed',
        authority: 'shipped-artifact',
      },
    },
  },
  {
    tool: 'trace_call_path',
    args: { from: 'applicationDidFinishLaunching:', to: 'ml_crypto_verify_ed25519' },
    result: {
      result: {
        query: 'applicationDidFinishLaunching: → ml_crypto_verify_ed25519',
        matches: [],
        nodes: [
          { name: 'applicationDidFinishLaunching:' },
          { name: 'validateSignature:withPublicKey:' },
          { name: 'rotationTableAt:seed:' },
          { name: 'ml_crypto_verify_ed25519' },
        ],
        edges: [],
        residual_unknowns: ['rotationTableAt: 的种子来源未追溯到静态数据。'],
      },
      evidence_id: 'ev_31d0be82',
      evidence: { confidence: 'derived', provider: { name: 'Hopper' } },
    },
  },
  {
    tool: 'list_unknowns',
    args: {},
    result: { result: { items: [
      { unknown_id: 'unk_' + 'd'.repeat(64), question: '0x3d84 处的跳转表未解析，目标可能是堆生成的代码。', status: 'open', severity: 'medium' },
      { unknown_id: 'unk_' + 'e'.repeat(64), question: 'rotationTableAt: 的种子来源未追溯到静态数据。', status: 'investigating', severity: 'high' },
    ] } },
  },
  {
    tool: 'export_evidence_bundle',
    args: { path: '/Users/dev/monolith/evidence/bundle.json' },
    result: { result: { path: '/Users/dev/monolith/evidence/bundle.json', bytes: 794_000, records: 6, unknowns: 2 } },
  },
]

export default function ReverseArtifactsPreview() {
  const t = useT()
  const messages = useMemo(() => toolMessages(previewCalls), [])
  return (
    <div data-agent-conversation className="flex h-screen w-screen overflow-hidden bg-surface-editor p-6">
      <div className="mr-6 hidden max-w-[260px] shrink-0 flex-col gap-2 self-center text-muted-foreground md:flex">
        <h1 className="text-base font-medium text-foreground">MilkSU</h1>
        <p className="text-[12.5px] leading-relaxed">
          {t('逆向产物标签 · 预览（真实 REA 输出形状）', 'Reverse artifacts rail · preview (real REA output shapes)')}
        </p>
      </div>
      <ContextRail
        header={(
          <div className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-foreground">
            {t('逆向产物', 'Reverse artifacts')}
          </div>
        )}
        width={520}
      >
        <ReverseArtifactsPanel messages={messages} />
      </ContextRail>
    </div>
  )
}
