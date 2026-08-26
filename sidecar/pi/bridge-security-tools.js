import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import { assertWorkspacePath, sandboxProfile } from "./bridge-policy.js";

const supportedIds = new Set(["ida-pro", "capa"]);
const outputLimit = 60_000;

function within(root, target) {
  const path = relative(root, target);
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function regularCanonicalFile(path, label) {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  return realpath(path);
}

function boundedText(value, label, limit = 240) {
  const text = String(value ?? "").trim();
  if (!text || text.length > limit || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`MilkSU rejected an invalid ${label}`);
  }
  return text;
}

export async function normalizeSecurityTools(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 4) {
    throw new Error("MilkSU rejected an invalid security tool catalog");
  }
  const result = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("MilkSU rejected an invalid security tool descriptor");
    }
    const id = boundedText(raw.id, "security tool id", 32);
    if (!supportedIds.has(id) || seen.has(id)) {
      throw new Error(`MilkSU rejected unsupported or duplicate security tool ${id}`);
    }
    seen.add(id);
    const command = await regularCanonicalFile(raw.command, `${id} command`);
    const capabilities = Array.isArray(raw.capabilities)
      ? raw.capabilities.map(value => boundedText(value, `${id} capability`, 120)).slice(0, 12)
      : [];
    const normalized = {
      id,
      command,
      version: boundedText(raw.version, `${id} version`, 80),
      capabilities,
    };
    if (id === "ida-pro") {
      normalized.profilePath = await regularCanonicalFile(raw.profilePath, "IDA profile");
      normalized.idaPath = resolve(boundedText(raw.idaPath, "IDA path", 520));
      const idaMetadata = await lstat(normalized.idaPath);
      if (idaMetadata.isSymbolicLink() || !idaMetadata.isDirectory()) {
        throw new Error("MilkSU requires IDA Pro to be a regular application directory");
      }
      normalized.userIdaPath = resolve(boundedText(raw.userIdaPath, "IDA user path", 520));
      // HOME belongs to MilkSU's isolated Agent runtime. The supervised Go
      // launcher separately publishes the real local user home for reviewed
      // desktop tools such as IDA, whose IDAUSR directory intentionally lives
      // outside that isolation root.
      const home = String(
        process.env.MILKSU_USER_HOME ?? process.env.HOME ?? "",
      ).trim();
      if (!home || !within(resolve(home), normalized.userIdaPath)) {
        throw new Error("MilkSU rejected an IDA user directory outside the current home");
      }
    }
    result.push(normalized);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

export function securityToolSelectionChanged(previous, next) {
  const project = value => (Array.isArray(value) ? value : []).map(tool => ({
    id: String(tool?.id ?? ""),
    command: String(tool?.command ?? ""),
    version: String(tool?.version ?? ""),
    profilePath: String(tool?.profilePath ?? ""),
  })).sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(project(previous)) !== JSON.stringify(project(next));
}

export function createSecurityToolsExtension(workspace, tools) {
  const capa = tools.find(tool => tool.id === "capa");
  return (pi) => {
    if (capa) {
      pi.registerTool({
        name: "capa_analyze",
        label: "Analyze binary with capa",
        description: "Analyze one binary inside the selected Coding workspace with the locally configured Mandiant capa release. Use this when static capability identification can answer the task faster than manual inspection.",
        parameters: Type.Object({
          relativePath: Type.String({
            minLength: 1,
            maxLength: 520,
            description: "Path to a binary inside the selected Coding workspace.",
          }),
          format: Type.Optional(Type.Union([
            Type.Literal("summary"),
            Type.Literal("json"),
          ])),
        }),
        async execute(_toolCallId, params, signal) {
          const root = await realpath(workspace);
          const target = await assertWorkspacePath(root, resolve(root, params.relativePath));
          const metadata = await lstat(target);
          if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new Error("capa requires a regular file inside the workspace");
          }
          const args = params.format === "json" ? ["-j", target] : [target];
          const result = await runCapa(root, capa.command, args, signal);
          return {
            content: [{ type: "text", text: result.output }],
            details: {
              tool: "capa",
              version: capa.version,
              relativePath: relative(root, target).replaceAll("\\", "/"),
              format: params.format === "json" ? "json" : "summary",
              exitCode: result.exitCode,
            },
          };
        },
      });
    }

    pi.on("before_agent_start", async (event) => {
      if (!tools.length) return undefined;
      const index = tools.map(tool => (
        `- ${tool.id} (${tool.version}): ${tool.capabilities.join("；")}`
      )).join("\n");
      return {
        systemPrompt: `${event.systemPrompt}\n\nMilkSU local security capability index:\n${index}\n`
          + "Choose these tools yourself only when they materially help the user's task. "
          + "The IDA MCP exposes its reviewed schema lazily through the mcp tool; "
          + "capa_analyze accepts only a workspace-relative binary path.\n",
      };
    });
  };
}

function runCapa(workspace, command, args, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        sandboxProfile(workspace, false, [], false, [dirname(command)], []),
        "/usr/bin/env",
        "-i",
        "PATH=/usr/bin:/bin:/usr/sbin:/sbin",
        `HOME=${tmpdir()}`,
        `TMPDIR=${tmpdir()}`,
        "LANG=en_US.UTF-8",
        command,
        ...args,
      ],
      { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout;
    const finish = callback => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", chunk => {
      if (stdout.length < outputLimit) stdout += String(chunk);
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < 8_000) stderr += String(chunk);
    });
    child.on("error", error => finish(() => rejectPromise(error)));
    child.on("close", exitCode => finish(() => {
      if (exitCode !== 0) {
        rejectPromise(new Error(`capa exited with ${exitCode}: ${stderr.trim()}`));
        return;
      }
      const output = stdout.length >= outputLimit
        ? `${stdout.slice(0, outputLimit)}\n…output truncated by MilkSU`
        : stdout;
      resolvePromise({ exitCode, output: output.trim() || "capa returned no matches." });
    }));
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => rejectPromise(new Error("capa analysis exceeded 120 seconds")));
    }, 120_000);
  });
}
