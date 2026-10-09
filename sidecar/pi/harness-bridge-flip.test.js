// PR-2 批次 D2：扳机翻转判定收口（harness-bridge-flip）的单元面。
//
// 覆盖：门翻转语义（缺省开/0 显式关——语义断言在 harness-adapter/gate 契约里，这里只
// 验组合）、CTF 工作区识别（challenge.json 的 schema 前缀口径与 loadSessionPolicy 同源）、
// 会话角色排除（CTF 三角色 + 研究两角色）、ctf_ 前缀、以及「排除与门开关无关」的组合
// 语义（门开也被排除、门关排除面自然也走旧引擎）。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CTF_CONVERSATION_ID_PREFIX,
  CTF_WORKSPACE_MANIFEST_FILE,
  CTF_WORKSPACE_SCHEMA_PREFIX,
  ctfSessionRoles,
  harnessSessionEligible,
  harnessSessionExcluded,
  isCtfWorkspace,
} from "./harness-bridge-flip.js";

async function withWorkspaces(run) {
  const root = await mkdtemp(join(tmpdir(), "milksu-flip-"));
  const coding = join(root, "coding-ws");
  const ctf = join(root, "ctf-ws");
  const staleSchema = join(root, "stale-schema-ws");
  const broken = join(root, "broken-json-ws");
  await mkdir(coding, { recursive: true });
  await mkdir(ctf, { recursive: true });
  await mkdir(staleSchema, { recursive: true });
  await mkdir(broken, { recursive: true });
  await writeFile(join(ctf, CTF_WORKSPACE_MANIFEST_FILE), `${JSON.stringify({
    schemaVersion: `${CTF_WORKSPACE_SCHEMA_PREFIX}v1alpha2`,
    challenge: {},
  })}\n`);
  await writeFile(join(staleSchema, CTF_WORKSPACE_MANIFEST_FILE), `${JSON.stringify({
    schemaVersion: "some-unrelated-schema/v9",
  })}\n`);
  await writeFile(join(broken, CTF_WORKSPACE_MANIFEST_FILE), "not json at all");
  try {
    return await run({ root, coding, ctf, staleSchema, broken });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("CTF workspace detection follows the challenge.json schema prefix convention", async () => {
  await withWorkspaces(({ coding, ctf, staleSchema, broken }) => {
    assert.equal(isCtfWorkspace(ctf), true, "ctf-workspace.milksu.dev/* schema marks a CTF workspace");
    assert.equal(isCtfWorkspace(coding), false, "no challenge.json = coding workspace");
    // loadSessionPolicy 的同款口径：无关 schemaVersion 的 challenge.json 不算 CTF
    // （会在会话创建时按编码工作区处理）。
    assert.equal(isCtfWorkspace(staleSchema), false);
    // 解析失败按非 CTF 处理——真正的错误由 loadSessionPolicy 在旧路径如实抛。
    assert.equal(isCtfWorkspace(broken), false);
    assert.equal(isCtfWorkspace(join(coding, "does-not-exist")), false);
    // 结果按 cwd 缓存：同一路径两次判定一致。
    assert.equal(isCtfWorkspace(ctf), isCtfWorkspace(ctf));
  });
});

test("excluded roles: CTF solver/strategist/tool-builder and research cve-research/lab-job", async () => {
  await withWorkspaces(({ coding }) => {
    for (const role of [...ctfSessionRoles, "cve-research", "lab-job"]) {
      assert.equal(
        harnessSessionExcluded({ conversationId: "conv-role", sessionRole: role }, coding),
        true,
        `${role} sessions always run on the legacy engine`,
      );
    }
    // 普通编码会话与空角色不排除。
    assert.equal(harnessSessionExcluded({ conversationId: "conv-normal" }, coding), false);
    assert.equal(harnessSessionExcluded({}, coding), false);
    // 未知名不误伤。
    assert.equal(harnessSessionExcluded({ conversationId: "conv-x", sessionRole: "reviewer" }, coding), false);
  });
});

test(`conversation ids with the ${CTF_CONVERSATION_ID_PREFIX} prefix are excluded without a role`, async () => {
  await withWorkspaces(({ coding }) => {
    // 宿主的 CTF 会话 id 生成约定（internal/ctf/workspace.go:464）；不带 sessionRole 的
    // 命令（abort/compact/destroy/…）靠它判定。
    assert.equal(harnessSessionExcluded({ conversationId: "ctf_9f2a71" }, coding), true);
    assert.equal(harnessSessionExcluded({ conversationId: "ctf_tool_9f2a71" }, coding), true);
    assert.equal(harnessSessionExcluded({ conversationId: "ctf_strategy_9f2a71" }, coding), true);
    assert.equal(harnessSessionExcluded({ conversationId: "conv_9f2a71" }, coding), false);
    assert.equal(harnessSessionExcluded({ conversationId: "lab-job-42" }, coding), false,
      "lab-job ids without a role are not excludable — the role rides on send_message (disclosed edge)");
  });
});

test("a CTF workspace excludes every session regardless of id or role", async () => {
  await withWorkspaces(({ ctf }) => {
    assert.equal(harnessSessionExcluded({ conversationId: "conv-anything" }, ctf), true);
    assert.equal(harnessSessionExcluded({}, ctf), true);
    // 与门开关无关：门开也被排除（FLIP-REVIEW #3）。
    assert.equal(harnessSessionEligible({}, {}, ctf), false);
    assert.equal(harnessSessionEligible({}, { MILKSU_PI_HARNESS: "1" }, ctf), false);
  });
});

test("eligibility combines the flipped gate with the exclusion surface", async () => {
  await withWorkspaces(({ coding, ctf }) => {
    // 缺省开 + 普通编码会话 → Harness。
    assert.equal(harnessSessionEligible({}, {}, coding), true);
    assert.equal(harnessSessionEligible({ conversationId: "conv-1" }, { MILKSU_PI_HARNESS: "1" }, coding), true);
    // 门开 + 排除面 → 旧引擎。
    assert.equal(harnessSessionEligible({ sessionRole: "cve-research" }, {}, coding), false);
    assert.equal(harnessSessionEligible({ conversationId: "ctf_1" }, {}, coding), false);
    assert.equal(harnessSessionEligible({}, {}, ctf), false);
    // 门显式关（回退）→ 一律旧引擎，无论排除面。
    assert.equal(harnessSessionEligible({}, { MILKSU_PI_HARNESS: "0" }, coding), false);
    assert.equal(harnessSessionEligible({ conversationId: "ctf_1" }, { MILKSU_PI_HARNESS: "0" }, ctf), false);
  });
});
