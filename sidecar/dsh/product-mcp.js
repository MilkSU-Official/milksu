import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import {
  codingAskToolName,
  formatAskSelection,
  formatAskToolInput,
  normalizeAskOptions,
} from "../pi/bridge-ask.js";
import {
  codingWorkspaceToolName,
  codingWorkspaceGuidance,
  formatCodingWorkspaceInput,
  normalizeCodingWorkspaceAction,
} from "../pi/bridge-workspace.js";

const ipcPath = String(process.env.MILKSU_DSH_IPC ?? "").trim();
const conversationId = String(process.env.MILKSU_CONVERSATION_ID ?? "").trim();

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function callIpc(method, params) {
  if (!ipcPath) {
    return Promise.reject(new Error("MilkSU product IPC is not configured"));
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection(ipcPath);
    const id = Date.now();
    const input = createInterface({ input: socket });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("MilkSU product tool timed out"));
    }, 30_000);
    input.on("line", line => {
      if (!line.trim()) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timer);
      input.close();
      socket.end();
      if (message.error) {
        reject(new Error(message.error.message || "MilkSU product tool failed"));
        return;
      }
      resolve(message.result);
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

const tools = [
  {
    name: codingAskToolName,
    description: "Show a tappable choice card with 2-6 options. Use when asking a multiple-choice question or when the user asks you to present options. Wait for the selected option; do not write the choices as a numbered or bulleted list.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 1, maxLength: 200 },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              detail: { type: "string" },
            },
            required: ["label"],
          },
        },
      },
      required: ["question", "options"],
    },
  },
  {
    name: codingWorkspaceToolName,
    description: codingWorkspaceGuidance(),
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        tabId: { type: "string" },
        query: { type: "string" },
        url: { type: "string" },
        path: { type: "string" },
        panel: { type: "string" },
        kind: { type: "string" },
        id: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        title: { type: "string" },
      },
      required: ["action"],
    },
  },
];

async function callTool(name, args) {
  if (name === codingAskToolName) {
    const options = normalizeAskOptions(args?.options);
    const question = String(args?.question ?? "").trim();
    if (!question) throw new Error("milksu_ask needs a question");
    if (options.length < 2) throw new Error("milksu_ask needs at least two options");
    const picked = await callIpc("ask", { conversationId, question, options });
    return formatAskSelection(picked);
  }
  if (name === codingWorkspaceToolName) {
    const action = normalizeCodingWorkspaceAction(args?.action);
    if (!action) throw new Error("MilkSU rejected an unknown Coding workspace action.");
    const result = await callIpc("workspace", {
      conversationId,
      action,
      input: args ?? {},
    });
    return String(result ?? formatCodingWorkspaceInput(args));
  }
  throw new Error(`Unknown MilkSU tool: ${name}`);
}

const input = createInterface({ input: process.stdin });
input.on("line", line => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "milksu-dsh-product", version: "1" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "tools/list") {
    write({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }
  if (method === "tools/call") {
    void callTool(String(params?.name ?? ""), params?.arguments ?? {})
      .then(text => {
        write({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text }] },
        });
      })
      .catch(error => {
        write({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          },
        });
      });
    return;
  }
  if (id != null) {
    write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
});
