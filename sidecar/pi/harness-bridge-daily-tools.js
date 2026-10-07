// PR-2 批次 B2c：门开路径的日常 UX 与产品面板工具面。
//
// 挂载对象（B2 对照表里标「暂缓」的日常面，本票逐项补齐）：
//   milksu_ask / milksu_progress —— 门关定义在 bridge.js:847-983
//     （createMilkSUWorkflowExtension，模块私有不可导入）。这里对着它写薄壳：
//     选项规整与回传文案复用 bridge-ask.js 的同一批纯函数（normalizeAskOptions /
//     formatAskSelection / codingAskToolName），选卡回路复用同一个
//     approvalBroker.requestChoice——桥侧事件形状（approval_requested /
//     approval_resolved 的逐字段 payload）由真 broker 保证与门关逐字节一致，
//     渲染器零改动。progress 的 content/details 复刻同一形状（渲染器在
//     tool_call_start/end 上投影计划面板）。
//   web_search / web_fetch —— bridge-web-research.js 的 piWebResearchExtension
//     （earendil-works/pi PR #3080 评审版）经本文件的 pi 收集壳原样收集：execute
//     逐字节同源，promptSnippet 一并带出供 milksu-prompt 的 tools 段渲染。
//   milksu_workspace —— bridge-workspace.js createCodingWorkspaceExtension 同一
//     构造器，按会话懒实例化（工厂闭包按 conversationId 绑定 workspaceActionBroker
//     /压缩排队/研究隔离面，与门关 bridge.js:2108-2127 的接线逐参一致）。
//   milksu_imagegen / milksu_archify —— 会话策略的 policy.customTools
//     （bridge-policy.js createCodingToolDefinitions 的产物：imagegen 的
//     ensureRead/ensureMutation、archify 的 archifyRoot 都按该会话的
//     readOnlyResourceRoots / codingCollaboration 构造）按名取用——与门关
//     createAgentSession 挂的是同一批定义对象。注册面元数据
//     （description/parameters）用同一构造器先建一份原型：imagegen 描述嵌
//     env 模型名（进程级稳定），archify 描述静态。
//   capa_analyze —— bridge-security-tools.js createSecurityToolsExtension 同一
//     构造器，按会话 policy.securityTools 懒实例化；注册面随 capa 目录指纹变化
//     按名原位替换（registry.install 的 replace-in-place 语义，见
//     harness-bridge-session 的 refreshSecurityToolsMount）。目录未配置的会话由
//     activeTools 门禁自然不暴露（bridge.js:2412-2414 同款）。
//
// 审批/隔离：不需要另接——B1 审判链（harness-bridge-approval 的 beforeTool）对
// registry 里的一切工具自动生效：imagegen 逐次审批（authorizeImageGenToolCall，
// imageDraw 画图页免卡）、activeTools 白名单、turn contract、破坏性删除、重复
// 熔断、bash 超时注入都在那一条链上。
//
// replay 声明：纯读/幂等面 safe——progress 纯渲染、ask 崩溃后重弹卡（与 DECISIONS
// Q3 接受的审批重问同一口径）、web 两件纯网络读、capa 只读分析（sandbox 无写根）；
// 有副作用面 unsafe——workspace 改桌面状态、imagegen 写文件+计费调用、archify
// 写交付物。

import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import piWebResearchExtension from "./bridge-web-research.js";
import {
  codingAskToolName,
  formatAskSelection,
  normalizeAskOptions,
} from "./bridge-ask.js";
import {
  codingWorkspaceToolName,
  createCodingWorkspaceExtension,
  queueWorkspaceCompaction,
} from "./bridge-workspace.js";
import { createSecurityToolsExtension } from "./bridge-security-tools.js";
import { createCodingToolDefinitions } from "./bridge-policy.js";
import { codingImageGenToolName } from "./bridge-imagegen.js";

