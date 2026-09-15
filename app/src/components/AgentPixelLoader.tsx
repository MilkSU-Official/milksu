const PIXEL_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270]

export default function AgentPixelLoader({
  label,
  elapsed,
  running = false,
  compact = false,
}: {
  label?: string
  elapsed?: string
  running?: boolean
  compact?: boolean
}) {
  return (
    <span
      className={`agent-pixel-loader${compact ? ' agent-pixel-loader--compact' : ''}`}
      role="status"
      aria-label={[label, elapsed].filter(Boolean).join(' ')}
    >
      {running ? (
        <span className="agent-pixel" aria-hidden="true">
          {PIXEL_DELAYS.map((delay, index) => (
            <span
              key={index}
              className="agent-pixel__cell"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      ) : null}
      {label && !compact ? (
        <span className={`agent-pixel-loader__label${running ? ' agent-pixel-loader__label--run' : ''}`}>
          {label}
        </span>
      ) : null}
      {elapsed ? <span className="agent-pixel-loader__elapsed">{elapsed}</span> : null}
    </span>
  )
}
