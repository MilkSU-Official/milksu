import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assignWriterWorktrees,
  codingCollaborationChanged,
  codingSubagentGuidance,
  codingWorkspaceIdentityGuidance,
  formatSubagentApproval,
  normalizeCodingCollaboration,
  validateSubagentInput,
  writerWorktreesRequired,
} from "./bridge-collaboration.js";

async function fixture(writers = 2) {
  const root = await mkdtemp(join(tmpdir(), "milksu-collaboration-"));
  const workspace = join(root, "workspace");
  const collaborationRoot = join(root, "runtime");
  const conversationId = "coding-conversation";
  const key = createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
  await mkdir(workspace);
  const worktrees = [];
  for (let index = 1; index <= writers; index += 1) {
    const id = `writer-${index}`;
    const path = join(collaborationRoot, key, id);
    await mkdir(path, { recursive: true });
    worktrees.push({
      id,
      path,
      branch: `codex/agent-${key.slice(0, 12)}-writer-${index}`,
    });
  }
  const descriptor = normalizeCodingCollaboration({
    schemaVersion: 2,
    conversationId,
    workspace,
    baseHead: "a".repeat(40),
    worktrees,
  }, conversationId, workspace, collaborationRoot);
  return {
    descriptor,
    workspace: await realpath(workspace),
    worktrees: await Promise.all(worktrees.map(async value => ({
      ...value,
      path: await realpath(value.path),
    }))),
  };
}

test("normalizes a conversation-bound worktree descriptor", async () => {
  const { descriptor, workspace, worktrees } = await fixture();
  assert.equal(descriptor.workspace, workspace);
  assert.deepEqual(
    descriptor.worktrees.map(value => value.path),
    worktrees.map(value => value.path),
  );
  assert.equal(codingCollaborationChanged(descriptor, descriptor), false);
  assert.equal(codingCollaborationChanged(undefined, descriptor), true);
});

test("main workspace identity cannot be replaced by writer worktree metadata", async () => {
  const { descriptor, workspace, worktrees } = await fixture();
  const guidance = codingWorkspaceIdentityGuidance(workspace, descriptor);
  assert.match(guidance, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(guidance, /本主会话的权威工作目录/);
  assert.match(guidance, /不能取代主会话工作目录/);
  for (const worktree of worktrees) {
    assert.equal(guidance.includes(worktree.path), false);
  }
});

test("one launch uses the main workspace or a registered writer", async () => {
  const { descriptor, workspace, worktrees } = await fixture();
  const onMain = validateSubagentInput({
    agent: "worker",
    task: "change code",
    cwd: workspace,
  }, descriptor, workspace);
  assert.equal(onMain.mode, "single");
  assert.equal(onMain.externalCli, false);
  assert.equal(onMain.tasks[0].cwd, workspace);
  assert.equal(onMain.tasks[0].access, "workspace");
  const isolated = validateSubagentInput({
    agent: "worker",
    task: "change code",
    cwd: worktrees[0].path,
  }, descriptor, workspace);
  assert.equal(isolated.tasks[0].access, "worktree");
  assert.throws(
    () => validateSubagentInput({
      tasks: [
        { agent: "worker", task: "first" },
        { agent: "worker", task: "second" },
      ],
    }, descriptor, workspace),
    /one subagent launch per call/,
  );
  assert.throws(
    () => validateSubagentInput({
      chain: [{ agent: "worker", task: "implement" }],
    }, descriptor, workspace),
    /one subagent launch per call/,
  );
});

test("read-only roles can inspect main but unknown agents and outside cwd are rejected", async () => {
  const { descriptor, workspace } = await fixture(1);
  const accepted = validateSubagentInput({
    agent: "reviewer",
    task: "review the integration",
  }, descriptor);
  assert.equal(accepted.tasks[0].cwd, workspace);
  assert.equal(accepted.tasks[0].access, "read-only");
  assert.throws(
    () => validateSubagentInput({
      agent: "custom-project-agent",
      task: "run",
      agentScope: "project",
    }, descriptor),
    /reviewed bundled/,
  );
  assert.throws(
    () => validateSubagentInput({
      agent: "worker",
      task: "run",
      cwd: "/tmp",
    }, descriptor),
    /working directory is unavailable|registered writer worktree/,
  );
});

test("bundled roles work without collaboration worktrees", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-subagent-main-"));
  const accepted = validateSubagentInput({
    agent: "scout",
    task: "Look up the public subapi documentation and summarize the endpoints.",
  }, undefined, workspace);
  assert.equal(accepted.tasks[0].agent, "scout");
  assert.equal(accepted.tasks[0].access, "read-only");
  assert.equal(accepted.tasks[0].cwd, await realpath(workspace));
  const writer = validateSubagentInput({
    agent: "worker",
    task: "edit the repo",
  }, undefined, workspace);
  assert.equal(writer.tasks[0].access, "workspace");
  const summary = formatSubagentApproval({
    agent: "scout",
    task: "Look up the public subapi documentation.",
  }, undefined, workspace);
  assert.match(summary, /single · 1 个后台 Pi 会话/);
  assert.match(summary, /scout → 主工作区/);
  assert.match(codingSubagentGuidance(), /status/);
  assert.doesNotMatch(codingSubagentGuidance(), /at most four/);
  assert.doesNotMatch(codingSubagentGuidance(), /scout, planner, reviewer/);
  assert.doesNotMatch(codingSubagentGuidance(), /IDA Pro/);
});

