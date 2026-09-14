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
  assert.match(guidance, /authoritative working directory for this main session/);
  assert.match(guidance, /never replace the main session working directory/);
  for (const worktree of worktrees) {
    assert.equal(guidance.includes(worktree.path), false);
  }
});

test("writing agents require distinct registered worktrees", async () => {
  const { descriptor, workspace, worktrees } = await fixture();
  assert.throws(
    () => validateSubagentInput({
      agent: "worker",
      task: "change code",
      cwd: workspace,
    }, descriptor),
    /requires its own writer worktree/,
  );
  assert.throws(
    () => validateSubagentInput({
      tasks: [
        { agent: "worker", task: "first", cwd: worktrees[0].path },
        { agent: "verifier", task: "second", cwd: worktrees[0].path },
      ],
    }, descriptor),
    /distinct writer worktrees/,
  );

  const accepted = validateSubagentInput({
    tasks: [
      { agent: "worker", task: "first", cwd: worktrees[0].path },
      { agent: "verifier", task: "second", cwd: worktrees[1].path },
    ],
  }, descriptor);
  assert.equal(accepted.mode, "parallel");
  assert.deepEqual(
    accepted.tasks.map(value => value.cwd),
    worktrees.map(value => value.path),
  );
});

test("chained writing agents still require distinct writer worktrees", async () => {
  const { descriptor, worktrees } = await fixture();
  assert.throws(
    () => validateSubagentInput({
      chain: [
        { agent: "worker", task: "implement", cwd: worktrees[0].path },
        { agent: "verifier", task: "verify and patch", cwd: worktrees[0].path },
      ],
    }, descriptor),
    /distinct writer worktrees/,
  );

  const accepted = validateSubagentInput({
    chain: [
      { agent: "worker", task: "implement", cwd: worktrees[0].path },
      { agent: "verifier", task: "verify and patch", cwd: worktrees[1].path },
    ],
  }, descriptor);
  assert.equal(accepted.mode, "chain");
  assert.deepEqual(
    accepted.tasks.map(value => value.cwd),
    worktrees.map(value => value.path),
  );
});

test("read-only roles can inspect main but project and unknown agents are rejected", async () => {
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

test("read-only subagents work without collaboration worktrees", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-subagent-main-"));
  const accepted = validateSubagentInput({
    agent: "scout",
    task: "Look up the public subapi documentation and summarize the endpoints.",
  }, undefined, workspace);
  assert.equal(accepted.tasks[0].agent, "scout");
  assert.equal(accepted.tasks[0].access, "read-only");
  assert.equal(accepted.tasks[0].cwd, await realpath(workspace));
  assert.throws(
    () => validateSubagentInput({
      agent: "worker",
      task: "edit the repo",
    }, undefined, workspace),
    /prepared Git collaboration/,
  );
  const summary = formatSubagentApproval({
    agent: "scout",
    task: "Look up the public subapi documentation.",
  }, undefined, workspace);
  assert.match(summary, /scout → 主工作树（只读角色）/);
  assert.match(codingSubagentGuidance(), /at most four/);
  // Role names and when-to-use belong to the subagent tool schema, not to a
  // per-turn system prompt essay.
  assert.doesNotMatch(codingSubagentGuidance(), /scout, planner, reviewer/);
  assert.doesNotMatch(codingSubagentGuidance(), /IDA Pro/);
});

test("read-only parallel lanes accept four scouts and reject a fifth", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-subagent-lanes-"));
  const accepted = validateSubagentInput({
    tasks: [
      { agent: "scout", task: "HTTP surface" },
      { agent: "scout", task: "DNS and certificates" },
      { agent: "security-auditor", task: "bound lease extras" },
      { agent: "reviewer", task: "summarize inventory gaps" },
    ],
  }, undefined, workspace);
  assert.equal(accepted.mode, "parallel");
  assert.equal(accepted.tasks.length, 4);
  assert.equal(accepted.tasks.every(task => task.access === "read-only"), true);
  assert.throws(
    () => validateSubagentInput({
      tasks: [
        { agent: "scout", task: "one" },
        { agent: "scout", task: "two" },
        { agent: "scout", task: "three" },
        { agent: "scout", task: "four" },
        { agent: "scout", task: "five" },
      ],
    }, undefined, workspace),
    /at most 4 subagent tasks/,
  );
});

test("writer demand is counted before anything is prepared", async () => {
  assert.equal(writerWorktreesRequired({ agent: "scout", task: "look" }), 0);
  assert.equal(writerWorktreesRequired({ agent: "worker", task: "edit" }), 1);
  assert.equal(writerWorktreesRequired({
    tasks: [
      { agent: "worker", task: "one" },
      { agent: "verifier", task: "two" },
    ],
  }), 2);
  // More writing roles than registered writers still asks for the bound, and a
  // malformed delegation asks for nothing so validation owns the rejection.
  assert.equal(writerWorktreesRequired({
    tasks: [
      { agent: "worker", task: "one" },
      { agent: "verifier", task: "two" },
      { agent: "refactorer", task: "three" },
    ],
  }), 2);
  assert.equal(writerWorktreesRequired({ agent: "worker", tasks: [] }), 0);
  assert.equal(writerWorktreesRequired(undefined), 0);
});

test("the product assigns writer worktrees the model was never told about", async () => {
  const { descriptor, workspace, worktrees } = await fixture();

  const single = { agent: "worker", task: "implement the slice" };
  assignWriterWorktrees(single, descriptor);
  assert.equal(single.cwd, worktrees[0].path);
  assert.equal(
    validateSubagentInput(single, descriptor, workspace).tasks[0].access,
    "worktree",
  );

  const parallel = {
    tasks: [
      { agent: "worker", task: "implement" },
      { agent: "verifier", task: "verify" },
    ],
  };
  assignWriterWorktrees(parallel, descriptor);
  assert.deepEqual(
    parallel.tasks.map(task => task.cwd),
    worktrees.map(value => value.path),
  );
  assert.equal(validateSubagentInput(parallel, descriptor, workspace).mode, "parallel");
});

test("assignment keeps a registered writer the model already chose", async () => {
  const { descriptor, workspace, worktrees } = await fixture();
  const parallel = {
    tasks: [
      { agent: "worker", task: "implement", cwd: worktrees[1].path },
      { agent: "verifier", task: "verify" },
    ],
  };
  assignWriterWorktrees(parallel, descriptor);
  assert.deepEqual(
    parallel.tasks.map(task => task.cwd),
    [worktrees[1].path, worktrees[0].path],
  );
  assert.equal(validateSubagentInput(parallel, descriptor, workspace).mode, "parallel");
});

test("assignment leaves read-only roles in the main workspace", async () => {
  const { descriptor, workspace } = await fixture();
  const mixed = {
    tasks: [
      { agent: "scout", task: "survey" },
      { agent: "worker", task: "implement" },
    ],
  };
  assignWriterWorktrees(mixed, descriptor);
  assert.equal(mixed.tasks[0].cwd, undefined);
  const accepted = validateSubagentInput(mixed, descriptor, workspace);
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
  assert.match(summary, /single · 1 个独立 Pi 会话/);
  assert.match(summary, /worker → writer-1/);
  assert.equal(summary.includes("codex/agent-"), true);
  assert.match(summary, /Implement the focused slice/);
});
