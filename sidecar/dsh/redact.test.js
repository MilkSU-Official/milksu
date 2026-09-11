import assert from "node:assert/strict";
import test from "node:test";
import { formatProcessFailure, redactProcessText } from "./redact.js";

test("redactProcessText strips keys, bearer, and assignments", () => {
  assert.match(redactProcessText("using sk-abcdefghijklmnopqrstuvwxyz"), /\[REDACTED\]/);
  assert.match(redactProcessText("Authorization: Bearer abcdefghijklmnop"), /\[REDACTED\]/);
  assert.match(redactProcessText("api_key=supersecretvalue"), /\[REDACTED\]/);
  assert.doesNotMatch(redactProcessText("api_key=supersecretvalue"), /supersecretvalue/);
});

test("formatProcessFailure keeps a short stderr tail without leaking secrets", () => {
  const message = formatProcessFailure(
    "spawn ENOENT",
    "api_key=supersecretvalue\nmore",
  );
  assert.match(message, /ENOENT/);
  assert.doesNotMatch(message, /supersecretvalue/);
  assert.ok([...message].length <= 323);
});
