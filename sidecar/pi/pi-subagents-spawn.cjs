"use strict";

const { existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

// Same names the Pi shell copy drops when MILKSU_PI_SUBAGENT_RUNTIME=1.
// External CLI children never receive these. The Pi runner process keeps them
// so the model API can authenticate; only its shell copy is stripped.
const providerEnvNames = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_BASE_URL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "KOURICHAT_API_KEY",
  "KOURICHAT_BASE_URL",
  "MILKSU_RELAY_KEY",
  "MILKSU_RELAY_URL",
  "MISTRAL_API_KEY",
  "MISTRAL_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
]);

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
  writeSandboxProfile,
};