export const MILKSU_DAILY_TOOLS_EXTENSION = "milksu-daily-tools";
export const MILKSU_SECURITY_TOOLS_EXTENSION = "milksu-security-tools";
export const codingArchifyToolName = "milksu_archify";
export const capaAnalyzeToolName = "capa_analyze";

/** B2c 挂载的日常面工具名（mountedHarnessToolNames 与对照断言共用）。 */
export const MILKSU_DAILY_TOOL_NAMES = Object.freeze([
  codingAskToolName,
  "milksu_progress",
  "web_search",
  "web_fetch",
  codingWorkspaceToolName,
  codingImageGenToolName,
  codingArchifyToolName,
  capaAnalyzeToolName,
]);

/** replay: safe 的日常面（其余默认 unsafe）。 */
const replaySafeDailyToolNames = new Set([
  codingAskToolName,
  "milksu_progress",
  "web_search",
  "web_fetch",
  capaAnalyzeToolName,
]);

/**
 * pi-coding-agent 扩展工厂 `(pi) => { pi.registerTool(...); pi.on(...) }` →
 * registerTool 定义清单。收集壳只认 registerTool：其余 pi 面（on/setActiveTools/
 * registerCommand…）全部 no-op——门关挂在这些面上的行为（如 workflow 扩展的
 * before_agent_start 系统提示拼装）不归本扩展管（见交付报告「看到但没动」）。
 * 这样 web/workspace/security 三个门关工厂可以原样复用，execute 逐字节同源。
 */
export function collectExtensionToolDefinitions(factory) {
  if (typeof factory !== "function") {
    throw new TypeError("collectExtensionToolDefinitions requires an extension factory");
  }
  const definitions = [];
  const pi = new Proxy({}, {
    get(_target, property) {
      if (property === "registerTool") {
        return definition => {
          if (definition && typeof definition === "object") definitions.push(definition);
          return undefined;
        };
      }
      return () => undefined;
    },
  });
  factory(pi);
  return definitions;
}

/**
 * pi-coding-agent 工具定义 → pi-durable 执行结果的签名适配（对照 B2
 * adaptCodingToolDefinition 的核心映射，去掉 daily 面用不到的流式/ctx 面——
 * 这批定义的 execute 都不读 onUpdate/ctx）。结果 {content, details, isError}
 * 直通（pi-ai content 块形状两边一致）。
 */
async function invokePortedDefinition(definition, args, api, context) {
  const result = await definition.execute(
    api.callId,
    args,
    context?.abortSignal,
    undefined,
    {},
  );
  return {
    ...(Array.isArray(result?.content) ? { content: result.content } : {}),
    ...(result?.isError !== undefined ? { isError: Boolean(result.isError) } : {}),
    ...(result?.details !== undefined ? { details: result.details } : {}),
  };
}

/** 找不到定义时的统一显式报错（会话策略缺该工具面时快速失败）。 */
function missingDefinitionError(name) {
  return new Error(`MilkSU could not resolve the ${name} definition for this conversation`);
}

// ---------- milksu_ask / milksu_progress（bridge.js:850-972 薄壳） ----------

// 参数与描述逐字对齐门关 registerTool（bridge.js:851-862 / 939-950）。
const askParameters = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 200 }),
  options: Type.Array(Type.Object({
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    label: Type.String({ minLength: 1, maxLength: 80 }),
    detail: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  }), { minItems: 2, maxItems: 6 }),
});

const progressParameters = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: 240 }),
  steps: Type.Array(Type.Object({
    text: Type.String({ minLength: 1, maxLength: 180 }),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("in_progress"),
      Type.Literal("completed"),
    ]),
  }), { minItems: 1, maxItems: 8 }),
});

