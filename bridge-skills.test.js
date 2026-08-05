import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { reviewedCodingSkillPaths } from "./bridge-skills.js";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));

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

test("frontend QA skill requires tests, a real preview, and Browser evidence", () => {
  const skill = readFileSync(
    join(repositoryRoot, "skills", "frontend-visual-qa", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /^---\nname: frontend-visual-qa\ndescription: .+\n---/);
  assert.match(skill, /automated tests/);
  assert.match(skill, /canonical preview or development server with `bg_task`/);
  assert.match(skill, /reference image or a new design direction/);
  assert.match(skill, /isolated Coding Browser/);
  assert.match(skill, /full workspace-relative path/);
  assert.match(skill, /Console messages and failed Network requests/);
  assert.match(
    skill,
    /Do not call the\s+task visually verified unless the Browser evidence exists/,
  );
  assert.ok(skill.split("\n").length < 160);
});
