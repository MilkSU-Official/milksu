export interface CodingArchitectureAction {
  visibleText: string
  prompt: string
  relativeSpecPath: string
  relativeHtmlPath: string
}

function workspaceName(workspacePath: string): string {
  return workspacePath.split(/[\\/]/).filter(Boolean).at(-1) || 'Project'
}

function outputSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project'
}

export function buildCodingArchitectureAction(
  workspacePath: string,
): CodingArchitectureAction {
  const project = workspaceName(workspacePath)
  const base = `docs/architecture/generated/${outputSlug(project)}-current-system`
  const relativeSpecPath = `${base}.architecture.json`
  const relativeHtmlPath = `${base}.html`

  return {
    visibleText: '生成架构图',
    relativeSpecPath,
    relativeHtmlPath,
    prompt: `[MilkSU product action: Generate architecture diagram]

Use the loaded Archify skill and execute this action immediately for the current workspace.
Do not ask the user to choose a title, diagram type, scope, theme, layout, or output path.

Fixed product defaults:
- Inspect the current repository and depict the current implemented system, not a hypothetical redesign.
- Diagram type: architecture.
- Title: ${project} Current System.
- Scope: entry points, major components, runtime boundaries, persistence, and important external adapters.
- Output spec: ${relativeSpecPath}
- Output HTML: ${relativeHtmlPath}
- Quality: showcase, static by default, at most 12 primary nodes.
- Read the packaged Archify SKILL.md, matching schemas, and one matching example as instructed.
- Validate until the Archify receipt reports all 9 checks with 0 errors and 0 warnings.
- Run Archify deliver for the final HTML, then report both relative paths and the validation receipt.
- If the target files already exist, update them in place.
- Do not use network access and do not copy or reimplement Archify inside the repository.

Only ask one concise question if the current workspace is empty or cannot be read. Otherwise make reasonable product defaults and finish the artifact.`,
  }
}
