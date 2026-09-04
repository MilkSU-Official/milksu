import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  AnchorEditError,
  applyAnchorEdits,
  hashFileText,
  hashMatchesFile,
  hashesMatch,
  parseAnchorEdits,
  shouldFallbackToReplace,
  staleAnchorError,
  wrapEditToolDefinition,
} from "./bridge-edit-anchor.js";

const source = [
  "export function greet(name: string) {",
  "  return `hello ${name}`;",
  "}",
  "",
].join("\n");

const twoFunctions = [
  "export function greet(name: string) {",
  "  return `hello ${name}`;",
  "}",
  "",
  "export function farewell(name: string) {",
  "  return `bye ${name}`;",
  "}",
  "",
].join("\n");

async function wrappedEdit(fileSource) {
  const dir = await mkdtemp(join(tmpdir(), "milksu-edit-anchor-"));
  const rel = "sample.ts";
  await writeFile(join(dir, rel), fileSource);
  const tool = wrapEditToolDefinition(createEditToolDefinition(dir), { root: dir });
  return {
    dir,
    rel,
    tool,
    async body() {
      return readFile(join(dir, rel), "utf8");
    },
    async run(input) {
      try {
        const result = await tool.execute(
          "t",
          { path: rel, ...input },
          new AbortController().signal,
        );
        return {
          ok: true,
          text: result.content[0].text,
          body: await readFile(join(dir, rel), "utf8"),
        };
      } catch (reason) {
        return {
          ok: false,
          error: reason instanceof Error ? reason.message : String(reason),
          code: reason instanceof AnchorEditError ? reason.code : undefined,
          fallbackable: reason instanceof AnchorEditError ? reason.fallbackable : undefined,
          body: await readFile(join(dir, rel), "utf8"),
        };
      }
    },
  };
}

test("parseAnchorEdits leaves ordinary Pi replace calls alone", () => {
  const parsed = parseAnchorEdits({
    path: "sample.ts",
    edits: [{ oldText: "  return `hello ${name}`;", newText: "  return `hi ${name}`;" }],
  });
  assert.equal(parsed.kind, "none");
});

test("parseAnchorEdits accepts contentHash plus line anchors", () => {
  const parsed = parseAnchorEdits({
    path: "sample.ts",
    contentHash: hashFileText(source),
    edits: [{
      newText: "  return `hi ${name}`;",
      anchor: { startLine: 2, endLine: 2 },
    }],
  });
  assert.equal(parsed.kind, "anchor");
  assert.equal(parsed.edits[0].anchor.startLine, 2);
});

test("parseAnchorEdits accepts a compact hash-bound patch", () => {
  const hash = hashFileText(source);
  const parsed = parseAnchorEdits({
    path: "sample.ts",
    patch: [`[sample.ts#${hash.slice(0, 16)}]`, "PUT 2.=2:", "+  return `hi ${name}`;", ""].join("\n"),
  });
  assert.equal(parsed.kind, "anchor");
  assert.equal(parsed.edits[0].anchor.endLine, 2);
  assert.equal(parsed.edits[0].newText, "  return `hi ${name}`;");
});

test("parseAnchorEdits marks a broken compact patch as invalid and keeps replace fallback", () => {
  const parsed = parseAnchorEdits({
    path: "sample.ts",
    patch: "not a patch",
    edits: [{ oldText: "  return `hello ${name}`;", newText: "  return `hi ${name}`;" }],
  });
  assert.equal(parsed.kind, "invalid");
  assert.equal(parsed.replaceFallback.length, 1);
});

test("applyAnchorEdits performs an exact hash-bound replacement", () => {
  const applied = applyAnchorEdits(source, {
    contentHash: hashFileText(source),
    edits: [{ oldText: "  return `hello ${name}`;", newText: "  return `hi ${name}`;" }],
  });
  assert.match(applied.text, /hi \$\{name\}/);
  assert.equal(applied.replacements.length, 1);
});

test("applyAnchorEdits applies multiple non-overlapping edits against the original", () => {
  const applied = applyAnchorEdits(twoFunctions, {
    contentHash: hashFileText(twoFunctions),
    edits: [
      { newText: "  return `hi ${name}`;", anchor: { startLine: 2, endLine: 2 } },
      { newText: "  return `later ${name}`;", anchor: { startLine: 6, endLine: 6 } },
    ],
  });
  assert.match(applied.text, /hi \$\{name\}/);
  assert.match(applied.text, /later \$\{name\}/);
  assert.equal(applied.replacements.length, 2);
});

test("applyAnchorEdits refuses a stale hash after the file changed", () => {
  const originalHash = hashFileText(source);
  const changed = source.replace("hello", "bonjour");
  assert.throws(
    () => applyAnchorEdits(changed, {
      contentHash: originalHash,
      edits: [{
        oldText: "  return `hello ${name}`;",
        newText: "  return `hi ${name}`;",
        anchor: { startLine: 2, endLine: 2 },
      }],
    }),
    error => error instanceof AnchorEditError
      && error.code === "stale-hash"
      && error.fallbackable === false
      && error.message === staleAnchorError,
  );
});

test("applyAnchorEdits recovers whitespace mismatch through a line anchor", () => {
  const applied = applyAnchorEdits(source, {
    contentHash: hashFileText(source),
    edits: [{
      oldText: "\treturn `hello ${name}`;",
      newText: "  return `hi ${name}`;",
      anchor: { startLine: 2, endLine: 2 },
    }],
  });
  assert.equal(applied.replacements[0].oldText, "  return `hello ${name}`;");
  assert.match(applied.text, /hi \$\{name\}/);
});

