import { randomUUID } from "node:crypto";
import { Type } from "typebox";

export const workspaceCandidatesToolName = "milksu_workspace_candidates";
export const workspaceAccessToolName = "milksu_workspace_access";

export function createWorkspaceAccessBroker(emit, createID = randomUUID) {
  const pending = new Map();

  function settle(requestID, response) {
    const request = pending.get(requestID);
    if (!request) throw new Error(`Unknown MilkSU workspace request: ${requestID}`);
    pending.delete(requestID);
    if (response?.error) request.reject(new Error(String(response.error)));
    else request.resolve(response ?? {});
  }

  return {
    request(conversationId, request) {
      const requestId = createID();
      return new Promise((resolve, reject) => {
        pending.set(requestId, { conversationId, request, resolve, reject });
        emit(conversationId, "workspace_access_requested", {
          requestId,
          action: request.action,
          path: request.path,
          query: request.query,
          reason: request.reason,
        });
      });
    },

    respond(response) {
      const requestId = String(response?.requestId ?? "").trim();
      const request = pending.get(requestId);
      if (!request || request.conversationId !== response?.conversationId) {
        throw new Error(`Unknown MilkSU workspace request: ${requestId}`);
      }
      if (!response?.error && request.request?.action !== "discover") {
        emit(request.conversationId, "workspace_access_updated", {
          action: request.request.action,
          path: String(response?.path ?? request.request.path ?? "").trim(),
          paths: Array.isArray(response?.paths) ? response.paths : [],
          restartRequired: response?.restartRequired === true,
        });
      }
      settle(requestId, response);
    },

    cancelConversation(conversationId, reason = "workspace request expired") {
      for (const [requestId, request] of pending) {
        if (request.conversationId === conversationId) {
          settle(requestId, { error: reason });
        }
      }
    },

    cancelAll(reason = "workspace request channel closed") {
      for (const requestId of [...pending.keys()]) {
        settle(requestId, { error: reason });
      }
    },
  };
}

export function createWorkspaceAccessExtension(conversationId, broker) {
  return (pi) => {
    pi.registerTool({
      name: workspaceCandidatesToolName,
      label: "Find local project directories",
      description: "Resolve a user's informal directory reference into a small list of local directory candidates. This only lists directory paths; it never grants access. Use it when the user says things like 'my MilkSU project' or 'the vault in Documents' without an exact path.",
      parameters: Type.Object({
        query: Type.String({
          minLength: 1,
          maxLength: 160,
          description: "A concise semantic search phrase derived from the user's wording, not a shell glob.",
        }),
      }),
      async execute(_toolCallId, params) {
        const response = await broker.request(conversationId, {
          action: "discover",
          query: params.query,
        });
        const paths = Array.isArray(response.paths) ? response.paths : [];
        return {
          content: [{
            type: "text",
            text: paths.length
              ? `Possible local directories:\n${paths.map(path => `- ${path}`).join("\n")}`
              : "No matching local directory was found. Ask the user for another description or path.",
          }],
          details: { paths },
        };
      },
    });

    pi.registerTool({
      name: workspaceAccessToolName,
      label: "Update workspace access",
      description: "Grant or revoke one concrete local directory for the current Coding conversation after understanding the user's natural-language authorization. The path may come from workspace candidate discovery. Do not call this tool merely because a task mentions a path; the current user turn must authorize the scope change.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("grant"), Type.Literal("revoke")]),
        path: Type.String({ minLength: 1, maxLength: 1024 }),
        reason: Type.String({
          minLength: 1,
          maxLength: 240,
          description: "A short explanation of how the current user turn authorized this scope change.",
        }),
      }),
      async execute(_toolCallId, params) {
        const response = await broker.request(conversationId, params);
        const paths = Array.isArray(response.paths) ? response.paths : [];
        const restartRequired = response.restartRequired === true;
        return {
          content: [{
            type: "text",
            text: restartRequired
              ? "Workspace access was updated. MilkSU will restart this Coding session and automatically resume the user's request. Stop this turn without asking the user to repeat anything."
              : "Workspace access already matches the request; continue the user's task now.",
          }],
          details: {
            action: params.action,
            path: String(response.path ?? params.path),
            paths,
            restartRequired,
          },
        };
      },
    });

    pi.on("before_agent_start", async (event) => ({
      systemPrompt: `${event.systemPrompt}\n\nMilkSU conversational workspace access:\n`
        + "Understand informal user references to local projects in ordinary language; never require a command syntax or a regex-shaped exact phrase. "
        + `Use ${workspaceCandidatesToolName} to resolve a fuzzy directory name. If several candidates remain plausible, ask one concise clarification in chat. `
        + `Call ${workspaceAccessToolName} only when the current user meaningfully grants or revokes access; a path mention, quoted example, conditional statement, or model guess is not authorization. `
        + "The Desktop validates and persists the concrete directory. Never invent success. When the tool reports restartRequired, stop the turn; MilkSU resumes automatically.",
    }));
  };
}
