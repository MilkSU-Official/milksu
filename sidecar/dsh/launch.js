import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function parseArgList(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return [...fallback];
  return raw.split(/\s+/).filter(Boolean);
}

export function resolveDshScript(here) {
  const root = String(here ?? "").trim();
  const candidates = [
    join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    join(root, "..", "..", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

export function resolveDshLaunch(options = {}) {
  const env = options.env ?? process.env;
  const here = options.here ?? dirname(fileURLToPath(import.meta.url));
  const execPath = options.execPath ?? process.execPath;
  const configured = String(env.MILKSU_DSH_COMMAND ?? "").trim();
  const extra = parseArgList(env.MILKSU_DSH_ACP_ARGS, ["--profile", "acp"]);
  if (configured) {
    return { command: configured, args: extra };
  }
  const script = resolveDshScript(here);
  if (!script) {
    throw new Error("DeepSeek Harness CLI is not packaged next to the Sidecar");
  }
  return { command: execPath, args: [script, ...extra] };
}
