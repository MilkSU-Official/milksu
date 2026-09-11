import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Usable sockaddr_un.sun_path length on Darwin (104 including NUL). Keep in
// sync with internal/hostpath.
const unixSocketMaxBytes = 103;

export function ephemeralRoot(env = process.env, platform = process.platform) {
  if (platform === "linux") {
    const dir = String(env.XDG_RUNTIME_DIR ?? "").trim();
    if (dir) return dir;
  }
  return tmpdir();
}

export function computerUseRuntimeRoot(
  sessionId,
  env = process.env,
  platform = process.platform,
) {
  return join(ephemeralRoot(env, platform), "milksu-computer-use", sessionId);
}

export function playwrightSocketRoot(env = process.env, platform = process.platform) {
  return join(ephemeralRoot(env, platform), "milksu-playwright");
}

export function computerUseSocket(
  sessionId,
  env = process.env,
  platform = process.platform,
) {
  if (platform === "win32") {
    return `\\\\.\\pipe\\milksu-computer-use-${sessionId}`;
  }
  return unixComputerUseSocket(ephemeralRoot(env, platform), sessionId);
}

export function dshProductIpc(
  conversationId,
  env = process.env,
  platform = process.platform,
) {
  const id = String(conversationId ?? "").trim() || "session";
  if (platform === "win32") {
    const suffix = id.slice(-24);
    return `\\\\.\\pipe\\milksu-dsh-${suffix}`;
  }
  return unixDshProductIpc(ephemeralRoot(env, platform), id, env, platform);
}

export function unixDshProductIpc(
  root,
  id,
  env = process.env,
  platform = process.platform,
) {
  const key = String(id ?? "").trim() || "session";
  for (const candidateRoot of [
    root,
    ephemeralRoot(env, platform),
    unixSocketOverflowRoot(env, platform),
  ]) {
    const path = fitUnixSocket(candidateRoot, "dsh", key);
    if (path) return path;
  }
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `${digest}.sock`;
}

function fitUnixSocket(root, prefix, id) {
  if (!String(root ?? "").trim()) return "";
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 16);
  for (const name of [
    `${prefix}-${id}.sock`,
    `${prefix}-${digest}.sock`,
    `${digest}.sock`,
  ]) {
    const candidate = join(root, name);
    if (Buffer.byteLength(candidate) <= unixSocketMaxBytes) return candidate;
  }
  return "";
}

function unixSocketOverflowRoot(env = process.env, platform = process.platform) {
  if (platform === "linux") {
    const cache = String(env.XDG_CACHE_HOME ?? "").trim();
    if (cache) return join(cache, "milksu-ipc");
  }
  return join(homedir(), ".cache", "milksu-ipc");
}

export function unixComputerUseSocket(root, sessionId) {
  const suffix = sessionId.startsWith("computer_")
    ? sessionId.slice("computer_".length)
    : sessionId;
  const candidate = join(root, `mcu-${suffix}.sock`);
  if (Buffer.byteLength(candidate) <= unixSocketMaxBytes) {
    return candidate;
  }
  const digest = createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return join(root, `mcu-${digest}.sock`);
}
