import { existsSync } from "node:fs";
import { join } from "node:path";

export function parseArgList(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return [...fallback];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const args = parsed.map(item => String(item ?? "").trim()).filter(Boolean);
        if (args.length) return args;
      }
    } catch {
      // Fall through to whitespace split.
    }
  }
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
  const configured = String(env.MILKSU_DSH_COMMAND ?? "").trim();
  const extra = parseArgList(env.MILKSU_DSH_ACP_ARGS, ["--profile", "acp"]);
  if (configured) {
    return { command: configured, args: extra };
  }
  throw new Error("Agent command is not configured");
}
