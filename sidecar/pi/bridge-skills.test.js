import assert from "node:assert/strict";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  extraCodingSkillPaths,
  firstPartyCodingSkillNames,
  resolveCodingSkillPaths,
  reviewedCodingSkillNames,
  reviewedCodingSkillPaths,
} from "./bridge-skills.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("reviewed Coding skills load only first-party review and one Archify copy", () => {
  assert.deepEqual(reviewedCodingSkillPaths(repositoryRoot), [
    ...firstPartyCodingSkillNames.map(name => join(repositoryRoot, "skills", name)),
    join(repositoryRoot, "third_party", "archify", "archify"),
  ]);
  assert.deepEqual(reviewedCodingSkillNames, [
    ...firstPartyCodingSkillNames,
    "archify",
  ]);
});

test("packaged Archify wins over the development fallback", () => {
  const existing = new Set([
    ...firstPartyCodingSkillNames.map(name => (
      join(repositoryRoot, "skills", name, "SKILL.md")
    )),
    join(repositoryRoot, "skills", "archify", "SKILL.md"),
    join(repositoryRoot, "third_party", "archify", "archify", "SKILL.md"),
  ]);

  assert.deepEqual(
    reviewedCodingSkillPaths(repositoryRoot, "", [], path => existing.has(path)),
    [
      ...firstPartyCodingSkillNames.map(name => join(repositoryRoot, "skills", name)),
      join(repositoryRoot, "skills", "archify"),
    ],
  );
});

test("disabled reviewed skills are absent without opening arbitrary paths", () => {
  assert.deepEqual(
    reviewedCodingSkillPaths(repositoryRoot, "", [
      "product-design",
      "archify",
      "../../untrusted",
    ]),
    firstPartyCodingSkillNames
      .filter(name => name !== "product-design")
      .map(name => join(repositoryRoot, "skills", name)),
  );
});

test("CTF roles can load the same reviewed Coding skills", () => {
  assert.deepEqual(
    reviewedCodingSkillPaths(repositoryRoot, "solver", []),
    reviewedCodingSkillPaths(repositoryRoot, "", []),
  );
});

test("user skill paths are appended when SKILL.md exists", () => {
  const extra = join(repositoryRoot, "skills", "product-design");
  const resolved = resolveCodingSkillPaths(
    repositoryRoot,
    "",
    ["product-design"],
    [extra, join(repositoryRoot, "missing-skill"), extra + "/../untrusted"],
  );
  assert.deepEqual(
    resolved,
    [
      ...firstPartyCodingSkillNames
        .filter(name => name !== "product-design")
        .map(name => join(repositoryRoot, "skills", name)),
      join(repositoryRoot, "third_party", "archify", "archify"),
      extra,
    ],
  );
  assert.deepEqual(extraCodingSkillPaths(["../escape", extra]), [extra]);
});

function skillFrontmatter(name) {
  const text = readFileSync(join(repositoryRoot, "skills", name, "SKILL.md"), "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${name} has YAML frontmatter`);
  const fields = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

test("first-party skill descriptions are Pi routing rules", () => {
  const catalog = [];
  for (const name of firstPartyCodingSkillNames) {
    const fields = skillFrontmatter(name);
    assert.equal(fields.name, name);
    assert.match(fields.description, /Use /);
    assert.ok(
      fields.description.length <= 400,
      `${name} description stays near the 50-100 token routing budget`,
    );
    catalog.push({
      name,
      description: fields.description,
      filePath: join(repositoryRoot, "skills", name, "SKILL.md"),
      disableModelInvocation: fields["disable-model-invocation"] === "true",
    });
  }
  assert.equal(skillFrontmatter("release-milksu")["disable-model-invocation"], "true");
  const prompt = formatSkillsForPrompt(catalog);
  assert.match(prompt, /frontend-visual-qa/);
  assert.doesNotMatch(prompt, /release-milksu/);
});
