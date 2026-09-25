import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadSessionPolicy } from "./bridge-policy.js";
import {
  derivedProtectedRoots,
  protectedCommandViolation,
  protectedWriteViolation,
} from "./bridge-protected-paths.js";

/**
 * 真机 bug 的回归：读者在设置里列的「受限文件夹」必须**真的拦得住写入**。
 *
 * 现场形状（用户实测）：宿主（Go）把 `protectedFolders` 发给了侧车 ✓，侧车的写入守卫也读
 * `policy.protectedFolders` ✓，但**中间那步**（`bridge.js` 的 `loadRuntimeSessionPolicy`
 * 构造会话策略时）没把它转发给 `loadSessionPolicy` ✗ ⇒ 存进 `sessionPolicies` 的策略里永远
 * 是空列表 ⇒ 守卫读到空列表 ⇒ 往受限目录写文件**成功**（本该被拒）✗。
 *
 * 这里钉三件事，缺一条这条链就又断了：
 *   ① 策略层确实带上并归一化这份列表；
 *   ② 守卫拿到这份列表**真的会拦**（write 与 bash 两条路都要）；
 *   ③ `bridge.js` 里那两处转发**真的存在**（源码守卫：删掉就红 —— 正是当初漏掉的地方）。
 */

const SIDECAR_PI = dirname(fileURLToPath(import.meta.url));
// 中性夹具：不放任何读者私有目录名。
const USER_FOLDER = "/tmp/example-project/out";
const WORKSPACE = "/tmp/example-project";
const USER_PROTECTED_FOLDER_LABEL = "user-protected-folder";

// 与 bridge.js 的 userProtectedRoots() 同一口径：策略里的列表 ⇒ 守卫的 enforcedRoots。
function enforcedRootsFrom(policy) {
  return (policy.protectedFolders ?? []).map(path => ({
    path,
    label: USER_PROTECTED_FOLDER_LABEL,
  }));
}

test("① 会话策略带上读者列的受限文件夹，并归一化", async () => {
  const policy = await loadSessionPolicy(tmpdir(), "", {
    protectedFolders: [` ${USER_FOLDER} `, "", USER_FOLDER, "   "],
  });

  assert.deepEqual(
    policy.protectedFolders,
    [USER_FOLDER],
    "列表必须落进策略（去空白、去空项、去重）",
  );
});

test("② 命中受限文件夹的写入必须违规（write 与 bash 两条路）", async () => {
  const policy = await loadSessionPolicy(tmpdir(), "", {
    protectedFolders: [USER_FOLDER],
  });
  const enforcedRoots = enforcedRootsFrom(policy);
  assert.deepEqual(
    enforcedRoots,
    [{ path: USER_FOLDER, label: USER_PROTECTED_FOLDER_LABEL }],
    "守卫拿到的必须是策略里那份列表",
  );

  const write = protectedWriteViolation(join(USER_FOLDER, "note.txt"), {
    roots: [],
    enforcedRoots,
    ownWorkspace: WORKSPACE,
  });
  assert.equal(
    write?.label,
    USER_PROTECTED_FOLDER_LABEL,
    "write 到受限文件夹里必须被拦（要保护的往往正是自己项目里的某个目录）",
  );

  const bash = protectedCommandViolation(`echo hi > ${USER_FOLDER}/note.txt`, {
    roots: [],
    enforcedRoots,
    ownWorkspace: WORKSPACE,
    cwd: WORKSPACE,
  });
  assert.equal(
    bash?.label,
    USER_PROTECTED_FOLDER_LABEL,
    "bash 往受限文件夹里重定向同样必须被拦",
  );
});

test("③ 列表为空时不误拦（总开关关掉 ⇒ 读者自己的目录可以写）", async () => {
  const policy = await loadSessionPolicy(tmpdir(), "", { protectedFolders: [] });
  const enforcedRoots = enforcedRootsFrom(policy);

  assert.deepEqual(enforcedRoots, [], "空列表不能被补成别的规则");
  assert.equal(
    protectedWriteViolation(join(USER_FOLDER, "note.txt"), {
      roots: [],
      enforcedRoots,
      ownWorkspace: WORKSPACE,
    }),
    null,
    "列表为空时不许拦 —— 否则等于把「永远拦」写死了",
  );
  assert.equal(
    protectedCommandViolation(`echo hi > ${USER_FOLDER}/note.txt`, {
      roots: [],
      enforcedRoots,
      ownWorkspace: WORKSPACE,
      cwd: WORKSPACE,
    }),
    null,
  );
});

test("④ 列表为空也不许松开系统保护线（运行时数据目录照拦）", () => {
  const dataDirectory = "/tmp/example-runtime-data";
  const roots = derivedProtectedRoots({
    workspace: WORKSPACE,
    userHome: "/tmp/example-home",
    dataDirectory,
  });

  assert.ok(
    roots.some(root => root.path === dataDirectory),
    "运行时数据目录仍应在保护清单里",
  );
  assert.equal(
    protectedWriteViolation(join(dataDirectory, "settings.json"), {
      roots,
      enforcedRoots: [],
      ownWorkspace: WORKSPACE,
    })?.label,
    "runtime-data",
    "本次修复不许把既有安全线一起松开",
  );
});

test("⑤ 源码守卫：bridge.js 两处 loadSessionPolicy 都必须转发这份列表", () => {
  const source = readFileSync(join(SIDECAR_PI, "bridge.js"), "utf8");
  const call = source.indexOf("await loadSessionPolicy(cwd, command.sessionRole, {");

  assert.notEqual(
    call,
    -1,
    "找不到 loadRuntimeSessionPolicy 里的 loadSessionPolicy 调用（结构变了就更新这条测试）",
  );

  // 两处：第一次构造策略；第二次（codingResourceRoots 非空时）会**整个替换**策略 ——
  // 少任何一处，列表都会在某一步悄悄丢掉。
  // ⚠️ 正则要求**行首就是** `protectedFolders:` —— 否则"被注释掉的那一行"也会匹配
  //（实测：把转发注释掉，守卫仍绿 ⇒ 假守卫 ✗）。
  const forwards = source.match(
    /^\s*protectedFolders:\s*Array\.isArray\(command\.protectedFolders\)/gm,
  ) ?? [];

  assert.equal(
    forwards.length,
    2,
    `两处转发都必须在（实际找到 ${forwards.length} 处）；少了它，读者的受限文件夹就进不到`
      + "守卫那份策略里 —— 这正是真机 bug 的原形",
  );
});
