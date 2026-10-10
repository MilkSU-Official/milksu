// PR-2 批次 D2：扳机翻转的判定收口（门 + CTF/CVE/实验室工作区排除，唯一判定点）。
//
// 语义（FLIP-REVIEW-pi-harness.md #3 用户已过目；DECISIONS-pi-harness.md 总原则）：
//   新编码会话默认走 Harness；CTF/CVE/实验室（lab）类工作区的会话**无论门开关一律走
//   旧引擎**——ctf_*/env_* 域工具未移植，开门会缺工具。MILKSU_PI_HARNESS=0 显式关 =
//   回退旧引擎（门判定在 harness-adapter.isPiHarnessEnabled，本模块是它与排除逻辑的
//   合流点；bridge.js 只调 harnessSessionEligible，不散落第二处判定）。
//
// 排除信号的来源（与既有分流逻辑同一份约定）：
//   1. 工作区类型：workspace 根的 challenge.json 且 schemaVersion 以
//      "ctf-workspace.milksu.dev/" 开头 = CTF 工作区——bridge-policy.loadSessionPolicy
//      的 ctf:true 判定同源（internal/ctf/workspace.go:38 同一前缀口径）。一个 sidecar
//      进程一个工作区，结果按 cwd 缓存（进程内不变；读取一次，readFileSync）。
//   2. 会话角色（send_message 命令自带，supervisor.go:1975）：cve-research / lab-job
//      （研究角色，bridge-workspace.isResearchSessionRole）与 solver / strategist /
//      tool-builder（CTF 角色，cmd/milksu-backend/app.go:1482-1496 的派发面）。
//   3. conversationId 前缀 "ctf_"：宿主 CTF 会话 id 的生成约定
//      （internal/ctf/workspace.go:464），不带角色的命令（abort/compact/…）也能判。
//
// 已知边界（如实披露，见 D2 交付报告）：destroy/compact/fork 等命令不携带 sessionRole，
// 研究角色的会话若在 sidecar 重启后未经 send_message 重建即收到这类命令，只能靠本工作
// 区是否 CTF（信号 1）判定——CVE/lab 工作区没有 challenge.json，此类「重启后先 fork/删
// 研究会话」的窄窗会走 Harness 层（fork/rewind 得到「不支持」的如实回包，与 Q1 对旧
// 会话的口径一致；destroy 为无害清场）。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPiHarnessEnabled } from "./harness-adapter.js";
import { isResearchSessionRole } from "./bridge-workspace.js";

export const CTF_WORKSPACE_SCHEMA_PREFIX = "ctf-workspace.milksu.dev/";
export const CTF_WORKSPACE_MANIFEST_FILE = "challenge.json";
export const CTF_CONVERSATION_ID_PREFIX = "ctf_";

/** CTF 会话角色（宿主 ctf.AgentWorkspaceRole* 的派发面；见文件头信号 2）。 */
export const ctfSessionRoles = Object.freeze(["solver", "strategist", "tool-builder"]);

// 工作区类型缓存：cwd → 是否 CTF 工作区。进程内 cwd 不变，但测试可能切换目录，
// 按 cwd 记键；读取失败（无 challenge.json / 解析失败）按「非 CTF」处理——
// loadSessionPolicy 对解析失败同样会在旧路径如实抛错，不在这里抢跑。
const ctfWorkspaceByCwd = new Map();

export function isCtfWorkspace(cwd = process.cwd()) {
  const key = String(cwd ?? "");
  const cached = ctfWorkspaceByCwd.get(key);
  if (cached !== undefined) return cached;
  let result = false;
  try {
    const manifest = JSON.parse(readFileSync(join(key, CTF_WORKSPACE_MANIFEST_FILE), "utf8"));
    result = String(manifest?.schemaVersion ?? "").startsWith(CTF_WORKSPACE_SCHEMA_PREFIX);
  } catch {
    // ENOENT（普通编码工作区）与读取/解析异常都按非 CTF 处理；真正的 CTF 工作区
    // schema 由 loadSessionPolicy 在会话创建时给出明确错误。
    result = false;
  }
  ctfWorkspaceByCwd.set(key, result);
  return result;
}

/** 本会话是否属于被排除的 CTF/CVE/实验室面（与门开关无关，一律旧引擎）。 */
export function harnessSessionExcluded(command = {}, cwd = process.cwd()) {
  const id = String(command?.conversationId ?? "").trim();
  const role = String(command?.sessionRole ?? "").trim();
  if (ctfSessionRoles.includes(role)) return true;
  if (isResearchSessionRole(role)) return true;
  if (id.startsWith(CTF_CONVERSATION_ID_PREFIX)) return true;
  return isCtfWorkspace(cwd);
}

/**
 * 扳机判定（bridge.js 的唯一调用点）：门开（缺省开，MILKSU_PI_HARNESS=0 显式关）且
 * 不在 CTF/CVE/实验室排除面 → 新会话可走 Harness。已是 Harness 会话的路由按
 * sessions map 的 kind 判定，不经本函数。
 */
export function harnessSessionEligible(command = {}, environment = process.env, cwd = process.cwd()) {
  return isPiHarnessEnabled(environment) && !harnessSessionExcluded(command, cwd);
}
