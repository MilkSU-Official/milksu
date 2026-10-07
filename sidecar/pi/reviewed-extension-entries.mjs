export { createMcpAdapter } from "pi-mcp-adapter";
export { default as piGoalExtension } from "@narumitw/pi-goal/src/index.ts";
export { default as piLspExtension } from "@narumitw/pi-lsp/src/index.ts";
export { default as piBackgroundTasksExtension } from "pi-better-background-tasks/src/index.ts";
export { readLog as readPiBackgroundTaskLog } from "pi-better-background-tasks/src/logs.ts";
export { listMetas as listPiBackgroundTaskMetas } from "pi-better-background-tasks/src/registry.ts";
export {
  spawnTask as spawnPiBackgroundTask,
  stopTask as stopPiBackgroundTask,
} from "pi-better-background-tasks/src/runtime.ts";
// PR-2 批次 B2：@narumitw/pi-lsp 的可分离核心（不含吃 pi-coding-agent 扩展 API 的
// pi-lsp.ts 入口）。门开路径的 milksu-lsp 扩展（harness-bridge-tools.js）对着这层
// 重写薄壳：受审逻辑在工具 execute 里，语言服务进程/路由/文本编辑复用包本体。
export { loadRuntime as loadLspRuntime } from "@narumitw/pi-lsp/src/adapters.ts";
export {
  selectDiagnosticRoutes as selectLspDiagnosticRoutes,
  selectFixRoute as selectLspFixRoute,
} from "@narumitw/pi-lsp/src/routes.ts";
export {
  DEFAULT_FILE_LIMIT as LSP_DEFAULT_FILE_LIMIT,
  runDiagnostics as runLspDiagnostics,
  runFix as runLspFix,
} from "@narumitw/pi-lsp/src/runner.ts";
