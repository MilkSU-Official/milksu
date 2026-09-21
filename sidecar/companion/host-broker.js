// Companion host IPC broker — same shape as Pi `createWorkspaceActionBroker`:
// finite default timeout, cancel-on-abort, optional timeoutMs:0 only while a
// confirm is parked (mirrors approvalBroker waiting for the user).

export const defaultCompanionHostTimeoutMs = 30_000;

export function createCompanionHostBroker(emit, options = {}) {
  const pending = new Map();
  let seq = 0;
  const defaultTimeoutMs = Number.isFinite(options.defaultTimeoutMs)
    ? options.defaultTimeoutMs
    : defaultCompanionHostTimeoutMs;
  const createID = typeof options.createID === "function"
    ? options.createID
    : () => `companion-host-${++seq}`;

  return {
    request(action, input, requestOptions = {}) {
      const requestId = createID();
      const timeoutMs = Number.isFinite(requestOptions.timeoutMs)
        ? requestOptions.timeoutMs
        : defaultTimeoutMs;
      return new Promise((resolve, reject) => {
        let timer = null;
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            if (!pending.has(requestId)) return;
            pending.delete(requestId);
            reject(new Error("companion host request timed out"));
          }, timeoutMs);
        }
        pending.set(requestId, {
          resolve: (value) => {
            if (timer) clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            if (timer) clearTimeout(timer);
            reject(error);
          },
        });
        emit("companion_host", { requestId, action, input });
      });
    },

    respond(payload) {
      const requestId = String(payload?.requestId ?? "");
      const entry = pending.get(requestId);
      if (!entry) throw new Error(`unknown companion host request: ${requestId}`);
      pending.delete(requestId);
      if (payload?.ok === false) {
        entry.reject(new Error(String(payload?.error || "companion host request failed")));
        return;
      }
      entry.resolve(payload?.result ?? {});
    },

    cancelAll(reason = "companion host cancelled") {
      const error = new Error(reason);
      for (const [requestId, entry] of pending) {
        pending.delete(requestId);
        entry.reject(error);
      }
    },

    pendingCount() {
      return pending.size;
    },
  };
}
