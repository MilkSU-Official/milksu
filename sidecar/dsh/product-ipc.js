import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createServer } from "node:net";

export function createProductIpc(socketPath, handler) {
  try {
    mkdirSync(dirname(socketPath), { mode: 0o700, recursive: true });
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
        void handleLine(socket, line);
      }
    });
  });

  async function handleLine(socket, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    try {
      const result = await handler(message);
      socket.write(`${JSON.stringify({ id: message.id, result })}\n`);
    } catch (error) {
      socket.write(`${JSON.stringify({
        id: message.id,
        error: { message: error instanceof Error ? error.message : String(error) },
      })}\n`);
    }
  }

  return {
    path: socketPath,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => resolve());
      });
    },
    close() {
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}