function createAskTool({ resolveConversation, approvalBroker }) {
  return defineTool({
    name: codingAskToolName,
    description: "Show a tappable choice card with 2-6 options. Use when asking a "
      + "multiple-choice question or when the user asks you to present options. Wait for "
      + "the selected option; do not write the choices as a numbered or bulleted list.",
    parameters: askParameters,
    replay: "safe",
    async execute(args, api) {
      // bridge.js:864-885 逐段对照：规整 → requestChoice（真 broker，事件形状
      // 逐字段同源）→ 回传文案。
      const alias = resolveConversation(api.conversationId);
      const options = normalizeAskOptions(args.options);
      const question = String(args.question ?? "").trim();
      if (!question) throw new Error("milksu_ask needs a question");
      if (options.length < 2) throw new Error("milksu_ask needs at least two options");
      const picked = await approvalBroker.requestChoice({
        conversationId: alias,
        question,
        options,
      });
      if (!picked) {
        return {
          content: [{ type: "text", text: formatAskSelection(null) }],
        };
      }
      return {
        content: [{
          type: "text",
          text: formatAskSelection(picked),
        }],
        details: { question, selected: picked },
      };
    },
  });
}

function createProgressTool() {
  return defineTool({
    name: "milksu_progress",
    description: "Publish or update a short execution plan (summary + up to 8 steps) "
      + "when the task has more than one concrete step. Skip one-shot replies. Keep the "
      + "in-progress step updated.",
    parameters: progressParameters,
    replay: "safe",
    async execute(args) {
      // bridge.js:955-972 逐段对照（latestPlan 是门关工厂内的死状态，无外部读者，
      // 不搬运）。
      const inProgress = args.steps.filter(step => step.status === "in_progress").length;
      if (inProgress > 1) {
        throw new Error("MilkSU progress accepts at most one in-progress step");
      }
      const steps = args.steps.map(step => ({ ...step }));
      return {
        content: [{
          type: "text",
          text: `${args.summary}\n${steps.map(step => (
            `[${step.status === "completed" ? "x" : step.status === "in_progress" ? ">" : " "}] ${step.text}`
          )).join("\n")}`,
        }],
        details: {
          summary: args.summary,
          steps,
        },
      };
    },
  });
}

// ---------- 日常面扩展 ----------

/**
 * 门开路径的日常面扩展。context（全部来自 harness-bridge-session 的会话层）：
 *   resolveConversation   durable conversationId → MilkSU conversationId
 *   getPolicy            alias → 会话策略（customTools / securityTools / workspace）
 *   approvalBroker       与门关同一个审批 broker（ask 选卡回路）
 *   workspaceActionBroker 与门关同一个工作区动作 broker（workspace 面板回路）
 *   pendingWorkspaceCompaction  maps 的压缩排队集合（compact_context 入队）
 *   inspectUsage         alias → {usage, contextWindow}（compact_context 报告）
 *   observeResearchAction 研究动作观测（bridge.js observeResearchWorkspaceAction）
 *   researchSecrets      alias → 会话 provider secrets（研究文本脱敏）
 *   isResearchActive     alias → 是否有活跃研究 run（研究浏览器隔离）
 *   workspace            进程工作区（原型构造用）
 */
