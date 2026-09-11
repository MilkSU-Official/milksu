import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const name = "milksu-dsh-host";
export const inject = ["compaction", "agents"];

export function apply(ctx) {
  const path = String(process.env.MILKSU_DSH_HOST_IPC ?? "").trim();
  if (!path) return;

  try {
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  } catch {
    // Named pipes have no parent directory.
  }

  const server = createServer(socket => {
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        void handleLine(ctx, socket, line);
      }
    });
  });

  ctx.effect(() => {
    server.listen(path);
    return () => {
      server.close();
    };
  });
}

async function handleLine(ctx, socket, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const result = await dispatch(ctx, message);
    socket.write(`${JSON.stringify({ id: message.id, result })}\n`);
  } catch (error) {
    socket.write(`${JSON.stringify({
      id: message.id,
      error: { message: error instanceof Error ? error.message : String(error) },
    })}\n`);
  }
}

async function dispatch(ctx, message) {
  if (message.method !== "compact") {
    throw new Error(`Unknown MilkSU host method: ${message.method}`);
  }
  const sessionId = String(message.params?.sessionId ?? "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  const agent = ctx.agents.get(sessionId);
  if (!agent) throw new Error(`DeepSeek Harness session not found: ${sessionId}`);
  const result = await ctx.compaction.compactNow(agent, AbortSignal.timeout(120_000));
  if (result == null) {
    return { compacted: false, tokensBefore: 0, estimatedTokensAfter: 0 };
  }
  return {
    compacted: true,
    tokensBefore: Number(result.shadowedTokenCount ?? 0),
    estimatedTokensAfter: 0,
    summarySeq: result.summarySeq,
  };
}
