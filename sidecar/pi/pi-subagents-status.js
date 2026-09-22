import { readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const runningStates = new Set([
  "queued",
  "running",
  "paused",
  "starting",
  "pending",
  "scheduled",
]);
const failedTokens = ["fail", "stop", "kill", "timeout", "error", "reject"];
const transcriptLimit = 8000;
const summaryLimit = 240;

function insideRoot(root, target) {
  const path = relative(root, target);
  return path === ""
    || (
      path !== ".."
      && !path.startsWith(`..${sep}`)
      && !isAbsolute(path)
    );
}

export function acceptedAsyncDir(asyncDir, workspace) {
  const raw = String(asyncDir ?? "").trim();
  if (!raw || raw.includes("\0") || raw.split(/[/\\]/).includes("..")) return "";
  let resolved;
  try {
    resolved = realpathSync(raw);
  } catch {
    return "";
  }
  const roots = [];
  try {
    roots.push(realpathSync(resolve(tmpdir())));
  } catch {
    roots.push(resolve(tmpdir()));
  }
  if (workspace) {
    try {
      roots.push(realpathSync(String(workspace)));
    } catch {
      // A missing workspace cannot authorize a read.
    }
  }
  return roots.some(root => insideRoot(root, resolved)) ? resolved : "";
}

export function mapAsyncSubagentStatus(state) {
  const value = String(state ?? "").trim().toLowerCase();
  if (!value || runningStates.has(value)) return "running";
  if (failedTokens.some(token => value.includes(token))) return "failed";
  return "succeeded";
}

function hideAbsolutePaths(text) {
  return String(text ?? "")
    .replace(/(?:^|[\s"'`(])(?:\/|[A-Za-z]:\\)[^\s"'`)]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bounded(text, limit) {
  const value = hideAbsolutePaths(text);
  if (value.length <= limit) return value;
  return value.slice(value.length - limit);
}

function readTail(path, limit) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 2_000_000) return "";
    const text = readFileSync(path, "utf8");
    return text.length > limit ? text.slice(text.length - limit) : text;
  } catch {
    return "";
  }
}

export function readAsyncSubagentSnapshot(asyncDir, workspace) {
  const directory = acceptedAsyncDir(asyncDir, workspace);
  if (!directory) return null;
  let status = {};
  try {
    const parsed = JSON.parse(readFileSync(join(directory, "status.json"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) status = parsed;
  } catch {
    status = {};
  }
  const transcript = bounded(readTail(join(directory, "output-0.log"), transcriptLimit), transcriptLimit);
  const state = String(status.state ?? "").trim();
  const error = typeof status.error === "string" ? status.error : "";
  const summarySource = error || state || transcript;
  return {
    status: mapAsyncSubagentStatus(state),
    summary: bounded(summarySource, summaryLimit),
    transcript: transcript || undefined,
  };
}
