import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  optionalCodingSkillNames,
  resolveCodingSkillPaths,
  reviewedCodingSkillNames,
} from "../pi/bridge-skills.js";

const managedSkillNames = new Set([
  ...reviewedCodingSkillNames,
  ...optionalCodingSkillNames,
]);

export function skillResourceRoot(here = dirname(fileURLToPath(import.meta.url))) {
  return existsSync(join(here, "skills")) ? here : resolve(here, "..", "..");
}

function replacePath(dest) {
  rmSync(dest, { recursive: true, force: true });
}

function publishSkill(src, dest) {
  try {
    const current = lstatSync(dest);
    if (current.isSymbolicLink() || current.isDirectory() || current.isFile()) {
      replacePath(dest);
    }
  } catch {
    // Dest does not exist yet.
  }
  try {
    symlinkSync(src, dest, process.platform === "win32" ? "junction" : "dir");
  } catch {
    cpSync(src, dest, { recursive: true });
  }
}

export function syncDshSkillCatalog({
  dshHome = process.env.DSH_HOME,
  disabledSkills = [],
  extraSkillPaths = [],
  resourceRoot = skillResourceRoot(),
} = {}) {
  const home = String(dshHome ?? "").trim();
  if (!home || !isAbsolute(home)) return [];
  const destRoot = join(home, "skills");
  mkdirSync(destRoot, { recursive: true, mode: 0o700 });
  const enabled = resolveCodingSkillPaths(
    resourceRoot,
    "",
    disabledSkills,
    extraSkillPaths,
  );
  const enabledNames = new Set(enabled.map(path => basename(path)));
  for (const name of managedSkillNames) {
    if (enabledNames.has(name)) continue;
    replacePath(join(destRoot, name));
  }
  for (const src of enabled) {
    const name = basename(src);
    managedSkillNames.add(name);
    publishSkill(src, join(destRoot, name));
  }
  return [...enabledNames];
}
