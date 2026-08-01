import { describe, expect, it } from 'vitest'
import { buildCodingArchitectureAction } from '@/lib/codingArchitecture'

describe('Coding architecture product action', () => {
  it('derives stable workspace-local output paths', () => {
    const action = buildCodingArchitectureAction('/Users/milk/code/My Project')
    expect(action.visibleText).toBe('生成架构图')
    expect(action.relativeSpecPath)
      .toBe('docs/architecture/generated/my-project-current-system.architecture.json')
    expect(action.relativeHtmlPath)
      .toBe('docs/architecture/generated/my-project-current-system.html')
  })

  it('uses fixed defaults instead of asking the user for implementation details', () => {
    const action = buildCodingArchitectureAction('/tmp/milksu')
    expect(action.prompt).toContain('Do not ask the user')
    expect(action.prompt).toContain(`Product spec path: ${action.relativeSpecPath}`)
    expect(action.prompt).toContain(`Product HTML path: ${action.relativeHtmlPath}`)
    expect(action.prompt).toContain('Diagram type: architecture')
    expect(action.prompt).toContain('all 9 checks with 0 errors')
    expect(action.prompt).toContain('and 0 warnings')
    expect(action.prompt).toContain('milksu_archify')
    expect(action.prompt).toContain('The only authorized file changes')
    expect(action.prompt).toContain(action.relativeHtmlPath)
    expect(action.prompt).toContain('Only ask one concise question')
  })
})
