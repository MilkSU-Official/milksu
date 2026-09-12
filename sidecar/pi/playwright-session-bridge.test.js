import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bridgePath = fileURLToPath(new URL("./playwright-session-bridge.cjs", import.meta.url));

function runBridge(env, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`playwright session bridge timed out: ${stderr || stdout}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("playwright session bridge execs the packaged CLI after the descriptor appears", async () => {
  const directory = await mkdtemp(join(tmpdir(), "milksu-pw-bridge-"));
  const cli = join(directory, "cli.cjs");
  const file = join(directory, "cdp.json");
  await writeFile(cli, "console.log(process.argv.slice(2).join(' '));\n");
  const started = runBridge({
    MILKSU_PLAYWRIGHT_MCP_CLI: cli,
    MILKSU_CODING_BROWSER_DESCRIPTOR_FILE: file,
  });
  await writeFile(file, `${JSON.stringify({
    sessionId: "browser_12345678-abcd-4567-8901-123456789abc",
    cdpEndpoint: "http://127.0.0.1:43127",
  })}\n`);
  const result = await started;
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--cdp-endpoint http:\/\/127\.0\.0\.1:43127/);
});

test("playwright session bridge fails closed when the isolated browser is not ready", async () => {
  const result = await runBridge({
    MILKSU_PLAYWRIGHT_MCP_CLI: process.execPath,
    MILKSU_CODING_BROWSER_DESCRIPTOR_FILE: join(tmpdir(), "milksu-missing-cdp.json"),
  }, 3_000);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /isolated browser is not ready/);
});
