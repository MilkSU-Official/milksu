import type { Conversation } from '../types'

interface Props {
  conversation: Conversation | null
}

export function OutputPanel({ conversation }: Props) {
  const toolMessages = conversation?.messages.filter(m => m.role === 'tool') ?? []

  return (
    <div className="w-72 border-l border-[#e5e5e5] flex flex-col bg-[#fafafa]">
      <div className="h-14 flex items-center px-4 border-b border-[#e5e5e5]">
        <span className="text-sm font-medium text-[#666]">Output</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {toolMessages.length === 0 ? (
          <p className="text-xs text-[#999]">No output yet</p>
        ) : (
          <div className="space-y-3">
            {toolMessages.map(msg => (
              <div key={msg.id} className="bg-white border border-[#eee] rounded-lg p-3">
                <p className="text-xs text-[#888] mb-1">{msg.toolName}</p>
                <pre className="text-xs font-mono text-[#555] whitespace-pre-wrap">{msg.content}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