export async function createMilksuDailyToolsExtension(context) {
  const required = ["resolveConversation", "getPolicy", "approvalBroker", "workspaceActionBroker"];
  for (const name of required) {
    if (!context || !context[name]) {
      throw new TypeError(`createMilksuDailyToolsExtension requires ${name}`);
    }
  }
  const {
    resolveConversation,
    getPolicy,
    approvalBroker,
    workspaceActionBroker,
    pendingWorkspaceCompaction = new Set(),
    inspectUsage = () => ({}),
    observeResearchAction,
    researchSecrets = () => [],
    isResearchActive = () => false,
    workspace = process.cwd(),
  } = context;

  // web 两件：门关工厂原样收集（无会话闭包，定义进程级稳定）。
  const webDefinitions = collectExtensionToolDefinitions(piWebResearchExtension);
  const webTools = webDefinitions.map(definition => defineTool({
    name: definition.name,
    description: String(definition.description ?? definition.name),
    parameters: definition.parameters,
    replay: "safe",
    async execute(args, api, executionContext) {
      return invokePortedDefinition(definition, args, api, executionContext);
    },
  }));
  const webSnippets = webDefinitions
    .filter(definition => typeof definition.promptSnippet === "string" && definition.promptSnippet)
    .map(definition => [definition.name, definition.promptSnippet]);

  // imagegen/archify 注册面原型：与门关同一构造器（description 不依赖会话参数）。
  const prototypeDefinitions = await createCodingToolDefinitions(workspace);
  const imageGenPrototype = prototypeDefinitions.find(
    definition => definition.name === codingImageGenToolName,
  );
  const archifyPrototype = prototypeDefinitions.find(
    definition => definition.name === codingArchifyToolName,
  );
  if (!imageGenPrototype || !archifyPrototype) {
    throw new Error("MilkSU coding tool definitions are missing the imagegen/archify surfaces");
  }

  // workspace 注册面原型 + 按会话解析（工厂闭包按 conversationId 绑定）。
  const workspacePrototypes = collectExtensionToolDefinitions(
    createCodingWorkspaceExtension(
      "",
      () => undefined,
      () => {
        throw new Error("MilkSU prototype workspace tool must not execute");
      },
      () => {
        throw new Error("MilkSU prototype workspace tool must not execute");
      },
      () => ({}),
      undefined,
      () => [],
      () => false,
    ),
  );
  const workspacePrototype = workspacePrototypes.find(
    definition => definition.name === codingWorkspaceToolName,
  );
  if (!workspacePrototype) {
    throw new Error("MilkSU workspace extension did not register milksu_workspace");
  }
  function workspaceDefinitionFor(alias) {
    const definitions = collectExtensionToolDefinitions(
      createCodingWorkspaceExtension(
        alias,
        () => getPolicy(alias),
        request => workspaceActionBroker.request(request),
        id => queueWorkspaceCompaction(pendingWorkspaceCompaction, id),
        id => inspectUsage(id),
        observeResearchAction,
        () => researchSecrets(alias),
        () => isResearchActive(alias),
      ),
    );
    const definition = definitions.find(
      candidate => candidate.name === codingWorkspaceToolName,
    );
    if (!definition) throw missingDefinitionError(codingWorkspaceToolName);
    return definition;
  }

  // imagegen/archify：会话策略的 customTools（门关 createAgentSession 挂的同一批
  // 定义对象）按名取用——ensureRead/ensureMutation、archifyRoot 都是本会话策略
  // 构造时的闭包。
  function customToolDefinitionFor(name, alias) {
    const policy = getPolicy(alias);
    const definition = (Array.isArray(policy?.customTools) ? policy.customTools : [])
      .find(candidate => candidate?.name === name);
    if (!definition || typeof definition.execute !== "function") {
      throw missingDefinitionError(name);
    }
    return definition;
  }

  const sessionBoundTool = (name, prototype, resolveDefinition) => defineTool({
    name,
    description: String(prototype.description ?? name),
    parameters: prototype.parameters,
    ...(replaySafeDailyToolNames.has(name) ? { replay: "safe" } : {}),
    async execute(args, api, executionContext) {
      const alias = resolveConversation(api.conversationId);
      return invokePortedDefinition(resolveDefinition(alias), args, api, executionContext);
    },
  });

  const tools = [
    createAskTool({ resolveConversation, approvalBroker }),
    createProgressTool(),
    ...webTools,
    sessionBoundTool(
      codingWorkspaceToolName,
      workspacePrototype,
      workspaceDefinitionFor,
    ),
    sessionBoundTool(
      codingImageGenToolName,
      imageGenPrototype,
      alias => customToolDefinitionFor(codingImageGenToolName, alias),
    ),
    sessionBoundTool(
      codingArchifyToolName,
      archifyPrototype,
      alias => customToolDefinitionFor(codingArchifyToolName, alias),
    ),
  ];

  const extension = defineExtension({
    name: MILKSU_DAILY_TOOLS_EXTENSION,
    tools,
  });
  // web 工具的 tools 段贡献（门关 promptSnippet 的同一批字符串），
  // 供 milksu-prompt 渲染（非枚举属性，不进 registry 的扩展形状）。
  extension.promptContributions = {
    snippets: new Map(webSnippets),
    guidelines: new Map(),
  };
  return extension;
}

