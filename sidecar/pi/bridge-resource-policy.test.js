import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  assert.equal(
    config.servers["milksu-go"].command.at(-1),
    join(root, "gopls"),
  );
  assert.deepEqual(config.servers["milksu-vue"].command.slice(-3), [
    process.execPath,
    join(root, "node_modules", "@vue", "language-server", "bin", "vue-language-server.js"),
    "--stdio",
  ]);
  assert.deepEqual(config.servers["milksu-vue"].initialization, {
    typescript: {
      tsdk: join(root, "node_modules", "typescript", "lib"),
      disableAutoImportCache: true,
    },
    vue: {
      hybridMode: false,
    },
  });
  assert.equal(config.servers["milksu-vue"].pushDiagnosticsGraceMs, 3000);
  assert.deepEqual(config.servers["milksu-typescript"].command.slice(-3), [
    process.execPath,
    join(root, "node_modules", "typescript-language-server", "lib", "cli.mjs"),
    "--stdio",
  ]);
});

test("coding resource policy overrides ambient LSP configuration", () => {
  const environment = {
    HOME: "/tmp/home",
    PATH: "/usr/bin",
    PI_LSP_CONFIG: "/untrusted/project/config.json",
    PI_MILKSU_GO_LSP_COMMAND: "/tmp/untrusted-command",
  };

  applyCodingResourcePolicy(environment, "darwin");

  assert.doesNotThrow(() => JSON.parse(environment.PI_LSP_CONFIG));
  assert.equal("PI_MILKSU_GO_LSP_COMMAND" in environment, false);
  assert.equal(environment.MCP_DIRECT_TOOLS, "__none__");
});

test("loaded extension names come from registered tools", () => {
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
          extension(["goal_complete", "goal_blocked"]),
          extension(["bg_task", "bg_status"]),
          extension(["mcp"]),
          extension(["subagent"]),
        ],
        errors: [{ path: "broken-extension", error: "failed to load" }],
      };
    },
  };

  assert.deepEqual(describeLoadedExtensions(resourceLoader), {
    names: [
      "milksu-workflow",
      "pi-lsp",
      "pi-goal",
      "pi-background-tasks",
      "pi-mcp-adapter",
      "pi-sub-agent",
    ],
    errors: [{ path: "broken-extension", error: "failed to load" }],
  });
});
