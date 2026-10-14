// 门判定 + 排除面的唯一收口点。bridge.js 只调 harnessSessionEligible。
//
// 新编码会话默认走 Harness。MILKSU_PI_HARNESS=0 显式关 = 回退旧引擎。
// CVE / 实验室研究角色（cve-research / lab-job）无论门开关一律旧引擎。
//
// 产品面已移除 CTF。isCtfWorkspace 恒为 false，不再按 challenge.json 当活工作区。
// conversationId 前缀 "ctf_" 仍排除：那是旧会话 id，旧记录还要能打开，走 legacy engine。
// 旧角色 solver / strategist / tool-builder 同样走旧引擎。

import { isPiHarnessEnabled } from "./harness-adapter.js";
import { isResearchSessionRole } from "./bridge-workspace.js";

export const CTF_WORKSPACE_SCHEMA_PREFIX = "ctf-workspace.milksu.dev/";
export const CTF_WORKSPACE_MANIFEST_FILE = "challenge.json";
/** Leftover conversation id prefix. Not a live CTF product surface. */
export const CTF_CONVERSATION_ID_PREFIX = "ctf_";

/** Leftover session roles. Product CTF is gone; these still run on the legacy engine. */
export const ctfSessionRoles = Object.freeze(["solver", "strategist", "tool-builder"]);

/** Product CTF workspaces are gone. Always false. */
export function isCtfWorkspace(cwd = process.cwd()) {
  void cwd;
  return false;
}

/** CVE / Lab research roles, leftover ctf_ ids, leftover solver roles: legacy engine. */
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
 * 不在排除面 → 新会话可走 Harness。已是 Harness 会话的路由按
 * sessions map 的 kind 判定，不经本函数。
 */
export function harnessSessionEligible(command = {}, environment = process.env, cwd = process.cwd()) {
  return isPiHarnessEnabled(environment) && !harnessSessionExcluded(command, cwd);
}
