// PR-2 批次 B2b：门开路径的 MCP 挂载面（单 "mcp" 代理工具 + 连接管理器）。
//
// 挂载架构选型（工单「核心难点」的结论）：
//   pi-mcp-adapter 5.0.0 的 createMcpAdapter（index.ts:2326）返回吃 pi-coding-agent
//   ExtensionAPI 的扩展工厂（index.ts 消费 pi.registerTool/pi.on/pi.setActiveTools/
//   pi.registerCommand/pi.events 等），不能跑在 pi-durable 下；包唯一为嵌入方准备的
//   低层 profile ./host-managed（host-managed.ts:1-547）只注册**逐工具直挂面**
//   （host-managed.ts:530-545，server 前缀命名），与 #220 的单代理面语义
//   （settings.namespaceProxyTools:false —— 全部调用过同一个 "mcp" 工具的审批与
//   活动边界）相反，其 dispatch 也只在其自身注册的工具内可达。因此本文件对着
//   adapter 的**协议层** @modelcontextprotocol/client（#220 的 protocolVersion auto
//   落点，server-manager.ts:1428-1436 + bridge-mcp-protocol.test.js 的 SDK 直连测试
//   同款）重写 pi-durable 薄壳，网关分发语义对着 proxy-modes.ts / index.ts 的
//   executeCall/executeStatus/executeList/executeDescribe/executeSearch/
//   executeInstructions/executeConnect 逐条移植。
//
// #220 口径的保真方式：
//   - 配置漏斗不动：mcpConfig 仍由 bridge-mcp.js 的 adapterConfig 产出（sandbox 包装、
//     includeTools 评审、16/64 上限、withAutoProtocolVersion 都在那层，测试见
//     bridge-mcp-protocol.test.js）。
//   - 本层只接手 #220 之后的事：连接（Client + versionNegotiation auto）、目录
//     （includeTools 过滤 + tools/list_changed 重列 retire）、调用（单代理面）、
//     输出护栏（50KB/2000 行 + 满溢落盘，mcp-output-guard.ts 的移植）、lazy 生命周期
//     + idleTimeout 10 分钟清扫。
//   - 门禁：adoptConfig 校验每个服务器都带 protocolVersion "auto" 且 settings 与
//     #220 漏斗一致（namespaceProxyTools/scriptMode 关、hostConfigDiscovery off），
//     漏斗被绕过时立即失败而不是静默退化。
//
// 审批：不在本层。B1 的 beforeTool 审判链（harness-bridge-approval.js:196-227 研究/
// 浏览器隔离、:333-361 逐调用审批 + 会话级 grantKey）对挂载的 "mcp" 工具自动生效——
// 与门关一致（门关的 adapter 内部审批 broker 在 MilkSU 下无人认领、恒 abstain，真正
// 的审批都在 MilkSU 权限扩展的 tool_call 钩子）。
//
// 与门关 adapter 的已知差异（如实记录，见交付报告）：
//   - 无跨会话元数据缓存（mcp-cache.json）：每会话 adopt 时做一次发现连接（连上→
//     列目录→关 lazy 连接），进程内按会话记目录；adapter 是启动时连一次写盘缓存。
//   - 无 OAuth/auth-start/auth-complete 动作面（#220 的 autoAuth:false、elicitation:
//     false 口径下本就不走）；action 仍识别并按程序化配置语义回固定文案
//     （index.ts:1845-1849）。
//   - 无 install 动作（程序化配置下 adapter 同样回固定不可用文案，index.ts:1845）。
//   - 搜索为简化词法打分（adapter 的 search-ranking.ts 有 stem/关键词加权；MilkSU
//     漏斗产出的定义从不带 searchKeywords，影响面限于排序细节）。

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  Client,
  ReadBuffer,
  StreamableHTTPClientTransport,
  fromJsonSchema,
  serializeMessage,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";

export const MILKSU_MCP_EXTENSION = "milksu-mcp";
export const MILKSU_MCP_TOOL_NAME = "mcp";

// pi-mcp-adapter 5.0.0 代理工具的 promptSnippet（index.ts:2061）——milksu-prompt 的
// tools 段用它（见 harness-bridge-tools.js）。
export const MILKSU_MCP_PROMPT_SNIPPET = "MCP gateway — install by URL, status, search, describe, auth, and single MCP tool calls";

const idleTimeoutMinutesDefault = 10;
const idleSweepIntervalMs = 30 * 1000;
const discoveryConcurrency = 10;
const failureBackoffMs = 60 * 1000;
const instructionsPreviewLength = 300;
const maxRegexSearchQueryLength = 256;
const maxServers = 16;

// ---------- 命名与选择器（pi-mcp-adapter types.ts:860-1059 的移植） ----------

function sanitizeServerPrefix(serverName) {
  const validCharacters = /[a-zA-Z0-9_-]/u;
  return Array.from(String(serverName), char => (
    validCharacters.test(char) ? char : `_${char.codePointAt(0).toString(16)}_`
  )).join("");
}

function getServerPrefix(serverName) {
  // settings.toolPrefix: "server"（#220 漏斗 adapterConfig 钉死）。
  return sanitizeServerPrefix(serverName);
}

function formatToolName(toolName, serverName) {
  const prefix = getServerPrefix(serverName);
  const sanitized = String(toolName).replace(/\./g, "_");
  if (prefix && sanitized.startsWith(`${prefix}_`) && sanitized.length > prefix.length + 1) {
    return sanitized;
  }
  return prefix ? `${prefix}_${sanitized}` : sanitized;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function toolNameCandidates(toolName, serverName) {
  const legacy = String(toolName).replace(/-/g, "_");
  return new Set([
    toolName,
    legacy,
    formatToolName(toolName, serverName),
    formatToolName(legacy, serverName),
  ]);
}

function matchesToolPattern(candidates, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (!pattern.includes("*") && !pattern.includes("?") && candidates.has(pattern)) return true;
    if (
      (pattern.includes("*") || pattern.includes("?"))
      && [...candidates].some(candidate => globToRegExp(pattern).test(candidate))
    ) {
      return true;
    }
  }
  return false;
}

// includeTools/excludeTools 过滤（buildToolMetadata 的选择器语义：原名或带前缀名，
// 支持 glob；无过滤器 = 全量）。
function toolAllowed(definition, toolName, serverName) {
  const candidates = toolNameCandidates(toolName, serverName);
  if (Array.isArray(definition.excludeTools) && definition.excludeTools.length > 0) {
    if (matchesToolPattern(candidates, definition.excludeTools)) return false;
  }
  if (Array.isArray(definition.includeTools) && definition.includeTools.length > 0) {
    return matchesToolPattern(candidates, definition.includeTools);
  }
  return true;
}

// ---------- 内容变换（tool-registrar.ts:176-247 的移植） ----------

const maxBinaryResourceBytes = 10 * 1024 * 1024;
const maxSessionResourceBytes = 100 * 1024 * 1024;
const maxSessionResourceFiles = 10000;

class MaterializedResourceSession {
  constructor() {
    this.directory = undefined;
    this.bytes = 0;
    this.files = 0;
    this.sequence = 0;
  }
}

function materializeBinaryResource(resource, session) {
  if (!session) {
    return omitBinaryResource(resource, "runtime stopped");
  }
  const decodedBytes = Buffer.byteLength(resource.blob, "base64");
  if (decodedBytes > maxBinaryResourceBytes) {
    return omitBinaryResource(resource, "decoded size exceeds 10 MiB");
  }
  if (session.bytes + decodedBytes > maxSessionResourceBytes || session.files >= maxSessionResourceFiles) {
    return omitBinaryResource(resource, "session resource limit reached");
  }
  try {
    session.directory ??= mkdtempSync(join(tmpdir(), "milksu-mcp-resource-"));
  } catch {
    return omitBinaryResource(resource, "could not be saved");
  }
  const filePath = join(session.directory, `resource-${++session.sequence}.bin`);
  session.bytes += decodedBytes;
  session.files += 1;
  try {
    writeFileSync(filePath, Buffer.from(resource.blob, "base64"), { flag: "wx", mode: 0o600 });
  } catch {
    try {
      rmSync(filePath, { force: true });
      session.bytes -= decodedBytes;
      session.files -= 1;
    } catch {
      // 保留配额记账。
    }
    return omitBinaryResource(resource, "could not be saved");
  }
  return [
    `[Resource: ${resource.uri ?? "(no URI)"}]`,
    `Binary content saved to ${filePath}`,
    `MIME type: ${resource.mimeType ?? "application/octet-stream"}`,
  ].join("\n");
}

