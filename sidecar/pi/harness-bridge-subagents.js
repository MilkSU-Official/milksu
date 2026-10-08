// PR-2 批次 C1：门开路径的子代理·协作工具路（MilkSU 自有 `subagent` 工具全量迁
// Harness，DECISIONS Q6：一步到位）。
//
// 语义事实源是门关路径的 bridge-collaboration.js（builtin 角色 + 外部 CLI +
// worktree 管理的宿主契约）与 bridge.js 对 subagent 工具的投影管线；角色定义本
// 体（提示词/工具集/思考档/外部 CLI 启动器）继续取自钉包的 pi-subagents
// agents/*.md（数据文件，**不加载 pi-subagents 包代码**——它是 pi-coding-agent
// 扩展 API 消费者，跑不进 Harness，见 DECISIONS Q6 注意项）。
//
// 结构（对照 pi-durable README「Abort and Subagents」的产品级范例 397-443 行）：
//   公共底座（C2 异步路面同用，本文件导出面见文尾）：
//     - child 会话 get-or-create：api.commit(tx => { scanConversations({ownerTaskId:
//       api.taskId}) 命中即复用；否则 createConversation({ownership:{kind:"task",
//       taskId}}) + 同 commit 内 configure（工具面/提示词/思考档/cwd/模型）}）——
//       崩溃重跑（replay:"safe"）找回同一 child，不重复创建。
//     - 提交幂等：requestId = `subagent:${api.taskId}`——重启后同一消息不投两次
//       （pi-durable submissionByRequest 幂等）。
//     - api.details({conversationId}) 让 UI 挂到子会话；abort 级联由 pi-durable
//       所有权机制自底向上完成（abort 调用→abort child；调用失败同理）。
//     - 子会话模型继承：child 复制父会话 agent（B1 的 harness 级 Models 机制），
//       角色思考档/调用方 model 覆写走同 commit 的 configure。
//   builtin 角色（scout/researcher/evidence-auditor/reviewer/oracle/delegate/
//   worker）：每个角色 = 一个任务拥有的会话；角色工具集 = 角色 frontmatter
//   `tools` ∩ registry 工具名（configureAgentTools 的按名过滤同款语义，传对象——
//   pi-durable 按对象 .name 归档）；systemPromptMode: replace → 角色 body 作为
//   instructions，inheritProjectContext: true → 追加项目说明。
//   外部 CLI（cursor-agent/claude-code/codex-exec 及 writer 变体）：仍是外部进
//   程——守卫体系平移：guardSubagentSpawn（pi-subagents-spawn.cjs，externalCli 分
//   支剥 provider 环境）+ adapter 环境 allowlist + preflight（binary 解析 +
//   --version/--help 校验 + mtime 缓存）+ 进程组终止（SIGTERM→宽限→SIGKILL）。
//   启动前审批在审判链（harness-bridge-approval subagent 分支，beforeTool 里
//   await approvalBroker，B1 已接线）：外部 CLI 恒 ask，拒绝即零 spawn。
//   worktree：消费面语义照 bridge-collaboration.js——cwd 必须是主工作区或已登
//   记的 writer worktree（validateSubagentInput，审批链已生效），access 分类
//   read-only/workspace/worktree；child 的 agent.cwd 指向请求目录。上限 2 与互
//   斥由 normalizeCodingCollaboration（描述符 1-2 个 writer、按会话 key 派生分
//   支/路径）在 milksu_workspace prepare_coding_worktree 回包时把关。
//
// 与门关的已见变化点（交付报告总表有完整对照）：
//   1. builtin 单发从「默认异步收据 + 后续通知」改为前台等待（PREP §3.3 草图：
//      submit + wait，结果经工具结果回传）；{background:true} 边界保留给 C2。
//   2. builtin child 在 sidecar 进程内跑（无 sandbox-exec 包装）；门关 runner 进
//      程有 OS 沙箱（写限 cwd/tmpdir/agentDir + .git 保护）。
//   3. 角色 frontmatter 里 runner 提供的内部工具（contact_supervisor /
//      watchdog_diff / web 研究工具）在 Harness registry 不存在，按
//      configureAgentTools 同款语义告警后不挂载。
//   4. schedule.*/mission.*/watchdog.*/doctor/validate/refine.show/lane.status/
//      children.list 之外的 pi-subagents 专属管理面在门开路径返回明确的
//      management 通告（C2 已交付异步单发路面 subagent_async 四件；编排面
//      schedule/mission/watchdog/workflow 仍暂缓）。
//
// replay 声明：`subagent` 整体 replay:"safe"——builtin 路靠所有权索引 + requestId
// 幂等；外部 CLI 路靠 run 目录 status.json 的 pid 收养（崩溃重跑发现活着的受管
// 进程就等它收尾，不二次 spawn）。

import {
  spawn as spawnChildProcess,
  spawnSync,
} from "node:child_process";
import { existsSync } from "node:fs";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { configure, defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  codingCollaborationToolName,
  validateSubagentInput,
} from "./bridge-collaboration.js";
import { normalizeSubagentYield } from "./bridge-subagent-yield.js";
import {
  commandForPid,
  isOwnedSubagentCommand,
} from "./pi-subagents-stop.js";
import { guardSubagentSpawn } from "./pi-subagents-spawn.cjs";

const nodeRequire = createRequire(import.meta.url);
const bridgeDirectory = dirname(fileURLToPath(import.meta.url));
const sidecarResourceDirectory = existsSync(join(bridgeDirectory, "skills"))
  ? bridgeDirectory
  : resolve(bridgeDirectory, "..", "..");

export const MILKSU_SUBAGENTS_EXTENSION = "milksu-subagents";

/** C1 挂载的工具名（mountedHarnessToolNames 与对照断言共用）。 */
export const MILKSU_SUBAGENT_TOOL_NAMES = Object.freeze([codingCollaborationToolName]);

// 子代理单发默认超时（pi-subagents config timeoutMs 缺省值，tool schema 注释同源）。
const DEFAULT_SUBAGENT_TIMEOUT_MS = 30 * 60 * 1000;

// ---------- 钉包角色定义（数据面，不加载 pi-subagents 代码） ----------

/**
 * 解析钉包的 pi-subagents 根目录（bridge.js configureSubagentRuntime 的同款布局：
 * 打包形态在 bridge 目录 node_modules 下，开发形态在仓库根；MILKSU_PI_SUBAGENTS_ROOT
 * 显式覆盖优先）。
 */
export function resolveSubagentsPackageRoot(environment = process.env) {
  const override = String(environment.MILKSU_PI_SUBAGENTS_ROOT ?? "").trim();
  if (override) return override;
  const packagedRoot = join(bridgeDirectory, "node_modules", "pi-subagents");
  if (existsSync(join(packagedRoot, "package.json"))) return packagedRoot;
  const developmentRoot = join(sidecarResourceDirectory, "node_modules", "pi-subagents");
  if (existsSync(join(developmentRoot, "package.json"))) return developmentRoot;
  throw new Error(`MilkSU subagent package is unavailable: ${developmentRoot}`);
}

/** 极简 frontmatter 解析：本目录只用平铺标量 + runner 两级缩进块。 */
function parseAgentFrontmatter(text, label) {
  const lines = String(text ?? "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error(`MilkSU bundled agent ${label} is missing frontmatter`);
  }
  const fields = {};
  let nested = undefined;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") {
      return { fields, body: lines.slice(index + 1).join("\n").trim() };
    }
    if (!line.trim()) continue;
    const indented = /^\s+/.test(line);
    const match = /^([A-Za-z][\w.-]*):\s*(.*)$/.exec(line.trim());
    if (!match) {
      throw new Error(`MilkSU bundled agent ${label} has an unsupported frontmatter line: ${line.trim()}`);
    }
    if (!indented) {
      nested = match[2].trim() === "" ? match[1] : undefined;
      fields[match[1]] = match[2].trim();
      continue;
    }
    if (!nested) {
      throw new Error(`MilkSU bundled agent ${label} has an unexpected indented line: ${line.trim()}`);
    }
    fields[nested] = { ...(fields[nested] ?? {}), [match[1]]: match[2].trim() };
  }
  throw new Error(`MilkSU bundled agent ${label} has an unterminated frontmatter block`);
}

