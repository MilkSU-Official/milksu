/**
 * Choose Computer Use vs isolated-browser CDP for product-loop.
 * Calculator is the only CU target this suite will drive. Other visible
 * windows are not treated as available — do not click the user's Chrome.
 */

const CALCULATOR_PATTERN = /calculator|计算器|calc\.exe|calculator\.app/i
const HOST_PATTERN = /milksu|com\.milksu/i
export const COMPUTER_USE_TOOL_PATTERN = /computer.?use|screenshot|cua|mouse_click|left_click|key|screen_capture/i
export const BROWSER_TOOL_PATTERN = /mcp__playwright-mcp__|milksu-playwright(?!-user)|milksu_workspace|browser_navigate|browser_snapshot|EnsureCodingBrowser/i

export function targetLabel(row) {
  return [row?.name, row?.windowTitle, row?.title, row?.bundleId]
    .map(value => String(value ?? ''))
    .join(' ')
}

export function isHostComputerUseTarget(row) {
  return HOST_PATTERN.test(targetLabel(row))
}

export function isCalculatorTarget(row) {
  return CALCULATOR_PATTERN.test(targetLabel(row))
}

export function pickComputerUseTarget(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.error) {
    return {
      available: false,
      reason: String(raw.error),
      target: null,
    }
  }
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.targets) ? raw.targets : []
  const calculator = rows.find(row => isCalculatorTarget(row) && !isHostComputerUseTarget(row))
  if (calculator) {
    return {
      available: true,
      reason: 'calculator',
      target: calculator,
    }
  }
  return {
    available: false,
    reason: 'ListCodingComputerUseTargets 没有计算器窗口（TCC / 平台不可用 / 未打开计算器）',
    target: null,
  }
}

export function usedComputerUseTools(toolNames) {
  return (toolNames ?? []).some(name => COMPUTER_USE_TOOL_PATTERN.test(String(name)))
}

export function usedIsolatedBrowserTools(toolNames) {
  return (toolNames ?? []).some(name => BROWSER_TOOL_PATTERN.test(String(name)))
}
