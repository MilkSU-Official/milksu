import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEditTool } from "@earendil-works/pi-coding-agent";
import { createToolRepeatGuard } from "./bridge-tool-repeat.js";

const source = [
  "export function greet(name: string) {",
  "  return `hello ${name}`;",
  "}",
  "",
].join("\n");

async function edit(fileSource, edits) {
  const dir = await mkdtemp(join(tmpdir(), "milksu-edit-base-"));
  const rel = "sample.ts";
  await writeFile(join(dir, rel), fileSource);
  const tool = createEditTool(dir);
  try {
    const result = await tool.execute(
      "t",
      { path: rel, edits },
      new AbortController().signal,
    );
    return { ok: true, text: result.content[0].text, body: await readFile(join(dir, rel), "utf8") };
  } catch (reason) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
      body: await readFile(join(dir, rel), "utf8"),
    };
  }
}

test("baseline: exact oldText succeeds on the real Pi edit tool", async () => {
  const result = await edit(source, [
    { oldText: "  return `hello ${name}`;", newText: "  return `hi ${name}`;" },
  ]);
  assert.equal(result.ok, true);
  assert.match(result.text, /Successfully replaced 1 block/);
  assert.match(result.body, /hi \$\{name\}/);
});

test("baseline: unique substring without indent still matches", async () => {
  const result = await edit(source, [
    { oldText: "return `hello ${name}`;", newText: "return `hi ${name}`;" },
  ]);
  assert.equal(result.ok, true);
});

test("baseline: tab vs spaces oldText fails and leaves the file unchanged", async () => {
  const result = await edit(source, [
    { oldText: "\treturn `hello ${name}`;", newText: "\treturn `hi ${name}`;" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /must match exactly including all whitespace/);
  assert.equal(result.body, source);
});

test("baseline: stale oldText after the file changed fails", async () => {
  const result = await edit(source.replace("hello", "bonjour"), [
    { oldText: "  return `hello ${name}`;", newText: "  return `hi ${name}`;" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /must match exactly including all whitespace/);
});

test("baseline: identical failed edit signature hits the 10-call brake", () => {
  const guard = createToolRepeatGuard();
  let stop = 0;
  for (let i = 1; i <= 12; i += 1) {
    const decision = guard.inspect("edit", {
      path: "sample.ts",
      edits: [{ oldText: "return \"hello world\";", newText: "return \"hi\";" }],
    });
    if (decision?.terminate) {
      stop = i;
      break;
    }
  }
  assert.equal(stop, 10);
});
