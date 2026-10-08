// PR-2 批次 B2：门开路径的工具面与挂载面（工具侧）。
//
// 本文件替换 B1 脚手架里的 pi-durable 裸 CodingTools，把门关路径实际暴露的工具面
// 移植成语义等价的 pi-durable 扩展（对照总表见交付报告）：
//
//   milksu-coding-tools —— read/bash/edit/write/grep/find/ls。方案选择：**移植 MilkSU
//     现有实现**（bridge-policy createCodingToolDefinitions 的同一批 pi-coding-agent
//     定义）为 defineTool（工单三条路里的 ②）。理由：门关的这七个工具本来就是
//     MilkSU 自己的定义（bash 的 fullAccessCommandEnvironment spawnHook、edit 的
//     锚点包装、read 的图片读取），复用同一构造器 = 语义逐字节同源；①/③ 换成
//     pi-durable 自带工具会丢图片读取（pi-durable read 明确 unsupported_image）、丢
//     bash 环境约定、丢 edit 锚点格式，保真度都更差。适配层只做签名翻译：
//     (toolCallId, params, signal, onUpdate, ctx) → (args, api, context)，流式 onUpdate
//     快照转 api.output() 增量；审批面不用搬——B1 的 beforeTool 审判链对任何挂载的
//     工具自动生效（harness-bridge-approval）。
//
//   milksu-lsp —— lsp_diagnostics + lsp_fix（受审）。@narumitw/pi-lsp 包本体是
//     pi-coding-agent 扩展（registerTool/registerCommand API），不能在 pi-durable 下
//     加载；这里对着它的可分离核心（adapters/routes/runner，经 reviewed-ts bundle
//     导出，见 reviewed-extension-entries.mjs）重写两个工具的薄壳，bridge-lsp.js:
//     55-193 的受审链（策略门禁→强制 dry-run→realpath 圈界→SHA-256 前后校验→Diff→
//     ask 审批→过期检查→回滚）整体搬进 lsp_fix 的 execute。两个工具都声明
//     replay:"safe"（diagnostics 纯读；fix 的 dry-run 重新推导同一修复，SHA-256 过期
//     检查天然幂等——文件变了就失败，不会二次写坏）。
//
//   milksu-skills —— sections 渲染技能目录（名字+description+location，不贴正文，
//     白皮书约定）；正文读取继续走上面的 read 工具。目录按会话的技能路径渲染，
//     disabled 技能变化只改 section 内容 → pi-durable 位置型 pi.system 条目只重发
//     差异（PREP §3.1；门关路径为此要整会话重建）。
//
//   milksu-prompt —— B2b 补齐的 Pi 默认系统提示段（preamble/tools/rules/docs），
//     对齐 pi-coding-agent system-prompt.js:66-104 的段结构：无 AGENTS.md 时门关
//     有这些默认段而门开此前缺失。cwd 段由 milksu-core 末位渲染（段序 skills 之后）。
//
//   hang-guard afterTool —— bridge-hang-guard 的 tool_result 面移植：超时错误结果上
//     追加 iCloud dataless 诊断。超时注入（改参面）B1 已在审判链里
//     （harness-bridge-approval 的 applyBashTimeout），这里只补结果侧诊断。
//
//   tool-result bound —— 不移植自研裁剪（bridge-tool-result-bound）。pi-durable 对
//     每个工具结果都有引擎侧硬界：outputLimits（默认 50KB/2000 行，与 MilkSU 契约同
//     常数）+ finalResult 的 boundContent + truncated 诊断。bash/read 的全量落盘与
//     「Full output: path」提示由移植的工具自带（OutputAccumulator / truncateHead），
//     与门关一致。

import { defineExtension, defineTool, hook, section, ToolTask } from "@earendil-works/pi-durable";
import {
  formatSkillsForPrompt,
  getDocsPath,
  getExamplesPath,
  getReadmePath,
  loadSkills,
} from "@earendil-works/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { Type } from "typebox";
import { createCodingToolDefinitions } from "./bridge-policy.js";
import {
  commandDirectories,
  countDatalessFiles,
  hangGuardConfig,
  isICloudSyncedPath,
  resolveUserHome,
  timeoutDiagnostic,
} from "./bridge-hang-guard.js";
import {
  reviewedDiff,
  reviewedFile,
  sha256 as lspSha256,
  truncate as lspTruncate,
} from "./bridge-lsp.js";
import {
  loadLspRuntime,
  runLspDiagnostics,
  runLspFix,
  selectLspDiagnosticRoutes,
  selectLspFixRoute,
  LSP_DEFAULT_FILE_LIMIT,
} from "./reviewed-ts/extensions.js";

