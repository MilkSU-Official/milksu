import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  firstPartyCodingSkillNames,
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

test("CTF roles cannot inherit Coding skills", () => {
  assert.deepEqual(reviewedCodingSkillPaths(repositoryRoot, "solver", []), []);
});
