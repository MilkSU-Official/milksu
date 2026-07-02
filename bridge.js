import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { createReadStream } from "fs";
import { createInterface } from "readline";

let currentPromptId = null;

function emit(type, data) {
  const line = JSON.stringify({ type, id: currentPromptId, ...data });
  process.stdout.write(line + "\n");
}

const rl = createInterface({ input: process.stdin });

let session = null;

async function initSession() {
  try {
    const { session: s } = await createAgentSession({
      cwd: process.cwd(),
    });

    session = s;

    session.subscribe((event) => {
      switch (event.type) {
        case "text_delta":
          emit("text_delta", { delta: event.delta });
          break;
        case "thinking_delta":
          emit("thinking_delta", { delta: event.delta });
          break;
        case "toolcall_start":
          emit("tool_call_start", {
            toolName: event.partial?.content?.[event.contentIndex]?.toolName,
          });
          break;
        case "toolcall_end":
          if (event.toolCall?.toolName === "panel_update") {
            const input = event.toolCall?.toolInput ?? {};
            emit("panel_update", {
              set_fields: input.set_fields ?? {},
              append_items: input.append_items ?? {},
            });
          }
          emit("tool_call_end", {
            toolName: event.toolCall?.toolName,
            toolInput: event.toolCall?.toolInput,
          });
          break;
        case "done":
          emit("message_done", {
            reason: event.reason,
            content: extractTextContent(event.message),
          });
          break;
        case "error":
          emit("error", {
            reason: event.reason,
            error: String(event.error),
          });
          break;
      }
    });

    emit("ready", {});
  } catch (err) {
    emit("error", { reason: "init_failed", error: String(err) });
    process.exit(1);
  }
}

function extractTextContent(message) {
  if (!message?.content) return "";
  return message.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

rl.on("line", async (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.type === "prompt") {
      if (!session) {
        emit("error", { reason: "no_session", error: "Session not initialized", id: msg.id });
        return;
      }
      currentPromptId = msg.id;
      emit("prompt_ack", { id: msg.id });
      if (msg.model && msg.provider) {
        const desired = session.modelRegistry.find(msg.provider, msg.model);
        if (desired) {
          const current = session.model;
          if (!current || current.provider !== msg.provider || current.id !== msg.model) {
            try {
              await session.setModel(desired);
            } catch (err) {
              emit("error", { reason: "model_switch_failed", error: String(err) });
            }
          }
        }
      }
      await session.prompt(msg.text);
    }
  } catch (err) {
    emit("error", { reason: "parse_error", error: String(err) });
  }
});

rl.on("close", () => {
  if (session) session.dispose();
  process.exit(0);
});

await initSession();
