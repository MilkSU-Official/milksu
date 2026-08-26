import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
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
