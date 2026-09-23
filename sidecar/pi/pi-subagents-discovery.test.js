import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearAgentDiscoveryCache,
  discoverAgents,
  discoverAgentsAll,
} from "../../node_modules/pi-subagents/src/agents/agents.js";

test("bundled-only discovery lists builtin agents inside a project root", () => {
  const previous = process.env.MILKSU_PI_SUBAGENT_BUNDLED_ONLY;
  const root = mkdtempSync(join(tmpdir(), "milksu-subagent-discovery-"));
  mkdirSync(join(root, ".agents"));
  process.env.MILKSU_PI_SUBAGENT_BUNDLED_ONLY = "1";
  clearAgentDiscoveryCache();
  try {
    const listed = discoverAgentsAll(root);
    const names = [...listed.builtin, ...listed.user, ...listed.project, ...listed.package]
      .map(agent => agent.name);
    assert.ok(names.includes("scout"));
    assert.ok(names.includes("worker"));
    assert.equal(listed.project.length, 0);
    assert.equal(listed.user.length, 0);
    const launched = discoverAgents(root, "both");
    assert.ok(launched.agents.some(agent => agent.name === "worker"));
  } finally {
    if (previous === undefined) delete process.env.MILKSU_PI_SUBAGENT_BUNDLED_ONLY;
    else process.env.MILKSU_PI_SUBAGENT_BUNDLED_ONLY = previous;
    clearAgentDiscoveryCache();
    rmSync(root, { recursive: true, force: true });
  }
});
