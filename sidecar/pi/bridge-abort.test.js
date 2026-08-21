import assert from "node:assert/strict";
import test from "node:test";
import { dropSendAfterAbort } from "./bridge-abort.js";

test("drops a queued send when stop arrived before the Pi session existed", () => {
  const aborted = new Set(["conversation-1"]);
  assert.equal(dropSendAfterAbort(aborted, new Map(), "conversation-1"), true);
  assert.equal(aborted.has("conversation-1"), false);
});

test("does not drop a later send after an idle session was aborted", () => {
  const aborted = new Set(["conversation-1"]);
  const sessions = new Map([["conversation-1", {}]]);
  assert.equal(dropSendAfterAbort(aborted, sessions, "conversation-1"), false);
  assert.equal(aborted.has("conversation-1"), false);
});

test("ignores abort notes for a different conversation", () => {
  const aborted = new Set(["conversation-1"]);
  assert.equal(dropSendAfterAbort(aborted, new Map(), "conversation-2"), false);
  assert.equal(aborted.has("conversation-1"), true);
});