function omitBinaryResource(resource, reason) {
  return [
    `[Resource: ${resource.uri ?? "(no URI)"}]`,
    `Binary content omitted: ${reason}`,
    `MIME type: ${resource.mimeType ?? "application/octet-stream"}`,
  ].join("\n");
}

function transformMcpContent(content, session) {
  return (Array.isArray(content) ? content : []).map(block => {
    if (block?.type === "text") {
      return { type: "text", text: String(block.text ?? "") };
    }
    if (block?.type === "image") {
      return {
        type: "image",
        data: String(block.data ?? ""),
        mimeType: typeof block.mimeType === "string" && block.mimeType.trim()
          ? block.mimeType.trim().slice(0, 100)
          : "image/png",
      };
    }
    if (block?.type === "resource") {
      const resourceUri = block.resource?.uri ?? "(no URI)";
      if (block.resource && "blob" in block.resource && typeof block.resource.blob === "string") {
        return {
          type: "text",
          text: materializeBinaryResource({
            uri: resourceUri,
            mimeType: block.resource.mimeType,
            blob: block.resource.blob,
          }, session),
        };
      }
      const resourceContent = block.resource?.text
        ?? (block.resource ? JSON.stringify(block.resource) : "(no content)");
      return { type: "text", text: `[Resource: ${resourceUri}]\n${resourceContent}` };
    }
    if (block?.type === "resource_link") {
      const linkName = block.name ?? block.uri ?? "unknown";
      return {
        type: "text",
        text: `[Resource Link: ${linkName}]\nURI: ${block.uri ?? "(no URI)"}`,
      };
    }
    return { type: "text", text: JSON.stringify(block) };
  });
}

function resourceNameToToolName(name) {
  return String(name ?? "").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/\.+/g, "_");
}

function transformMcpResourceContents(contents, session) {
  return (Array.isArray(contents) ? contents : []).map(resource => {
    if (typeof resource?.text === "string") return { type: "text", text: resource.text };
    if (typeof resource?.blob === "string") {
      return {
        type: "text",
        text: materializeBinaryResource({
          uri: resource.uri,
          mimeType: resource.mimeType,
          blob: resource.blob,
        }, session),
      };
    }
    return { type: "text", text: JSON.stringify(resource) };
  });
}

function resolveMcpResultContent(result, session) {
  const blocks = transformMcpContent(result?.content, session);
  if (result?.structuredContent !== undefined && result?.structuredContent !== null) {
    let structured;
    try {
      structured = JSON.stringify(result.structuredContent, null, 2) ?? String(result.structuredContent);
    } catch {
      structured = String(result.structuredContent);
    }
    if (blocks.length > 0) {
      return [...blocks, { type: "text", text: `structuredContent:\n${structured}` }];
    }
    return [{ type: "text", text: structured }];
  }
  return blocks;
}

// ---------- 输出护栏（mcp-output-guard.ts 的移植：50KB/2000 行 + 满溢落盘） ----------

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function textStats(text) {
  const lines = text.length === 0 ? 0 : text.split("\n").length;
  return { bytes: byteLength(text), lines };
}

function reserveBudget(maxBytes, maxLines, notice) {
  const stats = textStats(`\n\n${notice}`);
  return {
    maxBytes: Math.max(0, maxBytes - stats.bytes),
    maxLines: Math.max(0, maxLines - stats.lines),
  };
}

function formatTruncationNotice(truncation, fullOutputPath, writeError) {
  let reason;
  if (truncation.firstLineExceedsLimit) {
    reason = `First line exceeds ${formatSize(truncation.maxBytes)} limit`;
  } else if (truncation.truncatedBy === "lines") {
    reason = `Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines} line limit)`;
  } else {
    reason = `Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes)} limit)`;
  }
  const base = `[MCP text output truncated: original ${truncation.totalLines.toLocaleString()} lines / ${formatSize(truncation.totalBytes)}. ${reason}.`;
  if (fullOutputPath) {
    return `${base} Full text saved to: ${fullOutputPath} — use read with offset/limit or grep to inspect.]`;
  }
  return `${base} Full output could not be saved: ${writeError ?? "unknown error"}]`;
}

async function saveGuardArtifact(text) {
  try {
    const directory = await mkdtemp(join(tmpdir(), "milksu-mcp-output-"));
    const path = join(directory, "output.txt");
    await writeFile(path, text, "utf8");
    return { path, error: undefined };
  } catch (error) {
    return { path: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 文本按 maxBytes/maxLines 截断（保留头部），超限内容落盘并在尾部给出提示；图片块
 * 原样直通（作为原生 image 内容而非文本上下文）。details 里带 outputGuard 统计。
 */
async function guardMcpOutput(content, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const prefix = options.prefix ?? "";
  const suffix = options.suffix ?? "";
  const normalized = (Array.isArray(content) && content.length > 0
    ? content
    : [{ type: "text", text: options.emptyTextFallback ?? "(empty result)" }
  ]).filter(Boolean);
  const imageBlocks = normalized.filter(block => block.type === "image");
  const textOutput = normalized
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n");
  const composed = `${prefix}${textOutput}${suffix}`;
  const truncation = truncateHead(composed, { maxBytes, maxLines });
  let guardedContent = normalized;
  let outputGuard;
  if (truncation.truncated) {
    const { path: fullOutputPath, error: writeError } = await saveGuardArtifact(composed);
    const notice = formatTruncationNotice(truncation, fullOutputPath, writeError);
    const previewBudget = reserveBudget(maxBytes, maxLines, notice);
    const preview = truncateHead(composed, previewBudget);
    const finalText = `${preview.content}\n\n${notice}`;
    const finalStats = textStats(finalText);
    guardedContent = [{ type: "text", text: finalText }, ...imageBlocks];
    outputGuard = {
      truncated: true,
      originalBytes: truncation.totalBytes,
      returnedBytes: finalStats.bytes,
      originalLines: truncation.totalLines,
      returnedLines: finalStats.lines,
      ...(imageBlocks.length > 0 ? { imageBlocksPassedThrough: imageBlocks.length } : {}),
      ...(fullOutputPath !== undefined ? { fullOutputPath } : {}),
      ...(writeError !== undefined ? { writeError } : {}),
    };
  }
  return {
    content: guardedContent,
    ...(outputGuard ? { details: { outputGuard } } : {}),
  };
}

function guardedMcpDetails(guarded) {
  return { ...(guarded.details ?? {}) };
}

// ---------- 参数规整与校验（utils.ts:368 + proxy-modes.ts:38 的移植） ----------

function normalizeToolArguments(value, context = "tool arguments") {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return {};
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `${context}: invalid args JSON (${error instanceof SyntaxError ? error.message : String(error)}); `
        + "pass args as a JSON object, or as a valid JSON string encoding one",
        { cause: error },
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `${context}: expected a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      );
    }
    return parsed;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `${context}: expected a JSON object, got ${Array.isArray(value) ? "array" : typeof value}`,
    );
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new Error(
      `${context}: value is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

const schemaValidators = new WeakMap();

function proxyArgumentValidationError(inputSchema, args) {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) return null;
  try {
    let validator = schemaValidators.get(inputSchema);
    if (!validator) {
      validator = fromJsonSchema(inputSchema)["~standard"];
      schemaValidators.set(inputSchema, validator);
    }
    const result = validator.validate(args);
    if (!result || result.issues === undefined) return null;
    return result.issues
      .map(issue => issue?.message ?? String(issue))
      .join("; ") || "arguments do not match the advertised input schema";
  } catch {
    // 适配不了的 schema 方言交给服务器端校验（adapter 同款语义）。
    return null;
  }
}

// ---------- bearer 解析（bearerToken 静态值 + "!command" 命令式，bearer-command-resolver 移植） ----------

const bearerCommandTimeoutMs = 10 * 1000;
const bearerCommandMaxOutputBytes = 1024 * 1024;

function runBearerCommand(command, context, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = Buffer.alloc(0);
    let settled = false;
    const child = spawn(command.slice(1), {
      shell: true,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const kill = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // 进程已退出。
      }
    };
    const finish = (error, token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error !== undefined) rejectPromise(error);
      else resolvePromise(token);
    };
    const onAbort = () => {
      kill();
      finish(signal?.reason ?? new Error(`${context} was aborted`));
    };
    const timer = setTimeout(() => {
      kill();
      finish(new Error(`Failed to resolve ${context}: command timed out after ${bearerCommandTimeoutMs}ms`));
    }, bearerCommandTimeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    child.on("error", () => {
      if (!settled) finish(new Error(`Failed to resolve ${context}: command failed to start`));
    });
    child.stdout.on("data", chunk => {
      if (settled) return;
      output = Buffer.concat([output, Buffer.from(chunk)]);
      if (output.byteLength > bearerCommandMaxOutputBytes) {
        kill();
        finish(new Error(`Failed to resolve ${context}: command output exceeded 1 MiB`));
      }
    });
    child.on("close", code => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error(`Failed to resolve ${context}: command exited with code ${code ?? "unknown"}`));
        return;
      }
      const token = output.toString("utf8").trim();
      if (!token) {
        finish(new Error(`Failed to resolve ${context}: command returned empty output`));
        return;
      }
      finish(undefined, token);
    });
  });
}

