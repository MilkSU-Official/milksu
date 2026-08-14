import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCodingMcpConfig } from "./bridge-mcp.js";
import {
  createSecurityToolsExtension,
  normalizeSecurityTools,
  securityToolSelectionChanged,
} from "./bridge-security-tools.js";

async function fixture() {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => (
    mkdtemp(join(tmpdir(), "milksu-security-tools-"))
  ));
  const workspace = join(root, "workspace");
  const home = join(root, "home");
  const idaPath = join(root, "IDA Professional.app");
  const userIdaPath = join(home, ".idapro");
  const command = join(root, "security-tools", "ida-pro", "venv", "bin", "idalib-mcp");
  const profilePath = join(root, "security-tools", "ida-pro", "readonly-profile.txt");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(idaPath, { recursive: true }),
    mkdir(userIdaPath, { recursive: true }),
    mkdir(join(root, "security-tools", "ida-pro", "venv", "bin"), { recursive: true }),
  ]);
  await writeFile(command, "fixture");
  await chmod(command, 0o700);
  await writeFile(profilePath, "list_funcs\n");
  return { root, workspace, home, idaPath, userIdaPath, command, profilePath };
}

test("normalizes the recomputed local catalog and builds lazy read-only IDA MCP", async () => {
  const value = await fixture();
  const previousHome = process.env.HOME;
  process.env.HOME = value.home;
  try {
    const tools = await normalizeSecurityTools([{
      id: "ida-pro",
      command: value.command,
      version: "9.1",
      profilePath: value.profilePath,
      idaPath: value.idaPath,
      userIdaPath: value.userIdaPath,
      capabilities: ["读取函数与反编译结果"],
    }]);
    const loaded = await loadCodingMcpConfig(
      value.workspace,
      [],
      "",
      undefined,
      undefined,
      undefined,
      tools,
    );
    assert.deepEqual(loaded.selected, ["milksu-ida-pro"]);
    const server = loaded.config.mcpServers["milksu-ida-pro"];
    assert.equal(server.command, "/usr/bin/sandbox-exec");
    assert.equal(server.lifecycle, "lazy");
    assert.equal(server.directTools, false);
    assert.ok(server.args.includes("--profile"));
    assert.ok(server.includeTools.includes("decompile"));
    assert.ok(!server.includeTools.includes("py_eval"));
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("validates IDAUSR against the supervised user home instead of the isolated Agent HOME", async () => {
  const value = await fixture();
  const previousHome = process.env.HOME;
  const previousUserHome = process.env.MILKSU_USER_HOME;
  process.env.HOME = join(value.root, "isolated-agent-home");
  process.env.MILKSU_USER_HOME = value.home;
  try {
    const tools = await normalizeSecurityTools([{
      id: "ida-pro",
      command: value.command,
      version: "9.1",
      profilePath: value.profilePath,
      idaPath: value.idaPath,
      userIdaPath: value.userIdaPath,
      capabilities: ["读取函数与反编译结果"],
    }]);
    assert.equal(tools[0].userIdaPath, value.userIdaPath);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserHome === undefined) delete process.env.MILKSU_USER_HOME;
    else process.env.MILKSU_USER_HOME = previousUserHome;
  }
});

test("registers capa as a model-selectable tool and publishes a lightweight index", async () => {
  const registered = [];
  const listeners = new Map();
  createSecurityToolsExtension("/tmp/workspace", [{
    id: "capa",
    command: "/tmp/capa",
    version: "v9.4.0",
    capabilities: ["识别能力规则"],
  }])({
    registerTool(tool) { registered.push(tool); },
    on(name, listener) { listeners.set(name, listener); },
  });
  assert.deepEqual(registered.map(tool => tool.name), ["capa_analyze"]);
  const result = await listeners.get("before_agent_start")({ systemPrompt: "base" });
  assert.match(result.systemPrompt, /local security capability index/);
  assert.match(result.systemPrompt, /capa \(v9\.4\.0\)/);
});

test("detects runtime catalog changes that require session recreation", () => {
  assert.equal(securityToolSelectionChanged([], []), false);
  assert.equal(securityToolSelectionChanged([], [{ id: "capa", command: "/capa", version: "1" }]), true);
  assert.equal(securityToolSelectionChanged(
    [{ id: "capa", command: "/capa", version: "1" }],
    [{ id: "capa", command: "/capa", version: "2" }],
  ), true);
});
