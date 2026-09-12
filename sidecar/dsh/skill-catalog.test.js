import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { skillResourceRoot, syncDshSkillCatalog } from "./skill-catalog.js";

test("syncs enabled product skills into DSH_HOME/skills", async () => {
  const home = await mkdtemp(join(tmpdir(), "milksu-dsh-skills-"));
  const names = syncDshSkillCatalog({ dshHome: home });
  assert.ok(names.includes("product-design"));
  assert.ok(names.includes("release-milksu"));
  const body = await readFile(join(home, "skills", "product-design", "SKILL.md"), "utf8");
  assert.match(body, /name: product-design/);
  const hidden = await readFile(join(home, "skills", "release-milksu", "SKILL.md"), "utf8");
  assert.match(hidden, /disable-model-invocation: true/);
});

test("drops disabled product skills from the DSH catalog root", async () => {
  const home = await mkdtemp(join(tmpdir(), "milksu-dsh-skills-"));
  syncDshSkillCatalog({ dshHome: home });
  const names = syncDshSkillCatalog({
    dshHome: home,
    disabledSkills: ["product-design"],
  });
  assert.equal(names.includes("product-design"), false);
  await assert.rejects(readFile(join(home, "skills", "product-design", "SKILL.md")), /ENOENT/);
});

test("publishes extra user skill directories that already have SKILL.md", async () => {
  const home = await mkdtemp(join(tmpdir(), "milksu-dsh-skills-"));
  const extra = await mkdtemp(join(tmpdir(), "milksu-user-skill-"));
  const skillDir = join(extra, "user-note");
  await mkdir(skillDir, { recursive: true, mode: 0o700 });
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: user-note\ndescription: Extra.\n---\n\nBody.\n", {
    mode: 0o600,
  });
  const names = syncDshSkillCatalog({
    dshHome: home,
    extraSkillPaths: [skillDir],
  });
  assert.ok(names.includes("user-note"));
  const body = await readFile(join(home, "skills", "user-note", "SKILL.md"), "utf8");
  assert.match(body, /name: user-note/);
  await rm(extra, { recursive: true, force: true });
});

test("skill resource root finds the packaged or checkout skills tree", () => {
  const root = skillResourceRoot();
  assert.ok(root);
});

test("relative DSH_HOME is ignored", () => {
  assert.deepEqual(syncDshSkillCatalog({ dshHome: "dsh-home" }), []);
});