function commaList(value) {
  return String(value ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

/**
 * 读取钉包 builtin/外部 CLI 角色定义（agents/*.md）。只读数据文件；目录缺失或
 * 单文件结构异常即抛错（fail fast，对齐 configureSubagentRuntime 的守卫语气）。
 */
export function readBundledAgentDefinitions(environment = process.env) {
  const root = resolveSubagentsPackageRoot(environment);
  const directory = join(root, "agents");
  let entries;
  try {
    entries = nodeRequire("node:fs").readdirSync(directory);
  } catch (error) {
    throw new Error(`MilkSU subagent definitions are unavailable: ${directory} (${error.message})`);
  }
  const definitions = new Map();
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const raw = readFileSync(join(directory, entry), "utf8");
    const { fields, body } = parseAgentFrontmatter(raw, entry);
    const name = String(fields.name ?? "").trim();
    if (!name) throw new Error(`MilkSU bundled agent ${entry} is missing a name`);
    const runner = fields.runner && typeof fields.runner === "object" ? fields.runner : undefined;
    definitions.set(name, Object.freeze({
      name,
      aliases: commaList(fields.aliases),
      description: String(fields.description ?? "").trim(),
      tools: Object.freeze(commaList(fields.tools)),
      thinking: String(fields.thinking ?? "").trim(),
      // C2 增量：frontmatter model 字段（门关 KNOWN_FIELDS 之一；钉包 builtin 定义
      // 本身不带 model，maiRecord 形态的自定义定义用它——工具 arg 覆写优先）。
      model: String(fields.model ?? "").trim(),
      systemPromptMode: String(fields.systemPromptMode ?? "append").trim(),
      inheritProjectContext: String(fields.inheritProjectContext ?? "true").trim() !== "false",
      acceptanceRole: String(fields.acceptanceRole ?? "").trim(),
      defaultContext: String(fields.defaultContext ?? "").trim(),
      externalCli: runner?.type === "external-cli",
      runner: runner
        ? Object.freeze({
          type: String(runner.type ?? "").trim(),
          adapter: String(runner.adapter ?? "").trim(),
          command: String(runner.command ?? "").trim(),
          promptDelivery: String(runner.promptDelivery ?? "").trim(),
        })
        : undefined,
      prompt: body,
    }));
  }
  if (definitions.size === 0) {
    throw new Error(`MilkSU subagent definitions are empty: ${directory}`);
  }
  return definitions;
}

// ---------- 角色 → 子会话工具面（configureAgentTools 的按名过滤同款语义） ----------

const warnedMissingToolNames = new Set();

/**
 * 角色工具集解析：frontmatter `tools` ∩ registry 快照。缺名的面只告警一次
 * （harness-bridge-session configureAgentTools 的同款约定）——门关 runner 的
 * 子会话也只挂 pi 原生 7 件（read/write/edit/bash/grep/find/ls），frontmatter
 * 里的 runner 内部工具（contact_supervisor 等）两边都不可用。
 */
export function resolveRoleToolObjects(roleDefinition, registrySnapshot) {
  const byName = new Map(
    registrySnapshot.tools().map(entry => [entry.tool.name, entry.tool]),
  );
  const tools = [];
  const missing = [];
  for (const name of roleDefinition.tools) {
    const tool = byName.get(name);
    if (tool && !tools.includes(tool)) tools.push(tool);
    else if (!tool) missing.push(name);
  }
  for (const name of missing) {
    if (warnedMissingToolNames.has(name)) continue;
    warnedMissingToolNames.add(name);
    console.warn(
      `MilkSU harness registry has no tool ${name}; the role ${roleDefinition.name} runs without it (see PR-2 C1 report)`,
    );
  }
  return tools;
}

/** 角色 body 提示词 + 项目说明（inheritProjectContext）。 */
export function buildChildInstructions(roleDefinition, projectInstructions) {
  const prompt = roleDefinition.prompt;
  if (!roleDefinition.inheritProjectContext || !projectInstructions) return prompt;
  return `${prompt}\n\n${projectInstructions}`;
}

// ---------- 模型覆写解析（{action:"models"} 给出的 provider/id 口径） ----------

const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * 解析 model 覆写（"provider/id" 或裸 id 唯一命中；":level" 后缀覆写思考档）。
 * 返回 undefined = 继承父会话模型。
 */
export function parseSubagentModelOverride(spec, modelsCollection) {
  const raw = String(spec ?? "").trim();
  if (!raw) return undefined;
  let provider = "";
  let modelId = raw;
  let thinkingLevel = undefined;
  const slash = raw.lastIndexOf("/");
  if (slash > 0) {
    provider = raw.slice(0, slash);
    modelId = raw.slice(slash + 1);
  }
  const colon = modelId.lastIndexOf(":");
  if (colon > 0 && thinkingLevels.has(modelId.slice(colon + 1))) {
    thinkingLevel = modelId.slice(colon + 1);
    modelId = modelId.slice(0, colon);
  }
  const models = modelsCollection?.models ?? modelsCollection;
  if (!models || typeof models.getModel !== "function") {
    throw new Error("MilkSU subagent model override is unavailable: no harness model collection");
  }
  if (provider) {
    const resolved = models.getModel(provider, modelId);
    if (!resolved) throw new Error(`MilkSU subagent model override has no model ${provider}/${modelId}`);
    return { provider, modelId, thinkingLevel };
  }
  const matches = (models.getModels?.() ?? []).filter(model => model?.id === modelId);
  const providers = [...new Set(matches.map(model => model.provider))];
  if (providers.length !== 1) {
    throw new Error(`MilkSU subagent model override requires a unique provider for bare id ${modelId}`);
  }
  return { provider: providers[0], modelId, thinkingLevel };
}

// ---------- 子会话注册表（控制动作 / halt / UI 投影的进程内状态） ----------

/**
 * alias → 子代理运行记录。进程内状态（durable 真相在 ownership 索引与转录里），
 * 崩溃后由 replay 重建。记录形状与 emitSubagentTasks 的任务行对齐。
 */
export function createSubagentChildRegistry() {
  const byAlias = new Map();
  return {
    remember(alias, record) {
      const list = byAlias.get(alias) ?? [];
      const next = list.filter(entry => entry.id !== record.id);
      next.push(record);
      byAlias.set(alias, next);
    },
    list(alias) {
      return [...(byAlias.get(alias) ?? [])];
    },
    find(alias, id) {
      const needle = String(id ?? "").trim();
      const list = this.list(alias);
      if (!needle) return undefined;
      const direct = list.find(entry => (
        entry.id === needle
        || String(entry.conversationId ?? "") === needle
        || (entry.runDirectory ?? "").endsWith(`/${needle}`)
      ));
      if (direct) return direct;
      // 角色 targeted 查找：该角色仅一个 child 时命中（status/steer/stop 的友好
      // 面；门关的 run-id/prefix 语义在 Harness 路由 child 登记 id + 角色名）。
      const byRole = list.filter(entry => entry.role === needle);
      if (byRole.length === 1) return byRole[0];
      return undefined;
    },
    forget(alias) {
      byAlias.delete(alias);
    },
  };
}

// ---------- 外部 CLI 适配器（pi-subagents runs/shared 三个 adapter 的薄壳移植） ----------

const MAX_OUTPUT_TAIL_BYTES = 64 * 1024;
const MAX_ERROR_TAIL_BYTES = 64 * 1024;
const MAX_RAW_LOG_BYTES = 8 * 1024 * 1024;
const MAX_PARSER_LINE_BYTES = 256 * 1024;
const MAX_PARSER_STREAM_BYTES = 32 * 1024 * 1024;
const MAX_PARSER_OUTPUT_BYTES = 1024 * 1024;
const MAX_OVERSIZED_LINE_PREFIX_BYTES = 512;
const MAX_SKIPPABLE_LINE_BYTES = 1024 * 1024;
const MAX_EVENT_TYPE_LENGTH = 128;
const MAX_ERROR_LENGTH = 4096;
const MAX_FINAL_MESSAGE_BYTES = 1024 * 1024;

const CURSOR_AGENT_ENV_ALLOWLIST = [
  "PATH", "HOME", "USERPROFILE", "CURSOR_API_KEY",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR",
];
const CLAUDE_CODE_ENV_ALLOWLIST = [
  "PATH", "HOME", "USERPROFILE", "USER", "LOGNAME", "TMPDIR", "CLAUDE_CONFIG_DIR",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY", "AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK", "GOOGLE_APPLICATION_CREDENTIALS", "CLOUD_ML_REGION",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR",
];
const CODEX_EXEC_ENV_ALLOWLIST = [
  "PATH", "HOME", "USERPROFILE", "CODEX_HOME", "CODEX_API_KEY", "OPENAI_API_KEY",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR",
];

/** external-cli-runner.js buildExternalCliPrompt 的同源实现。 */
export function buildExternalCliPrompt(systemInstructions, task) {
  return `<System instructions>\n${systemInstructions.trim()}\n\n<Task>\n${task}`;
}

/** external-cli-runner.js parseExternalCliJsonlEvent 的同源实现。 */
export function parseExternalCliJsonlEvent(line, label) {
  let value;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(`${label} emitted malformed JSONL: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} emitted a JSONL event that is not an object.`);
  }
  if (typeof value.type !== "string" || !value.type || value.type.length > MAX_EVENT_TYPE_LENGTH) {
    throw new Error(`${label} emitted a JSONL event with an invalid type.`);
  }
  return value;
}

function boundedError(value) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, MAX_ERROR_LENGTH) : undefined;
}

function cursorTerminalError(event) {
  for (const value of [event.result, event.error, event.message]) {
    const text = boundedError(value);
    if (text) return text;
  }
  const subtype = typeof event.subtype === "string" && event.subtype ? event.subtype : "unknown";
  return `Cursor Agent reported terminal result ${subtype}.`;
}

