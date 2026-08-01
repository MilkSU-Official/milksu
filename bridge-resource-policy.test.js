import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCodingResourcePolicy,
  describeLoadedExtensions,
  reviewedLspConfig,
} from "./bridge-resource-policy.js";

test("reviewed LSP config ignores project commands and strips provider secrets", () => {
  const config = JSON.parse(reviewedLspConfig({
    HOME: "/tmp/home",
    PATH: "/usr/local/bin:/usr/bin",
    TMPDIR: "/tmp/workspace",
    LANG: "en_US.UTF-8",
    DEEPSEEK_API_KEY: "provider-secret",
    MILKSU_RELAY_KEY: "relay-secret",
  }, "darwin"));

  assert.deepEqual(Object.keys(config.servers), [
    "milksu-go",
    "milksu-vue",
    "milksu-typescript",
  ]);
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes("provider-secret"), false);
  assert.equal(serialized.includes("relay-secret"), false);
  for (const server of Object.values(config.servers)) {
    assert.equal(server.command[0], "/usr/bin/env");
    assert.equal(server.command[1], "-i");
    assert.equal(server.command.some(value => value.startsWith("HOME=/tmp/home")), true);
  }
});

test("coding resource policy overrides ambient LSP configuration and disables retry watchdog", () => {
  const environment = {
    HOME: "/tmp/home",
    PATH: "/usr/bin",
    PI_LSP_CONFIG: "/untrusted/project/config.json",
    PI_MILKSU_GO_LSP_COMMAND: "/tmp/untrusted-command",
  };

  applyCodingResourcePolicy(environment, "darwin");

  assert.doesNotThrow(() => JSON.parse(environment.PI_LSP_CONFIG));
  assert.equal(environment.PI_RETRY_STALL_TIMEOUT_MS, "0");
  assert.equal("PI_MILKSU_GO_LSP_COMMAND" in environment, false);
});

test("loaded extension names come from registered tools and flags", () => {
  const extension = (tools = [], flags = []) => ({
    tools: new Map(tools.map(name => [name, {}])),
    flags: new Map(flags.map(name => [name, {}])),
  });
  const resourceLoader = {
    getExtensions() {
      return {
        extensions: [
          extension(["milksu_progress"]),
          extension(["lsp_diagnostics", "lsp_fix"]),
          extension([], ["retry-stall-timeout-ms"]),
          extension(["bg_task", "bg_status"]),
        ],
        errors: [{ path: "broken-extension", error: "failed to load" }],
      };
    },
  };

  assert.deepEqual(describeLoadedExtensions(resourceLoader), {
    names: ["milksu-workflow", "pi-lsp", "pi-retry", "pi-background-tasks"],
    errors: [{ path: "broken-extension", error: "failed to load" }],
  });
});
