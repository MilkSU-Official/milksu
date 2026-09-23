import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { acceptedAsyncDir, mapAsyncSubagentStatus } from "./pi-subagents-status.js";

const defaultGraceMs = 400;

function integerPid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 1 ? pid : 0;
}

export function commandForPid(pid, platform = process.platform) {
  if (!integerPid(pid)) return "";
  if (platform === "linux") {
    try {
      return readFileSync(`/proc/${pid}/cmdline`).toString().replaceAll("\0", " ").trim();
    } catch {
      return "";
    }
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return String(result.stdout ?? "").trim();
}

export function isOwnedSubagentCommand(command, role) {
  const text = String(command ?? "");
  if (!text.trim()) return false;
  if (role === "runner") return /subagent-runner|pi-subagents/.test(text);
  return /cursor-agent|claude|codex|subagent-runner|pi-subagents/.test(text);
}

function pidsFromStatus(status) {
  const pids = [];
  const push = (value) => {
    const pid = integerPid(value);
    if (pid && !pids.includes(pid)) pids.push(pid);
  };
  push(status?.pid);
  const steps = Array.isArray(status?.steps) ? status.steps : [];
  for (const step of steps) {
    push(step?.pid);
    push(step?.externalProcess?.pid);
  }
  return pids;
}

function readStatus(directory, readFile = readFileSync) {
  try {
    const parsed = JSON.parse(readFile(`${directory}/status.json`, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function signalPid(pid, signal, platform, kill) {
  if (platform === "win32") {
    kill(pid, signal);
    return;
  }
  try {
    kill(-pid, signal);
    return;
  } catch (error) {
    if (error?.code !== "ESRCH" && error?.code !== "EPERM") throw error;
  }
  try {
    kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function processAlive(pid, kill) {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function ownedSubagentPids(asyncDir, workspace, options = {}) {
  const directory = acceptedAsyncDir(asyncDir, workspace);
  if (!directory) return { action: "absent", pids: [] };
  const status = readStatus(directory, options.readFile);
  if (!status) return { action: "absent", pids: [] };
  if (mapAsyncSubagentStatus(status.state) !== "running") return { action: "absent", pids: [] };
  const commandFor = options.commandForPid ?? commandForPid;
  const listed = pidsFromStatus(status);
  const runnerPid = integerPid(status.pid);
  const runnerCommand = runnerPid ? commandFor(runnerPid) : "";
  if (!runnerPid || !isOwnedSubagentCommand(runnerCommand, "runner")) {
    return { action: "skipped", pids: [] };
  }
  const owned = [];
  for (const pid of listed) {
    const command = pid === runnerPid ? runnerCommand : commandFor(pid);
    const role = pid === runnerPid ? "runner" : "external";
    if (isOwnedSubagentCommand(command, role)) owned.push(pid);
  }
  return owned.length
    ? { action: "signaled", pids: owned }
    : { action: "skipped", pids: [] };
}

export async function terminateConversationSubagents(tasks, workspace, options = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  const platform = options.platform ?? process.platform;
  const graceMs = options.graceMs ?? defaultGraceMs;
  const wait = options.wait ?? (ms => new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  }));
  const outcomes = [];
  const signaled = [];
  for (const task of list) {
    const live = task?.status === "running" || task?.status === "start";
    if (!live || !task?.asyncDir) continue;
    const owned = ownedSubagentPids(task.asyncDir, workspace, options);
    if (owned.action !== "signaled") {
      outcomes.push({ id: task.id, action: owned.action, pids: [] });
      continue;
    }
    let signaledAny = false;
    for (const pid of owned.pids) {
      try {
        signalPid(pid, "SIGTERM", platform, kill);
        signaled.push(pid);
        signaledAny = true;
      } catch (error) {
        if (error?.code !== "ESRCH") continue;
        signaledAny = true;
      }
    }
    outcomes.push(signaledAny
      ? { id: task.id, action: "signaled", pids: owned.pids }
      : { id: task.id, action: "skipped", pids: [] });
  }
  if (signaled.length && graceMs > 0) await wait(graceMs);
  for (const pid of signaled) {
    if (!processAlive(pid, kill)) continue;
    try {
      signalPid(pid, "SIGKILL", platform, kill);
    } catch {
      // The process group already exited between the probe and the signal.
    }
  }
  return outcomes;
}
