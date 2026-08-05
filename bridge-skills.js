import { existsSync } from "node:fs";
import { join } from "node:path";

export function reviewedCodingSkillPaths(
  bridgeDirectory,
  sessionRole = "",
  pathExists = existsSync,
) {
  if (sessionRole) return [];

  const frontendVisualQa = join(
    bridgeDirectory,
    "skills",
    "frontend-visual-qa",
  );
  const archify = [
    join(bridgeDirectory, "skills", "archify"),
    join(bridgeDirectory, "third_party", "archify", "archify"),
  ].find(path => pathExists(join(path, "SKILL.md")));

  return [frontendVisualQa, archify]
    .filter(Boolean)
    .filter(path => pathExists(join(path, "SKILL.md")));
}
