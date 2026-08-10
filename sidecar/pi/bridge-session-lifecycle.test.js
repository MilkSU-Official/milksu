import assert from "node:assert/strict";
import test from "node:test";
import { disposeAgentSession } from "./bridge-session-lifecycle.js";

function fakeSession({ hasShutdownHandler = true, shutdownError } = {}) {
  const events = [];
  return {
    events,
    session: {
      async abort() {
        events.push("abort");
      },
      hasExtensionHandlers(name) {
        assert.equal(name, "session_shutdown");
        return hasShutdownHandler;
      },
      extensionRunner: {
        async emit(event) {
          events.push(event);
          if (shutdownError) throw shutdownError;
        },
      },
      dispose() {
        events.push("dispose");
      },
    },
  };
}

test("disposes a Pi session only after extension shutdown completes", async () => {
  const fixture = fakeSession();
  await disposeAgentSession(fixture.session, "reload");
  assert.deepEqual(fixture.events, [
    "abort",
    { type: "session_shutdown", reason: "reload" },
    "dispose",
  ]);
});

test("skips the shutdown event when no extension owns session resources", async () => {
  const fixture = fakeSession({ hasShutdownHandler: false });
  await disposeAgentSession(fixture.session);
  assert.deepEqual(fixture.events, ["abort", "dispose"]);
});

test("still invalidates the session when extension cleanup fails", async () => {
  const fixture = fakeSession({ shutdownError: new Error("cleanup failed") });
  await assert.rejects(
    disposeAgentSession(fixture.session),
    /cleanup failed/,
  );
  assert.equal(fixture.events.at(-1), "dispose");
});