// ---------- Unix 套接字传输（unix-socket-transport.ts 的移植） ----------

class UnixSocketClientTransport {
  constructor(socketPath) {
    this.socketPath = socketPath;
    this.socket = undefined;
    this.readBuffer = new ReadBuffer();
    this.onclose = undefined;
    this.onerror = undefined;
    this.onmessage = undefined;
  }

  async start() {
    if (this.socket) throw new Error("UnixSocketClientTransport already started");
    await new Promise((resolvePromise, rejectPromise) => {
      const socket = createConnection(this.socketPath);
      this.socket = socket;
      let connected = false;
      socket.once("connect", () => {
        connected = true;
        resolvePromise();
      });
      socket.on("data", chunk => {
        try {
          this.readBuffer.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          for (;;) {
            const message = this.readBuffer.readMessage();
            if (message === null) break;
            this.onmessage?.(message);
          }
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          this.onerror?.(cause);
          void this.close();
        }
      });
      socket.on("error", error => {
        if (!connected) rejectPromise(error);
        this.onerror?.(error);
      });
      socket.on("close", () => {
        if (this.socket === socket) this.socket = undefined;
        this.onclose?.();
      });
    });
  }

  async send(message) {
    if (!this.socket) throw new Error("UnixSocketClientTransport is not connected");
    await new Promise((resolvePromise, rejectPromise) => {
      this.socket.write(serializeMessage(message), error => (
        error ? rejectPromise(error) : resolvePromise()
      ));
    });
  }

  async close() {
    const socket = this.socket;
    this.socket = undefined;
    if (socket) socket.destroy();
  }
}

// ---------- 搜索（search-ranking.ts 的简化词法版） ----------

function normalizeSearchText(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase();
}

function tokenize(value) {
  const tokens = [];
  for (const run of normalizeSearchText(value).match(/[a-z0-9]+|(?:[^\s])/gu) ?? []) {
    tokens.push(run);
  }
  return [...new Set(tokens)];
}

function searchScore(tool, serverName, queryTokens) {
  if (queryTokens.length === 0) return null;
  const nameTokens = new Set(tokenize(`${tool.name} ${serverName}`));
  const descriptionTokens = new Set(tokenize(tool.description ?? ""));
  let score = 0;
  let matched = 0;
  for (const token of queryTokens) {
    let hit = 0;
    if (nameTokens.has(token)) hit = 12;
    else if ([...nameTokens].some(candidate => candidate.startsWith(token))) hit = 6;
    else if (descriptionTokens.has(token)) hit = 5;
    else if ([...descriptionTokens].some(candidate => candidate.startsWith(token))) hit = 2;
    if (hit > 0) {
      matched += 1;
      score += hit;
    }
  }
  if (matched === 0) return null;
  return matched === queryTokens.length ? score : score / 2;
}

function paginate(items, offset, limit) {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 1;
  const total = items.length;
  const page = items.slice(safeOffset, safeOffset + safeLimit);
  const nextOffset = safeOffset + page.length;
  return {
    items: page,
    total,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  };
}

// ---------- 每会话连接管理器 ----------

function toolAnnotationHints(annotations) {
  if (!annotations || typeof annotations !== "object") return "";
  const hints = [];
  const flag = (value, yes, no) => {
    if (value !== undefined) hints.push(value ? yes : no);
  };
  flag(annotations.readOnlyHint, "read-only", "not read-only");
  flag(annotations.destructiveHint, "destructive", "non-destructive");
  flag(annotations.idempotentHint, "idempotent", "not idempotent");
  flag(annotations.openWorldHint, "open-world", "closed-world");
  return hints.join(", ");
}

/**
 * 一个 MilkSU 会话（别名）一份：配置在 createSession/policy 刷新时经 adopt() 注入，
 * 发现连接（连上→列目录→关 lazy 连接）在 adopt 时完成一次，目录进程内缓存；
 * 调用时 lazy 重连，idleTimeout 分钟空闲后清扫。close() 在会话销毁/sidecar 退出时
 * 收掉全部子进程与定时器。
 */
class McpConversationRuntime {
  constructor(alias, config, { environment = process.env } = {}) {
    this.alias = alias;
    this.environment = environment;
    this.lifetime = new AbortController();
    this.servers = new Map();
    // server → { tools: ToolMeta[], resources: McpResource[] , instructions?: string }
    this.catalog = new Map();
    this.retired = new Map();
    this.resourceSession = new MaterializedResourceSession();
    this.sweepTimer = undefined;
    this.validateConfig(config);
    for (const [name, definition] of Object.entries(config.mcpServers ?? {})) {
      this.servers.set(name, {
        name,
        definition,
        client: undefined,
        transport: undefined,
        status: "not connected",
        lastUsedAt: 0,
        inFlight: 0,
        failedAt: undefined,
        failureMessage: undefined,
      });
    }
  }

  /** #220 漏斗契约：每台服务器 protocolVersion "auto"、settings 面与漏斗钉死值一致。 */
  validateConfig(config) {
    if (!config || typeof config !== "object" || typeof config.mcpServers !== "object") {
      throw new Error(`MilkSU harness MCP config for "${this.alias}" is malformed`);
    }
    const names = Object.keys(config.mcpServers);
    if (names.length > maxServers) {
      throw new Error(`MilkSU supports at most ${maxServers} MCP servers per task`);
    }
    const settings = config.settings ?? {};
    if (settings.namespaceProxyTools !== false) {
      throw new Error("MilkSU harness MCP requires namespaceProxyTools: false (single proxy surface)");
    }
    if (settings.scriptMode !== false) {
      throw new Error("MilkSU harness MCP requires scriptMode: false (QuickJS off the product path)");
    }
    if (settings.hostConfigDiscovery !== "off") {
      throw new Error("MilkSU harness MCP requires hostConfigDiscovery: off");
    }
    for (const name of names) {
      const definition = config.mcpServers[name];
      if (definition?.protocolVersion !== "auto") {
        throw new Error(
          `MCP server "${name}" must reach the harness with protocolVersion "auto" (bridge-mcp adapterConfig funnel)`,
        );
      }
      const kinds = [definition.command, definition.url, definition.socket]
        .filter(value => typeof value === "string" && value.length > 0);
      if (kinds.length !== 1) {
        throw new Error(`Server ${name} must configure exactly one of command, url, or socket`);
      }
    }
  }

  get signal() {
    return this.lifetime.signal;
  }

