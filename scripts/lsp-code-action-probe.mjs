import piLspExtension from "@narumitw/pi-lsp/src/index.ts";
import { createReviewedLspExtension } from "../bridge-lsp.js";
import { applyCodingResourcePolicy } from "../bridge-resource-policy.js";

async function readInput() {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return JSON.parse(value);
}

async function main() {
  const input = await readInput();
  applyCodingResourcePolicy(process.env);

  let lspFixTool;
  const registeredCommands = new Map();
  const registeredEvents = new Map();
  const extensionApi = {
    registerTool(tool) {
      if (tool?.name === "lsp_fix") lspFixTool = tool;
    },
    registerCommand(name, command) {
      registeredCommands.set(name, command);
    },
    on(name, handler) {
      registeredEvents.set(name, handler);
    },
  };
  const policy = {
    ctf: false,
    workspace: input.workspace,
    executionMode: "go",
    approvalPolicy: input.approvalPolicy ?? "workspace-auto",
    activeTools: ["lsp_fix"],
  };
  const approvalRequests = [];

  createReviewedLspExtension(piLspExtension, {
    conversationId: "lsp-code-action-probe",
    getPolicy: () => policy,
    approvalBroker: {
      async request(request) {
        approvalRequests.push(request);
        return input.approved !== false;
      },
    },
  })(extensionApi);

  if (!lspFixTool) throw new Error("pi-lsp did not register lsp_fix");

  try {
    const result = await lspFixTool.execute(
      "lsp-code-action-probe",
      {
        path: input.path,
        kind: input.kind,
        server: input.server,
        write: input.write === true,
      },
      undefined,
      undefined,
      { ui: { setStatus() {} } },
    );
    process.stdout.write(`${JSON.stringify({
      ok: true,
      result,
      approvalRequests,
    })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      approvalRequests,
    })}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
