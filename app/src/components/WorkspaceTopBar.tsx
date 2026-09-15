import type { ReactNode } from 'react'
import WorkspaceTopBarTitle from '@/components/WorkspaceTopBarTitle'

export default function WorkspaceTopBar({
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
  module?: 'coding' | 'ctf' | 'cve' | 'lab'
  title: string
  subtitle?: string
  hideIdentity?: boolean
  leading?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  filters?: ReactNode
  metrics?: ReactNode
}) {
  const moduleKey = module ?? title.trim().toLowerCase()

  return (
    <header
      className="workspace-topbar shell-window-control-safe-x app-drag pl-6 py-4"
      data-module-topbar
      data-workspace-topbar
      data-plugin-surface="workspace-topbar"
      data-workspace-module={moduleKey}
      data-workspace-topbar-idle={hideIdentity ? '' : undefined}
    >
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {!hideIdentity ? (
            <span className="sr-only">{moduleKey}</span>
          ) : null}
          {leading ? (
            <div className="workspace-topbar__leading app-no-drag shrink-0">{leading}</div>
          ) : null}
          {!hideIdentity ? (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <WorkspaceTopBarTitle title={title} />
                {badge}
              </div>
              {subtitle ? (
                <p
                  className="workspace-topbar__subtitle mt-1 truncate text-caption text-muted-foreground"
                  data-workspace-topbar-subtitle
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div
            className="workspace-topbar__actions app-no-drag flex min-w-0 shrink-0 items-center gap-2 text-control"
            data-workspace-topbar-actions
          >
            {actions}
          </div>
        ) : null}
      </div>
      {filters ? (
        <div
          className="workspace-topbar__filters app-no-drag mt-3 text-control"
          data-workspace-topbar-filters
        >
          {filters}
        </div>
      ) : null}
      {metrics ? (
        <div className="workspace-topbar__metrics mt-3 text-body">{metrics}</div>
      ) : null}
      <style>{workspaceTopBarCss}</style>
    </header>
  )
}

const workspaceTopBarCss = `
.workspace-topbar {
  --shell-window-control-gutter: 1.5rem;
  --module-topbar-title-size: var(--text-control, 0.875rem);
  --module-topbar-title-line-height: var(--text-control--line-height, 1.25rem);
  --module-topbar-control-size: var(--text-control, 0.875rem);
  --module-topbar-control-line-height: var(--text-control--line-height, 1.25rem);

  min-height: 3rem;
  position: relative;
  z-index: var(--z-sticky);
  isolation: isolate;
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  overflow: visible;
}

.workspace-topbar[data-workspace-topbar-idle] {
  min-height: 2.75rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}

.workspace-topbar__module-mark {
  display: inline-flex;
  min-width: 2.1rem;
  height: 2.2rem;
  flex: none;
  align-items: center;
  justify-content: center;
  color: var(--brand);
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 900;
  letter-spacing: -.06em;
}

.workspace-topbar__actions {
  max-width: 100%;
}

.workspace-topbar[data-workspace-module="ctf"],
.workspace-topbar[data-workspace-module="cve"],
.workspace-topbar[data-workspace-module="lab"] {
  --module-topbar-title-size: 1.25rem;
  --module-topbar-title-line-height: 1.5rem;
  min-height: 3.25rem;
  padding-top: 0.65rem;
  padding-bottom: 0.65rem;
}

.workspace-topbar__title,
.workspace-topbar__subtitle {
  margin: 0;
}

.workspace-topbar__title {
  font-size: var(--module-topbar-title-size);
  line-height: var(--module-topbar-title-line-height);
}

.workspace-topbar__actions [data-button][data-size="sm"],
.workspace-topbar__actions [data-button][data-size="icon-sm"],
.workspace-topbar__actions [data-slot="select-trigger"][data-size="sm"],
.workspace-topbar__actions [data-slot="native-select"][data-size="sm"],
.workspace-topbar__actions [data-slot="input"][data-size="sm"],
.workspace-topbar__filters [data-button][data-size="sm"],
.workspace-topbar__filters [data-button][data-size="icon-sm"],
.workspace-topbar__filters [data-slot="select-trigger"][data-size="sm"],
.workspace-topbar__filters [data-slot="native-select"][data-size="sm"],
.workspace-topbar__filters [data-slot="input"][data-size="sm"] {
  font-size: var(--module-topbar-control-size);
  line-height: var(--module-topbar-control-line-height);
}
`
