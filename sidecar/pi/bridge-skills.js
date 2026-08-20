import { existsSync } from "node:fs";
import { join } from "node:path";

export const firstPartyCodingSkillNames = Object.freeze([
  "frontend-visual-qa",
  "product-design",
  "integrate-api",
  "review-security",
  "create-technical-deliverables",
  "release-milksu",
]);

export const reviewedCodingSkillNames = Object.freeze([
  ...firstPartyCodingSkillNames,
  "archify",
]);

function disabledSkillNames(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map(name => String(name ?? "").trim()).filter(Boolean));
}

export function reviewedCodingSkillPaths(
  bridgeDirectory,
  sessionRole = "",
  disabledSkills = [],
  pathExists = existsSync,
) {
  void sessionRole;
  const disabled = disabledSkillNames(disabledSkills);
  const firstParty = firstPartyCodingSkillNames.map(name => ({
    name,
    path: join(bridgeDirectory, "skills", name),
  }));
  const archify = [
    join(bridgeDirectory, "skills", "archify"),
    join(bridgeDirectory, "third_party", "archify", "archify"),
  ].find(path => pathExists(join(path, "SKILL.md")));

  return [
    ...firstParty,
    { name: "archify", path: archify },
  ]
    .filter(skill => !disabled.has(skill.name))
    .map(skill => skill.path)
    .filter(Boolean)
    .filter(path => pathExists(join(path, "SKILL.md")));
}
