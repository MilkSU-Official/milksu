import assert from "node:assert/strict";
import test from "node:test";
import {
  dataDirectoryFromEnvironment,
  derivedProtectedRoots,
  mergeProtectedRoots,
  parseProtectedRoots,
  protectedCommandViolation,
  protectedWriteViolation,
} from "./bridge-protected-paths.js";

const ROOTS = [
  { path: "/Users/me/data", label: "runtime-data" },
  { path: "/Users/me/data/agent-home/pi/sessions", label: "pi-sessions" },
  { path: "/Applications/MilkSU.app", label: "app-bundle" },
];

test("the protected path list comes from the host", () => {
  assert.deepEqual(
    parseProtectedRoots(JSON.stringify([{ path: "/a/", label: "x" }, { path: "", label: "y" }])),
    [{ path: "/a", label: "x" }],
  );
  assert.deepEqual(parseProtectedRoots("not json"), []);
  assert.deepEqual(parseProtectedRoots('{"path":"/a"}'), []);
  assert.deepEqual(parseProtectedRoots(""), []);
});

test("a file write into a protected root is a violation", () => {
  const settings = protectedWriteViolation("/Users/me/data/settings.json", { roots: ROOTS });
  assert.equal(settings?.label, "runtime-data");
  const conversation = protectedWriteViolation("/Users/me/data/conversations/abc.json", { roots: ROOTS });
  assert.equal(conversation?.label, "runtime-data");
  const session = protectedWriteViolation("/Users/me/data/agent-home/pi/sessions/s.jsonl", { roots: ROOTS });
  assert.equal(session?.label, "pi-sessions");
  const bundle = protectedWriteViolation("/Applications/MilkSU.app/Contents/Resources/x", { roots: ROOTS });
  assert.equal(bundle?.label, "app-bundle");
});

test("the session's own workspace is always writable", () => {
  const workspace = "/Users/me/MilkSU/Coding/无项目任务-aaaaaaaa";
  const roots = [...ROOTS, { path: "/Users/me/MilkSU/Coding", label: "coding-workspaces" }];
  assert.equal(
    protectedWriteViolation(`${workspace}/src/app.ts`, { roots, ownWorkspace: workspace }),
    null,
  );
  // A sibling workspace is not.
  const sibling = protectedWriteViolation(
    "/Users/me/MilkSU/Coding/另一个项目/file.ts",
    { roots, ownWorkspace: workspace },
  );
  assert.equal(sibling?.label, "coding-workspaces");
});

test("git hooks are matched anywhere on disk", () => {
  const hook = protectedWriteViolation("/tmp/whatever/.git/hooks/pre-commit", { roots: [] });
  assert.equal(hook?.label, "git-hooks");
  assert.equal(protectedWriteViolation("/tmp/whatever/.git/config", { roots: [] }), null);
});

const WORKSPACE = "/Users/me/data/agent-workspaces/Coding/无项目任务-aaaaaaaa"
const DATA = "/Users/me/data"
const SHELL_ROOTS = [
  { path: DATA, label: "runtime-data" },
  { path: `${DATA}/agent-home/pi/sessions`, label: "pi-sessions" },
  { path: "/Users/me/MilkSU/Coding", label: "coding-workspaces" },
]
const SHELL_OPTIONS = { roots: SHELL_ROOTS, ownWorkspace: WORKSPACE, cwd: WORKSPACE }

