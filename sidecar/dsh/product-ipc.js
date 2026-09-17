import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createServer } from "node:net";

export function swallowEmitterError(emitter) {
  if (!emitter || typeof emitter.on !== "function") return emitter;
  emitter.on("error", () => {});
  return emitter;
}

function writeIpc(socket, message) {
  try {
    socket.write(`${JSON.stringify(message)}\n`);
  } catch {
    // Client already closed the named pipe.
  }
}

export function createProductIpc(socketPath, handler) {
  try {
    mkdirSync(dirname(socketPath), { mode: 0o700, recursive: true });
  } catch {
    // Named pipes have no parent directory.
  }
  const server = createServer(socket => {
    swallowEmitterError(socket);
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
  // Windows named-pipe clients closing after milksu_workspace would otherwise
  // emit an unhandled server error and kill the whole DSH sidecar.
  swallowEmitterError(server);

  async function handleLine(socket, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    try {
      const result = await handler(message);
      writeIpc(socket, { id: message.id, result });
    } catch (error) {
      writeIpc(socket, {
        id: message.id,
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return {
    path: socketPath,
    listen() {
      return new Promise((resolve, reject) => {
        const onListenError = error => reject(error);
        server.once("error", onListenError);
        server.listen(socketPath, () => {
          server.off("error", onListenError);
          resolve();
        });
      });
    },
    close() {
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}