export const MILKSU_CODING_TOOLS_EXTENSION = "milksu-coding-tools";
export const MILKSU_LSP_EXTENSION = "milksu-lsp";
export const MILKSU_SKILLS_EXTENSION = "milksu-skills";
export const MILKSU_PROMPT_EXTENSION = "milksu-prompt";

// 门关会话实际激活的编码工具全集（codingReadOnly/codingWorkspaceAuto 的并集，去掉
// 门关也由扩展注册的域工具）。replay 声明：纯读工具 safe（重跑幂等）；写/命令默认
// unsafe（PREP R5：中断拿 interrupted，不盲重放副作用）。
const portedCodingToolNames = Object.freeze([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);
const replaySafeCodingToolNames = new Set(["read", "grep", "find", "ls"]);

/**
 * pi-coding-agent ToolDefinition → pi-durable ToolRegistration 的签名适配器。
 *
 * - execute(toolCallId, params, signal, onUpdate, ctx) → execute(args, api, context)：
 *   toolCallId 取 api.callId、signal 取 context.abortSignal、ctx 组装 {cwd, model}
 *   （cwd 用会话 agent 的 cwd，model 用 Models 解析出的 pi-ai 模型——read 的图片
 *   处理需要它的 inputLimits）。
 * - onUpdate({content, details}) 是**快照**（每次给当前累计输出），pi-durable 的
 *   api.output 是**增量**：前缀匹配时只发新增后缀；一旦快照进入截断态（tail 窗口
 *   滑动，前缀关系失效）就停止流式，终值仍由结果 content 精确给出。
 * - 结果 {content, details, isError} 直通（pi-ai 的 content 块形状两边一致，图片
 *   块可直通）；pi-coding-agent 的 structuredContent/outputSchema 是 codemode 面
 *   （PR-3），pi-durable ToolExecutionResult 没有对应字段，静默丢弃。
 */
export function adaptCodingToolDefinition(definition, options = {}) {
  if (!definition || typeof definition.execute !== "function") {
    throw new TypeError("adaptCodingToolDefinition requires a tool definition");
  }
  const {
    fallbackCwd = process.cwd(),
    resolveModel = () => undefined,
  } = options;
  return defineTool({
    name: definition.name,
    description: String(definition.description ?? definition.name),
    parameters: definition.parameters,
    ...(definition.prepareArguments ? { prepareArguments: definition.prepareArguments } : {}),
    ...(definition.constrainedSampling !== undefined
      ? { constrainedSampling: definition.constrainedSampling }
      : {}),
    ...(replaySafeCodingToolNames.has(definition.name) ? { replay: "safe" } : {}),
    ...(definition.name === "bash" ? { outputLimits: { retain: "tail" } } : {}),
    async execute(args, api, context) {
      let agentCwd = "";
      let model = undefined;
      try {
        const agent = await api.agent(context);
        agentCwd = String(agent?.cwd ?? "");
        if (agent?.model) model = resolveModel(agent.model);
      } catch {
        // agent 解析失败按进程 cwd 兜底（工具自身还有 fallbackCwd）。
      }
      const ctx = {
        ...(agentCwd || fallbackCwd ? { cwd: agentCwd || fallbackCwd } : {}),
        ...(model ? { model } : {}),
      };
      let streamed = "";
      let streamStopped = false;
      const onUpdate = (update) => {
        if (streamStopped || typeof api?.output !== "function") return;
        const text = String(update?.content?.[0]?.text ?? "");
        if (update?.details?.truncation?.truncated) {
          // 截断后的快照是滑动 tail，前缀关系失效：停止流式，终值由结果给出。
          streamStopped = true;
          return;
        }
        if (text && text.startsWith(streamed) && text.length > streamed.length) {
          api.output(text.slice(streamed.length));
          streamed = text;
        }
      };
      const result = await definition.execute(
        api.callId,
        args,
        context?.abortSignal,
        onUpdate,
        ctx,
      );
      return {
        ...(Array.isArray(result?.content) ? { content: result.content } : {}),
        ...(result?.isError !== undefined ? { isError: Boolean(result.isError) } : {}),
        ...(result?.details !== undefined ? { details: result.details } : {}),
      };
    },
  });
}

/**
 * 门开路径的编码工具面扩展。定义来自 bridge-policy 的 createCodingToolDefinitions
 * （与门关会话同一构造器、同一参数：bash 带 fullAccessCommandEnvironment spawnHook、
 * edit 带锚点包装），只挑七个编码工具；archify/imagegen 的定义构造无害但按对照表
 * 暂缓（不入 registry）。
 */
export async function createMilksuCodingToolsExtension({
  workspace,
  resolveModel = () => undefined,
  codingToolNames = portedCodingToolNames,
} = {}) {
  if (!workspace) throw new TypeError("createMilksuCodingToolsExtension requires a workspace");
  const wanted = new Set(codingToolNames.map(name => String(name)));
  const definitions = await createCodingToolDefinitions(workspace);
  const tools = definitions
    .filter(definition => wanted.has(definition.name))
    .map(definition => adaptCodingToolDefinition(definition, {
      fallbackCwd: workspace,
      resolveModel,
    }));
  const missing = [...wanted].filter(
    name => !tools.some(tool => tool.name === name),
  );
  if (missing.length > 0) {
    throw new Error(`milksu coding tools unavailable: ${missing.join(", ")}`);
  }
  const extension = defineExtension({
    name: MILKSU_CODING_TOOLS_EXTENSION,
    tools,
  });
  // B2b：Pi 门关的 tools/rules 系统提示段按各工具的 promptSnippet/promptGuidelines
  // 渲染（agent-session.js:1236-1254）。pi-durable 工具面不带这两个字段，这里把
  // 同一批定义的贡献带出来供 milksu-prompt 的段渲染使用（非枚举属性，不进
  // registry 的扩展形状）。
  extension.promptContributions = {
    snippets: new Map(definitions
      .filter(definition => typeof definition.promptSnippet === "string" && definition.promptSnippet)
      .map(definition => [definition.name, definition.promptSnippet])),
    guidelines: new Map(definitions
      .filter(definition => Array.isArray(definition.promptGuidelines) && definition.promptGuidelines.length > 0)
      .map(definition => [definition.name, [...definition.promptGuidelines]])),
  };
  return extension;
}

// ---------- LSP（PREP §3.2 草图：受审逻辑内嵌进 execute） ----------

const lspApprovalDiffLimit = 60_000;
const lspToolDiffLimit = 60_000;
const lspStatusKey = "lsp";
// pi-lsp 的 StatusContext 只要 ui.setStatus；pi-durable 下进度走 api.output/details。
const lspStatusContext = { ui: { setStatus: () => undefined } };

const lspServerParameter = Type.Optional(
  Type.Union([Type.String(), Type.Array(Type.String())], {
    description:
      "Optional configured LSP server name, or names for diagnostics. "
      + "Defaults to all servers matching the file extension.",
  }),
);

const lspDiagnosticsParameters = Type.Object({
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Files or directories to check. Defaults to the workspace root and routes by "
        + "configured server extensions.",
    }),
  ),
  root: Type.Optional(
    Type.String({ description: "Workspace root for language servers. Defaults to cwd." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum files to open per selected server." }),
  ),
  server: lspServerParameter,
});

