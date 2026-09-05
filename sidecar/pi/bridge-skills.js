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

// extraCodingSkillPaths only forwards directories that already contain SKILL.md
// to Pi's ResourceLoader. It does not paste skill bodies into the system prompt.
export function extraCodingSkillPaths(values, pathExists = existsSync) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of values) {
    const path = String(raw ?? "").trim();
    if (!path || seen.has(path) || path.includes("..")) continue;
    if (!pathExists(join(path, "SKILL.md"))) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

export function resolveCodingSkillPaths(
  bridgeDirectory,
  sessionRole = "",
  disabledSkills = [],
  extraPaths = [],
  pathExists = existsSync,
) {
  return [
    ...reviewedCodingSkillPaths(
      bridgeDirectory,
      sessionRole,
      disabledSkills,
      pathExists,
    ),
    ...extraCodingSkillPaths(extraPaths, pathExists),
  ];
}
