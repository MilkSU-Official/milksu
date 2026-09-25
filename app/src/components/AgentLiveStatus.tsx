export default function AgentLiveStatus({
  label,
  elapsed,
  compact = false,
}: {
  label?: string
  elapsed?: string
  compact?: boolean
}) {
  return (
    <span
      className={`agent-live${compact ? ' agent-live--compact' : ''}`}
      role="status"
      aria-label={[label, elapsed].filter(Boolean).join(' ')}
    >
      <span className="agent-live__dot" aria-hidden="true" />
      {label && !compact ? <span className="agent-live__label">{label}</span> : null}
      {elapsed ? <span className="agent-live__elapsed">{elapsed}</span> : null}
    </span>
  )
}
