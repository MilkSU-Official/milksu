"use strict";

const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const test = require("node:test");
const {
  guardSubagentSpawn,
  providerEnvNames,
  writeSandboxProfile,
} = require("./pi-subagents-spawn.cjs");

test("external CLI spawn drops provider credentials and skips the seatbelt", () => {
  const env = { PATH: "/usr/bin", MILKSU_PI_SUBAGENT_RUNTIME: "1" };
  for (const name of providerEnvNames) env[name] = "secret";
  const guarded = guardSubagentSpawn({
    command: "cursor-agent",
    args: ["--print"],
    env,
    cwd: "/work",
    externalCli: true,
    platform: "darwin",
  });
  assert.equal(guarded.command, "cursor-agent");
  assert.deepEqual(guarded.args, ["--print"]);
  assert.equal(guarded.env.PATH, "/usr/bin");
  assert.equal(guarded.env.MILKSU_PI_SUBAGENT_RUNTIME, undefined);
  for (const name of providerEnvNames) {
    assert.equal(guarded.env[name], undefined);
  }
  assert.equal(env.OPENAI_API_KEY, "secret");
});

test("Pi runner keeps provider credentials and marks the shell copy", () => {
  const guarded = guardSubagentSpawn({
    command: process.execPath,
    args: ["runner.js"],
    env: { OPENAI_API_KEY: "secret", PATH: "/usr/bin" },
    cwd: "/work",
    externalCli: false,
    platform: "linux",
  });
  assert.equal(guarded.command, process.execPath);
  assert.deepEqual(guarded.args, ["runner.js"]);
  assert.equal(guarded.env.OPENAI_API_KEY, "secret");
  assert.equal(guarded.env.MILKSU_PI_SUBAGENT_RUNTIME, "1");
  assert.equal(guarded.env.MILKSU_PI_NO_PROJECT_RESOURCE_DISCOVERY, "1");
});

test("macOS write profile allows the workspace and temp dir and denies .git", () => {
  const profile = writeSandboxProfile({
    cwd: "/work/repo",
    temporaryDirectory: "/var/folders/t",
    agentDirectory: "/work/repo/.milksu/pi",
  });
  assert.match(profile, /\(allow default\)/);
  assert.match(profile, /\(deny file-write\*\)/);
  assert.match(profile, /subpath "\/work\/repo"/);
  assert.match(profile, /subpath "\/var\/folders\/t"/);
  assert.match(profile, /subpath "\/work\/repo\/\.milksu\/pi"/);
  assert.match(profile, /subpath "\/work\/repo\/\.git"/);
  const launch = {
    command: "/usr/bin/node",
    args: ["runner.js"],
    env: { OPENAI_API_KEY: "secret" },
    cwd: "/work/repo",
    externalCli: false,
    platform: "darwin",
  };
  if (!existsSync("/usr/bin/sandbox-exec")) {
    assert.throws(() => guardSubagentSpawn(launch), /sandbox-exec/);
    return;
  }
  const guarded = guardSubagentSpawn(launch);
  assert.equal(guarded.command, "/usr/bin/sandbox-exec");
  assert.equal(guarded.args[0], "-p");
  assert.match(guarded.args[1], /deny file-write\*/);
  assert.equal(guarded.args[2], "/usr/bin/node");
  assert.equal(guarded.env.OPENAI_API_KEY, "secret");
});
