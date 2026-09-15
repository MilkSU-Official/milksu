export default function WorkspaceTopBarTitle({ title }: { title: string }) {
  return (
    <h1
      className="workspace-topbar__title truncate text-control font-semibold"
      data-workspace-topbar-title
    >
      {title}
    </h1>
  )
}
