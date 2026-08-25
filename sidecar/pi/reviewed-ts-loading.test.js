import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareReviewedTypeScript } from "./prepare-reviewed-ts.mjs";

const sidecarDirectory = dirname(fileURLToPath(import.meta.url));

function runNodeUntilOutput(args, input = "") {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, {
      cwd: join(sidecarDirectory, "..", ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const finish = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      resolvePromise({ stdout, stderr });
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`Sidecar start timed out: ${stderr || stdout}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes("\n")) {
        clearTimeout(timeout);
        finish();
      }
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      resolvePromise({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

test("development Sidecar does not import TypeScript from node_modules", async () => {
  const source = await readFile(join(sidecarDirectory, "bridge.js"), "utf8");
  assert.match(source, /from "\.\/reviewed-ts\/extensions\.js"/);
  assert.doesNotMatch(source, /from "pi-mcp-adapter"/);
  assert.doesNotMatch(source, /from "[^"]+\/src\/index\.ts"/);
  assert.doesNotMatch(source, /from "[^"]+\/extensions\/index\.ts"/);
});

test("reviewed TypeScript extensions load as JavaScript outside node_modules", async () => {
  await prepareReviewedTypeScript();
  const loaded = await import("./reviewed-ts/extensions.js");
  assert.equal(typeof loaded.createMcpAdapter, "function");
  assert.equal(typeof loaded.piGoalExtension, "function");
  assert.equal(typeof loaded.piLspExtension, "function");
  assert.equal(typeof loaded.piBackgroundTasksExtension, "function");
  assert.equal(typeof loaded.piSubAgentExtension, "function");
  assert.equal(typeof loaded.readPiBackgroundTaskLog, "function");
  assert.equal(typeof loaded.listPiBackgroundTaskMetas, "function");
  assert.equal(typeof loaded.spawnPiBackgroundTask, "function");
  assert.equal(typeof loaded.stopPiBackgroundTask, "function");
});

test("development Sidecar entry starts without node_modules type stripping", async () => {
  const result = await runNodeUntilOutput(
    [join(sidecarDirectory, "run-bridge.mjs")],
    `${JSON.stringify({ action: "not_a_command" })}\n`,
  );
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/,
  );
  const event = JSON.parse(result.stdout.trim().split("\n").find(Boolean));
  assert.equal(event.type, "error");
  assert.match(String(event.error), /Unknown action/);
});