const lspFixParameters = Type.Object({
  path: Type.String({
    description:
      "File to process. The server is selected from configured file extensions.",
  }),
  root: Type.Optional(
    Type.String({ description: "Workspace root for language servers. Defaults to cwd." }),
  ),
  write: Type.Optional(
    Type.Boolean({ description: "Write changed text back to the file. Defaults to false." }),
  ),
  server: Type.Optional(
    Type.String({
      description:
        "Optional configured LSP server name. Defaults to extension-based inference.",
    }),
  ),
  kind: Type.Optional(
    Type.String({ description: "Source action kind. Defaults to source.fixAll." }),
  ),
});

function lspTextResult(text, details) {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function textOfResult(result) {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter(block => block?.type === "text")
    .map(block => String(block.text ?? ""))
    .join("\n");
}

/** reviewed-ts bundle 导出的 pi-lsp 可分离核心（测试可注入假实现）。 */
export function defaultLspRuntime() {
  return {
    loadRuntime: loadLspRuntime,
    selectDiagnosticRoutes: selectLspDiagnosticRoutes,
    selectFixRoute: selectLspFixRoute,
    runDiagnostics: runLspDiagnostics,
    runFix: runLspFix,
    defaultFileLimit: LSP_DEFAULT_FILE_LIMIT,
  };
}

/**
 * 门开路径的 LSP 扩展：lsp_diagnostics 原样语义（纯读）+ lsp_fix 受审链整体内嵌。
 * 对照 bridge-lsp.js:55-193（createReviewedLspFixTool）逐段：策略门禁 → 强制
 * dry-run（write:false）→ realpath 圈界 → SHA-256 前后校验 → 统一 Diff → ask 审批
 * （Diff ≤60k 字符）→ 过期检查 → apply 后不匹配即回滚。签名适配：
 * (toolCallId, params, signal, onUpdate, ctx) → (args, api, context)；进度走
 * api.details()（Diff 尽早可见）+ 结果 content/details。
 */
export function createMilksuLspExtension({
  resolveConversation,
  getPolicy,
  approvalBroker,
  lsp = defaultLspRuntime(),
} = {}) {
  if (typeof resolveConversation !== "function"
    || typeof getPolicy !== "function"
    || !approvalBroker) {
    throw new TypeError("createMilksuLspExtension requires the session context");
  }

  const diagnosticsTool = defineTool({
    name: "lsp_diagnostics",
    description: "Run diagnostics using configured, language-agnostic LSP server routes.",
    parameters: lspDiagnosticsParameters,
    replay: "safe",
    async execute(args, api, context) {
      const alias = resolveConversation(api.conversationId);
      const root = String(getPolicy(alias)?.workspace ?? process.cwd());
      const { adapters, timeoutMs } = lsp.loadRuntime(root);
      const { root: routeRoot, routes, skipped } = lsp.selectDiagnosticRoutes(
        adapters,
        { ...args, root },
        lsp.defaultFileLimit,
      );
      const results = [];
      for (const route of routes) {
        const result = await lsp.runDiagnostics(
          route.adapter,
          {
            root: routeRoot,
            paths: args.paths,
            limit: args.limit,
            files: route.files,
          },
          timeoutMs,
          context?.abortSignal,
          lspStatusContext,
          lspStatusKey,
        );
        results.push({ route, result });
      }
      const sections = results.map(
        ({ route, result }) => `${route.reason}\n\n${textOfResult(result)}`,
      );
      if (skipped.length) {
        sections.push(
          `Skipped unavailable default LSP server(s): ${skipped
            .map(route => route.adapter.name)
            .join(", ")}.`,
        );
      }
      return lspTextResult(sections.join("\n\n---\n\n"), {
        root: routeRoot,
        skipped: skipped.map(route => ({
          server: route.adapter.name,
          reason: route.reason,
          files: route.files,
        })),
        routes: results.map(({ route, result }) => ({
          server: route.adapter.name,
          backend: route.adapter.name,
          reason: route.reason,
          files: route.files,
          details: result.details,
        })),
      });
    },
  });

  const reviewedFixTool = defineTool({
    name: "lsp_fix",
    description: "Preview and apply an LSP source fix inside the current workspace. "
      + "MilkSU shows a unified Diff before approval in Request Approval mode and verifies "
      + "that the applied file exactly matches the reviewed proposal.",
    parameters: lspFixParameters,
    replay: "safe",
    async execute(args, api, context) {
      const alias = resolveConversation(api.conversationId);
      const policy = getPolicy(alias);
      if (
        !policy
        || policy.executionMode !== "go"
        || !["ask", "workspace-auto", "full-auto"].includes(policy.approvalPolicy)
        || !policy.activeTools.includes("lsp_fix")
      ) {
        throw new Error("MilkSU Coding policy does not allow lsp_fix in this task");
      }

      // 模型给的 root 无效：根永远取会话工作区（bridge-lsp.js:84-94 同款）。
      const { adapters, timeoutMs } = lsp.loadRuntime(policy.workspace);
      const { root, route } = lsp.selectFixRoute(adapters, {
        path: args.path,
        root: policy.workspace,
        server: args.server,
      });

      // 强制 dry-run：受审链只信自己推导的预览。
      const preview = await lsp.runFix(
        route.adapter,
        {
          root: policy.workspace,
          path: args.path,
          kind: args.kind,
          write: false,
        },
        timeoutMs,
        context?.abortSignal,
        lspStatusContext,
        lspStatusKey,
      );
      const details = preview?.details;
      if (!details || typeof details !== "object") {
        throw new Error("MilkSU could not inspect the LSP fix preview");
      }
      const path = String(details.path ?? args.path ?? "").trim();
      const file = await reviewedFile(policy.workspace, path);
      const before = await readFile(file.absolutePath, "utf8");
      const proposed = typeof details.text === "string" ? details.text : before;
      const changed = proposed !== before;
      const diff = changed
        ? reviewedDiff(file.relativePath, before, proposed)
        : "";
      const resultDetails = {
        ...details,
        path: file.relativePath,
        reviewed: true,
        write: false,
        diff: lspTruncate(diff, lspToolDiffLimit),
        beforeSha256: lspSha256(before),
        afterSha256: lspSha256(proposed),
      };
      // 进度面：Diff 一算出来就让 UI 可见（旧 onUpdate 透传的等价物）。
      if (typeof api?.details === "function") {
        await api.details(resultDetails, context).catch(() => undefined);
      }

      if (!changed) {
        return lspTextResult(
          `LSP found no applicable source fix for ${file.relativePath}.`,
          resultDetails,
        );
      }
      if (args.write !== true) {
        return lspTextResult(
          `LSP previewed a source fix for ${file.relativePath}; no files were changed.\n\n`
          + lspTruncate(diff, lspToolDiffLimit),
          resultDetails,
        );
      }

      if (policy.approvalPolicy === "ask") {
        if (diff.length > lspApprovalDiffLimit) {
          throw new Error(
            `MilkSU did not request approval because the LSP Diff for ${file.relativePath} `
            + `exceeds the ${lspApprovalDiffLimit}-character review limit`,
          );
        }
        const approved = await approvalBroker.request({
          conversationId: alias,
          toolName: "lsp_fix",
          content: `LSP 修复 · ${file.relativePath}\n\n${diff}`,
          input: JSON.stringify({
            path: file.relativePath,
            kind: String(args.kind ?? "source.fixAll"),
            server: args.server ? String(args.server) : undefined,
            beforeSha256: resultDetails.beforeSha256,
            afterSha256: resultDetails.afterSha256,
          }, null, 2),
        });
        if (!approved) {
          throw new Error("MilkSU user denied lsp_fix");
        }
      }

      const current = await readFile(file.absolutePath, "utf8");
      if (lspSha256(current) !== resultDetails.beforeSha256) {
        throw new Error(
          `MilkSU did not apply the LSP fix because ${file.relativePath} changed after preview`,
        );
      }

      await lsp.runFix(
        route.adapter,
        {
          root: policy.workspace,
          path: file.relativePath,
          kind: args.kind,
          write: true,
        },
        timeoutMs,
        context?.abortSignal,
        lspStatusContext,
        lspStatusKey,
      );
      const applied = await readFile(file.absolutePath, "utf8");
      if (applied !== proposed) {
        await writeFile(file.absolutePath, before, "utf8");
        throw new Error(
          `MilkSU rolled back ${file.relativePath} because the applied LSP fix `
          + "did not match the reviewed Diff",
        );
      }

      return lspTextResult(
        `LSP applied the reviewed source fix to ${file.relativePath}.\n\n`
        + lspTruncate(diff, lspToolDiffLimit),
        {
          ...resultDetails,
          write: true,
        },
      );
    },
  });

  return defineExtension({
    name: MILKSU_LSP_EXTENSION,
    tools: [diagnosticsTool, reviewedFixTool],
  });
}

// ---------- 技能目录（PREP §3.1 草图：sections + 自有 read 工具读正文） ----------

/**
 * 门开路径的技能扩展：section "skills" 渲染目录。与 pi-coding-agent 的 skills 段
 * 同形（formatSkillsForPrompt：名字+description+location，不贴正文；正文由模型用
 * read 工具读取）。渲染条件对齐门关（pi system-prompt.js:100-104）：会话有技能路径
 * 且 read/bash 至少一个在本次请求的工具面里。目录按会话技能路径动态渲染——
 * disabled 技能变化只改 section 文本，pi-durable 的位置型 pi.system 只重发差异。
 */
export function createMilksuSkillsExtension({
  resolveConversation,
  skillPathsFor,
  cwd = process.cwd(),
} = {}) {
  if (typeof resolveConversation !== "function" || typeof skillPathsFor !== "function") {
    throw new TypeError("createMilksuSkillsExtension requires the session context");
  }
  // 按路径清单缓存 loadSkills 结果（同步 fs 读 frontmatter；路径不变不重读——与
  // 门关「路径变化才 reload」的节奏一致）。
  let cacheKey = undefined;
  let cacheValue = undefined;
  const skillsFor = (paths) => {
    const key = JSON.stringify(paths);
    if (cacheKey === key) return cacheValue;
    const { skills } = loadSkills({
      cwd,
      agentDir: cwd,
      skillPaths: paths,
      includeDefaults: false,
    });
    cacheKey = key;
    cacheValue = skills;
    return skills;
  };
  const skillsSection = section("skills", (input) => {
    const alias = resolveConversation(input.conversationId);
    const paths = skillPathsFor(alias);
    if (!Array.isArray(paths) || paths.length === 0) return undefined;
    const offered = Array.isArray(input.agent?.tools) ? input.agent.tools : [];
    const fileReadTool = offered.some(tool => tool?.name === "read")
      ? "read"
      : offered.some(tool => tool?.name === "bash")
        ? "bash"
        : undefined;
    if (!fileReadTool) return undefined;
    const skills = skillsFor(paths);
    if (!Array.isArray(skills) || skills.length === 0) return undefined;
    return formatSkillsForPrompt(skills, fileReadTool).trim();
  }, { tag: false });
  return defineExtension({
    name: MILKSU_SKILLS_EXTENSION,
    sections: [skillsSection],
  });
}

// ---------- Pi 默认系统提示段（B2b 补齐：PREP §3.1 + system-prompt.js:66-104） ----------

// Pi 默认 preamble（pi-coding-agent dist/core/system-prompt.js:81）。门关路径无
// AGENTS.md（customPrompt 为空）时 Pi 用它；有 AGENTS.md 时 preamble=项目说明，
// 且 tools/rules/docs 三段不再渲染（buildSystemPromptSections:76-94 的分支）。
const PI_DEFAULT_PREAMBLE = "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

// LSP 工具的提示贡献：@narumitw/pi-lsp 0.29.0 src/pi-lsp.ts:53-58/113-118 的
// promptSnippet/promptGuidelines（工具定义不导出，钉版字符串）+ MilkSU 受审版的
// 附加 guideline（bridge-lsp.js:70-75）。
export const LSP_PROMPT_CONTRIBUTIONS = Object.freeze({
  snippets: Object.freeze({
    lsp_diagnostics: "Get diagnostics from configured LSP servers selected by file extension",
    lsp_fix: "Apply configured LSP source fixes to a file",
  }),
  guidelines: Object.freeze({
    lsp_diagnostics: Object.freeze([
      "Use lsp_diagnostics when files need diagnostics from a configured LSP server.",
      "Use the server parameter only when the user asks for a specific configured LSP server or multiple servers match the same extension.",
      "If a configured server command is missing, report the configuration error and suggest installing the command or setting its PI_<SERVER>_LSP_COMMAND environment variable.",
    ]),
    lsp_fix: Object.freeze([
      "Use lsp_fix for files handled by a configured LSP code-action server.",
      "Use kind when the server needs a specific source action kind such as source.organizeImports.",
      "Set write=true when the user asked to apply the fix. MilkSU computes a dry-run first, shows the exact Diff when approval is required, and aborts if the file changes before apply.",
    ]),
  }),
});

// buildRules（system-prompt.js:30-64）的移植：bash 兜底规则 + 各工具 guidelines +
// 两条固定尾规则，去重后逐条 `- ` 渲染。
function buildPromptRules(selectedToolNames, toolGuidelines) {
  const rules = [];
  const seen = new Set();
  const addRule = rule => {
    const normalized = String(rule ?? "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    rules.push(normalized);
  };
  const hasBash = selectedToolNames.includes("bash");
  const hasPowerShell = selectedToolNames.includes("powershell");
  const hasGrep = selectedToolNames.includes("grep");
  const hasFind = selectedToolNames.includes("find");
  const hasLs = selectedToolNames.includes("ls");
  if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
    if (hasBash && hasPowerShell) {
      addRule("Use bash or PowerShell for file operations like listing, searching, and finding files");
    } else if (hasPowerShell) {
      addRule("Use PowerShell for file operations like listing, searching, and finding files");
    } else {
      addRule("Use bash for file operations like ls, rg, find");
    }
  }
  for (const name of selectedToolNames) {
    for (const rule of toolGuidelines.get(name) ?? []) addRule(rule);
  }
  addRule("Be concise in your responses");
  addRule("Show file paths clearly when working with files");
  return rules.map(rule => `- ${rule}`).join("\n");
}

// docs 段（system-prompt.js:86-93）：Pi 自身文档路径与查阅指引，逐字对齐门关默认。
function piDocsSectionText() {
  return `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
}

/**
 * B2b 补齐的 Pi 默认系统提示段扩展（安装位在 milksu-skills 之前，段次序 =
 * preamble → tools → rules → docs → …skills（milksu-skills）→ cwd（milksu-core），
 * 对齐 system-prompt.js:66-115 的段序）：
 *
 *   preamble —— 有项目说明（AGENTS.md）时即项目说明（替代 B2 的
 *     milksu-project-instructions 段，同为无标签首段）；无项目说明时用 Pi 默认
 *     preamble，并补渲染 tools/rules/docs。
 *   tools —— 本次请求工具面里带 promptSnippet 的工具逐条 `- name: snippet`
 *     + 尾行「还可能有其它自定义工具」（agent-session.js:1236-1244：无 snippet
 *     的工具不列出）。
 *   rules —— buildPromptRules（见上）。
 *   docs —— piDocsSectionText（见上）。
 *
 * cwd 段在 milksu-core（最后一个扩展）里渲染，保证段序与门关一致（skills 之后）。
 */
export function createMilksuPromptSectionsExtension({
  projectInstructionsFor,
  promptSnippets,
  promptGuidelines,
  cwdFor = () => process.cwd(),
} = {}) {
  if (typeof projectInstructionsFor !== "function") {
    throw new TypeError("createMilksuPromptSectionsExtension requires projectInstructionsFor");
  }
  const snippets = promptSnippets instanceof Map ? promptSnippets : new Map();
  const guidelines = promptGuidelines instanceof Map ? promptGuidelines : new Map();
  const preambleSection = section("preamble", () => (
    String(projectInstructionsFor() ?? "").trim() || PI_DEFAULT_PREAMBLE
  ), { tag: false });
  const toolsSection = section("tools", (input) => {
    // 有 customPrompt（项目说明）时 Pi 不渲染 tools/rules/docs（buildSystemPrompt
    // Sections:76-94 的 else 分支只在无 customPrompt 时走）。
    if (String(projectInstructionsFor() ?? "").trim()) return undefined;
    const offered = Array.isArray(input.agent?.tools) ? input.agent.tools : [];
    const visible = offered
      .map(tool => tool?.name)
      .filter(name => name && snippets.has(name));
    const lines = visible.length > 0
      ? visible.map(name => `- ${name}: ${snippets.get(name)}`).join("\n")
      : "(none)";
    return `${lines}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
  });
  const rulesSection = section("rules", (input) => {
    if (String(projectInstructionsFor() ?? "").trim()) return undefined;
    const offered = Array.isArray(input.agent?.tools) ? input.agent.tools : [];
    const names = offered.map(tool => String(tool?.name ?? "")).filter(Boolean);
    const rendered = buildPromptRules(names, guidelines);
    return rendered || undefined;
  });
  const docsSection = section("docs", () => {
    if (String(projectInstructionsFor() ?? "").trim()) return undefined;
    return piDocsSectionText();
  });
  return defineExtension({
    name: MILKSU_PROMPT_EXTENSION,
    sections: [preambleSection, toolsSection, rulesSection, docsSection],
  });
}

