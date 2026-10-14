// PR-2 批次 D2：扳机翻转判定收口（harness-bridge-flip）的单元面。
//
// 覆盖：门翻转语义（缺省开/0 显式关）、isCtfWorkspace 恒 false、
// 会话角色排除（遗留 solver 三角色 + 研究两角色）、遗留 ctf_ 会话 id 前缀、
// 以及「排除与门开关无关」的组合语义。

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

test("retired CTF workspace manifests no longer exclude sessions", async () => {
  await withWorkspaces(({ coding, ctf, staleSchema, broken }) => {
    assert.equal(isCtfWorkspace(ctf), false);
    assert.equal(isCtfWorkspace(coding), false);
    assert.equal(isCtfWorkspace(staleSchema), false);
    assert.equal(isCtfWorkspace(broken), false);
    assert.equal(isCtfWorkspace(join(coding, "does-not-exist")), false);
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
    // 遗留会话 id 前缀；不带 sessionRole 的命令（abort/compact/destroy/…）靠它判定。
    assert.equal(harnessSessionExcluded({ conversationId: "ctf_9f2a71" }, coding), true);
    assert.equal(harnessSessionExcluded({ conversationId: "ctf_tool_9f2a71" }, coding), true);
    assert.equal(harnessSessionExcluded({ conversationId: "ctf_strategy_9f2a71" }, coding), true);
    assert.equal(harnessSessionExcluded({ conversationId: "conv_9f2a71" }, coding), false);
    assert.equal(harnessSessionExcluded({ conversationId: "lab-job-42" }, coding), false,
      "lab-job ids without a role are not excludable — the role rides on send_message (disclosed edge)");
  });
});

test("a leftover CTF workspace is eligible for harness as coding", async () => {
  await withWorkspaces(({ ctf }) => {
    assert.equal(harnessSessionExcluded({ conversationId: "conv-anything" }, ctf), false);
    assert.equal(harnessSessionExcluded({}, ctf), false);
    assert.equal(harnessSessionEligible({}, {}, ctf), true);
    assert.equal(harnessSessionEligible({}, { MILKSU_PI_HARNESS: "1" }, ctf), true);
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
    assert.equal(harnessSessionEligible({}, {}, ctf), true);
    // 门显式关（回退）→ 一律旧引擎，无论排除面。
    assert.equal(harnessSessionEligible({}, { MILKSU_PI_HARNESS: "0" }, coding), false);
    assert.equal(harnessSessionEligible({ conversationId: "ctf_1" }, { MILKSU_PI_HARNESS: "0" }, ctf), false);
  });
});
