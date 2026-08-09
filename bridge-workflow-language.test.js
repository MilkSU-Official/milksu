import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import currentProviderRuntime from "./current-provider-runtime.cjs";

const root = dirname(fileURLToPath(import.meta.url));
const { currentProviderDefinition } = currentProviderRuntime;

test("workflow pins conversation language without a custom detector or session state machine", () => {
  const source = readFileSync(join(root, "bridge.js"), "utf8");
  assert.match(
    source,
    /User-visible progress and answers continue in the current conversation language/,
  );
  assert.match(
    source,
    /English tool protocol, schemas, paths, commands, or tool results must not switch that language/,
  );
  assert.doesNotMatch(source, /bridge-response-language/);
  assert.doesNotMatch(source, /resolveAndPersistSessionResponseLanguage|detectOrdinaryResponseLanguage/);
  assert.doesNotMatch(source, /codingResponseLanguageEntryType|milksu-response-language/);
});

test("Grok 4.5 is image-capable through the existing TokenFlux catalog modality", () => {
  const definition = currentProviderDefinition("tokenflux", "grok-4.5", {});
  const model = definition.models.find((item) => item.id === "grok-4.5");
  assert.ok(model);
  assert.deepEqual(model.input, ["text", "image"]);
  const textOnly = definition.models.find((item) => item.id === "grok-4.3");
  assert.deepEqual(textOnly.input, ["text"]);
});

test("send path keeps raw user prompts free of the retired English runtime envelope", () => {
  const source = readFileSync(
    join(root, "app/src/composables/useConversations.ts"),
    "utf8",
  );
  assert.match(source, /invokeCommand\('send_message',[\s\S]*?\n\s*prompt,\n/);
  assert.doesNotMatch(source, /promptWithCodingWorkspaceContext/);
  assert.doesNotMatch(source, /MilkSU Coding runtime context:/);
  assert.doesNotMatch(source, /User request:/);
});