/** cwd 段（system-prompt.js:105：反斜杠归一）。挂在 milksu-core（末位扩展）保证段序。 */
export function milksuCwdSection(cwdFor = () => process.cwd()) {
  return section("cwd", input => {
    const agentCwd = String(input?.agent?.cwd ?? "").trim();
    return (agentCwd || cwdFor()).replace(/\\/g, "/");
  });
}

// ---------- hang-guard 结果面（afterTool） ----------

/**
 * bridge-hang-guard 的 tool_result 钩子移植：错误结果文本命中超时模式时，对命令
 * 涉及的 iCloud 目录做 dataless 计数并追加诊断（只解释，不拦截）。beforeTool 的
 * 超时注入已在审判链（harness-bridge-approval），本钩子只补事后解释。返回 hook
 * 注册数组（disabled 时为空）。纯读函数复用 bridge-hang-guard.js 导出。
 */
export function createMilksuHangGuardHooks({
  environment = process.env,
  platform = process.platform,
  home = resolveUserHome(environment),
  spawn,
  scanCacheTtlMs = 60_000,
} = {}) {
  const config = hangGuardConfig(environment);
  if (!config.enabled) return [];
  const cache = new Map();
  const countCached = directory => {
    const now = Date.now();
    const hit = cache.get(directory);
    if (hit && now - hit.at < scanCacheTtlMs) return hit.count;
    const count = countDatalessFiles(directory, { platform, spawn });
    cache.set(directory, { at: now, count });
    return count;
  };

  const afterTool = async (call, result) => {
    try {
      if (!result?.isError) return undefined;
      const text = [
        ...(Array.isArray(result.content)
          ? result.content
            .filter(block => block?.type === "text")
            .map(block => String(block.text ?? ""))
          : []),
        ...(Array.isArray(result.diagnostics)
          ? result.diagnostics.map(diagnostic => String(diagnostic?.message ?? ""))
          : []),
      ].join("\n");
      if (!/timeout[:：]/i.test(text) && !/timed out/i.test(text)) return undefined;
      const input = call?.arguments ?? {};
      const command = typeof input.command === "string" ? input.command : "";
      const synced = commandDirectories(command, process.cwd(), { home })
        .filter(candidate => isICloudSyncedPath(candidate, { platform, home }));
      const directory = synced[0];
      const detail = timeoutDiagnostic({
        timeoutSeconds: Number(input.timeout) || config.defaultTimeoutSeconds,
        directory,
        count: directory ? countCached(directory) : -1,
      });
      return {
        ...result,
        content: [
          ...(Array.isArray(result.content) ? result.content : []),
          { type: "text", text: detail },
        ],
      };
    } catch {
      return undefined;
    }
  };

  return [hook(ToolTask, { afterTool })];
}

