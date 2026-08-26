import { randomUUID } from "node:crypto";

export function createApprovalBroker(emit, createID = randomUUID) {
  const pending = new Map();
  const conversationGrants = new Map();

  function grantKey(value) {
    return String(value ?? "").trim();
  }

  function hasConversationGrant(conversationId, key) {
    return Boolean(key) && Boolean(conversationGrants.get(conversationId)?.has(key));
  }

  function rememberConversationGrant(conversationId, key) {
    if (!key) return;
    const granted = conversationGrants.get(conversationId) ?? new Set();
    granted.add(key);
    conversationGrants.set(conversationId, granted);
  }

  function settle(requestID, approved, reason = "") {
    const request = pending.get(requestID);
    if (!request) {
      throw new Error(`Unknown MilkSU approval request: ${requestID}`);
    }
    pending.delete(requestID);
    emit(request.conversationId, "approval_resolved", {
      requestId: requestID,
      toolName: request.toolName,
      approved: Boolean(approved),
      reason,
    });
    request.resolve(Boolean(approved));
  }

  return {
    requestChoice({ conversationId, question, options }) {
      const requestID = createID();
      return new Promise((resolve) => {
        pending.set(requestID, {
          conversationId,
          toolName: "milksu_ask",
          kind: "choice",
          options,
          resolve(approved, choice) {
            resolve(approved ? choice : null);
          },
        });
        emit(conversationId, "approval_requested", {
          requestId: requestID,
          toolName: "milksu_ask",
          content: question,
          input: JSON.stringify({ options }),
        });
      });
    },

    request({ conversationId, toolName, content, input, grantKey: requestedGrantKey }) {
      const key = grantKey(requestedGrantKey);
      if (hasConversationGrant(conversationId, key)) {
        return Promise.resolve(true);
      }
      const requestID = createID();
      return new Promise((resolve) => {
        pending.set(requestID, {
          conversationId,
          toolName,
          grantKey: key,
          resolve,
        });
        emit(conversationId, "approval_requested", {
          requestId: requestID,
          toolName,
          content,
          input,
          ...(key ? { grantable: true } : {}),
        });
      });
    },

    respond({ conversationId, requestId, approved, scope, choice }) {
      const request = pending.get(requestId);
      if (!request || request.conversationId !== conversationId) {
        throw new Error(`Unknown MilkSU approval request: ${requestId}`);
      }
      if (request.kind === "choice") {
        if (!approved) {
          settle(requestId, false, "dismissed by user");
          return;
        }
        const selected = String(choice ?? "").trim();
        const option = request.options.find(item => item.id === selected);
        if (!option) throw new Error("Unknown MilkSU choice");
        pending.delete(requestId);
        emit(request.conversationId, "approval_resolved", {
          requestId,
          toolName: request.toolName,
          approved: true,
          reason: "choice selected",
          choice: option.id,
        });
        request.resolve(true, option);
        return;
      }
      const conversationGrant = approved
        && String(scope ?? "").trim() === "conversation"
        && Boolean(request.grantKey);
      if (conversationGrant) {
        rememberConversationGrant(conversationId, request.grantKey);
      }
      settle(
        requestId,
        approved,
        approved
          ? conversationGrant
            ? "approved for this conversation"
            : "approved by user"
          : "denied by user",
      );
    },

    cancelConversation(conversationId, reason = "approval expired") {
      for (const [requestID, request] of pending) {
        if (request.conversationId === conversationId) {
          settle(requestID, false, reason);
        }
      }
    },

    clearConversationGrants(conversationId) {
      conversationGrants.delete(conversationId);
    },

    cancelAll(reason = "approval channel closed") {
      for (const requestID of [...pending.keys()]) {
        settle(requestID, false, reason);
      }
      conversationGrants.clear();
    },

    pendingCount() {
      return pending.size;
    },
  };
}