  describeFailure(name) {
    const server = this.servers.get(name);
    if (!server?.failedAt) return null;
    const ageMs = Date.now() - server.failedAt;
    if (ageMs > failureBackoffMs) return null;
    const failedAgo = Math.round(ageMs / 1000);
    const reason = String(server.failureMessage ?? "").slice(0, 300);
    return reason ? `failed ${failedAgo}s ago: ${reason}` : `failed ${failedAgo}s ago`;
  }

  recordFailure(name, message) {
    const server = this.servers.get(name);
    if (!server) return;
    server.failedAt = Date.now();
    server.failureMessage = message instanceof Error ? message.message : String(message);
    server.status = "failed";
  }

  clearFailure(name) {
    const server = this.servers.get(name);
    if (server) {
      server.failedAt = undefined;
      server.failureMessage = undefined;
    }
  }

  idleTimeoutMinutes(name) {
    const server = this.servers.get(name);
    const perServer = Number(server?.definition?.idleTimeout);
    if (Number.isFinite(perServer) && perServer >= 0) return perServer;
    return idleTimeoutMinutesDefault;
  }

  touch(name) {
    const server = this.servers.get(name);
    if (server) server.lastUsedAt = Date.now();
  }

  // ---- 连接（server-manager.ts:1111-1190 的移植面：stdio/url/socket 三种传输） ----

