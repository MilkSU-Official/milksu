import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  codingCollaborationChanged,
  formatSubagentApproval,
  normalizeCodingCollaboration,
  validateSubagentInput,
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