// Dev's acceptance: the same write form must be refused every time, however the path is
// written (literal, $HOME, ${HOME}, ~, or relative).
test("every common write form into a protected root is refused", () => {
  const writes = [
    `printf 'probe' > ${DATA}/settings.json.dev-probe`,
    `printf 'probe' > "${DATA}/settings.json.dev-probe"`,
    `printf 'probe' >> ${DATA}/conversations/abc.json`,
    `echo x | tee ${DATA}/settings.json`,
    `echo x | tee -a "${DATA}/settings.json"`,
    `cp /tmp/a ${DATA}/settings.json`,
    `mv /tmp/a ${DATA}/conversations/abc.json`,
    `sed -i '' 's/x/y/' ${DATA}/settings.json`,
    `dd if=/dev/zero of=${DATA}/settings.json bs=1 count=1`,
    `rm -rf ${DATA}/conversations`,
    `truncate -s 0 ${DATA}/settings.json`,
    `touch ${DATA}/conversations/abc.json`,
    `mkdir -p ${DATA}/conversations/archive`,
    `chmod 777 ${DATA}/settings.json`,
    // Variables and tilde: judged by where they really point, not by their text.
    `printf 'probe' > "$HOME/Library/x/settings.json"`,
    `printf 'probe' > "${'$'}{HOME}/Library/x/settings.json"`,
    `printf 'probe' > ~/Library/x/settings.json`,
  ]
  const env = { HOME: `${DATA}/agent-home`, MILKSU_USER_HOME: "/Users/me" }
  for (const command of writes) {
    const violation = protectedCommandViolation(command, { ...SHELL_OPTIONS, env })
    assert.ok(violation, `must be refused: ${command}`)
  }
})

// The same command five times in a row must be refused five times: no startup window, no
// shape that works only sometimes.
test("the same write is refused on every attempt", () => {
  const command = `printf 'probe' > "$HOME/MilkSU/Coding/milksu-src/.git/hooks/dev-probe.sample"`
  const env = { HOME: "/Users/me/MilkSU/Coding" }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const violation = protectedCommandViolation(command, { ...SHELL_OPTIONS, env, cwd: "/Users/me/MilkSU/Coding/milksu-src" })
    assert.equal(violation?.label, "git-hooks", `attempt ${attempt + 1}`)
  }
})

// Reads are ordinary work: mentioning a protected path must never refuse the call.
test("a read is never refused", () => {
  const reads = [
    `cat ${DATA}/settings.json`,
    `ls -la ${DATA}/conversations`,
    `grep -rn "x" ${DATA}/conversations`,
    `node -e "require('fs').readFileSync('${DATA}/conversations/a.json','utf8')"`,
    `python3 -c "print(open('${DATA}/settings.json').read())"`,
    `head -c 40 ${DATA}/settings.json`,
    `sed 's/x/y/' ${DATA}/settings.json`,
    `npm test`,
    `git status`,
    // The shapes that were refused by mistake: a redirect to /dev/null, a `[ -e ]` probe, a
    // loop over protected paths, and simply listing a hooks directory.
    `ls "${DATA}/agent-home" 2>/dev/null | head`,
    `test -e "${DATA}/settings.json" && echo present`,
    `for p in "${DATA}/settings.json"; do [ -e "$p" ] && echo yes; done`,
    `ls -la /Users/me/MilkSU/Coding/milksu-src/.git/hooks`,
    `cat /Users/me/MilkSU/Coding/milksu-src/.git/hooks/dev-probe.sample`,
  ]
  for (const command of reads) {
    assert.equal(protectedCommandViolation(command, SHELL_OPTIONS), null, `must pass: ${command}`)
  }
})

// A relative target is resolved the way the shell would, and `.git/hooks` is never writable
// - not even inside the session's own workspace.
test("relative write targets resolve against the working directory", () => {
  const hooksInWorkspace = protectedCommandViolation('printf x > .git/hooks/pre-commit', SHELL_OPTIONS)
  assert.equal(hooksInWorkspace?.label, "git-hooks")

  const ownFile = protectedCommandViolation('printf x > src/app.ts', SHELL_OPTIONS)
  assert.equal(ownFile, null)

  // A relative path that resolves outside every protected root is none of the guard's
  // business. A relative path that resolves *into* one - here the runtime-data root, which is
  // where settings.json lives - stays protected however it was spelled: agents must never
  // write the app's own settings.
  const escape = protectedCommandViolation(`cp /tmp/a /tmp/notes.txt`, SHELL_OPTIONS)
  assert.equal(escape, null, "a target outside every protected root is not a violation")

  const intoRuntimeData = protectedCommandViolation(`cp /tmp/a ../../../settings.json`, SHELL_OPTIONS)
  assert.equal(intoRuntimeData?.label, "runtime-data", "a relative path into a protected root is still protected")
})