  async createTransport(name, signal) {
    const definition = this.servers.get(name)?.definition;
    if (definition.command) {
      return new StdioClientTransport({
        command: String(definition.command),
        args: Array.isArray(definition.args) ? definition.args.map(String) : [],
        env: definition.env && typeof definition.env === "object" && !Array.isArray(definition.env)
          ? { ...definition.env }
          : undefined,
        ...(definition.cwd ? { cwd: String(definition.cwd) } : {}),
        stderr: "pipe",
      });
    }
    if (definition.url) {
      const requestInit = {};
      const headers = { ...(definition.headers ?? {}) };
      if (definition.auth === "bearer") {
        const token = definition.bearerToken;
        if (typeof token === "string" && token.startsWith("!")) {
          headers.Authorization = `Bearer ${await runBearerCommand(
            token,
            `MCP server "${name}" HTTP bearer token`,
            signal,
          )}`;
        } else if (typeof token === "string" && token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }
      if (Object.keys(headers).length > 0) requestInit.headers = headers;
      return new StreamableHTTPClientTransport(
        new URL(String(definition.url)),
        Object.keys(requestInit).length > 0 ? { requestInit } : {},
      );
    }
    if (definition.socket) {
      return new UnixSocketClientTransport(String(definition.socket));
    }
    throw new Error(`Server ${name} must configure exactly one of command, url, or socket`);
  }

  createClient(name) {
    // server-manager.ts:1428-1436：versionNegotiation { mode: "auto" }（#220 的
    // protocolVersion auto 落点——现代 revision 优先、旧 initialize 回退）。
    return new Client(
      { name: `pi-mcp-${name}`, version: "1.0.0" },
      { capabilities: {}, versionNegotiation: { mode: "auto" } },
    );
  }

  async connectServer(name, signal) {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Server "${name}" is not configured`);
    if (server.client && server.status === "connected") return server;
    this.clearFailure(name);
    const owned = combineSignals(this.signal, signal);
    try {
      const transport = await this.createTransport(name, owned);
      const client = this.createClient(name);
      client.onerror = () => {};
      client.onclose = () => {
        if (server.client === client) {
          server.status = "closed";
        }
      };
      // 目录变化：重列一次，变化/消失的工具永久 retire（host-managed.ts:231-255 同款
      // 语义——评审过的目录变了就不再调用旧定义）。
      client.setNotificationHandler("notifications/tools/list_changed", () => {
        void this.refreshCatalog(name).catch(() => this.retireAll(name));
      });
      try {
        await client.connect(transport, owned ? { signal: owned } : undefined);
      } catch (error) {
        try {
          await transport.close();
        } catch {
          // 清理失败不掩盖原错误。
        }
        throw error;
      }
      server.client = client;
      server.transport = transport;
      server.status = "connected";
      this.touch(name);
      const connection = await this.captureCatalog(name, client, owned);
      return { server, ...connection };
    } catch (error) {
      this.recordFailure(name, error);
      throw error;
    }
  }

  async captureCatalog(name, client, signal) {
    const definition = this.servers.get(name)?.definition ?? {};
    const listed = await client.listTools(undefined, signal ? { signal } : undefined);
    const tools = [];
    for (const tool of listed.tools ?? []) {
      if (!tool?.name) continue;
      if (!toolAllowed(definition, tool.name, name)) continue;
      tools.push({
        name: formatToolName(tool.name, name),
        originalName: tool.name,
        description: String(tool.description ?? ""),
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        resourceUri: undefined,
      });
    }
    let resources = [];
    if (definition.exposeResources !== false) {
      try {
        const listedResources = await client.listResources(undefined, signal ? { signal } : undefined);
        for (const resource of listedResources.resources ?? []) {
          if (!resource?.name || !resource?.uri) continue;
          const baseName = `read_${resourceNameToToolName(resource.name)}`;
          if (!toolAllowed(definition, baseName, name)) continue;
          tools.push({
            name: formatToolName(baseName, name),
            originalName: baseName,
            description: resource.description ? String(resource.description) : `Read resource ${resource.uri}`,
            inputSchema: undefined,
            annotations: undefined,
            resourceUri: resource.uri,
          });
        }
        resources = listedResources.resources ?? [];
      } catch {
        // resources 广告了但列失败：不算连接失败（server-manager 同款标记）。
      }
    }
    const instructions = typeof client.getInstructions?.() === "string"
      ? client.getInstructions()
      : undefined;
    this.catalog.set(name, { tools, resources, instructions });
    this.retired.delete(name);
    return { tools, resources, instructions };
  }

  async refreshCatalog(name) {
    const server = this.servers.get(name);
    if (!server?.client || server.status !== "connected") return;
    const previous = new Map((this.catalog.get(name)?.tools ?? []).map(tool => [tool.name, tool]));
    await this.captureCatalog(name, server.client, this.signal);
    const current = this.catalog.get(name)?.tools ?? [];
    const retired = this.retired.get(name) ?? new Set();
    for (const [prefixedName, tool] of previous) {
      const next = current.find(candidate => candidate.name === prefixedName);
      if (!next || JSON.stringify(next.inputSchema) !== JSON.stringify(tool.inputSchema)) {
        retired.add(tool.originalName);
      }
    }
    this.retired.set(name, retired);
  }

  retireAll(name) {
    const retired = this.retired.get(name) ?? new Set();
    for (const tool of this.catalog.get(name)?.tools ?? []) retired.add(tool.originalName);
    this.retired.set(name, retired);
  }

  async ensureConnected(name, signal) {
    const server = this.servers.get(name);
    if (!server) return undefined;
    if (server.client && server.status === "connected") return server;
    if (server.client) {
      try {
        await server.client.close();
      } catch {
        // 旧连接已断。
      }
      server.client = undefined;
      server.transport = undefined;
    }
    await this.connectServer(name, signal);
    return this.servers.get(name);
  }

  async closeServer(name) {
    const server = this.servers.get(name);
    if (!server) return;
    const client = server.client;
    server.client = undefined;
    server.transport = undefined;
    server.status = "closed";
    if (client) {
      await client.close().catch(() => undefined);
    }
  }

  // ---- 发现（init.ts:344-380 的移植：连上→列目录→非 resident 即关） ----

  async discover() {
    const names = [...this.servers.keys()];
    const queue = [...names];
    const workers = Array.from({ length: Math.min(discoveryConcurrency, names.length) }, async () => {
      for (;;) {
        const name = queue.shift();
        if (name === undefined) return;
        try {
          await this.connectServer(name, this.signal);
          // lazy（#220 全部服务器）不常驻：发现完即关，目录留在内存里。
          if (this.servers.get(name)?.definition?.lifecycle === "lazy") {
            await this.closeServer(name);
          }
        } catch {
          // 发现失败已记录 failure/backoff；会话照常创建（adapter init 同款）。
        }
      }
    });
    await Promise.all(workers);
    this.startSweep();
  }

  startSweep() {
    if (this.sweepTimer || this.lifetime.signal.aborted) return;
    this.sweepTimer = setInterval(() => {
      void this.sweepIdle().catch(() => undefined);
    }, idleSweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  async sweepIdle() {
    const now = Date.now();
    for (const [name, server] of this.servers.entries()) {
      if (server.status !== "connected" || server.inFlight > 0) continue;
      const idleMinutes = this.idleTimeoutMinutes(name);
      if (idleMinutes === 0) continue;
      if (server.lastUsedAt > 0 && now - server.lastUsedAt > idleMinutes * 60 * 1000) {
        await this.closeServer(name);
      }
    }
  }

  async close() {
    this.lifetime.abort();
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    await Promise.all([...this.servers.keys()].map(name => this.closeServer(name)));
    if (this.resourceSession.directory) {
      try {
        rmSync(this.resourceSession.directory, { recursive: true, force: true });
      } catch {
        // 临时目录清扫失败不致命。
      }
      this.resourceSession.directory = undefined;
    }
  }

  // ---- 目录查询 ----

  serverNames() {
    return [...this.servers.keys()];
  }

  catalogTools(name) {
    return this.catalog.get(name)?.tools ?? [];
  }

  instructionsFor(name) {
    return this.catalog.get(name)?.instructions;
  }

  connectionStatus(name) {
    const server = this.servers.get(name);
    if (!server) return "not configured";
    if (server.status === "connected") return "connected";
    if (server.failedAt && Date.now() - server.failedAt <= failureBackoffMs) return "failed";
    if (this.catalog.has(name)) return "cached";
    return "not connected";
  }

  isRetired(name, originalName) {
    return this.retired.get(name)?.has(originalName) === true;
  }

  /**
   * 解析调用目标（executeCall 的名字解析链：带 server 用原名/前缀名；不带 server 先
   * 全局唯一前缀名、再唯一原名；多义报 ambiguous）。
   */
  resolveTool(toolName, serverOverride) {
    if (serverOverride) {
      if (!this.servers.has(serverOverride)) {
        return {
          error: {
            content: [{ type: "text", text: `Server "${serverOverride}" not found. Use mcp({}) to see available servers.` }],
            details: { mode: "call", error: "server_not_found", server: serverOverride, requestedTool: toolName },
          },
        };
      }
      const match = this.serverToolMatch(serverOverride, toolName);
      if (match === "ambiguous") return { error: ambiguousServerToolResult("call", toolName, serverOverride) };
      if (match) return { server: serverOverride, tool: match };
      return undefined;
    }
    const exact = [];
    const original = [];
    for (const name of this.servers.keys()) {
      const match = this.serverToolMatch(name, toolName);
      if (match === "ambiguous") return { error: ambiguousToolResult("call", toolName) };
      if (match?.name === toolName) exact.push({ server: name, tool: match });
      else if (match) original.push({ server: name, tool: match });
    }
    const matches = exact.length > 0 ? exact : original;
    if (matches.length > 1) return { error: ambiguousToolResult("call", toolName) };
    if (matches.length === 1) return matches[0];
    return undefined;
  }

  serverToolMatch(serverName, toolName) {
    const tools = this.catalogTools(serverName);
    const byPrefixed = tools.filter(tool => tool.name === toolName);
    if (byPrefixed.length > 0) {
      return byPrefixed.length === 1 ? byPrefixed[0] : "ambiguous";
    }
    const byOriginal = tools.filter(tool => tool.originalName === toolName);
    if (byOriginal.length > 0) {
      return byOriginal.length === 1 ? byOriginal[0] : "ambiguous";
    }
    return undefined;
  }

  suggestions(toolName, serverOverride) {
    const queryTokens = tokenize(toolName);
    const matches = [];
    for (const name of this.serverNames()) {
      if (serverOverride && name !== serverOverride) continue;
      for (const tool of this.catalogTools(name)) {
        const score = searchScore(tool, name, queryTokens);
        if (score !== null) matches.push({ name: tool.name, score });
      }
    }
    return matches
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, 5)
      .map(match => match.name);
  }
}

function combineSignals(...signals) {
  const live = signals.filter(signal => signal instanceof AbortSignal && !signal.aborted);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of live) signal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function ambiguousToolResult(mode, toolName) {
  return {
    content: [{ type: "text", text: `Tool name "${toolName}" is ambiguous across MCP servers. Use mcp({ tool: "${toolName}", server: "server-name" }) to disambiguate.` }],
    details: { mode, error: "ambiguous_tool", requestedTool: toolName },
  };
}

function ambiguousServerToolResult(mode, toolName, serverName) {
  return {
    content: [{ type: "text", text: `Tool name "${toolName}" is ambiguous on server "${serverName}".` }],
    details: { mode, error: "ambiguous_tool", server: serverName, requestedTool: toolName },
  };
}

// ---------- 网关面（proxy-modes.ts 各 execute* 的移植） ----------

function notFoundResult(mode, serverName) {
  return {
    content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
    details: { mode, error: "not_found", server: serverName },
  };
}

function executeStatus(runtime) {
  const servers = [];
  let totalTools = 0;
  let connectedCount = 0;
  for (const name of runtime.serverNames()) {
    const status = runtime.connectionStatus(name);
    const toolCount = status === "failed" ? 0 : runtime.catalogTools(name).length;
    if (status === "connected") connectedCount += 1;
    if (status !== "failed") totalTools += toolCount;
    const failure = status === "failed" ? runtime.describeFailure(name) : null;
    servers.push({ name, status, toolCount, ...(failure ? { failedAgo: failure } : {}) });
  }
  let text = `MCP: ${connectedCount}/${servers.length} servers, ${totalTools} tools\n\n`;
  for (const server of servers) {
    if (server.status === "connected") {
      text += `✓ ${server.name} (${server.toolCount} tools, legacy notification path)\n`;
    } else if (server.status === "failed") {
      text += `✗ ${server.name} (${server.failedAgo ?? `failed`})\n`;
    } else if (server.status === "cached") {
      text += `○ ${server.name} (${server.toolCount} tools, cached; not listening)\n`;
    } else {
      text += `○ ${server.name} (not listening; disconnected)\n`;
    }
  }
  if (servers.length > 0) {
    text += `\nmcp({ server: "name" }) to list tools, mcp({ search: "..." }) to search`;
  }
  return {
    content: [{ type: "text", text: text.trim() }],
    details: { mode: "status", servers, totalTools, connectedCount },
  };
}

function executeList(runtime, serverName) {
  if (!runtime.servers.has(serverName)) return notFoundResult("list", serverName);
  const tools = runtime.catalogTools(serverName);
  const status = runtime.connectionStatus(serverName);
  const definition = runtime.servers.get(serverName)?.definition ?? {};
  const description = String(definition.description ?? "").replace(/\s+/g, " ").trim();
  const descriptionText = description ? `\nDescription: ${description}` : "";
  const instructions = runtime.instructionsFor(serverName);
  let instructionsText = "";
  if (instructions) {
    const preview = instructions.length > instructionsPreviewLength
      ? `${instructions.slice(0, instructionsPreviewLength)}…`
      : instructions;
    instructionsText = `\n\nServer instructions:\n${preview}`;
    if (preview !== instructions) {
      instructionsText += `\nUse mcp({ instructions: "${serverName}" }) for the full text.`;
    }
  }
  if (tools.length === 0) {
    if (status === "connected") {
      return {
        content: [{ type: "text", text: `Server "${serverName}" has no tools.${descriptionText}${instructionsText}` }],
        details: { mode: "list", server: serverName, tools: [], count: 0, hasInstructions: Boolean(instructions) },
      };
    }
    if (status === "cached") {
      return {
        content: [{ type: "text", text: `Server "${serverName}" has no cached tools (not connected).${descriptionText}${instructionsText}` }],
        details: { mode: "list", server: serverName, tools: [], count: 0, cached: true, hasInstructions: Boolean(instructions) },
      };
    }
    if (status === "failed") {
      return {
        content: [{ type: "text", text: `Server "${serverName}" not available (last ${runtime.describeFailure(serverName)})` }],
        details: { mode: "list", server: serverName, tools: [], count: 0, error: "server_backoff" },
      };
    }
    return {
      content: [{ type: "text", text: `Server "${serverName}" is configured but not connected. Use mcp({ connect: "${serverName}" }) to connect.${descriptionText}${instructionsText}` }],
      details: { mode: "list", server: serverName, tools: [], count: 0, error: "not_connected", hasInstructions: Boolean(instructions) },
    };
  }
  const cachedNote = status !== "connected"
    ? ` (lazy: tools from cache, not connected yet — mcp({ connect: "${serverName}" }) to connect)`
    : "";
  let text = `${serverName} (${tools.length} tools${cachedNote}):${descriptionText}\n\n`;
  for (const tool of tools) {
    const truncated = tool.description.length > 50
      ? `${tool.description.slice(0, 50)}…`
      : tool.description;
    text += `- ${tool.name}`;
    if (truncated) text += ` - ${truncated}`;
    text += "\n";
  }
  text += instructionsText;
  return {
    content: [{ type: "text", text: text.trim() }],
    details: { mode: "list", server: serverName, tools: tools.map(tool => tool.name), count: tools.length, hasInstructions: Boolean(instructions) },
  };
}

function formatSchemaText(schema, indent = "") {
  try {
    return JSON.stringify(schema, null, 2)
      .split("\n")
      .map(line => `${indent}${line}`)
      .join("\n");
  } catch {
    return `${indent}(unprintable schema)`;
  }
}

function executeDescribe(runtime, toolName, serverOverride) {
  const resolved = runtime.resolveTool(toolName, serverOverride);
  if (resolved?.error) {
    if (resolved.error.details?.error === "server_not_found") {
      return {
        content: [{ type: "text", text: `Server "${serverOverride}" not found. Use mcp({}) to see available servers.` }],
        details: { mode: "describe", error: "server_not_found", server: serverOverride, requestedTool: toolName },
      };
    }
    return resolved.error;
  }
  if (!resolved) {
    const suggestions = runtime.suggestions(toolName, serverOverride);
    const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
    const scopeText = serverOverride ? ` on server "${serverOverride}"` : "";
    const searchHint = serverOverride
      ? `mcp({ search: "...", server: "${serverOverride}" })`
      : 'mcp({ search: "..." })';
    return {
      content: [{ type: "text", text: `Tool "${toolName}" not found${scopeText}. Use ${searchHint} to search.${suggestionText}` }],
      details: { mode: "describe", error: "tool_not_found", server: serverOverride, requestedTool: toolName, suggestions },
    };
  }
  const { server: serverName, tool } = resolved;
  let text = `${tool.name}\nServer: ${serverName}\n`;
  if (tool.resourceUri) text += `Type: Resource (reads from ${tool.resourceUri})\n`;
  const hints = toolAnnotationHints(tool.annotations);
  if (hints) text += `Hints: ${hints}\n`;
  text += `\n${tool.description || "(no description)"}\n`;
  if (tool.inputSchema && !tool.resourceUri) {
    text += `\nParameters:\n${formatSchemaText(tool.inputSchema)}`;
  } else if (tool.resourceUri) {
    text += "\nNo parameters required (resource tool).";
  } else {
    text += "\nNo parameters defined.";
  }
  return {
    content: [{ type: "text", text: text.trim() }],
    details: { mode: "describe", tool: { name: tool.name, description: tool.description }, server: serverName },
  };
}

function executeInstructions(runtime, serverName) {
  if (!runtime.servers.has(serverName)) return notFoundResult("instructions", serverName);
  const instructions = runtime.instructionsFor(serverName);
  if (instructions) {
    return {
      content: [{ type: "text", text: `${serverName} instructions:\n\n${instructions}` }],
      details: { mode: "instructions", server: serverName, length: instructions.length },
    };
  }
  if (runtime.connectionStatus(serverName) === "connected") {
    return {
      content: [{ type: "text", text: `Server "${serverName}" does not provide instructions.` }],
      details: { mode: "instructions", server: serverName, error: "no_instructions" },
    };
  }
  return {
    content: [{ type: "text", text: `No instructions cached for "${serverName}". Use mcp({ connect: "${serverName}" }) to connect and refresh.` }],
    details: { mode: "instructions", server: serverName, error: "not_connected" },
  };
}

function executeSearch(runtime, query, { regex, server, includeSchemas, limit = 12, offset = 0 } = {}) {
  if (server && !runtime.servers.has(server)) return notFoundResult("search", server);
  let matches;
  if (regex) {
    if (query.length > maxRegexSearchQueryLength) {
      return {
        content: [{ type: "text", text: `Regex query is too long; maximum length is ${maxRegexSearchQueryLength} characters.` }],
        details: { mode: "search", error: "query_too_long", query },
      };
    }
    let pattern;
    try {
      pattern = new RegExp(query, "i");
    } catch {
      return {
        content: [{ type: "text", text: `Invalid regex: ${query}` }],
        details: { mode: "search", error: "invalid_pattern", query },
      };
    }
    matches = [];
    for (const name of runtime.serverNames()) {
      if (server && name !== server) continue;
      for (const tool of runtime.catalogTools(name)) {
        if (pattern.test(tool.name) || pattern.test(tool.description)) {
          matches.push({ server: name, tool, score: 0 });
        }
      }
    }
  } else {
    if (String(query).trim().length === 0 && !server) {
      return {
        content: [{ type: "text", text: "Search query cannot be empty" }],
        details: { mode: "search", error: "empty_query", query },
      };
    }
    const queryTokens = tokenize(query);
    matches = [];
    for (const name of runtime.serverNames()) {
      if (server && name !== server) continue;
      for (const tool of runtime.catalogTools(name)) {
        const score = String(query).trim().length === 0 ? 0 : searchScore(tool, name, queryTokens);
        if (score !== null) matches.push({ server: name, tool, score });
      }
      if (String(query).trim().length === 0) break;
    }
    matches.sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name));
  }
  const page = paginate(matches, offset, limit);
  if (page.total === 0) {
    const scope = server ? ` in "${server}"` : "";
    return {
      content: [{ type: "text", text: `No tools matching "${query}"${scope}` }],
      details: { mode: "search", matches: [], count: 0, hasMore: false, nextOffset: null, query },
    };
  }
  let text = `Found ${page.total} tool${page.total === 1 ? "" : "s"} matching "${query}":\n\n`;
  for (const match of page.items) {
    if (includeSchemas !== false) {
      text += `${match.tool.name}\n  ${match.tool.description || "(no description)"}\n`;
      if (match.tool.inputSchema && !match.tool.resourceUri) {
        text += `\n  Parameters:\n${formatSchemaText(match.tool.inputSchema, "    ")}\n`;
      } else if (match.tool.resourceUri) {
        text += "  No parameters (resource tool).\n";
      }
      text += "\n";
    } else {
      text += `- ${match.tool.name}`;
      if (match.tool.description) {
        const truncated = match.tool.description.length > 50
          ? `${match.tool.description.slice(0, 50)}…`
          : match.tool.description;
        text += ` - ${truncated}`;
      }
      text += "\n";
    }
  }
  if (page.hasMore) text += `\n${page.items.length} of ${page.total} — offset: ${page.nextOffset} for more\n`;
  return {
    content: [{ type: "text", text: text.trim() }],
    details: {
      mode: "search",
      matches: page.items.map(match => ({ server: match.server, tool: match.tool.name, score: match.score })),
      count: page.total,
      hasMore: page.hasMore,
      nextOffset: page.nextOffset,
      query,
    },
  };
}

async function executeConnect(runtime, serverName, signal) {
  if (!runtime.servers.has(serverName)) {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not found. Use mcp({}) to see available servers.` }],
      details: { mode: "connect", error: "not_found", server: serverName },
    };
  }
  try {
    await runtime.ensureConnected(serverName, signal);
    runtime.clearFailure(serverName);
    return executeList(runtime, serverName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = signal?.aborted === true || runtime.signal.aborted === true;
    if (!aborted) runtime.recordFailure(serverName, error);
    return {
      content: [{ type: "text", text: `Failed to connect to "${serverName}": ${message}` }],
      details: { mode: "connect", error: aborted ? "aborted" : "connect_failed", server: serverName, message },
    };
  }
}

