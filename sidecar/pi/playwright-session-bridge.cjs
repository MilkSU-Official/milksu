"use strict";

const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { setTimeout: delay } = require("node:timers/promises");

const cdpEndpointPattern = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const waitMs = 1_500;
const pollMs = 50;

function trimmedEnv(name) {
  return String(process.env[name] ?? "").trim();
}

function readDescriptorEndpoint(file) {
  if (!file || !existsSync(file)) return "";
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "";
  }
  const endpoint = String(parsed?.cdpEndpoint ?? "").trim();
  return cdpEndpointPattern.test(endpoint) ? endpoint : "";
}

async function resolveCdpEndpoint() {
  const direct = trimmedEnv("MILKSU_CODING_BROWSER_CDP");
  if (cdpEndpointPattern.test(direct)) return direct;
  const file = trimmedEnv("MILKSU_CODING_BROWSER_DESCRIPTOR_FILE");
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    const endpoint = readDescriptorEndpoint(file);
    if (endpoint) return endpoint;
    await delay(pollMs);
  }
  throw new Error(
    "MilkSU isolated browser is not ready. Open a tab with milksu_workspace first.",
  );
}

async function main() {
  const cli = trimmedEnv("MILKSU_PLAYWRIGHT_MCP_CLI");
  if (!cli || !existsSync(cli)) {
    throw new Error("MilkSU packaged Playwright MCP CLI is unavailable");
  }
  const endpoint = await resolveCdpEndpoint();
  const child = spawn(process.execPath, [cli, "--cdp-endpoint", endpoint, ...process.argv.slice(2)], {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
  const stop = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
