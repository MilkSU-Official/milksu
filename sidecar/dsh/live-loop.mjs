import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hasDeepSeek = Boolean(String(process.env.DEEPSEEK_API_KEY ?? "").trim());
const hasTokenFlux = Boolean(String(process.env.TOKENFLUX_API_KEY ?? "").trim());

if (!hasDeepSeek && !hasTokenFlux) {
  console.log("SKIP live DeepSeek loop: no DEEPSEEK_API_KEY or TOKENFLUX_API_KEY in the environment");
  process.exit(0);
}

const home = mkdtempSync(join(tmpdir(), "milksu-dsh-live-"));
const child = spawn(process.execPath, [join(here, "run-bridge.mjs")], {
  cwd: here,
  env: {
    ...process.env,
    DSH_HOME: home,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const events = [];
let buffer = "";
child.stdout.on("data", chunk => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    events.push(JSON.parse(line));
  }
});
child.stderr.on("data", () => {});

function send(command) {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}

const timeout = setTimeout(() => {
  child.kill();
  console.error("FAIL live DeepSeek loop: timed out");
  process.exit(1);
}, 90_000);

try {
  send({
    action: "send_message",
    conversationId: "live-dsh-1",
    prompt: "Reply with the single word PONG and nothing else.",
    cwd: here,
  });
  const started = Date.now();
  while (Date.now() - started < 80_000) {
    const delta = events.find(event => event.type === "text_delta" && String(event.delta ?? "").trim());
    const error = events.find(event => event.type === "error" && event.error);
    if (error) {
      throw new Error(String(error.error));
    }
    if (delta) {
      const text = events.filter(event => event.type === "text_delta").map(event => event.delta).join("");
      if (!/pong/i.test(text)) {
        throw new Error("assistant reply did not contain PONG");
      }
      console.log("PASS live DeepSeek loop: streamed a PONG reply");
      process.exitCode = 0;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (process.exitCode !== 0) {
    throw new Error("no streamed assistant text");
  }
} catch (error) {
  console.error(`FAIL live DeepSeek loop: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  child.kill();
}