test("derived roots cover the coding trees when the host passes none", () => {
  const scratch = derivedProtectedRoots({
    workspace: "/Users/me/data/agent-workspaces/Coding/无项目任务-aaaaaaaa",
    userHome: "/Users/me",
    dataDirectory: "/Users/me/data",
  })
  assert.ok(scratch.some(root => root.label === "runtime-data"))
  assert.ok(scratch.some(root => root.label === "coding-workspaces"))

  // 读者反馈：PR 会话因为这点事情连文档都写不了（它写的是 ~/MilkSU/Coding/PR提交准备）。
  // 所以不再把整个 ~/MilkSU/Coding 封起来：那里放的是读者自己的项目、工作副本与文档。
  const project = derivedProtectedRoots({
    workspace: "/Users/me/MilkSU/Coding/milksu-src",
    userHome: "/Users/me",
  })
  assert.deepEqual(project, [], "读者的项目目录不得再被当成受保护根")
  assert.ok(
    !project.some(root => root.path === "/Users/me/MilkSU/Coding"),
    "整棵 ~/MilkSU/Coding 不得再被封死（否则文档也写不了）",
  )

  // 但真正的协作沙箱仍受保护：别的会话的工作区不能互相写坏。
  const collab = derivedProtectedRoots({
    workspace: "/Users/me/collab/agent-workspaces/Coding/task-bbbbbbbb",
    userHome: "/Users/me",
  })
  assert.ok(
    collab.some(root => root.label === "coding-workspaces"),
    "真沙箱必须仍然受保护",
  )
});

test("the data directory is derived from the collaboration root the host sets", () => {
  assert.equal(
    dataDirectoryFromEnvironment({
      MILKSU_CODING_COLLABORATION_ROOT: "/Users/me/data/agent-home/coding-collaboration",
    }),
    "/Users/me/data",
  )
  assert.equal(dataDirectoryFromEnvironment({}), "")
});

test("merging roots drops duplicates and names the narrowest match", () => {
  const merged = mergeProtectedRoots(
    [{ path: "/a", label: "host" }],
    [{ path: "/a", label: "derived" }, { path: "/b/c", label: "narrow" }, { path: "/b", label: "wide" }],
  )
  assert.deepEqual(merged, [
    { path: "/b/c", label: "narrow" },
    { path: "/a", label: "host" },
    { path: "/b", label: "wide" },
  ])
});

// 读者在设置里指定的受限文件夹：即使它就在会话自己的工作区里，也照样拦写。
// 这是这个功能的关键差别：内置清单在工作区例外之后判定，而读者指定的清单在它之前。
test("a folder the reader protected is refused even inside the session's own workspace", () => {
  const enforcedRoots = [{ path: "/Users/me/project/private", label: "user-protected-folder" }];
  const workspace = "/Users/me/project";
  const direct = protectedWriteViolation("/Users/me/project/private/notes.md", { enforcedRoots, ownWorkspace: workspace });
  assert.equal(direct?.label, "user-protected-folder");
  assert.equal(direct?.path, "/Users/me/project/private/notes.md");
  const command = protectedCommandViolation("rm -rf private/notes.md", { enforcedRoots, ownWorkspace: workspace, cwd: workspace });
  assert.equal(command?.label, "user-protected-folder");
  // 同一个工作区里没有被指定的目录照常可写
  assert.equal(protectedWriteViolation("/Users/me/project/src/app.ts", { enforcedRoots, ownWorkspace: workspace }), null);
  // 没有指定清单时，工作区里的一切照旧（默认行为不变）
  assert.equal(protectedWriteViolation("/Users/me/project/private/notes.md", { ownWorkspace: workspace }), null);
});
