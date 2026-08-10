import { randomUUID } from "node:crypto";

export function createApprovalBroker(emit, createID = randomUUID) {
  const pending = new Map();

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
    request({ conversationId, toolName, content, input }) {
      const requestID = createID();
      return new Promise((resolve) => {
        pending.set(requestID, {
          conversationId,
          toolName,
          resolve,
        });
        emit(conversationId, "approval_requested", {
          requestId: requestID,
          toolName,
          content,
          input,
        });
      });
    },

    respond({ conversationId, requestId, approved }) {
      const request = pending.get(requestId);
      if (!request || request.conversationId !== conversationId) {
        throw new Error(`Unknown MilkSU approval request: ${requestId}`);
      }
      settle(requestId, approved, approved ? "approved by user" : "denied by user");
    },

    cancelConversation(conversationId, reason = "approval expired") {
      for (const [requestID, request] of pending) {
        if (request.conversationId === conversationId) {
          settle(requestID, false, reason);
        }
      }
    },

    cancelAll(reason = "approval channel closed") {
      for (const requestID of [...pending.keys()]) {
        settle(requestID, false, reason);
      }
    },

    pendingCount() {
      return pending.size;
    },
  };
}
