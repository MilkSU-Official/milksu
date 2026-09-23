"use strict";

const { existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  applyChildModelEnvironment,
  childProcessDeniedEnvNames,
  childShellDeniedEnvNames,
} = require("./pi-subagent-model-registry.cjs");

// Same names the Pi shell copy drops when MILKSU_PI_SUBAGENT_RUNTIME=1.
// External CLI children never receive these. The Pi runner process keeps the
// provider keys so the model API can authenticate; only its shell copy is
// stripped. Image generation is not that API, so its key is dropped from both.
const providerEnvNames = childShellDeniedEnvNames;

function quoted(value) {
  return JSON.stringify(String(value));
}

function writeSandboxProfile({
  cwd,
  temporaryDirectory = tmpdir(),
  agentDirectory,
}) {
  const rules = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${quoted(cwd)}))`,
    `(allow file-write* (subpath ${quoted(temporaryDirectory)}))`,
  ];
  if (agentDirectory) {
    rules.push(`(allow file-write* (subpath ${quoted(agentDirectory)}))`);
  }
  rules.push(`(deny file-write* (subpath ${quoted(join(cwd, ".git"))}))`);
  return `${rules.join("\n")}\n`;
}

function environmentCopy(env) {
  return { ...(env && typeof env === "object" ? env : {}) };
}

function stripProviderEnv(env) {
  for (const name of providerEnvNames) delete env[name];
  for (const name of Object.keys(env)) {
    if (name.startsWith("MILKSU_SUBAGENT_KEY_")) delete env[name];
  }
  delete env.MILKSU_PI_SUBAGENT_RUNTIME;
}

function guardSubagentSpawn({
  command,
  args,
  env,
  cwd,
  externalCli = false,
  platform = process.platform,
} = {}) {
  const nextEnv = environmentCopy(env);
  const nextArgs = Array.isArray(args) ? [...args] : [];
  const nextCwd = cwd;
  if (externalCli) {
    stripProviderEnv(nextEnv);
    return {
      command,
      args: nextArgs,
      env: nextEnv,
      cwd: nextCwd,
    };
  }
  nextEnv.MILKSU_PI_SUBAGENT_RUNTIME = "1";
  nextEnv.MILKSU_PI_NO_PROJECT_RESOURCE_DISCOVERY = "1";
  for (const name of childProcessDeniedEnvNames) delete nextEnv[name];
  const withModels = applyChildModelEnvironment(nextEnv, nextCwd);
  Object.assign(nextEnv, withModels);
  if (platform !== "darwin") {
    return {
      command,
      args: nextArgs,
      env: nextEnv,
      cwd: nextCwd,
    };
  }
  if (command === "/usr/bin/sandbox-exec") {
    return {
      command,
      args: nextArgs,
      env: nextEnv,
      cwd: nextCwd,
    };
  }
  if (!existsSync("/usr/bin/sandbox-exec")) {
    throw new Error("MilkSU Pi subagent runner requires /usr/bin/sandbox-exec on macOS");
  }
  const agentDirectory = String(nextEnv.MILKSU_PI_AGENT_DIR ?? "").trim()
    || (nextCwd ? join(nextCwd, ".milksu", "pi") : "");
  const profile = writeSandboxProfile({
    cwd: String(nextCwd ?? ""),
    temporaryDirectory: tmpdir(),
    agentDirectory,
  });
  return {
    command: "/usr/bin/sandbox-exec",
    args: ["-p", profile, command, ...nextArgs],
    env: nextEnv,
    cwd: nextCwd,
  };
}

module.exports = {
  guardSubagentSpawn,
  providerEnvNames,
  stripProviderEnv,
  writeSandboxProfile,
};