function cursorParser() {
  let terminal;
  return {
    parseLine(line) {
      const event = parseExternalCliJsonlEvent(line, "Cursor Agent");
      if (terminal) throw new Error("Cursor Agent emitted an event after its terminal state.");
      if (event.type === "error") terminal = { state: "failed", error: cursorTerminalError(event) };
      else if (event.type === "result") {
        if (
          event.subtype === "success"
          && event.is_error === false
          && typeof event.result === "string"
          && event.result.trim()
        ) {
          terminal = { state: "completed", output: event.result.trim() };
        } else {
          terminal = { state: "failed", error: cursorTerminalError(event) };
        }
      }
      return { phase: terminal ? terminal.state : "streaming" };
    },
    skipOversizedLine(prefix, byteLength) {
      if (terminal || byteLength > MAX_SKIPPABLE_LINE_BYTES || !/^\s*\{\s*"type"\s*:\s*"tool_call"\s*,/.test(prefix)) {
        return undefined;
      }
      return { phase: "streaming" };
    },
    finish() {
      return terminal;
    },
  };
}

function claudeTerminalError(event) {
  for (const value of [event.error, event.result]) {
    const text = boundedError(value);
    if (text) return text;
  }
  if (Array.isArray(event.errors)) {
    const messages = event.errors.filter(value => typeof value === "string" && value.trim());
    if (messages.length) return messages.join("; ").slice(0, MAX_ERROR_LENGTH);
  }
  const subtype = typeof event.subtype === "string" && event.subtype ? event.subtype : "unknown";
  return `Claude Code reported terminal result ${subtype}.`;
}

function claudeParser() {
  let terminal;
  return {
    parseLine(line) {
      const event = parseExternalCliJsonlEvent(line, "Claude Code");
      if (terminal && event.type === "result") {
        throw new Error("Claude Code emitted a duplicate terminal result.");
      }
      if (!terminal && event.type === "result") {
        if (
          event.subtype === "success"
          && event.is_error === false
          && typeof event.result === "string"
          && event.result.trim()
        ) {
          terminal = { state: "completed", output: event.result.trim() };
        } else {
          terminal = { state: "failed", error: claudeTerminalError(event) };
        }
      }
      return { phase: terminal ? terminal.state : "streaming" };
    },
    skipOversizedLine() {
      return undefined;
    },
    finish() {
      return terminal;
    },
  };
}

function codexEventError(event, fallback) {
  if (typeof event.error === "string" && event.error.trim()) return event.error.trim().slice(0, MAX_ERROR_LENGTH);
  if (event.error && typeof event.error === "object" && !Array.isArray(event.error)) {
    if (typeof event.error.message === "string" && event.error.message.trim()) {
      return event.error.message.trim().slice(0, MAX_ERROR_LENGTH);
    }
  }
  if (typeof event.message === "string" && event.message.trim()) {
    return event.message.trim().slice(0, MAX_ERROR_LENGTH);
  }
  return fallback;
}

function codexParser(finalMessagePath) {
  let terminal;
  return {
    parseLine(line) {
      const event = parseExternalCliJsonlEvent(line, "Codex exec");
      if (terminal) throw new Error("Codex exec emitted an event after its terminal state.");
      if (event.type === "turn.completed") terminal = { state: "completed" };
      else if (event.type === "turn.failed") {
        terminal = { state: "failed", error: codexEventError(event, "Codex exec reported turn.failed.") };
      } else if (event.type === "error") {
        terminal = { state: "failed", error: codexEventError(event, "Codex exec reported an error event.") };
      }
      return { phase: terminal ? terminal.state : "streaming" };
    },
    skipOversizedLine() {
      return undefined;
    },
    finish() {
      if (!terminal || terminal.state === "failed") return terminal;
      let descriptor;
      try {
        descriptor = openSync(finalMessagePath, "r");
      } catch (error) {
        throw new Error(`Codex exec did not write its final-message artifact: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        const stat = fstatSync(descriptor);
        if (!stat.isFile()) throw new Error("Codex exec final-message artifact is not a file.");
        if (stat.size > MAX_FINAL_MESSAGE_BYTES) {
          throw new Error("Codex exec final-message artifact exceeded its byte limit.");
        }
        const content = Buffer.alloc(stat.size);
        let bytesRead = 0;
        while (bytesRead < content.length) {
          const count = readSync(descriptor, content, bytesRead, content.length - bytesRead, bytesRead);
          if (count === 0) break;
          bytesRead += count;
        }
        const text = content.toString("utf8");
        return { state: "completed", output: text.trim() };
      } finally {
        closeSync(descriptor);
      }
    },
  };
}

/**
 * 外部 CLI 启动面（adapter id → 命令行/allowlist/preflight/解析器）。对照
 * pi-subagents cursor-agent-adapter / claude-code-adapter / codex-exec-adapter
 * 的 resolve*Launch：参数逐项同源；command 由角色定义的 runner.command 提供
 * （MilkSU 测试用 PATH 前置的假可执行脚本顶替真 CLI）。
 */
export function resolveExternalCliLaunch(roleDefinition, runDirectory, cwd) {
  const adapter = roleDefinition.runner?.adapter ?? "";
  const command = roleDefinition.runner?.command ?? "";
  const promptDelivery = roleDefinition.runner?.promptDelivery ?? "";
  const stepIndex = 0;
  if (adapter === "cursor-agent" || adapter === "cursor-agent-writer") {
    const writer = adapter === "cursor-agent-writer";
    const promptDirectory = join(runDirectory, `external-${stepIndex}.cursor-prompt`);
    const promptFilePath = join(promptDirectory, "handoff.txt");
    const promptRelative = relative(cwd, promptDirectory);
    const promptOutsideWorkspace = promptRelative.startsWith("..") || isAbsolute(promptRelative);
    const args = [
      "-p",
      "--output-format", "stream-json",
      ...(writer ? [] : ["--mode", "ask"]),
      "--sandbox", "enabled",
      "--workspace", cwd,
      ...(promptOutsideWorkspace ? ["--add-dir", promptDirectory] : []),
      `Read the complete handoff from the private file at ${promptFilePath}. Follow it and return only the final answer.`,
    ];
    return {
      command,
      args,
      promptFilePath,
      promptDelivery: "file",
      temporaryDirectories: [promptDirectory],
      allowlist: CURSOR_AGENT_ENV_ALLOWLIST,
      preflight: {
        id: adapter,
        versionArgs: ["--version"],
        helpArgs: ["--help"],
        validate(result) {
          if (!/^\d{4}\.\d{2}\.\d{2}-[0-9a-f]+$/.test(result.version)) {
            throw new Error(`Unsupported Cursor Agent version response: ${JSON.stringify(result.version)}.`);
          }
          for (const required of [
            "Start the Cursor Agent", "--print", "stream-json", "--sandbox <mode>", "enabled",
            "--workspace <path-or-name>", "--add-dir <path>",
            ...(writer ? ["all tools", "including write and shell"] : ["--mode <mode>", "ask:", "read-only"]),
          ]) {
            if (!result.help.includes(required)) {
              throw new Error(`Cursor Agent help does not document required option ${JSON.stringify(required)}.`);
            }
          }
        },
      },
      parser: cursorParser(),
    };
  }
  if (adapter === "claude-code" || adapter === "claude-code-writer") {
    const writer = adapter === "claude-code-writer";
    const args = [
      "-p",
      "--input-format", "text",
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", writer ? "acceptEdits" : "plan",
      "--tools", writer ? "Read,Write,Edit,Glob,Grep" : "",
      "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}',
      "--setting-sources", "user",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--no-chrome",
    ];
    return {
      command,
      args,
      promptDelivery: promptDelivery === "file" ? "file" : "stdin",
      allowlist: CLAUDE_CODE_ENV_ALLOWLIST,
      preflight: {
        id: adapter,
        versionArgs: ["--version"],
        helpArgs: ["--help"],
        validate(result) {
          if (
            !/^(?:\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)? \(Claude Code\)|\d{4}\.\d{1,2}\.\d{1,2} [A-Za-z0-9._-]+ \(\d{4}-\d{2}-\d{2}\))$/.test(
              result.version,
            )
          ) {
            throw new Error(`Unsupported Claude Code version response: ${JSON.stringify(result.version)}.`);
          }
          for (const required of [
            "Claude Code - starts an interactive session", "--print", "--input-format", "stream-json",
            "--verbose", "--permission-mode", writer ? "acceptEdits" : "plan", "--tools",
            "--strict-mcp-config", "--mcp-config", "--setting-sources", "--no-session-persistence",
            "--disable-slash-commands", "--no-chrome",
          ]) {
            if (!result.help.includes(required)) {
              throw new Error(`Claude Code help does not document required option ${JSON.stringify(required)}.`);
            }
          }
        },
      },
      parser: claudeParser(),
    };
  }
  if (adapter === "codex-exec" || adapter === "codex-exec-writer") {
    const writer = adapter === "codex-exec-writer";
    const finalMessagePath = join(runDirectory, `external-${stepIndex}.final-message.txt`);
    const args = [
      "exec",
      "--json",
      "--color", "never",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "-s", writer ? "workspace-write" : "read-only",
      "-c", 'approval_policy="never"',
      "--output-last-message", finalMessagePath,
      "-",
    ];
    return {
      command,
      args,
      finalOutputPath: finalMessagePath,
      promptDelivery: "stdin",
      allowlist: CODEX_EXEC_ENV_ALLOWLIST,
      preflight: {
        id: adapter,
        versionArgs: ["--version"],
        helpArgs: ["exec", "--help"],
        validate(result) {
          if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(result.version)) {
            throw new Error(`Unsupported Codex version response: ${JSON.stringify(result.version)}.`);
          }
          for (const required of [
            "Run Codex non-interactively", "--json", "--output-last-message", "--ephemeral",
            "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox",
            writer ? "workspace-write" : "read-only", "--config",
          ]) {
            if (!result.help.includes(required)) {
              throw new Error(`Codex exec help does not document required option ${JSON.stringify(required)}.`);
            }
          }
        },
      },
      parser: codexParser(finalMessagePath),
    };
  }
  throw new Error(`MilkSU rejected unsupported external CLI runner "${adapter}" for ${roleDefinition.name}`);
}

// ---------- 外部 CLI preflight（external-cli-preflight.js 的薄壳移植） ----------

const MAX_PROBE_OUTPUT_BYTES = 256 * 1024;
const MAX_PROBE_TIMEOUT_MS = 5000;
const MAX_PREFLIGHT_CACHE_ENTRIES = 64;
const preflightCache = new Map();
const preflightLookup = new Map();

function resolveBinaryPath(command, env) {
  if (isAbsolute(command) || command.includes("/")) {
    const resolved = resolve(command);
    nodeRequire("node:fs").accessSync(resolved, nodeRequire("node:fs").constants.X_OK);
    return resolved;
  }
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const directory of (env.PATH ?? "").split(nodeRequire("node:path").delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        nodeRequire("node:fs").accessSync(candidate, nodeRequire("node:fs").constants.X_OK);
        return nodeRequire("node:fs").realpathSync(candidate);
      } catch {
        // Try the next directory.
      }
    }
  }
  throw new Error(`External CLI binary '${command}' was not found on PATH.`);
}

function probeWithTimeout(binaryPath, args, env, label, cwd) {
  const result = spawnSync(binaryPath, [...args], {
    cwd,
    env,
    encoding: "utf8",
    killSignal: "SIGKILL",
    maxBuffer: MAX_PROBE_OUTPUT_BYTES,
    timeout: MAX_PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`External CLI ${label} preflight failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`External CLI ${label} preflight exited with code ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function preflightSpecKey(spec) {
  return JSON.stringify([spec.id, spec.versionArgs, spec.helpArgs]);
}

/** 与 external-cli-preflight 同款：binary 解析 + version/help 探测 + mtime 缓存。 */
export function preflightExternalCli(command, spec, env, cwd) {
  const binaryPath = resolveBinaryPath(command, env);
  const binaryMtimeMs = nodeRequire("node:fs").statSync(binaryPath).mtimeMs;
  const lookupKey = JSON.stringify([binaryPath, binaryMtimeMs, preflightSpecKey(spec)]);
  const cachedKey = preflightLookup.get(lookupKey);
  const cached = cachedKey ? preflightCache.get(cachedKey) : undefined;
  const base = cached ?? {
    binaryPath,
    binaryMtimeMs,
    version: probeWithTimeout(binaryPath, spec.versionArgs, env, "version", cwd),
    help: probeWithTimeout(binaryPath, spec.helpArgs, env, "help", cwd),
  };
  const result = { ...base, cacheHit: Boolean(cached) };
  spec.validate?.(result);
  if (!cached) {
    const cacheKey = JSON.stringify([binaryPath, base.version, binaryMtimeMs, preflightSpecKey(spec)]);
    preflightCache.set(cacheKey, base);
    preflightLookup.set(lookupKey, cacheKey);
    while (preflightCache.size > MAX_PREFLIGHT_CACHE_ENTRIES) {
      const oldest = preflightCache.keys().next().value;
      preflightCache.delete(oldest);
      for (const [candidateLookup, candidateCache] of preflightLookup) {
        if (candidateCache === oldest) preflightLookup.delete(candidateLookup);
      }
    }
  }
  return result;
}

export function clearExternalCliPreflightCacheForTests() {
  preflightCache.clear();
  preflightLookup.clear();
}

// ---------- 外部 CLI 进程终止（owned-process-tree + pi-subagents-stop 的同源语义） ----------

const TERM_GRACE_MS = 2000;
const KILL_VERIFY_MS = 1000;

function signalProcess(id, signal) {
  try {
    process.kill(id, signal);
    return "sent";
  } catch (error) {
    if (error?.code === "ESRCH") return "absent";
    return { diagnostic: error instanceof Error ? error.message : String(error) };
  }
}

function processGroupMembers(processGroupId) {
  const result = spawnSync("ps", ["-axo", "pid=,pgid=,stat="], { encoding: "utf8" });
  if (result.error || result.status !== 0) return undefined;
  const members = [];
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line);
    if (!match || Number(match[2]) !== processGroupId || match[3].startsWith("Z")) continue;
    members.push(Number(match[1]));
  }
  return members;
}

async function waitUntilGroupTerminal(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const members = processGroupMembers(processGroupId);
    if (members && members.length === 0) return false;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return true;
    await new Promise(resolveParam => setTimeout(resolveParam, Math.min(25, remaining)));
  }
}

/** posix 进程组终止：SIGTERM(-pgid) → 宽限 → SIGKILL → 验证（owned-process-tree 同款）。 */
export async function terminateExternalCliProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  const target = -pid;
  const term = signalProcess(target, "SIGTERM");
  if (term !== "sent" && term !== "absent") return;
  const termExit = await waitUntilGroupTerminal(pid, TERM_GRACE_MS);
  if (termExit === false) return;
  signalProcess(target, "SIGKILL");
  await waitUntilGroupTerminal(pid, KILL_VERIFY_MS);
}

// ---------- 外部 CLI 执行主体（external-cli-runner.js runExternalCli 的薄壳） ----------

function fileTail(path, maxBytes) {
  try {
    const stat = nodeRequire("node:fs").statSync(path);
    if (!stat.isFile()) return "";
    const descriptor = openSync(path, "r");
    try {
      const size = Math.min(stat.size, maxBytes);
      const start = stat.size - size;
      const content = Buffer.alloc(size);
      let bytesRead = 0;
      while (bytesRead < content.length) {
        const count = readSync(descriptor, content, bytesRead, content.length - bytesRead, start + bytesRead);
        if (count === 0) break;
        bytesRead += count;
      }
      return content.toString("utf8");
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return "";
  }
}

function externalCliEnvironment(allowlist, environment) {
  const allowed = new Set(allowlist);
  const env = {};
  for (const key of allowed) {
    if (!key || key.includes("=") || key.includes("\0")) {
      throw new Error(`Invalid external CLI environment key: ${JSON.stringify(key)}.`);
    }
    if (environment[key] !== undefined) env[key] = environment[key];
  }
  return env;
}

/**
 * 终态解析：从 stdout 日志文件按 external-cli-runner 的行/流/输出限额过解析器。
 * 崩溃收养路径（replayExternalCliOutcome）复用同一函数。
 */
export function parseExternalCliLog(launch, logPath) {
  let parserBytes = 0;
  let parserError;
  let parserTerminal;
  const parser = launch.parser;
  const fail = error => {
    if (!parserError) parserError = error instanceof Error ? error : new Error(String(error));
  };
  try {
    const stat = nodeRequire("node:fs").statSync(logPath);
    const content = stat.size > MAX_RAW_LOG_BYTES
      ? fileTail(logPath, MAX_RAW_LOG_BYTES)
      : readFileSync(logPath, "utf8");
    for (const line of content.split("\n")) {
      const raw = Buffer.from(line, "utf8");
      parserBytes += raw.length;
      if (parserBytes > MAX_PARSER_STREAM_BYTES) {
        fail(new Error("External CLI parser stream exceeded its byte limit."));
        break;
      }
      if (raw.length > MAX_PARSER_LINE_BYTES) {
        const progress = parser.skipOversizedLine?.(
          raw.subarray(0, MAX_OVERSIZED_LINE_PREFIX_BYTES).toString("utf8"),
          raw.length,
        );
        if (!progress) {
          fail(new Error("External CLI parser line exceeded its byte limit."));
          break;
        }
        continue;
      }
      if (!line.trim()) continue;
      parser.parseLine(line);
    }
    if (!parserError) {
      parserTerminal = parser.finish();
      if (!parserTerminal) {
        fail(new Error("External CLI parser did not produce a terminal state."));
      } else if (Buffer.byteLength(parserTerminal.output ?? "", "utf8") > MAX_PARSER_OUTPUT_BYTES) {
        fail(new Error("External CLI parser terminal output exceeded its byte limit."));
      }
    }
  } catch (error) {
    fail(error);
  }
  return { parserError, parserTerminal };
}

/**
 * 执行一次外部 CLI。与 runExternalCli 的关键差异（外部进程仍受全量守卫）：
 *   - stdout/stderr 走日志文件 fd（门关 spawnRunner 的 stdoutFd/stderrFd 同款）——
 *     CLI 不挂在 sidecar 的管道上，sidecar 崩溃后进程照常写日志，重开时按
 *     run 目录收养（见 adoptedExternalCliRun）；
 *   - 解析在进程退出后对日志文件进行（fresh 路与崩溃收养路同一函数）；
 *   - 超时/停止 = 进程组 SIGTERM→宽限→SIGKILL（owned-process-tree 同款）；
 *   - stdin 仍走管道：promptDelivery:file 的 CLI 不读 stdin；stdin 型 CLI 在
 *     sidecar 崩溃后读到 EOF 自然收尾。
 */
export async function runGuardedExternalCli({
  launch,
  prompt,
  cwd,
  runDirectory,
  environment,
  timeoutMs,
  abortSignal,
  onPid,
}) {
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  const stdoutPath = join(runDirectory, "external-0.stdout.log");
  const stderrPath = join(runDirectory, "external-0.stderr.log");
  const createdDirectories = [];
  let promptFileCreated = false;
  let stdoutDescriptor;
  let stderrDescriptor;
  let child;
  let preflight;
  const cleanupTemporaryPaths = () => {
    if (launch.promptFilePath && promptFileCreated) rmSync(launch.promptFilePath, { force: true });
    for (const directory of createdDirectories.reverse()) rmSync(directory, { recursive: true, force: true });
  };
  try {
    const env = externalCliEnvironment(launch.allowlist, environment);
    preflight = preflightExternalCli(launch.command, launch.preflight, env, cwd);
    for (const directory of launch.temporaryDirectories ?? []) {
      // 只在真要 spawn 前清掉上次崩溃残留的 prompt 目录（收养路径不走这里）。
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { mode: 0o700 });
      createdDirectories.push(directory);
    }
    if (launch.finalOutputPath) {
      // 只在真要 spawn 前清掉上次崩溃残留（收养路径不能动它）。
      rmSync(launch.finalOutputPath, { force: true });
    }
    if (launch.promptFilePath) {
      const descriptor = openSync(launch.promptFilePath, "wx", 0o600);
      promptFileCreated = true;
      try {
        writeFileSync(descriptor, prompt, { encoding: "utf8" });
      } finally {
        closeSync(descriptor);
      }
    }
    stdoutDescriptor = openSync(stdoutPath, "a");
    stderrDescriptor = openSync(stderrPath, "a");
    const guarded = guardSubagentSpawn({
      command: preflight.binaryPath,
      args: launch.args,
      env,
      cwd,
      externalCli: true,
    });
    child = spawnChildProcess(guarded.command, guarded.args, {
      cwd: guarded.cwd,
      env: guarded.env,
      stdio: ["pipe", stdoutDescriptor, stderrDescriptor],
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
  } catch (error) {
    for (const descriptor of [stdoutDescriptor, stderrDescriptor]) {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    try {
      cleanupTemporaryPaths();
    } catch {
      // 启动失败时的清理尽力而为。
    }
    return {
      output: "",
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error),
      processSignal: null,
      pid: undefined,
      stdoutPath,
      stderrPath,
    };
  }

  const pid = typeof child.pid === "number" ? child.pid : undefined;
  onPid?.(pid);
  let timedOut = false;
  let stopped = false;
  let termination;
  let spawnError;
  const terminate = reason => {
    if (timedOut || stopped) return;
    timedOut = reason === "timeout";
    stopped = reason === "stop";
    if (pid !== undefined) termination = terminateExternalCliProcess(pid);
  };
  const timeoutTimer = timeoutMs > 0
    ? setTimeout(() => terminate("timeout"), timeoutMs)
    : undefined;
  timeoutTimer?.unref?.();
  const onAbort = () => terminate("stop");
  abortSignal?.addEventListener("abort", onAbort, { once: true });
  child.stdin.on("error", () => {});
  child.stdin.end(launch.promptFilePath ? undefined : prompt);
  child.once("error", error => {
    spawnError = error;
  });
  const closed = new Promise(resolveParam => {
    child.once("close", (exitCode, signal) => resolveParam({ exitCode, signal }));
  });
  const { exitCode, signal } = await closed;
  if (timeoutTimer) clearTimeout(timeoutTimer);
  abortSignal?.removeEventListener("abort", onAbort);
  if (termination) await termination.catch(() => undefined);
  for (const descriptor of [stdoutDescriptor, stderrDescriptor]) {
    closeSync(descriptor);
  }
  const { parserError, parserTerminal } = parseExternalCliLog(launch, stdoutPath);
  const stderr = fileTail(stderrPath, MAX_ERROR_TAIL_BYTES).trim();
  const parserFailure = parserError?.message
    ?? (parserTerminal?.state === "failed"
      ? parserTerminal.error ?? "External CLI parser reported terminal failure."
      : undefined);
  const error = stopped
    ? "Subagent stopped by user."
    : timedOut
      ? "Subagent timed out."
      : spawnError?.message ?? parserFailure ?? (exitCode === 0 ? undefined : stderr || `External CLI exited with code ${exitCode}.`);
  try {
    cleanupTemporaryPaths();
  } catch {
    // 结果已收集；临时文件清理失败不改变结果。
  }
  return {
    output: (!parserError && parserTerminal?.state === "completed"
      ? parserTerminal.output ?? ""
      : fileTail(stdoutPath, MAX_OUTPUT_TAIL_BYTES)).trim(),
    exitCode: timedOut || stopped || spawnError || parserFailure ? 1 : exitCode,
    ...(error ? { error } : {}),
    ...(timedOut ? { timedOut: true } : {}),
    ...(stopped ? { stopped: true } : {}),
    processSignal: signal,
    pid,
    stdoutPath,
    stderrPath,
    ...(launch.finalOutputPath ? { finalOutputPath: launch.finalOutputPath } : {}),
  };
}

/** 重跑收养判定：run 目录 status.json 里记录的 pid 是否仍活着且命令受管。 */
export function adoptedExternalCliRun(runDirectory) {
  try {
    const status = JSON.parse(readFileSync(join(runDirectory, "status.json"), "utf8"));
    const pid = Number(status?.pid);
    if (!Number.isInteger(pid) || pid <= 1) return undefined;
    if (mapAsyncState(status.state) !== "running") return undefined;
    const command = commandForPid(pid);
    if (!isOwnedSubagentCommand(command, "external")) return undefined;
    return { pid, status };
  } catch {
    return undefined;
  }
}

function mapAsyncState(state) {
  const value = String(state ?? "").trim().toLowerCase();
  if (!value || ["queued", "running", "paused", "starting", "pending", "scheduled"].includes(value)) {
    return "running";
  }
  if (["success", "succeeded", "complete", "completed", "done"].includes(value)) return "succeeded";
  return "failed";
}

async function waitForPidExit(pid, timeoutMs = 30 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise(resolveParam => setTimeout(resolveParam, 200));
  }
}

// ---------- 子代理工具 ----------

// 门关 registerTool 的参数面（pi-subagents schemas.js SubagentParamProperties）是
// 全可选 + 开放对象；MilkSU 契约层（validateSubagentInput）才是真正的门。这里保
// 留模型可见的关键字段描述，schema 开放度与门关一致（additionalProperties 放行）。
const subagentParameters = Type.Object({
  agent: Type.Optional(Type.String({ description: "One-child agent or management target." })),
  task: Type.Optional(Type.String({ description: "One-child task; requires agent." })),
  action: Type.Optional(Type.String({ minLength: 1, description: "Management/control only; omit for execution." })),
  capabilities: Type.Optional(Type.Boolean({ description: "list: compact capability rows without system prompts." })),
  id: Type.Optional(Type.String({ description: "Run id/prefix for status/control." })),
  runId: Type.Optional(Type.String({ description: "Target run ID; prefer id." })),
  message: Type.Optional(Type.String({ description: "resume/steer guidance." })),
  mode: Type.Optional(Type.String({ enum: ["steer", "follow_up", "auto"], description: "steer delivery mode." })),
  view: Type.Optional(Type.String({ enum: ["fleet", "transcript"], description: "status view." })),
  lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  cwd: Type.Optional(Type.String({ description: "Execution directory." })),
  model: Type.Optional(Type.String({ description: "Child model provider/id; bare id only if unique. Suffix :off/minimal/low/medium/high/xhigh/max overrides the thinking default." })),
  async: Type.Optional(Type.Boolean({ description: "Background; default asyncByDefault. false only to block parent." })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Foreground and single async runs use config timeoutMs, else 30m." })),
  maxRuntimeMs: Type.Optional(Type.Integer({ minimum: 1, description: "Alias timeoutMs (same defaults)." })),
});

// 门关工具描述逐字节拷贝（pi-subagents extension/tool-description.js
// FULL_SUBAGENT_TOOL_DESCRIPTION，toolDescriptionMode 默认 "full"、全部特性开启）。
const SUBAGENT_TOOL_DESCRIPTION = [
  "Delegate one child with {agent,task?}; otherwise set exactly one workflow source, with optional args.",
  "Workflow script: write it as one ```js workflow block in this reply, then call subagent({workflow:true,...}). workflow:'./path.js' (any value with '/') loads a file from request cwd; other strings name a resource.",
  "agent/task exclude workflow; task excludes action. agent may target management actions. action is management/control; validate accepts workflow:true or a path without launching.",
  "Scripts: JavaScript statement bodies with explicit return, top-level await, plain helpers/Promise chains; nested async function/arrow/method helpers are rejected. Await runs.run('key',{agent,task}) before .output; await runs.all([{key,agent,task},...]) for an ordered array, not a key map. Observe every stored run promise with direct await, Promise.race or Promise.all. Await/return runs.steer(key,message,options?) for a prior key, never raw run ids; queued/delivered/missed/failed receipts are not compliance proof.",
  "Before advanced orchestration (runs.lanes, rolling fanout, mission state, handoffs), read {action:\"guide\",topic:\"workflows\"} or the pi-subagents skill. Raw-script sandboxes add deeply frozen args; all sandboxes provide runs, emit, console, JavaScript and enabled mission state, with no filesystem/shell/Pi tools/host globals. External CLI agents support native options only when their runner declares them; read guide tool-reference before passing model, structured output, acceptance/agentContract, tool budget, fast, fork context or skills/tools.",
  "Model override: first call {action:\"models\"}; copy exact provider/id, not agent names. Thinking uses model suffix, not watchdog-only thinking.",
  "Named resources: {workflow:'review',args:{task:'...'}} or {workflow:'run-ci',args:{command:'npm test'}}. Raw scripts also accept bounded plain-data args; raw-script args persist as evidence, so never include secrets. worktree:true requires clean source; baseRef defaults to HEAD at allocation or a supported named ref, never full 40/64-character commit IDs or revision expressions.",
  "",
  "SAFETY-CRITICAL SUBAGENT GUIDANCE:",
  "• Direct parent execution is the default. Invoke subagents only when delegation is authorized by the operator's current request or applicable user/project instructions; task size, complexity, risk, tool-call count, or recipe fit do not independently authorize delegation.",
  "• First call {action:\"list\",capabilities:true}: executable, non-disabled agents only; external-cli requires runner.available === true. Passive PATH/PATHEXT/X_OK is not authentication/version/launch proof; preflight is authoritative.",
  "• Workflow, child launch, prompt runtime, extension load or child tooling failure is a lane infrastructure blocker. Stop; report exact failure, run/status and repo/cwd/worktree/branch/ref; verify clean worktree or capture partial diff before same-protocol retry or asking the owner. Never silently switch to interactive_shell, pi -ne, Codex/Claude/Cursor CLI or foreground/external mode: governed-workflow fallback requires explicit owner approval, not Pi Core's generic pi -ne hint. Explicit foreground/CLI requests and work outside that protocol remain valid.",
  "• Omit action for execution. For an authorized delegated multi-step/parallel workflow: exactly one top-level subagent workflow call with async:true; children launch only inside it.",
  "• Async follows asyncByDefault (normally true); async:false only to block the parent, not for final reviews/gates. Consume results at dependency barriers. Native async completion wakes this session: return control, no sleep/poll or bg_wait merely for a wake. bg_wait is for provider/detached work without native notification needing a same-turn result.",
  "• Ordinary child subagents are not orchestrators; only configured fanout within depth/session limits. For an authorized delegated workflow, keep one writer per cwd/worktree and isolate concurrent writers. Use fresh-context read-only reviewers when independent review was requested, then parent synthesis/fixes. Oracle/advisor unknowns use supervisor dialogue; one-shot only when requested.",
  "• Bind durable output on runs.run/runs.all, not task filename prose; return actual outputReference/outputPathMapping/artifactPaths, evidence and residual risks.",
  "• children.list is workflow-only, not an exhaustive list of direct native children: resume only resumable rows. When an intended child's exact run id is known, inspect it with {action:\"status\",id}; if status identifies the candidate, attempt {action:\"resume\",id,message}. Resume authoritatively checks eligibility, may reject it, and otherwise detaches a follow-up/challenge with the stored agent/model/tool contract. Use a labeled same-role fallback only when no known candidate exists or resume rejects eligibility. Scripts await runs.run(newKey,{resume:runId,task}); continue from latest returned runId. Each distinct resume pass needs a new stable key; same-key reuse requires identical launch parameters.",
  "• Named resources own authority; raw scripts (workflow:true or a path) cannot use runs.host. Granted commands/relative outputs use workflow cwd, never per-step cwd.",
  "• Inspect asyncId/asyncDir (status.json, events.jsonl, logs) with status/debug.run; control with interrupt/stop/resume/steer. Read {action:\"guide\",topic:\"tool-reference\"} for controls/evidence gates.",
  "",
  "WORKFLOW DETAILS:",
  "• runs.lanes([{key,stages:[{key,agent,task},{key,resume:'previous',task}]}]) runs first stages together, later stages sequentially per lane. Failures stay lane-local; only explicit structuredOutput.verdict === 'blocked' blocks a successful stage, never reviewer prose.",
  "• Workflow child controls default onto runs.run/runs.all items; child fields override them. worktree:true isolates each child and returns handoff artifacts. usageBudget is shared across the workflow; already-running children are not stopped.",
  "• Missions auto-attach unless mission:false; await state.get(key)/state.set(key,JSONValue) requires a mission. See guide topic missions. Omit acceptance for reviewer/read-only calls; acceptance.review.required requests independent writer review.",
  "• Management discovery: list/get/models/guide; create/update/delete/eject/disable/enable/reset/refine; mission.*, schedule.*, watchdog.*, inspector.*, project.*, lane.status/recordMerge/recordSupersession; worktree.discard and plan-only worktree.cleanup; doctor and grant-spawn-budget. Use guide topics agents, missions, observability, tool-reference, configuration, models, watchdog or extension-api for exact action fields. Schedules take script inputs, not direct children; recipes live in the missions guide.",
].join("\n");

const SUBAGENT_PROMPT_SNIPPET = "For operator-requested delegation, use subagents; compose multi-child work in one workflow call.";
const SUBAGENT_PROMPT_GUIDELINES = [
  "Do not invoke subagents unless the operator requested delegation directly or through applicable instructions.",
];

const MAX_ADVERTISED_AGENTS = 16;
const MAX_CATALOG_BYTES = 12288;
const MAX_DESCRIPTION_BYTES = 512;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function catalogDescription(description) {
  let text = String(description ?? "").replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (Buffer.byteLength(text, "utf8") > MAX_DESCRIPTION_BYTES) {
    text = Buffer.from(text, "utf8").subarray(0, MAX_DESCRIPTION_BYTES - 3).toString("utf8").replace(/\uFFFD$/u, "").trimEnd() + "…";
  }
  return escapeXml(text);
}

/** 广告目录（advertised-agent-prompt.js 的同款渲染，只收钉包定义）。 */
export function buildAdvertisedAgentCatalog(definitions) {
  const advertised = [...definitions.values()]
    .filter(definition => !definition.name.includes("/"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_ADVERTISED_AGENTS);
  if (!advertised.length) return undefined;
  const renderBody = entries => [
    "The following file-defined subagents opted into discovery. Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed. Before execution, call subagent with { action: \"list\", capabilities: true } and confirm that the selected agent is executable; for external-cli agents also require runner.available === true.",
    ...entries,
    ...(advertised.length > entries.length ? [`  <omitted count="${advertised.length - entries.length}" />`] : []),
  ].join("\n");
  const wrap = body => `<advertised_subagents>\n${body}\n</advertised_subagents>`;
  const entries = [];
  for (const definition of advertised) {
    const entry = [
      "  <subagent>",
      `    <name>${escapeXml(definition.name)}</name>`,
      `    <description>${catalogDescription(definition.description)}</description>`,
      "  </subagent>",
    ].join("\n");
    if (Buffer.byteLength(wrap(renderBody([...entries, entry])), "utf8") <= MAX_CATALOG_BYTES) {
      entries.push(entry);
    }
  }
  return renderBody(entries);
}

function textBlocks(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block?.type === "text")
    .map(block => String(block?.text ?? ""))
    .join("");
}

/** 子会话转录 → 答案文本 + 写过的文件（成功 write/edit 调用路径，上限 32）。 */
async function summarizeChildConversation(childId, answerEntryId, api, context) {
  const answer = await api.commit(async (tx) => {
    if (answerEntryId !== undefined) {
      const entry = await tx.entry(answerEntryId);
      const message = (entry?.model ?? []).find(candidate => candidate?.role === "assistant");
      if (message) return textBlocks(message).trim();
    }
    return undefined;
  }, context);
  const page = await api.commit(
    tx => tx.scanEntries({ conversationId: childId }, 80),
    context,
  );
  const successful = new Set();
  const writePaths = [];
  const items = [...(page?.items ?? [])].reverse();
  for (const entry of items) {
    for (const message of entry?.model ?? []) {
      if (message?.role === "toolResult" && message.isError === false && typeof message.toolCallId === "string") {
        successful.add(message.toolCallId);
      }
    }
  }
  for (const entry of items) {
    for (const message of entry?.model ?? []) {
      if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (
          block?.type === "toolCall"
          && (block.name === "write" || block.name === "edit")
          && successful.has(block.id)
          && block.arguments
          && typeof block.arguments.path === "string"
          && !writePaths.includes(block.arguments.path)
        ) {
          writePaths.push(block.arguments.path);
        }
      }
    }
  }
  return { answer, files: writePaths.slice(0, 32) };
}

function childYield(status, request, files, exitCode) {
  const worktree = request.worktree;
  return {
    status,
    ...(worktree ? { worktreeId: worktree.id } : { cwd: request.cwd }),
    files,
    findings: [],
    exitCode,
    agent: request.agent,
  };
}

// 门开路径不承载的 pi-subagents 专属管理面（异步路面/编排面归 C2）。
const deferredManagementActions = new Set([
  "doctor", "validate", "guide",
  "schedule.list", "schedule.show", "schedule.history",
  "mission.list", "mission.show",
  "watchdog.status", "watchdog.check", "watchdog.recommend-model",
  "refine.show", "lane.status",
]);

function managementResult(lines) {
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    details: { mode: "management" },
  };
}

async function childConversationBusy(handle, childId) {
  try {
    const conversation = await handle.harness.conversation(childId, BACKGROUND_CONTEXT);
    if (!conversation) return undefined;
    const state = await conversation.viewState(BACKGROUND_CONTEXT);
    try {
      return Boolean(state?.value?.docs?.["pi.live"]?.run);
    } finally {
      state?.dispose?.();
    }
  } catch {
    return undefined;
  }
}

/**
 * 构造门开路径的子代理扩展。context（来自 harness-bridge-session 的会话层）：
 *   resolveConversation   durable conversationId → MilkSU conversationId
 *   getPolicy             alias → 会话策略（workspace/codingCollaboration）
 *   getProjectInstructions () → 项目说明文本（child inheritProjectContext）
 *   modelsCollection      () → harness 级 Models 集合（model 覆写解析）
 *   getHarnessHandle      () → 适配层 handle（子会话观察面 .harness）
 *   agentDirectory        () → harness agentDir（外部 CLI run 目录根）
 *   childRegistry         createSubagentChildRegistry() 的实例
 *   updateSubagentTasks   (alias, currentTasks => nextTasks)——emitSubagentTasks
 *                         的更新面（roster 收尾行由 execute 精确给出，事件层的
 *                         tool_execution_end 只兜底仍处 start 态的行）
 *   environment           进程环境（外部 CLI env 构造）
 *   subagentTaskTimeoutMs () → 单发默认超时（测试可覆写；缺省 30m）
 */
export function createMilksuSubagentsExtension(context) {
  const required = [
    "resolveConversation",
    "getPolicy",
    "getProjectInstructions",
    "modelsCollection",
    "getHarnessHandle",
    "agentDirectory",
  ];
  for (const name of required) {
    if (!context || typeof context[name] !== "function") {
      throw new TypeError(`createMilksuSubagentsExtension requires ${name}`);
    }
  }
  if (!context?.childRegistry || typeof context.childRegistry.list !== "function") {
    throw new TypeError("createMilksuSubagentsExtension requires childRegistry");
  }
  const {
    resolveConversation,
    getPolicy,
    getProjectInstructions,
    modelsCollection,
    getHarnessHandle,
    agentDirectory,
    childRegistry,
    updateSubagentTasks,
    environment = process.env,
    subagentTaskTimeoutMs = () => DEFAULT_SUBAGENT_TIMEOUT_MS,
  } = context;
  const definitions = readBundledAgentDefinitions(environment);

  function roleDefinition(agent) {
    const direct = definitions.get(String(agent ?? "").trim());
    if (direct) return direct;
    for (const definition of definitions.values()) {
      if (definition.aliases.includes(String(agent ?? "").trim())) return definition;
    }
    throw new Error(`MilkSU rejected unsupported bundled subagent "${agent}"`);
  }

/**
 * roster 收尾行（对照 bridge-subagent-yield projectSubagentRosterEnd 的单发行
 * 形状）：由 execute 精确给出 status/yield/summary——事件层的 live-details 读取
 * 在「本轮最后一个工具」场景会被 endRun 的同提交清场，靠它兜底有竞态。
 */
function emitSubagentRosterEnd(api, request, outcome) {
  const alias = resolveConversation(api.conversationId);
  const policy = getPolicy(alias);
  const worktrees = policy?.codingCollaboration?.worktrees ?? [];
  const yieldValue = (() => {
    try {
      return normalizeSubagentYield(
        childYield(outcome.status, request, outcome.files, outcome.exitCode),
        {
          workspace: policy?.workspace,
          worktrees,
          role: request.agent,
        },
      );
    } catch {
      // 门关 createSubagentYieldExtension 的 catch 同款：坏 yield 按 failed 收场，
      // 不让投影异常吃掉工具结果。
      return {
        status: "failed",
        cwd: policy?.workspace ?? ".",
        files: [],
        findings: [],
        exitCode: 1,
      };
    }
  })();
  const row = {
    id: api.callId,
    toolCallId: api.callId,
    role: request.agent,
    prompt: request.task,
    cwd: request.worktree ? request.worktree.id : undefined,
    status: outcome.status,
    durationMs: outcome.durationMs,
    exitCode: outcome.exitCode,
    yield: yieldValue,
    ...(outcome.summary ? { summary: outcome.summary } : {}),
  };
  updateSubagentTasks(alias, current => [
    ...(Array.isArray(current) ? current : []).filter(task => task.toolCallId !== api.callId),
    row,
  ]);
}


  async function runBuiltinRole(args, api, context) {
    const request = args.request;
    const startedAt = Date.now();
    const role = roleDefinition(request.agent);
    if (role.externalCli) {
      throw new Error(`MilkSU routes ${request.agent} through the external CLI runner`);
    }
    // 子会话工具面：角色 frontmatter tools ∩ registry（configureAgentTools 同款）。
    const tools = resolveRoleToolObjects(role, api.registry);
    const modelOverride = parseSubagentModelOverride(args.model, modelsCollection());
    const change = {
      tools,
      instructions: buildChildInstructions(role, getProjectInstructions()),
      cwd: request.cwd,
      extensions: {
        remove: [
          api.registry.extension("milksu-prompt"),
          api.registry.extension("milksu-skills"),
          api.registry.extension(MILKSU_SUBAGENTS_EXTENSION),
        ].filter(Boolean),
      },
    };
    if (role.thinking && thinkingLevels.has(role.thinking)) change.thinkingLevel = role.thinking;
    if (modelOverride) {
      change.model = { provider: modelOverride.provider, modelId: modelOverride.modelId };
      if (modelOverride.thinkingLevel) change.thinkingLevel = modelOverride.thinkingLevel;
    }
    // 公共底座：get-or-create（所有权索引）+ 同 commit configure。oracle 一类
    // defaultContext: fork 的角色在首建时 fork 父会话的当前转录（门关
    // resolveAgentDefaultContextPolicy 的「持久父会话优先 fork」语义；重跑走
    // 所有权索引复用，不会二次 fork）。
    const childId = await api.commit(async (tx) => {
      const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
      if (existing !== undefined) return existing.id;
      let created;
      if (role.defaultContext === "fork") {
        const parentPage = await tx.scanEntries({ conversationId: api.conversationId }, 1);
        const forkAt = parentPage?.items?.[0]?.id;
        created = forkAt !== undefined
          ? await tx.forkConversation(api.conversationId, forkAt, {
            ownership: { kind: "task", taskId: api.taskId },
          })
          : await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
      } else {
        created = await tx.createConversation({
          ownership: { kind: "task", taskId: api.taskId },
        });
      }
      await configure(tx, created.id, change);
      return created.id;
    }, context);
    await api.details({ conversationId: childId, agent: request.agent }, context);
    childRegistry.remember(resolveConversation(api.conversationId), {
      id: api.callId,
      toolCallId: api.callId,
      conversationId: childId,
      role: request.agent,
      prompt: request.task,
      cwd: request.worktree ? request.worktree.id : request.cwd,
      status: "running",
      kind: "harness-child",
    });
    const conversation = await api.conversation(childId, context);
    if (!conversation) {
      throw new Error(`MilkSU subagent child conversation ${childId} is unavailable`);
    }
    api.output(`subagent ${request.agent} running in ${request.cwd}\n`);
    const submission = await conversation.submit({
      type: "input",
      content: request.task,
      requestId: `subagent:${api.taskId}`,
    }, context);
    const timeoutMs = Math.max(0, Number(args.timeoutMs ?? subagentTaskTimeoutMs()));
    let settled;
    if (timeoutMs > 0) {
      let timeoutHandle;
      const timedOut = new Promise(resolveParam => {
        timeoutHandle = setTimeout(resolveParam, timeoutMs, { status: "unanswered", reason: "timeout" });
        timeoutHandle.unref?.();
      });
      settled = await Promise.race([submission.wait(context), timedOut]);
      if (settled?.reason === "timeout") {
        await conversation.abort(context).catch(() => undefined);
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
    } else {
      settled = await submission.wait(context);
    }
    const { answer, files } = await summarizeChildConversation(childId, settled?.answer, api, context);
    const succeeded = settled?.status === "done" && !settled?.reason;
    const timedOutChild = settled?.reason === "timeout";
    const abortedChild = settled?.reason === "aborted" || settled?.reason === "stale";
    const status = succeeded ? "succeeded" : abortedChild ? "aborted" : "failed";
    const summary = succeeded
      ? (answer || "Subagent finished without a final message.")
      : timedOutChild
        ? "Subagent timed out."
        : `Subagent ${request.agent} ended with ${settled?.reason ?? "failure"}.`;
    childRegistry.remember(resolveConversation(api.conversationId), {
      id: api.callId,
      toolCallId: api.callId,
      conversationId: childId,
      role: request.agent,
      prompt: request.task,
      cwd: request.worktree ? request.worktree.id : request.cwd,
      status,
      summary,
      kind: "harness-child",
    });
    emitSubagentRosterEnd(api, request, {
      status,
      durationMs: Math.max(0, Date.now() - startedAt),
      exitCode: succeeded ? 0 : 1,
      files,
      summary,
    });
    return {
      content: [{ type: "text", text: succeeded ? (answer || summary) : summary }],
      details: {
        conversationId: childId,
        results: [childYield(status, request, files, succeeded ? 0 : 1)],
      },
      ...(succeeded ? {} : { isError: true }),
    };
  }

  async function runExternalCliRole(args, api, context) {
    const request = args.request;
    const startedAt = Date.now();
    const role = roleDefinition(request.agent);
    if (!role.externalCli) {
      throw new Error(`MilkSU routes ${request.agent} through a harness child conversation`);
    }
    const runDirectory = join(agentDirectory(), "harness", "subagents", String(api.taskId));
    mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
    const alias = resolveConversation(api.conversationId);
    childRegistry.remember(alias, {
      id: api.callId,
      toolCallId: api.callId,
      role: request.agent,
      prompt: request.task,
      cwd: request.worktree ? request.worktree.id : request.cwd,
      status: "running",
      kind: "external-cli",
      runDirectory,
    });
    // 崩溃收养：replay 重跑发现受管活进程就等它收尾（不二次 spawn）。
    const adopted = adoptedExternalCliRun(runDirectory);
    let outcome;
    if (adopted) {
      api.output(`subagent ${request.agent} resuming watched process ${adopted.pid}\n`);
      await waitForPidExit(adopted.pid);
      outcome = await replayExternalCliOutcome(runDirectory, role, request.cwd);
    } else {
      const launch = resolveExternalCliLaunch(role, runDirectory, request.cwd);
      const prompt = buildExternalCliPrompt(role.prompt, request.task);
      outcome = await runGuardedExternalCli({
        launch,
        prompt,
        cwd: request.cwd,
        runDirectory,
        environment,
        timeoutMs: Math.max(0, Number(args.timeoutMs ?? subagentTaskTimeoutMs())),
        abortSignal: context?.abortSignal,
        onPid: pid => writeRunStatus(runDirectory, { pid, state: "running", agent: request.agent }),
      });
      writeRunStatus(runDirectory, {
        pid: outcome.pid,
        state: outcome.exitCode === 0 ? "completed" : "failed",
        agent: request.agent,
        result: {
          output: outcome.output,
          exitCode: outcome.exitCode,
          ...(outcome.error ? { error: outcome.error } : {}),
        },
      });
    }
    const status = outcome.exitCode === 0 ? "succeeded" : outcome.stopped ? "aborted" : "failed";
    childRegistry.remember(alias, {
      id: api.callId,
      toolCallId: api.callId,
      role: request.agent,
      prompt: request.task,
      cwd: request.worktree ? request.worktree.id : request.cwd,
      status,
      summary: outcome.error || outcome.output?.slice(0, 240) || "",
      kind: "external-cli",
      runDirectory,
    });
    emitSubagentRosterEnd(api, request, {
      status,
      durationMs: Math.max(0, Date.now() - startedAt),
      exitCode: outcome.exitCode,
      files: [],
      summary: outcome.error || outcome.output?.slice(0, 240) || "",
    });
    const text = outcome.output || outcome.error || `External CLI ${request.agent} produced no output.`;
    return {
      content: [{ type: "text", text }],
      details: {
        runDirectory,
        results: [childYield(status, request, [], outcome.exitCode)],
      },
      ...(outcome.exitCode === 0 ? {} : { isError: true }),
    };
  }

  /** 收养路径：进程已退出——先读 status.json 记录结果，缺失/损坏则重解析日志。 */
  async function replayExternalCliOutcome(runDirectory, role, cwd) {
    try {
      const status = JSON.parse(readFileSync(join(runDirectory, "status.json"), "utf8"));
      if (status?.result && typeof status.result === "object") {
        return {
          output: String(status.result.output ?? ""),
          exitCode: Number(status.result.exitCode ?? 1),
          ...(status.result.error ? { error: String(status.result.error) } : {}),
          pid: Number(status.pid) || undefined,
        };
      }
    } catch {
      // status.json 缺失/损坏：回退日志重解析。
    }
    const launch = resolveExternalCliLaunch(role, runDirectory, cwd);
    const { parserError, parserTerminal } = parseExternalCliLog(launch, join(runDirectory, "external-0.stdout.log"));
    if (!parserError && parserTerminal?.state === "completed") {
      return { output: parserTerminal.output ?? "", exitCode: 0 };
    }
    return {
      output: "",
      exitCode: 1,
      error: parserError?.message
        ?? parserTerminal?.error
        ?? "External CLI run ended without a terminal state after a crash.",
    };
  }

  function writeRunStatus(runDirectory, status) {
    try {
      writeFileSync(join(runDirectory, "status.json"), `${JSON.stringify(status, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // 状态记录尽力而为；结果以工具回传为准。
    }
  }

  async function runControlAction(args, api, context) {
    const action = String(args.action ?? "").trim();
    const alias = resolveConversation(api.conversationId);
    if (action === "list") {
      const rows = [...definitions.values()].map(definition => ({
        agent: definition.name,
        description: definition.description,
        externalCli: definition.externalCli,
        ...(args.capabilities ? { tools: definition.tools } : {}),
        ...(definition.externalCli ? { runner: { type: "external-cli", command: definition.runner?.command ?? "" } } : {}),
      }));
      return managementResult([
        args.capabilities ? "Subagent catalog (capabilities):" : "Subagent catalog:",
        ...rows.map(row => `- ${row.agent}${row.externalCli ? " [external-cli]" : ""}: ${row.description}`),
      ]);
    }
    if (action === "get") {
      const role = roleDefinition(args.id || args.agent);
      return managementResult([
        `agent: ${role.name}`,
        `description: ${role.description}`,
        `tools: ${role.tools.join(", ") || "(parent default)"}`,
        ...(role.thinking ? [`thinking: ${role.thinking}`] : []),
        `externalCli: ${role.externalCli}`,
        ...(role.externalCli ? [`runner: ${role.runner?.adapter} (${role.runner?.command})`] : []),
      ]);
    }
    if (action === "models") {
      const models = modelsCollection()?.models ?? modelsCollection();
      const rows = (models?.getModels?.() ?? []).map(model => `${model.provider}/${model.id}`);
      return managementResult(["Subagent model catalog:", ...rows.map(row => `- ${row}`)]);
    }
    if (action === "children.list" || action === "status" || action === "steer" || action === "interrupt"
      || action === "stop" || action === "resume") {
      const children = childRegistry.list(alias);
      if (action === "children.list") {
        return managementResult([
          "Harness subagent children:",
          ...children.map(entry => (
            `- ${entry.id} · ${entry.role} · ${entry.status}${entry.conversationId !== undefined ? ` · conversation ${entry.conversationId}` : ""}`
          )),
        ]);
      }
      const target = childRegistry.find(alias, args.id ?? args.runId ?? args.agent);
      if (!target) {
        return managementResult([`MilkSU found no harness subagent for id "${args.id ?? args.runId ?? args.agent ?? ""}" in this conversation.`]);
      }
      if (action === "status") {
        const busy = target.conversationId !== undefined
          ? await childConversationBusy(getHarnessHandle(), target.conversationId)
          : undefined;
        return managementResult([
          `id: ${target.id}`,
          `agent: ${target.role}`,
          `status: ${busy === true ? "running" : target.status}`,
          `cwd: ${target.cwd}`,
          ...(target.summary ? [`summary: ${target.summary.slice(0, 240)}`] : []),
        ]);
      }
      const message = String(args.message ?? "").trim();
      if (action === "steer" || action === "resume") {
        if (!message) {
          return managementResult([`MilkSU needs a message to ${action} subagent ${target.id}.`]);
        }
        if (target.conversationId === undefined) {
          return managementResult([`Subagent ${target.id} is an external CLI run; steering is not supported after it finished.`]);
        }
        const conversation = await api.conversation(target.conversationId, context);
        if (!conversation) {
          return managementResult([`Subagent child conversation ${target.conversationId} is unavailable.`]);
        }
        const submission = await conversation.submit({
          type: "input",
          content: message,
          requestId: `subagent:${action}:${api.callId}:${randomSuffix()}`,
          ...(action === "steer" ? { whenBusy: "steer" } : {}),
        }, context);
        const settled = await submission.wait(context);
        const { answer } = await summarizeChildConversation(target.conversationId, settled?.answer, api, context);
        return managementResult([
          `subagent ${target.role} ${action}: ${settled?.status === "done" ? "delivered" : `unanswered (${settled?.reason ?? "unknown"})`}`,
          ...(answer ? [answer] : []),
        ]);
      }
      // interrupt / stop：外部 CLI 杀进程树；harness child abort 级联。
      if (target.kind === "external-cli") {
        const adopted = adoptedExternalCliRun(target.runDirectory ?? "");
        if (adopted) {
          await terminateExternalCliProcess(adopted.pid);
          return managementResult([`Stopped external CLI subagent ${target.id} (pid ${adopted.pid}).`]);
        }
        return managementResult([`External CLI subagent ${target.id} is not running.`]);
      }
      const conversation = target.conversationId !== undefined
        ? await api.conversation(target.conversationId, context)
        : undefined;
      await conversation?.abort(context).catch(() => undefined);
      return managementResult([`Stopped subagent ${target.id}.`]);
    }
    if (deferredManagementActions.has(action)) {
      return managementResult([
        `MilkSU Harness runtime does not carry the pi-subagents "${action}" surface.`,
        "The async single-child lane ships in batch C2 (subagent_async tools); schedules, missions, watchdog and workflow orchestration remain deferred.",
      ]);
    }
    return managementResult([`MilkSU blocked subagent action "${action}"`]);
  }

  const tool = defineTool({
    name: codingCollaborationToolName,
    description: SUBAGENT_TOOL_DESCRIPTION,
    parameters: subagentParameters,
    replay: "safe",
    async execute(args, api, context) {
      const alias = resolveConversation(api.conversationId);
      const policy = getPolicy(alias);
      const request = validateSubagentInput(args, policy?.codingCollaboration, policy?.workspace);
      if (request.mode === "control") {
        return runControlAction({ ...args, action: request.action }, api, context);
      }
      const launch = request.tasks[0];
      const worktree = policy?.codingCollaboration?.worktrees?.find(
        entry => entry.path === launch.cwd,
      );
      const enriched = {
        model: String(args.model ?? "").trim() || undefined,
        timeoutMs: positiveInteger(args.timeoutMs ?? args.maxRuntimeMs),
        request: {
          agent: launch.agent,
          task: launch.task,
          cwd: launch.cwd,
          access: launch.access,
          worktree,
        },
      };
      if (request.externalCli) {
        return runExternalCliRole(enriched, api, context);
      }
      return runBuiltinRole(enriched, api, context);
    },
  });

  const catalog = buildAdvertisedAgentCatalog(definitions);
  const extension = defineExtension({
    name: MILKSU_SUBAGENTS_EXTENSION,
    tools: [tool],
    sections: catalog ? [section("advertised_subagents", () => catalog)] : [],
  });
  extension.promptContributions = {
    snippets: new Map([[codingCollaborationToolName, SUBAGENT_PROMPT_SNIPPET]]),
    guidelines: new Map([[codingCollaborationToolName, SUBAGENT_PROMPT_GUIDELINES]]),
  };
  return extension;
}

function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------- halt：会话销毁时杀外部 CLI 进程（harness child 由 abort 级联兜底） ----------

/**
 * 门开路径的子代理停止面（destroySession 接线；与注入的
 * haltConversationSubagents——门关异步 run 的 pid 面——互补）：
 *   - 外部 CLI：run 目录 status.json 里的受管活进程 → 进程组终止；
 *   - harness child：conversation.abort 级联（abortConversation 已覆盖普通所有权
 *     范围；这里对注册表里的 child 再补一次显式 abort，防 background 边界漏网）。
 */
export function createHarnessSubagentHalt(childRegistry, getHarnessHandle) {
  return async function haltHarnessSubagents(alias) {
    const children = childRegistry.list(alias);
    for (const child of children) {
      if (child.kind === "external-cli" && child.runDirectory) {
        const adopted = adoptedExternalCliRun(child.runDirectory);
        if (adopted) await terminateExternalCliProcess(adopted.pid).catch(() => undefined);
      }
    }
    const handle = await Promise.resolve(getHarnessHandle?.()).catch(() => undefined);
    for (const child of children) {
      if (child.kind !== "harness-child" || child.conversationId === undefined) continue;
      try {
        const conversation = await handle?.harness?.conversation(child.conversationId, BACKGROUND_CONTEXT);
        await conversation?.abort(BACKGROUND_CONTEXT, { background: true }).catch(() => undefined);
      } catch {
        // 会话已终结：无需补刀。
      }
    }
    childRegistry.forget(alias);
  };
}
