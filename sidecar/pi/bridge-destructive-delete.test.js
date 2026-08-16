import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  destructiveDeleteDecision,
  expandDeleteTarget,
  recursiveDeleteTargets,
} from "./bridge-destructive-delete.js";

test("recursive deletion parser covers POSIX, PowerShell, Windows, find, and git clean", () => {
  assert.deepEqual(recursiveDeleteTargets('rm -rf -- "$HOME"'), ["$HOME"]);
  assert.deepEqual(
    recursiveDeleteTargets('powershell.exe -Command "Remove-Item -Recurse -Force $env:USERPROFILE"'),
    ["$env:USERPROFILE"],
  );
  assert.deepEqual(recursiveDeleteTargets('rmdir /s /q "%USERPROFILE%"'), ["%USERPROFILE%"]);
  assert.deepEqual(
    recursiveDeleteTargets('rmdir /s /q "C:\\Users\\demo\\large"'),
    ["C:\\Users\\demo\\large"],
  );
  assert.deepEqual(recursiveDeleteTargets("find . -type f -delete"), ["."]);
  assert.deepEqual(recursiveDeleteTargets("git clean -fdx"), ["."]);
  assert.deepEqual(recursiveDeleteTargets("rm -f notes.txt"), []);
});

test("delete target expansion handles home and cross-platform environment forms", () => {
  const options = {
    environment: { HOME: "/users/demo", USERPROFILE: "C:\\Users\\demo" },
    homeDirectory: "/users/demo",
  };
  assert.equal(expandDeleteTarget("~/cache", options).value, "/users/demo/cache");
  assert.equal(expandDeleteTarget("${HOME}/cache", options).value, "/users/demo/cache");
  assert.equal(
    expandDeleteTarget("%USERPROFILE%\\cache", { ...options, platform: "win32" }).value,
    "C:\\Users\\demo\\cache",
  );
  assert.match(expandDeleteTarget("$UNKNOWN/cache", options).error, /无法安全解析/);
});

test("Full Access still asks before deleting home or the conversation workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const workspace = join(home, "project");
  await mkdir(workspace, { recursive: true });
  const policy = {
    approvalPolicy: "full-auto",
    workspace,
    uiLocale: "zh",
  };

  const homeDecision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: 'rm -rf "$HOME"' },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(homeDecision.action, "approval");
  assert.match(homeDecision.content, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(homeDecision.content, /用户主目录/);

  const workspaceDecision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: "rm -rf ." },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(workspaceDecision.action, "approval");
  assert.match(workspaceDecision.content, /当前工作区根目录/);
});

test("symlink and glob targets are normalized before the confirmation decision", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const link = join(workspace, "home-link");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await symlink(home, link, "dir");
  const policy = { workspace, uiLocale: "zh" };
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${link}'/*` },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(decision.action, "approval");
  assert.match(decision.content, /用户主目录/);
  assert.match(decision.content, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("small recursive deletes remain automatic while large directories require confirmation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-size-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const small = join(workspace, "small");
  const large = join(workspace, "large");
  await mkdir(small, { recursive: true });
  await mkdir(large, { recursive: true });
  await writeFile(join(small, "one.txt"), "one");
  await Promise.all(Array.from({ length: 1001 }, (_value, index) => (
    writeFile(join(large, `${index}.txt`), "x")
  )));
  const policy = { workspace, uiLocale: "zh" };

  assert.equal(await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${small}'` },
    policy,
    environment: {},
    homeDirectory: join(root, "home"),
  }), null);
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${large}'` },
    policy,
    environment: {},
    homeDirectory: join(root, "home"),
  });
  assert.equal(decision.action, "approval");
  assert.match(decision.content, /大型目录/);
});

test("unresolved recursive delete targets are blocked instead of being approved ambiguously", async () => {
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: 'rm -rf "$UNKNOWN_ROOT"' },
    policy: { workspace: process.cwd(), uiLocale: "zh" },
    environment: {},
    homeDirectory: "/nonexistent-home",
  });
  assert.equal(decision.action, "block");
  assert.match(decision.reason, /明确的绝对路径/);
});
