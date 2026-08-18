import { posix } from "node:path";

export function codingBrowserGuidance() {
  return [
    "MilkSU's built-in isolated browser is already part of this app.",
    "Use the milksu-playwright MCP tools to open and operate pages in the right-hand browser.",
    "Never ask the user to enable Coding Browser, open Settings, or pick a capability first.",
    "Browser Use (the user's real Chrome/Edge tab) and Computer Use still require an explicit user-selected scope.",
  ].join(" ");
}

export const codingBrowserMcpServerName = "milksu-playwright";
export const browserUseMcpServerName = "milksu-playwright-user";
export const codingBrowserExcludedTools = Object.freeze([
  "browser_run_code_unsafe",
]);

function firstPartyBrowserServer(serverName) {
  const normalized = String(serverName ?? "").trim();
  return normalized === codingBrowserMcpServerName
    || normalized === browserUseMcpServerName;
}

function browserSurfaceLabel(serverName) {
  return String(serverName ?? "").trim() === browserUseMcpServerName
    ? "用户 Browser Use"
    : "隔离 Coding Browser";
}

const maxApprovalValueCharacters = 240;

function bounded(value, limit = maxApprovalValueCharacters) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}…`;
}

function parseMcpArguments(input) {
  const raw = input?.args;
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function baseToolName(value) {
  const tool = String(value ?? "").trim();
  for (const candidate of codingBrowserExcludedTools) {
    if (tool === candidate || tool.endsWith(`_${candidate}`)) return candidate;
  }
  const browserIndex = tool.lastIndexOf("browser_");
  return browserIndex >= 0 ? tool.slice(browserIndex) : tool;
}

function quoted(value) {
  const normalized = bounded(value);
  return normalized ? JSON.stringify(normalized) : "";
}

function formatFormFields(value) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const visible = value.slice(0, 4).map((field) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return "";
    const name = quoted(field.name);
    const type = bounded(field.type);
    const target = quoted(field.target);
    const fieldValue = quoted(field.value);
    return [
      name ? `字段 ${name}` : "字段",
      type ? `类型 ${type}` : "",
      target ? `目标 ${target}` : "",
      fieldValue ? `值 ${fieldValue}` : "",
    ].filter(Boolean).join(" · ");
  }).filter(Boolean);
  if (value.length > visible.length) {
    visible.push(`另有 ${value.length - visible.length} 个字段`);
  }
  return visible.join("；");
}

export function codingBrowserEvidenceRelativePath(sessionId) {
  const normalized = String(sessionId ?? "").trim();
  if (!/^browser_[A-Za-z0-9-]{8,128}$/u.test(normalized)) return "";
  return `.milksu/browser-evidence/${normalized}`;
}

export function codingBrowserToolBlockReason(input, serverName) {
  if (!firstPartyBrowserServer(serverName)) return "";
  const tool = baseToolName(input?.tool);
  if (codingBrowserExcludedTools.includes(tool)) {
    return "MilkSU blocked browser_run_code_unsafe because it executes arbitrary "
      + "JavaScript inside the Playwright server. Use the reviewed browser tools instead.";
  }
  return "";
}

export function codingBrowserEvidenceFileBlockReason(input, serverName, sessionId) {
  if (!firstPartyBrowserServer(serverName)) return "";
  const filename = String(parseMcpArguments(input).filename ?? "").trim();
  if (!filename) return "";
  const evidencePath = codingBrowserEvidenceRelativePath(sessionId);
  if (!evidencePath) {
    return "MilkSU rejected a Browser evidence file without a valid isolated session.";
  }
  if (
    filename.includes("\0")
    || filename.includes("\\")
    || posix.isAbsolute(filename)
  ) {
    return `MilkSU requires Browser evidence files under ${evidencePath}.`;
  }
  const normalized = posix.normalize(filename);
  const relative = posix.relative(evidencePath, normalized);
  if (
    normalized !== filename
    || relative === ""
    || relative === ".."
    || relative.startsWith("../")
    || posix.isAbsolute(relative)
  ) {
    return `MilkSU requires Browser evidence files under ${evidencePath}.`;
  }
  return "";
}

export function formatCodingBrowserApprovalInput(input, serverName) {
  if (!firstPartyBrowserServer(serverName)) return "";
  const tool = baseToolName(input?.tool);
  const action = bounded(input?.action ?? input?.connect);
  const args = parseMcpArguments(input);
  const details = [browserSurfaceLabel(serverName)];

  if (tool) details.push(`工具 ${tool}`);
  else if (action) details.push(`操作 ${action}`);

  const url = quoted(args.url);
  const element = quoted(args.element);
  const target = quoted(args.target);
  const filename = quoted(args.filename);

  if (url) details.push(`地址 ${url}`);
  if (element) details.push(`元素 ${element}`);
  if (target) details.push(`目标 ${target}`);

  if (tool === "browser_type") {
    const text = quoted(args.text);
    if (text) details.push(`输入 ${text}`);
  }
  if (tool === "browser_fill_form") {
    const fields = formatFormFields(args.fields);
    if (fields) details.push(fields);
  }
  if (tool === "browser_select_option" && Array.isArray(args.values)) {
    const values = quoted(args.values.join(", "));
    if (values) details.push(`选项 ${values}`);
  }
  if (tool === "browser_tabs") {
    const tabAction = bounded(args.action);
    if (tabAction) details.push(`标签页 ${tabAction}`);
    if (Number.isInteger(args.index)) details.push(`序号 ${args.index}`);
  }
  if (filename) details.push(`证据 ${filename}`);
  if (args.fullPage === true) details.push("整页截图");
  if (args.submit === true) details.push("输入后提交");

  return details.join(" · ");
}