test("day-one cuts and legacy fanout are rejected", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-subagent-cuts-"));
  for (const input of [
    { agent: "worker", task: "run", workflowScript: "return 1" },
    { agent: "worker", task: "run", workflowScriptPath: "flow.js" },
    { agent: "worker", task: "run", share: true },
    { action: "inspector.open" },
    { action: "project.open" },
    { action: "create", agent: "worker" },
    { action: "refine", agent: "worker" },
    { agentScope: "both", agent: "scout", task: "look" },
  ]) {
    assert.throws(
      () => validateSubagentInput(input, undefined, workspace),
      /workflow scripts|share subagent|tmux|blocked subagent action|reviewed bundled|one subagent/,
    );
  }
});

test("external CLI launches are marked and status is not", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-subagent-cli-"));
  const cursor = validateSubagentInput({
    agent: "cursor-agent",
    task: "inspect the diff",
  }, undefined, workspace);
  assert.equal(cursor.externalCli, true);
  assert.equal(cursor.tasks[0].access, "workspace");
  const status = validateSubagentInput({
    action: "status",
    id: "run-1",
  }, undefined, workspace);
  assert.equal(status.mode, "control");
  assert.equal(status.externalCli, false);
  assert.equal(formatSubagentApproval({
    action: "steer",
    id: "run-1",
  }, undefined, workspace), "steer");
});

test("writer demand is not preallocated by role", () => {
  assert.equal(writerWorktreesRequired({ agent: "scout", task: "look" }), 0);
  assert.equal(writerWorktreesRequired({ agent: "worker", task: "edit" }), 0);
  assert.equal(writerWorktreesRequired({
    tasks: [
      { agent: "worker", task: "one" },
      { agent: "worker", task: "two" },
    ],
  }), 0);
  assert.equal(writerWorktreesRequired(undefined), 0);
});

test("the product does not relocate a launch onto a writer worktree", async () => {
  const { descriptor, workspace, worktrees } = await fixture();
  const single = { agent: "worker", task: "implement the slice" };
  assignWriterWorktrees(single, descriptor);
  assert.equal(single.cwd, undefined);
  assert.equal(
    validateSubagentInput(single, descriptor, workspace).tasks[0].access,
    "workspace",
  );
  assert.equal(worktrees.length, 2);
});

test("assignment keeps a registered writer the model already chose", async () => {
  const { descriptor, workspace, worktrees } = await fixture();
  const single = {
    agent: "worker",
    task: "implement",
    cwd: worktrees[1].path,
  };
  assignWriterWorktrees(single, descriptor);
  assert.equal(single.cwd, worktrees[1].path);
  const accepted = validateSubagentInput(single, descriptor, workspace);
  assert.equal(accepted.mode, "single");
  assert.equal(accepted.tasks[0].cwd, worktrees[1].path);
  assert.equal(accepted.tasks[0].access, "worktree");
});

test("assignment leaves a read-only role in the main workspace", async () => {
  const { descriptor, workspace } = await fixture();
  const single = { agent: "scout", task: "survey" };
  assignWriterWorktrees(single, descriptor);
  assert.equal(single.cwd, undefined);
  const accepted = validateSubagentInput(single, descriptor, workspace);
  assert.equal(accepted.tasks[0].cwd, workspace);
  assert.equal(accepted.tasks[0].access, "read-only");
});

test("assignment without a prepared collaboration changes nothing", async () => {
  const single = { agent: "worker", task: "implement" };
  assignWriterWorktrees(single, undefined);
  assert.equal(single.cwd, undefined);
});

test("approval summary exposes role, mode, branch, and task", async () => {
  const { descriptor, worktrees } = await fixture(1);
  const summary = formatSubagentApproval({
    agent: "worker",
    task: "Implement the focused slice and verify it.",
    cwd: worktrees[0].path,
  }, descriptor);
  assert.match(summary, /single · 1 个后台 Pi 会话/);
  assert.match(summary, /worker → writer-1/);
  assert.equal(summary.includes("codex/agent-"), true);
  assert.match(summary, /Implement the focused slice/);
});