test("applyAnchorEdits fails a bad line range so replace can fall back", () => {
  assert.throws(
    () => applyAnchorEdits(source, {
      contentHash: hashFileText(source),
      edits: [{
        oldText: "  return `hello ${name}`;",
        newText: "  return `hi ${name}`;",
        anchor: { startLine: 99, endLine: 99 },
      }],
    }),
    error => error instanceof AnchorEditError && error.fallbackable === true,
  );
});

test("shouldFallbackToReplace waits for consecutive failures", () => {
  assert.equal(shouldFallbackToReplace(0), false);
  assert.equal(shouldFallbackToReplace(1), false);
  assert.equal(shouldFallbackToReplace([{ code: "bad-format" }, { code: "mismatch" }]), true);
});

test("hashesMatch accepts a SHA-256 prefix and ignores CRLF", () => {
  const lf = hashFileText(source);
  const crlf = hashFileText(source.replaceAll("\n", "\r\n"));
  assert.equal(lf, crlf);
  assert.equal(hashesMatch(lf.slice(0, 16), lf), true);
  assert.equal(hashesMatch("not-a-hash", lf), false);
});

test("applyAnchorEdits accepts the raw on-disk SHA-256 of a CRLF file", () => {
  const crlf = source.replaceAll("\n", "\r\n");
  const rawHash = createHash("sha256").update(crlf, "utf8").digest("hex");
  assert.equal(hashMatchesFile(rawHash.slice(0, 16), crlf), true);
  const applied = applyAnchorEdits(crlf, {
    contentHash: rawHash.slice(0, 16),
    edits: [{ newText: "  return `hi ${name}`;", anchor: { startLine: 2, endLine: 2 } }],
  });
  assert.match(applied.text, /hi \$\{name\}/);
});

test("wrapped edit: exact hash-bound replace still goes through Pi edit", async () => {
  const session = await wrappedEdit(source);
  const result = await session.run({
    contentHash: hashFileText(source),
    edits: [{ oldText: "  return `hello ${name}`;", newText: "  return `hi ${name}`;" }],
  });
  assert.equal(result.ok, true);
  assert.match(result.text, /Successfully replaced 1 block/);
  assert.match(result.body, /hi \$\{name\}/);
});

test("wrapped edit: multiple non-overlapping anchors write once through Pi", async () => {
  const session = await wrappedEdit(twoFunctions);
  const result = await session.run({
    contentHash: hashFileText(twoFunctions),
    edits: [
      { newText: "  return `hi ${name}`;", anchor: { startLine: 2, endLine: 2 } },
      { newText: "  return `later ${name}`;", anchor: { startLine: 6, endLine: 6 } },
    ],
  });
  assert.equal(result.ok, true);
  assert.match(result.text, /Successfully replaced 2 block/);
  assert.match(result.body, /hi \$\{name\}/);
  assert.match(result.body, /later \$\{name\}/);
});

test("wrapped edit: stale hash refuses even when replace fallback would succeed", async () => {
  const changed = source.replace("hello", "bonjour");
  const session = await wrappedEdit(changed);
  const result = await session.run({
    contentHash: hashFileText(source),
    edits: [{
      oldText: "  return `bonjour ${name}`;",
      newText: "  return `hi ${name}`;",
      anchor: { startLine: 2, endLine: 2 },
    }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "stale-hash");
  assert.equal(result.body, changed);
});

test("wrapped edit: consecutive bad anchors fall back to Pi replace", async () => {
  const session = await wrappedEdit(source);
  const bad = {
    contentHash: hashFileText(source),
    edits: [{
      oldText: "  return `hello ${name}`;",
      newText: "  return `hi ${name}`;",
      anchor: { startLine: 99, endLine: 99 },
    }],
  };
  const first = await session.run(bad);
  assert.equal(first.ok, false);
  assert.equal(first.fallbackable, true);
  assert.equal(first.body, source);

  const second = await session.run(bad);
  assert.equal(second.ok, true);
  assert.match(second.text, /Successfully replaced 1 block/);
  assert.match(second.body, /hi \$\{name\}/);
});

test("wrapped edit: line anchors recover tab-vs-space oldText", async () => {
  const session = await wrappedEdit(source);
  const result = await session.run({
    contentHash: hashFileText(source),
    edits: [{
      oldText: "\treturn `hello ${name}`;",
      newText: "  return `hi ${name}`;",
      anchor: { startLine: 2, endLine: 2 },
    }],
  });
  assert.equal(result.ok, true);
  assert.match(result.body, /hi \$\{name\}/);
});

test("wrapped edit: CRLF file with a line-span anchor still writes through Pi", async () => {
  const crlf = source.replaceAll("\n", "\r\n");
  const session = await wrappedEdit(crlf);
  const result = await session.run({
    contentHash: hashFileText(crlf),
    edits: [{
      newText: "  return `hi ${name}`;\n  return `again ${name}`;",
      anchor: { startLine: 2, endLine: 2 },
    }],
  });
  assert.equal(result.ok, true);
  assert.match(result.body, /hi \$\{name\}/);
  assert.match(result.body, /again \$\{name\}/);
});

test("wrapped edit: no-anchor calls still use native Pi replace", async () => {
  const session = await wrappedEdit(source);
  const result = await session.run({
    edits: [{ oldText: "  return `hello ${name}`;", newText: "  return `hi ${name}`;" }],
  });
  assert.equal(result.ok, true);
  assert.match(result.body, /hi \$\{name\}/);
});

test("Coding and CTF edit tools share wrapEditToolDefinition", async () => {
  const sourceText = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "bridge-policy.js"),
    "utf8",
  );
  const matches = sourceText.match(/wrapEditToolDefinition\(\s*createEditToolDefinition\(root\)/g);
  assert.equal(matches?.length, 2);
});