// ---------- capa_analyze（安全工具扩展，按会话目录动态挂载） ----------

/** 会话策略里的 capa 目录描述（normalizeSecurityTools 的产物；无则 undefined）。 */
export function milksuSecurityToolsCapaDescriptor(policy) {
  const tools = Array.isArray(policy?.securityTools) ? policy.securityTools : [];
  return tools.find(tool => tool?.id === "capa") ?? undefined;
}

/** capa 目录指纹（command/args/version）：变化才原位替换挂载面。 */
export function securityToolsMountFingerprint(policy) {
  const capa = milksuSecurityToolsCapaDescriptor(policy);
  if (!capa) return "";
  return JSON.stringify([
    String(capa.command ?? ""),
    Array.isArray(capa.args) ? capa.args : [],
    String(capa.version ?? ""),
  ]);
}

/**
 * 门开路径的安全工具扩展。policy 带 capa 目录时注册 capa_analyze（门关同一
 * 构造器 buildSecurityToolsExtension 的定义：描述嵌 capa 版本）；无 capa 时是
 * 空壳（保持挂载位稳定，供后续按名原位替换）。execute 每次按会话策略重新解析
 * 定义——目录变化即时生效；注册面元数据由 refreshSecurityToolsMount 的指纹
 * 对账刷新（多会话并发不同目录时最后写入者胜出，见交付报告已知限制）。
 */
export function createMilksuSecurityToolsExtension({ resolveConversation, getPolicy, policy }) {
  if (typeof resolveConversation !== "function" || typeof getPolicy !== "function") {
    throw new TypeError("createMilksuSecurityToolsExtension requires the session context");
  }
  const capa = milksuSecurityToolsCapaDescriptor(policy);
  if (!capa) {
    return defineExtension({ name: MILKSU_SECURITY_TOOLS_EXTENSION, tools: [] });
  }
  const securityTools = Array.isArray(policy?.securityTools) ? policy.securityTools : [];
  const registered = collectExtensionToolDefinitions(
    createSecurityToolsExtension(policy.workspace || process.cwd(), securityTools),
  );
  const capaDefinition = registered.find(
    definition => definition.name === capaAnalyzeToolName,
  );
  if (!capaDefinition) {
    throw new Error("MilkSU security tools extension did not register capa_analyze");
  }
  function capaDefinitionFor(alias) {
    const sessionPolicy = getPolicy(alias);
    const descriptors = Array.isArray(sessionPolicy?.securityTools)
      ? sessionPolicy.securityTools
      : [];
    if (!descriptors.some(tool => tool?.id === "capa")) {
      throw new Error("MilkSU capa is not configured for this conversation");
    }
    const definitions = collectExtensionToolDefinitions(
      createSecurityToolsExtension(sessionPolicy.workspace || process.cwd(), descriptors),
    );
    const definition = definitions.find(
      candidate => candidate.name === capaAnalyzeToolName,
    );
    if (!definition) throw missingDefinitionError(capaAnalyzeToolName);
    return definition;
  }
  const tool = defineTool({
    name: capaAnalyzeToolName,
    description: String(capaDefinition.description),
    parameters: capaDefinition.parameters,
    replay: "safe",
    async execute(args, api, executionContext) {
      const alias = resolveConversation(api.conversationId);
      return invokePortedDefinition(capaDefinitionFor(alias), args, api, executionContext);
    },
  });
  return defineExtension({
    name: MILKSU_SECURITY_TOOLS_EXTENSION,
    tools: [tool],
  });
}
