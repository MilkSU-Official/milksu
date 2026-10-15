import assert from "node:assert/strict";
import { chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
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
    assert.equal(
      server.command,
      process.platform === "darwin" ? "/usr/bin/sandbox-exec" : value.command,
    );
    assert.equal(server.lifecycle, "lazy");
    assert.equal(server.directTools, false);
    assert.ok(server.args.includes("--profile"));
    assert.ok(server.includeTools.includes("decompile"));
    assert.ok(!server.includeTools.includes("py_eval"));
    const overlay = await loadCodingMcpConfig(
      value.workspace,
      [],
      "",
      undefined,
      undefined,
      undefined,
      [{ ...tools[0], args: ["--stdio", "--max-workers", "1"] }],
    );
    const overlayArgs = overlay.config.mcpServers["milksu-ida-pro"].args;
    assert.ok(overlayArgs.includes("--max-workers"));
    assert.ok(overlayArgs.includes("1"));
    assert.equal(overlayArgs.includes("--profile"), false);
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

test("rejects capa on platforms without sandbox-exec", async () => {
  if (process.platform === "darwin") return;
  await assert.rejects(
    normalizeSecurityTools([{
      id: "capa",
      command: "/tmp/capa",
      version: "v9.4.0",
    }]),
    /only on macOS/,
  );
});

test("discloses capa through its own description instead of the system prompt", async () => {
  if (process.platform !== "darwin") return;
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
  assert.match(registered[0].description, /capa v9\.4\.0/);
  assert.equal(listeners.has("before_agent_start"), false);
});

test("detects runtime catalog changes that require session recreation", () => {
  assert.equal(securityToolSelectionChanged([], []), false);
  assert.equal(securityToolSelectionChanged([], [{ id: "capa", command: "/capa", version: "1" }]), true);
  assert.equal(securityToolSelectionChanged(
    [{ id: "capa", command: "/capa", version: "1" }],
    [{ id: "capa", command: "/capa", version: "2" }],
  ), true);
});

async function reaFixture() {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => (
    mkdtemp(join(tmpdir(), "milksu-rea-"))
  ));
  const workspace = join(root, "workspace");
  const install = join(root, "security-tools", "rea", "6.1.0", "node_modules", "rea-agents", "scripts");
  const nodePath = join(root, "bin", "node");
  const entry = join(install, "rea.mjs");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(install, { recursive: true }),
    mkdir(join(root, "bin"), { recursive: true }),
  ]);
  await writeFile(nodePath, "fixture");
  await chmod(nodePath, 0o700);
  await writeFile(entry, "fixture");
  return { root, workspace, install, nodePath, entry };
}

test("normalizes REA when the Node binary path is a Homebrew-style symlink", async () => {
  const value = await reaFixture();
  const linked = join(value.root, "alias", "node");
  await mkdir(join(value.root, "alias"));
  await symlink(value.nodePath, linked);
  const tools = await normalizeSecurityTools([{
    id: "rea",
    command: linked,
    args: [value.entry, "mcp"],
    version: "6.1.0",
    capabilities: ["打开二进制并读取概览"],
  }]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].command, await realpath(value.nodePath));
});

test("normalizes REA and builds the reviewed milksu-rea server", async () => {
  const value = await reaFixture();
  const tools = await normalizeSecurityTools([{
    id: "rea",
    command: value.nodePath,
    args: [value.entry, "mcp"],
    version: "6.1.0",
    capabilities: ["打开二进制并读取概览"],
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
  assert.deepEqual(loaded.selected, ["milksu-rea"]);
  const server = loaded.config.mcpServers["milksu-rea"];
  // milksu-rea 走 eager：会话创建即启动（lazy 在 bridge 进程内的 adapter
  // 路径上存在不拉起且无超时的挂起问题，见 bridge-mcp.js 的注释）。
  assert.equal(server.lifecycle, "eager");
  assert.equal(server.directTools, false);
  assert.equal(
    server.command,
    process.platform === "darwin" ? "/usr/bin/sandbox-exec" : value.nodePath,
  );
  assert.ok(server.includeTools.includes("binary_session"));
  assert.ok(server.includeTools.includes("analyze_function"));
  assert.ok(server.includeTools.includes("export_evidence_bundle"));
  assert.ok(server.includeTools.includes("list_procedures"));
  assert.ok(server.includeTools.includes("trace_call_path"));
  assert.ok(server.includeTools.includes("list_unknowns"));
  assert.equal(server.includeTools.includes("record_unknown"), true);
  assert.equal(server.includeTools.length, 19);
  const flat = server.args.join(" ");
  assert.equal(flat.includes("npx"), false);
  assert.equal(flat.includes("latest"), false);
  if (process.platform === "darwin") {
    assert.ok(flat.includes(value.install));
    const home = await import("node:os").then(({ homedir }) => homedir());
    assert.equal(flat.includes(`(subpath ${home})`), false);
    assert.equal(flat.includes("(allow network*)"), false);
  }
});

test("rejects REA launch lines outside the reviewed form", async () => {
  const value = await reaFixture();
  const npxPath = join(value.root, "bin", "npx");
  await writeFile(npxPath, "fixture");
  await chmod(npxPath, 0o700);
  await assert.rejects(
    () => normalizeSecurityTools([{
      id: "rea",
      command: npxPath,
      args: ["-y", "rea-agents@latest", "mcp"],
      version: "6.1.0",
    }]),
    /Node\.js binary/,
  );
  await assert.rejects(
    () => normalizeSecurityTools([{
      id: "rea",
      command: value.nodePath,
      args: [value.entry],
      version: "6.1.0",
    }]),
    /reviewed form/,
  );
  await assert.rejects(
    () => normalizeSecurityTools([{
      id: "rea",
      command: value.nodePath,
      args: [value.entry, "mcp", "--extra"],
      version: "6.1.0",
    }]),
    /reviewed form/,
  );
});
