import type { ReactNode } from 'react'
import WorkspaceTopBar from '@/components/WorkspaceTopBar'

export default function WorkspaceModuleTopBar({
  module,
  title,
  subtitle,
  hideIdentity,
  leading,
  badge,
  actions,
  filters,
  metrics,
}: {
  module: 'coding' | 'ctf' | 'cve' | 'lab'
  title?: string
  subtitle?: string
  hideIdentity?: boolean
  leading?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  filters?: ReactNode
  metrics?: ReactNode
}) {
  const fallbackTitle = { coding: 'Coding', ctf: 'CTF', cve: 'CVE', lab: 'LAB' }[module]
  const resolvedTitle = title?.trim() || fallbackTitle

  return (
    <WorkspaceTopBar
      module={module}
      title={resolvedTitle}
      subtitle={hideIdentity ? undefined : subtitle}
      hideIdentity={hideIdentity}
      leading={leading}
      badge={badge}
      actions={actions}
      filters={filters}
      metrics={metrics}
    />
  )
}