async function executeCall(runtime, toolName, rawArgs, serverOverride, signal) {
  const resolved = runtime.resolveTool(toolName, serverOverride);
  if (resolved?.error) return resolved.error;
  if (!resolved) {
    const suggestions = runtime.suggestions(toolName, serverOverride);
    let message = `Tool "${toolName}" not found.`;
    const hintServer = serverOverride;
    const available = hintServer ? runtime.catalogTools(hintServer).map(tool => tool.name) : [];
    if (available.length > 0) {
      message += ` Server "${hintServer}" has: ${available.join(", ")}`;
    } else {
      message += ' Use mcp({ search: "..." }) to search.';
    }
    if (suggestions.length > 0) message += ` Did you mean: ${suggestions.join(", ")}`;
    return {
      content: [{ type: "text", text: message }],
      details: { mode: "call", error: "tool_not_found", requestedTool: toolName, hintServer, suggestions },
    };
  }
  const { server: serverName, tool } = resolved;
  const callIdentity = tool.resourceUri
    ? { server: serverName, resourceUri: tool.resourceUri, canonicalTool: tool.name }
    : { server: serverName, tool: tool.originalName, canonicalTool: tool.name };

  let args;
  try {
    args = normalizeToolArguments(rawArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const schemaText = tool.inputSchema ? `\n\nExpected parameters:\n${formatSchemaText(tool.inputSchema)}` : "";
    const guarded = await guardMcpOutput(
      [{ type: "text", text: message }],
      { prefix: "Failed to call tool: ", suffix: schemaText },
    );
    return {
      content: guarded.content,
      details: { mode: "call", error: "call_failed", ...callIdentity, message, ...guardedMcpDetails(guarded) },
    };
  }
  const validationError = tool.resourceUri ? null : proxyArgumentValidationError(tool.inputSchema, args);
  if (validationError) {
    const schemaText = `\n\nExpected parameters:\n${formatSchemaText(tool.inputSchema)}`;
    const guarded = await guardMcpOutput(
      [{ type: "text", text: validationError }],
      { prefix: "Failed to call tool: ", suffix: schemaText },
    );
    return {
      content: guarded.content,
      details: { mode: "call", error: "call_failed", ...callIdentity, message: validationError, ...guardedMcpDetails(guarded) },
    };
  }

  const server = runtime.servers.get(serverName);
  if (runtime.connectionStatus(serverName) === "failed") {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not available (last ${runtime.describeFailure(serverName)})` }],
      details: { mode: "call", error: "server_backoff", ...callIdentity },
    };
  }
  try {
    await runtime.ensureConnected(serverName, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = signal?.aborted === true || runtime.signal.aborted === true;
    if (!aborted) runtime.recordFailure(serverName, error);
    return {
      content: [{ type: "text", text: `Failed to connect to "${serverName}": ${message}` }],
      details: { mode: "call", error: aborted ? "aborted" : "connect_failed", ...callIdentity, message },
    };
  }
  const connected = runtime.servers.get(serverName);
  const client = connected?.client;
  if (!client || connected?.status !== "connected") {
    return {
      content: [{ type: "text", text: `Server "${serverName}" not connected` }],
      details: { mode: "call", error: "server_not_connected", ...callIdentity },
    };
  }
  if (runtime.isRetired(serverName, tool.originalName)) {
    return {
      content: [{ type: "text", text: `MCP tool "${tool.originalName}" on server "${serverName}" was not run: its definition changed after it was loaded, so the call was not sent. Start a new session to use the new definition.` }],
      details: { mode: "call", error: "not_sent", ...callIdentity, catalogChanged: true },
    };
  }
  const owned = combineSignals(runtime.signal, signal);
  const requestOptions = owned ? { signal: owned } : undefined;
  connected.inFlight += 1;
  try {
    runtime.touch(serverName);
    if (tool.resourceUri) {
      const result = await client.readResource({ uri: tool.resourceUri }, requestOptions);
      const content = transformMcpResourceContents(result.contents ?? [], runtime.resourceSession);
      const guarded = await guardMcpOutput(
        content.length > 0 ? content : [{ type: "text", text: "(empty resource)" }],
      );
      return {
        content: guarded.content,
        details: { mode: "call", ...callIdentity, ...guardedMcpDetails(guarded) },
      };
    }
    const result = await client.callTool(
      { name: tool.originalName, arguments: args },
      requestOptions,
    );
    const content = resolveMcpResultContent(result, runtime.resourceSession);
    const outputContent = content.length > 0 ? content : [{ type: "text", text: "(empty result)" }];
    if (result.isError) {
      const guarded = await guardMcpOutput(outputContent, {
        prefix: "Error: ",
        emptyTextFallback: "Tool execution failed",
      });
      return {
        content: guarded.content,
        details: { mode: "call", error: "tool_error", ...callIdentity, ...guardedMcpDetails(guarded) },
      };
    }
    const guarded = await guardMcpOutput(outputContent);
    return {
      content: guarded.content,
      details: { mode: "call", ...callIdentity, ...guardedMcpDetails(guarded) },
    };
  } catch (error) {
    const aborted = owned?.aborted === true;
    const message = error instanceof Error ? error.message : String(error);
    const schemaText = tool.inputSchema ? `\n\nExpected parameters:\n${formatSchemaText(tool.inputSchema)}` : "";
    const guarded = await guardMcpOutput(
      [{ type: "text", text: message }],
      { prefix: "Failed to call tool: ", suffix: schemaText },
    );
    return {
      content: guarded.content,
      details: {
        mode: "call",
        error: aborted ? "aborted" : "call_failed",
        ...callIdentity,
        message: guarded.details?.outputGuard ? "output truncated; see outputGuard.fullOutputPath" : message,
        ...guardedMcpDetails(guarded),
      },
    };
  } finally {
    connected.inFlight = Math.max(0, connected.inFlight - 1);
    runtime.touch(serverName);
  }
}

// ---------- 扩展与挂载面 ----------

const optionalNumber = schema => Type.Optional(schema);

/** 代理工具 schema（pi-mcp-adapter index.ts:2064-2086 同形——审判链按这些字段读面）。 */
const mcpProxyParameters = Type.Object({
  tool: Type.Optional(Type.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
  args: Type.Optional(Type.Union([
    Type.String({ description: 'Arguments as a JSON string (e.g., \'{"key": "value"}\')' }),
    Type.Object({}, { additionalProperties: true, description: 'Arguments as a JSON object (e.g., { "key": "value" })' }),
  ], { description: "Tool arguments as a JSON object, or as a JSON string encoding one" })),
  connect: Type.Optional(Type.String({ description: "Server name to connect (lazy connect + metadata refresh)" })),
  describe: Type.Optional(Type.String({ description: "Tool name to describe (shows parameters)" })),
  instructions: Type.Optional(Type.String({ description: "Server name to show that server's usage instructions" })),
  search: Type.Optional(Type.String({ description: "Search tools by name/description" })),
  searchMode: Type.Optional(Type.String({ enum: ["lexical", "semantic"], description: "Search backend (default: lexical; semantic is available when a System One key is configured)" })),
  regex: Type.Optional(Type.Boolean({ description: "Treat search as regex (default: substring match)" })),
  includeSchemas: Type.Optional(Type.Boolean({ description: "Include parameter schemas in search results (default: true)" })),
  limit: optionalNumber({ minimum: 1, description: "Maximum search results to return (default: 12)" }),
  offset: optionalNumber({ minimum: 0, description: "Search result offset (default: 0)" }),
  server: Type.Optional(Type.String({ description: "Server name: filters searches, disambiguates calls and describe operations, and optionally names an install" })),
  action: Type.Optional(Type.String({ description: "Action: 'install', 'ui-messages', 'auth-start', or 'auth-complete'" })),
  url: Type.Optional(Type.String({ description: "MCP endpoint URL for action: 'install'" })),
  target: Type.Optional(Type.String({ description: "Install target: 'global' (default) or 'project'" })),
});

const programmaticInstallUnavailable = {
  content: [{ type: "text", text: "MCP install is unavailable when the adapter uses programmatic configuration." }],
  details: { mode: "install", error: "programmatic_config" },
};

/**
 * 门开路径的 MCP 扩展。返回 { extension, adopt, close, dispose }：
 *   extension —— 单 "mcp" 代理工具的 pi-durable 扩展（registry.install 用）；
 *   adopt(alias, mcpConfig) —— 会话层在 createSession/policy 刷新时注入配置并做
 *     一次发现连接（连上→列目录→关 lazy）；
 *   close(alias) / dispose() —— 会话销毁 / sidecar 退出时收连接与定时器。
 */
export function createMilksuMcpExtension({
  resolveConversation,
  mcpConfigFor,
  environment = process.env,
} = {}) {
  if (typeof resolveConversation !== "function" || typeof mcpConfigFor !== "function") {
    throw new TypeError("createMilksuMcpExtension requires the session context");
  }
  const runtimes = new Map();

  function runtimeFor(alias) {
    return runtimes.get(alias);
  }

  async function adopt(alias, mcpConfig) {
    const previous = runtimes.get(alias);
    if (previous) await previous.close();
    if (!mcpConfig) {
      runtimes.delete(alias);
      return undefined;
    }
    const runtime = new McpConversationRuntime(alias, mcpConfig, { environment });
    runtimes.set(alias, runtime);
    await runtime.discover();
    return runtime;
  }

  async function close(alias) {
    const runtime = runtimes.get(alias);
    if (!runtime) return;
    runtimes.delete(alias);
    await runtime.close();
  }

  async function dispose() {
    const closing = [...runtimesOf(runtimes)].map(runtime => runtime.close());
    runtimes.clear();
    await Promise.all(closing);
  }

  const mcpTool = defineTool({
    name: MILKSU_MCP_TOOL_NAME,
    description: mcpProxyDescription(),
    // replay 默认 unsafe：MCP 调用可能有副作用；恢复重跑会重新过审判链审批
    //（DECISIONS Q3 的接受口径）。
    parameters: mcpProxyParameters,
    async execute(args, api, context) {
      const alias = resolveConversation(api.conversationId);
      const runtime = runtimeFor(alias);
      if (!runtime) {
        return {
          content: [{ type: "text", text: "MCP is not configured for this conversation." }],
          details: { error: "not_configured" },
        };
      }
      const signal = context?.abortSignal;
      let parsedArgs;
      try {
        parsedArgs = normalizeToolArguments(args?.args, "tool arguments");
      } catch (error) {
        // adapter 网关同款：坏 args 直接抛错（工具错误结果，模型可见消息）。
        throw error;
      }
      const hasGatewayMode = args?.tool !== undefined
        || args?.connect !== undefined
        || args?.describe !== undefined
        || args?.instructions !== undefined
        || args?.search !== undefined
        || args?.server !== undefined
        || args?.action !== undefined
        || args?.url !== undefined
        || args?.target !== undefined;
      if (!hasGatewayMode && args?.args !== undefined) {
        throw new Error('Gateway params were nested inside `args`; pass them top-level (for example, mcp({ search: "..." }) or mcp({ tool: "...", args: {} })).');
      }
      // 分发次序与 adapter 网关一致（index.ts:2182-2295）：
      // action > tool (call) > connect > describe > instructions > search > server (list) > status。
      // truthy 语义同款：tool/connect/describe/instructions/server 空串视为未提供，
      // search 只要求 !== undefined。
      const action = String(args?.action ?? "").trim();
      if (action) {
        if (action === "install") return programmaticInstallUnavailable;
        if (action === "ui-messages") {
          return {
            content: [{ type: "text", text: "No UI session messages available." }],
            details: { sessions: 0 },
          };
        }
        if (action === "auth-start") {
          if (!args?.server) {
            return {
              content: [{ type: "text", text: 'auth-start requires `server`. Example: mcp({ action: "auth-start", server: "linear-server" })' }],
              details: { mode: "auth-start", error: "missing_server" },
            };
          }
          return {
            content: [{ type: "text", text: `Server "${args.server}" is not configured for OAuth over HTTP (MilkSU harness MCP runs with autoAuth disabled).` }],
            details: { mode: "auth-start", error: "oauth_not_supported", server: String(args.server) },
          };
        }
        if (action === "auth-complete") {
          if (!args?.server) {
            return {
              content: [{ type: "text", text: "auth-complete requires `server`." }],
              details: { mode: "auth-complete", error: "missing_server" },
            };
          }
          const input = parsedArgs?.redirectUrl ?? parsedArgs?.code ?? parsedArgs?.input;
          if (typeof input !== "string" || input.trim().length === 0) {
            return {
              content: [{ type: "text", text: "auth-complete requires args with `redirectUrl`, `code`, or `input`." }],
              details: { mode: "auth-complete", error: "missing_input" },
            };
          }
          return {
            content: [{ type: "text", text: `Server "${args.server}" is not configured for OAuth over HTTP (MilkSU harness MCP runs with autoAuth disabled).` }],
            details: { mode: "auth-complete", error: "oauth_not_supported", server: String(args.server) },
          };
        }
        return {
          content: [{ type: "text", text: `Unknown mcp action "${action}".` }],
          details: { mode: "action", error: "unknown_action", action },
        };
      }
      if (args?.tool) {
        return executeCall(
          runtime,
          String(args.tool),
          parsedArgs,
          args?.server !== undefined ? String(args.server) : undefined,
          signal,
        );
      }
      if (args?.connect) {
        return executeConnect(runtime, String(args.connect), signal);
      }
      if (args?.describe) {
        return executeDescribe(
          runtime,
          String(args.describe),
          args?.server !== undefined ? String(args.server) : undefined,
        );
      }
      if (args?.instructions) {
        return executeInstructions(runtime, String(args.instructions));
      }
      if (args?.search !== undefined) {
        return executeSearch(runtime, String(args.search), {
          regex: args?.regex,
          server: args?.server !== undefined ? String(args.server) : undefined,
          includeSchemas: args?.includeSchemas,
          limit: Number(args?.limit ?? 12),
          offset: Number(args?.offset ?? 0),
        });
      }
      if (args?.server) {
        return executeList(runtime, String(args.server));
      }
      return executeStatus(runtime);
    },
  });

  const extension = defineExtension({
    name: MILKSU_MCP_EXTENSION,
    tools: [mcpTool],
  });
  return { extension, adopt, close, dispose };
}

function* runtimesOf(runtimes) {
  for (const runtime of runtimes.values()) yield runtime;
}

/**
 * 代理工具描述（buildProxyDescription 的门开版：服务器清单 + 用法行；#220 口径下
 * 无 install/search-mode 提示——服务器清单由漏斗给的配置决定，运行时目录变化靠
 * mcp({}) 刷新）。
 */
function mcpProxyDescription() {
  let description = "MCP gateway — server status, tool search/describe, and single MCP tool calls. Non-MCP tools should be called directly, not through mcp.\n";
  description += "\nUsage:\n";
  description += "  mcp({ })                              → Show server status and tool counts\n";
  description += '  mcp({ server: "name" })               → List tools from server\n';
  description += '  mcp({ search: "query" })              → Search MCP tools by name/description\n';
  description += '  mcp({ describe: "tool_name" })        → Show tool details and parameters\n';
  description += '  mcp({ instructions: "name" })         → Show full server usage instructions\n';
  description += '  mcp({ connect: "server-name" })       → Connect to a server and refresh metadata\n';
  description += '  mcp({ tool: "name", args: { key: "value" } })         → Call a tool (object args; JSON string also accepted)\n';
  description += "\nMode: action > tool (call) > connect > describe > instructions > search > server (list) > nothing (status)";
  return description;
}
