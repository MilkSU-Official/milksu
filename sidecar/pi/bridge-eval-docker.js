import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function readEvalDocker(cwd) {
  const dir = join(String(cwd ?? ""), ".milksu-eval");
  const containerPath = join(dir, "container");
  const dockerPath = join(dir, "docker");
  const workdirPath = join(dir, "workdir");
  if (!existsSync(containerPath) || !existsSync(dockerPath)) return null;
  const container = readFileSync(containerPath, "utf8").trim();
  const docker = readFileSync(dockerPath, "utf8").trim();
  const workdir = existsSync(workdirPath) ? readFileSync(workdirPath, "utf8").trim() : "/app";
  if (!container || !docker) return null;
  return { container, docker, workdir };
}

export function wrapEvalDockerCommand(command, evalDocker) {
  if (!evalDocker?.container || !evalDocker?.docker) return command;
  const workdir = evalDocker.workdir || "/app";
  const encoded = JSON.stringify(String(command ?? ""));
  return `${evalDocker.docker} exec -i -w ${JSON.stringify(workdir)} ${JSON.stringify(evalDocker.container)} bash -lc ${encoded}`;
}

export function createEvalDockerExtension() {
  return pi => {
    pi.on("tool_call", async (event, ctx) => {
      try {
        if (event?.toolName !== "bash") return undefined;
        if (!event.input || typeof event.input !== "object") return undefined;
        const evalDocker = readEvalDocker(ctx?.cwd);
        if (!evalDocker) return undefined;
        event.input.command = wrapEvalDockerCommand(event.input.command, evalDocker);
      } catch {
        // Keep the original command if the wrapper cannot be applied.
      }
      return undefined;
    });
  };
}
