import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { buildCodingBackgroundLaunch } from "./bridge-policy.js";

export function validateCommandSpec(specification) {
  if (specification.shell === false) {
    if (
      !Array.isArray(specification.argv)
      || specification.argv.length === 0
      || typeof specification.argv[0] !== "string"
      || !specification.argv[0]
    ) {
      throw new Error("argv with at least one element is required when shell:false");
    }
    return;
  }
  if (
    typeof specification.command !== "string"
    || specification.command.trim().length === 0
  ) {
    throw new Error("command is required unless shell:false with argv is provided");
  }
}

function reviewedLaunch(specification, trustedOutputPath = "") {
  validateCommandSpec(specification);
  return buildCodingBackgroundLaunch(specification, trustedOutputPath);
}

function spawnLaunch(launch, detached, stdio) {
  return spawn(launch.file, launch.arguments, {
    cwd: launch.cwd,
    env: launch.environment,
    detached,
    stdio,
  });
}

export function spawnCommand(specification, logPath, detached) {
  // Build and validate the launch before creating the log. The background
  // extension owns this path; model input never does.
  const launch = reviewedLaunch(specification, logPath);
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  const descriptor = openSync(logPath, "a", 0o600);
  let child;
  try {
    child = spawnLaunch(launch, detached, ["ignore", descriptor, descriptor]);
    writeSync(
      descriptor,
      `\n--- spawn ${new Date().toISOString()} pid=${child.pid ?? "unknown"} ---\n`,
    );
  } finally {
    closeSync(descriptor);
  }
  child.on("close", (code, signal) => {
    appendFileSync(
      logPath,
      `\n--- exit ${new Date().toISOString()} code=${code ?? "null"} signal=${signal ?? "null"} ---\n`,
      { mode: 0o600 },
    );
  });
  return { child, pgid: detached && child.pid ? child.pid : undefined };
}

export function runCommandOnce(specification, maxBufferBytes = 1024 * 1024) {
  const startedAt = Date.now();
  const child = spawnLaunch(
    reviewedLaunch(specification),
    false,
    ["ignore", "pipe", "pipe"],
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", chunk => {
    if (Buffer.byteLength(stdout) < maxBufferBytes) stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", chunk => {
    if (Buffer.byteLength(stderr) < maxBufferBytes) stderr += chunk.toString("utf8");
  });
  return new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("close", (exitCode, signal) => {
      resolvePromise({
        exitCode,
        signal,
        stdout,
        stderr,
        startedAt,
        endedAt: Date.now(),
      });
    });
  });
}

export function stopProcessGroup(pid, pgid) {
  const target = pgid ?? pid;
  try {
    process.kill(-target, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
