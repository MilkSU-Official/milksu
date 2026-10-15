import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createFirstPartyPluginMcpServer,
  pluginMcpSessionRequiresReload,
  pluginMcpServerName,
} from "./bridge-plugin-mcp.js";

test("pins Plugin MCP command, arguments, data root, and child environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-plugin-mcp-"));
  const appData = join(root, "app-data");
  await mkdir(appData);
  const args = ["--experimental-strip-types", join(root, "plugin-mcp.ts")];
  const saved = new Map([
    ["MILKSU_PLUGIN_MCP_COMMAND", process.env.MILKSU_PLUGIN_MCP_COMMAND],
    ["MILKSU_PLUGIN_MCP_ARGS", process.env.MILKSU_PLUGIN_MCP_ARGS],
    ["MILKSU_PLUGIN_MCP_APPDATA", process.env.MILKSU_PLUGIN_MCP_APPDATA],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["TOKENFLUX_API_KEY", process.env.TOKENFLUX_API_KEY],
  ]);
  try {
    process.env.MILKSU_PLUGIN_MCP_COMMAND = process.execPath;
    process.env.MILKSU_PLUGIN_MCP_ARGS = JSON.stringify(args);
    process.env.MILKSU_PLUGIN_MCP_APPDATA = appData;
    process.env.OPENAI_API_KEY = "must-not-reach-plugin-mcp";
    process.env.TOKENFLUX_API_KEY = "must-not-reach-plugin-mcp";
    const descriptor = await createFirstPartyPluginMcpServer();
    const executable = await realpath(process.execPath);
    const canonicalAppData = await realpath(appData);
    assert.equal(descriptor.name, pluginMcpServerName);
    assert.equal(descriptor.server.command, executable);
    assert.deepEqual(descriptor.server.args, args);
    assert.deepEqual(descriptor.server.env, {
      MILKSU_APPDATA_DIR: canonicalAppData,
    });
    assert.equal(descriptor.server.cwd, canonicalAppData);
    assert.equal(descriptor.server.lifecycle, "lazy");
    assert.equal(descriptor.server.directTools, false);
    assert.equal("OPENAI_API_KEY" in descriptor.server.env, false);
    assert.equal("TOKENFLUX_API_KEY" in descriptor.server.env, false);
    assert.equal("ELECTRON_RUN_AS_NODE" in descriptor.server.env, false);
    assert.equal(pluginMcpSessionRequiresReload([], ""), true);
    assert.equal(
      pluginMcpSessionRequiresReload([pluginMcpServerName], ""),
      false,
    );
    assert.equal(
      pluginMcpSessionRequiresReload([], "background-tasks"),
      false,
    );

    delete process.env.MILKSU_PLUGIN_MCP_ARGS;
    await assert.rejects(
      createFirstPartyPluginMcpServer(),
      /launcher descriptor is incomplete/,
    );
    process.env.MILKSU_PLUGIN_MCP_ARGS = JSON.stringify(args);
    delete process.env.MILKSU_PLUGIN_MCP_APPDATA;
    await assert.rejects(
      createFirstPartyPluginMcpServer(),
      /launcher descriptor is incomplete/,
    );
    process.env.MILKSU_PLUGIN_MCP_COMMAND = "relative/backend";
    process.env.MILKSU_PLUGIN_MCP_APPDATA = appData;
    await assert.rejects(
      createFirstPartyPluginMcpServer(),
      /launcher-owned absolute path/,
    );

    const electronish = join(root, "Electron");
    await writeFile(electronish, "#!/bin/sh\n");
    await chmod(electronish, 0o755);
    process.env.MILKSU_PLUGIN_MCP_COMMAND = electronish;
    const electronDescriptor = await createFirstPartyPluginMcpServer();
    assert.equal(electronDescriptor.server.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(electronDescriptor.server.cwd, canonicalAppData);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
