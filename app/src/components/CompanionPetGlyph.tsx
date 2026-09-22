export function CompanionPetSpinner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-50 -50 100 100" aria-hidden="true">
      <g transform="rotate(16)">
        {Array.from({ length: 8 }, (_, index) => (
          <g key={index} transform={`rotate(${index * 45})`}>
            <rect x="-7.1" y="-46" width="14.2" height="49" rx="7.1" fill="#f4f2ef" />
            <rect x="-3.3" y="-36" width="6.6" height="30" rx="3.3" fill="#4a3238" />
          </g>
        ))}
        <circle r="11" fill="#e8eef8" />
        <circle r="6.5" fill="#d4deee" />
      </g>
    </svg>
  )
}

export function CompanionPetBang({
  tone,
  className,
}: {
  tone: 'yellow' | 'green'
  className?: string
}) {
  const ink = tone === 'green' ? '#2fbf5a' : '#f0b400'
  const rim = tone === 'green' ? '#d9ffe6' : '#fff4c2'
  return (
    <svg className={className} viewBox="0 0 48 56" aria-hidden="true">
      <rect x="18" y="2" width="12" height="34" rx="6" fill={rim} />
      <rect x="20.5" y="5" width="7" height="28" rx="3.5" fill={ink} />
      <circle cx="24" cy="46" r="7" fill={rim} />
      <circle cx="24" cy="46" r="4.6" fill={ink} />
    </svg>
  )
}
