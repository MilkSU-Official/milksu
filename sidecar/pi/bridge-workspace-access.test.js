import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceAccessBroker,
  createWorkspaceAccessExtension,
  workspaceAccessToolName,
  workspaceCandidatesToolName,
} from "./bridge-workspace-access.js";

test("workspace access tools delegate fuzzy resolution and exact grants to Desktop", async () => {
  const events = [];
  const broker = createWorkspaceAccessBroker(
    (id, type, payload) => events.push({ id, type, ...payload }),
    (() => {
      let index = 0;
      return () => `workspace-${++index}`;
    })(),
  );
  const tools = new Map();
  let beforeStart;
  createWorkspaceAccessExtension("coding-1", broker)({
    registerTool(tool) { tools.set(tool.name, tool); },
    on(name, handler) {
      if (name === "before_agent_start") beforeStart = handler;
    },
  });

  const candidatesPromise = tools.get(workspaceCandidatesToolName).execute("call-1", {
    query: "MilkSU project",
  });
  assert.deepEqual(events[0], {
    id: "coding-1",
    type: "workspace_access_requested",
    requestId: "workspace-1",
    action: "discover",
    path: undefined,
    query: "MilkSU project",
    reason: undefined,
  });
  broker.respond({
    conversationId: "coding-1",
    requestId: "workspace-1",
    paths: ["/Users/example/code/milksu"],
  });
  const candidates = await candidatesPromise;
  assert.match(candidates.content[0].text, /\/Users\/example\/code\/milksu/);

  const grantPromise = tools.get(workspaceAccessToolName).execute("call-2", {
    action: "grant",
    path: "/Users/example/code/milksu",
    reason: "The user asked to work in their MilkSU project",
  });
  broker.respond({
    conversationId: "coding-1",
    requestId: "workspace-2",
    path: "/Users/example/code/milksu",
    paths: ["/Users/example/code/milksu"],
    restartRequired: true,
  });
  assert.deepEqual(events.at(-1), {
    id: "coding-1",
    type: "workspace_access_updated",
    action: "grant",
    path: "/Users/example/code/milksu",
    paths: ["/Users/example/code/milksu"],
    restartRequired: true,
  });
  const grant = await grantPromise;
  assert.equal(grant.details.restartRequired, true);
  assert.match(grant.content[0].text, /automatically resume/);

  const prompt = await beforeStart({ systemPrompt: "base" });
  assert.match(prompt.systemPrompt, /ordinary language/);
  assert.match(prompt.systemPrompt, /ask one concise clarification/);
});

test("workspace access broker rejects mismatched conversations", async () => {
  const broker = createWorkspaceAccessBroker(() => undefined, () => "workspace-1");
  const pending = broker.request("coding-1", { action: "discover", query: "vault" });
  assert.throws(() => broker.respond({
    conversationId: "coding-2",
    requestId: "workspace-1",
    paths: [],
  }), /Unknown MilkSU workspace request/);
  broker.cancelAll("test complete");
  await assert.rejects(pending, /test complete/);
});