// ---------- 工具面清单（对照断言/报告共用） ----------

/**
 * 门开路径**已挂载**的工具名（B2 范围 + B2b 的 mcp + B2c 的日常面）。工具面对照
 * 断言用：门关 activeTools 与本清单的交集应当全部出现在 ready.tools；差集即暂缓面
 * （见交付报告对照总表）。mcp 的挂载还要求会话带 mcpConfig（策略派生见
 * bridge-policy.js:1540-1561），milksu_imagegen 要求 imageGenConfigured，
 * capa_analyze 要求会话安全目录（bridge.js:2412-2414 同款），无配置的会话不出现。
 */
export const mountedHarnessToolNames = Object.freeze([
  ...portedCodingToolNames,
  "lsp_diagnostics",
  "lsp_fix",
  "mcp",
  // PR-2 批次 B2c：日常 UX 与产品面板面（harness-bridge-daily-tools.js；capa 在
  // milksu-security-tools，按会话目录动态挂载）。
  "milksu_ask",
  "milksu_progress",
  "web_search",
  "web_fetch",
  "milksu_workspace",
  "milksu_imagegen",
  "milksu_archify",
  "capa_analyze",
  // PR-2 批次 C1：子代理·协作工具面（harness-bridge-subagents.js；审批/校验在
  // 审判链的 subagent 分支，挂上即生效）。
  "subagent",
]);

/** 供报告/测试引用的暂缓清单（门关 activeTools − mountedHarnessToolNames）。 */
export function deferredHarnessToolNames(activeToolNames) {
  const mounted = new Set(mountedHarnessToolNames);
  return [...new Set(activeToolNames ?? [])]
    .map(name => String(name))
    .filter(name => !mounted.has(name));
}
