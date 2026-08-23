import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_MAX_BYTES,
} from "@earendil-works/pi-coding-agent";
import {
  boundModelText,
  boundToolResultContent,
  persistOverflowText,
  toolResultCaptureRoot,
} from "./bridge-tool-result-bound.js";

test("small tool text stays in the model-visible body", () => {
  const bound = boundModelText("ok");
  assert.equal(bound.truncated, false);
  assert.equal(bound.text, "ok");
});

test("multiline output past Pi's 50KB/2000-line limit is clipped from the head", () => {
  const lines = Array.from({ length: 2500 }, (_, index) => `line-${index}`);
  const bound = boundModelText(lines.join("\n"));
  assert.equal(bound.truncated, true);
  assert.ok(bound.text.startsWith("line-0"));
  assert.equal(bound.text.includes("line-2499"), false);
  assert.ok(bound.previewBytes <= DEFAULT_MAX_BYTES);
});

test("a minified one-line dump is byte-clipped instead of dropped", () => {
  const blob = `var x="${"a".repeat(DEFAULT_MAX_BYTES + 2048)}";`;
  const bound = boundModelText(blob);
  assert.equal(bound.truncated, true);
  assert.ok(bound.text.startsWith("var x="));
  assert.ok(bound.previewBytes <= DEFAULT_MAX_BYTES);
  assert.ok(bound.totalBytes > DEFAULT_MAX_BYTES);
});

test("overflow is saved under the private runtime for on-demand read", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "milksu-tool-bound-"));
  const path = await persistOverflowText("full-output", "call-1", {
    MILKSU_WORKSPACE_RUNTIME: runtime,
  });
  assert.equal(path.startsWith(toolResultCaptureRoot({
    MILKSU_WORKSPACE_RUNTIME: runtime,
  }).replaceAll("\\", "/")), true);
  assert.equal(await readFile(path, "utf8"), "full-output");
});

test("keeps non-text blocks when rewriting the model-visible result", () => {
  const content = boundToolResultContent(
    [
      { type: "text", text: "preview" },
      { type: "image", data: "abc", mimeType: "image/png" },
    ],
    {
      text: "preview",
      previewBytes: 7,
      totalBytes: 99,
      capturePath: "/tmp/full.txt",
    },
  );
  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /Full output saved to \/tmp\/full.txt/);
  assert.equal(content[1].type, "image");
});
