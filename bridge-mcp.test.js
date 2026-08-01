import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureMcpMetadataCache,
  loadSelectedMcpConfig,
  mcpSelectionChanged,
  normalizeSelectedMcpServers,
} from "./bridge-mcp.js";

test("loads only explicitly selected MCP servers and clears stdio inheritance", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-mcp-"));
  const config = JSON.stringify({
    mcpServers: {
      browser: {
        command: "npx",
        args: ["-y", "browser-mcp"],
        env: { FIXTURE_MODE: "1" },
        lifecycle: "eager",
      },
      remote: {
        url: "https://example.test/mcp",
      },
    },
  });
  await writeFile(join(workspace, ".mcp.json"), config);

  const loaded = await loadSelectedMcpConfig(
    workspace,
    ["browser"],
    createHash("sha256").update(config).digest("hex"),
  );
  assert.deepEqual(loaded.selected, ["browser"]);
  assert.deepEqual(Object.keys(loaded.config.mcpServers), ["browser"]);
  assert.equal(loaded.config.mcpServers.browser.command, "/usr/bin/sandbox-exec");
  assert.equal(loaded.config.mcpServers.browser.cwd, await realpath(workspace));
  assert.ok(
    loaded.config.mcpServers.browser.args.some(value => value.includes("(allow network*)")),
  );
  assert.ok(loaded.config.mcpServers.browser.args.includes("/usr/bin/env"));
  assert.deepEqual(
    loaded.config.mcpServers.browser.args.slice(-4),
    ["FIXTURE_MODE=1", "npx", "-y", "browser-mcp"],
  );
  assert.deepEqual(loaded.config.mcpServers.browser.env, {});
  assert.equal(loaded.config.mcpServers.browser.lifecycle, "lazy");
  assert.equal(loaded.config.settings.sampling, false);
  assert.equal(loaded.config.settings.elicitation, false);
});

test("rejects symlinked configs and model-provider credential interpolation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-mcp-"));
  const outside = join(await mkdtemp(join(tmpdir(), "milksu-mcp-outside-")), "config.json");
  await writeFile(outside, JSON.stringify({
    mcpServers: { browser: { command: "npx" } },
  }));
  await symlink(outside, join(workspace, ".mcp.json"));
  await assert.rejects(
    loadSelectedMcpConfig(workspace, ["browser"], "0".repeat(64)),
    /regular project file/,
  );

  const safeWorkspace = await mkdtemp(join(tmpdir(), "milksu-mcp-"));
  const unsafeConfig = JSON.stringify({
    mcpServers: {
      browser: {
        command: "npx",
        env: { TOKEN: "${DEEPSEEK_API_KEY}" },
      },
    },
  });
  await writeFile(join(safeWorkspace, ".mcp.json"), unsafeConfig);
  await assert.rejects(
    loadSelectedMcpConfig(
      safeWorkspace,
      ["browser"],
      createHash("sha256").update(unsafeConfig).digest("hex"),
    ),
    /cannot reference the model-provider credential DEEPSEEK_API_KEY/,
  );

  const remoteWorkspace = await mkdtemp(join(tmpdir(), "milksu-mcp-"));
  const remoteConfig = JSON.stringify({
    mcpServers: {
      remote: {
        url: "https://example.test/mcp",
        bearerTokenEnv: "SOME_AMBIENT_TOKEN",
      },
    },
  });
  await writeFile(join(remoteWorkspace, ".mcp.json"), remoteConfig);
  await assert.rejects(
    loadSelectedMcpConfig(
      remoteWorkspace,
      ["remote"],
      createHash("sha256").update(remoteConfig).digest("hex"),
    ),
    /cannot read bearerTokenEnv/,
  );
});

test("normalizes task selections deterministically", () => {
  assert.deepEqual(
    normalizeSelectedMcpServers([" zed ", "alpha", "alpha"]),
    ["alpha", "zed"],
  );
  assert.equal(mcpSelectionChanged(["alpha"], ["alpha"]), false);
  assert.equal(mcpSelectionChanged(["alpha"], ["zed"]), true);
});

test("pre-creates a valid adapter cache without overwriting existing state", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "milksu-mcp-agent-"));
  await ensureMcpMetadataCache(agentDir);
  const cachePath = join(agentDir, "mcp-cache.json");
  assert.deepEqual(
    JSON.parse(await readFile(cachePath, "utf8")),
    { version: 1, servers: {} },
  );
  await writeFile(cachePath, '{"version":1,"servers":{"fixture":{"tools":[]}}}\n');
  await ensureMcpMetadataCache(agentDir);
  assert.match(await readFile(cachePath, "utf8"), /fixture/);
});
