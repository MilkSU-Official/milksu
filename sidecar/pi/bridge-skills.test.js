import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { reviewedCodingSkillPaths } from "./bridge-skills.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("reviewed Coding skills load only first-party review and one Archify copy", () => {
  assert.deepEqual(reviewedCodingSkillPaths(repositoryRoot), [
    join(repositoryRoot, "skills", "frontend-visual-qa"),
    join(repositoryRoot, "third_party", "archify", "archify"),
  ]);
});

test("packaged Archify wins over the development fallback", () => {
  const existing = new Set([
    join(repositoryRoot, "skills", "frontend-visual-qa", "SKILL.md"),
    join(repositoryRoot, "skills", "archify", "SKILL.md"),
    join(repositoryRoot, "third_party", "archify", "archify", "SKILL.md"),
  ]);

  assert.deepEqual(
    reviewedCodingSkillPaths(repositoryRoot, "", path => existing.has(path)),
    [
      join(repositoryRoot, "skills", "frontend-visual-qa"),
      join(repositoryRoot, "skills", "archify"),
    ],
  );
});

test("CTF roles cannot inherit Coding skills", () => {
  assert.deepEqual(reviewedCodingSkillPaths(repositoryRoot, "solver"), []);
});
