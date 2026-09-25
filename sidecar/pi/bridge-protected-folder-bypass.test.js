import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  protectedAgentNotice,
  protectedCommandViolation,
  protectedWriteViolation,
} from "./bridge-protected-paths.js";

/**
 * 真机绕过的回归：读者在设置里列的「受限文件夹」**不能被换写法绕过**，而且被拦时要
 * **明确告诉 agent 此路不通**。
 *
 * 现场（用户实测，beta.113）：`write` 工具拦得住 ✓、bash 写字面路径拦得住 ✓，但
 * `TARGET=/受限目录; echo x > "$TARGET/f.txt"` **没被拦** ✗ —— 文件被创建了。
 * 用户的原话：agent 被拦后如果不知道"这条路不允许"，它就会一直换写法找突破口 ✗。
 *
 * 这里钉两件事：① 变量 / cd / ~ / $HOME 这些换写法必须同样判违规（宁严勿松）；
 * ② 拦下时给 **agent** 的提示要含"被拒路径 + 原因 + 不要绕过 + 唯一正确做法"。
 */

// 中性夹具：不放任何读者私有目录名。
const PROTECTED = "/tmp/example-project/out";
const WORKSPACE = "/tmp/example-project";
const USER_PROTECTED_FOLDER_LABEL = "user-protected-folder";

const SHELL_OPTIONS = {
  roots: [],
  enforcedRoots: [{ path: PROTECTED, label: USER_PROTECTED_FOLDER_LABEL }],
  ownWorkspace: WORKSPACE,
  cwd: WORKSPACE,
  env: { HOME: "/tmp/example-home", PWD: WORKSPACE },
};

test("变量拼出来的写目标同样被拦（真机 bug 的原形）", () => {
  for (const command of [
    `TARGET=${PROTECTED}; echo x > "$TARGET/f.txt"`,
    `TARGET=${PROTECTED}; echo x > $TARGET/f.txt`,
    `D=${PROTECTED}; T="$D/f.txt"; printf probe > "$T"`,
    `export TARGET=${PROTECTED}\nprintf probe > "$TARGET/f.txt"`,
    `TARGET=${PROTECTED}; tee "$TARGET/f.txt" <<< probe`,
  ]) {
    const violation = protectedCommandViolation(command, SHELL_OPTIONS);
    assert.equal(
      violation?.label,
      USER_PROTECTED_FOLDER_LABEL,
      `必须拦（变量拼路径）：${command}`,
    );
  }
});

test("cd 进受限目录之后再写同样被拦（相对目标按真实落点判）", () => {
  for (const command of [
    `cd ${PROTECTED} && echo x > f.txt`,
    `cd ${PROTECTED}; touch y.txt`,
    `cd ${PROTECTED} && printf probe >> note.txt`,
  ]) {
    const violation = protectedCommandViolation(command, SHELL_OPTIONS);
    assert.equal(
      violation?.label,
      USER_PROTECTED_FOLDER_LABEL,
      `必须拦（cd 后相对写）：${command}`,
    );
  }
});

test("~ 与 $HOME 展开到受限根里同样被拦", () => {
  const options = {
    ...SHELL_OPTIONS,
    enforcedRoots: [{ path: "/tmp/example-home/MilkSU/notes", label: USER_PROTECTED_FOLDER_LABEL }],
    env: { HOME: "/tmp/example-home", PWD: WORKSPACE },
  };
  for (const command of [
    "echo x > ~/MilkSU/notes/a.txt",
    "echo x > \"$HOME/MilkSU/notes/a.txt\"",
    "echo x > \"${HOME}/MilkSU/notes/a.txt\"",
  ]) {
    const violation = protectedCommandViolation(command, options);
    assert.equal(
      violation?.label,
      USER_PROTECTED_FOLDER_LABEL,
      `必须拦（$HOME/~ 展开）：${command}`,
    );
  }
});

test("字面受限路径仍然被拦（回归保护，别被本次改动弄坏）", () => {
  const violation = protectedCommandViolation(`printf probe > ${PROTECTED}/f.txt`, SHELL_OPTIONS);
  assert.equal(violation?.label, USER_PROTECTED_FOLDER_LABEL);
});

test("没被列进去的路径不误拦，只读也不误拦（不能写成「永远拦」）", () => {
  // 同一个目录，但读者**没有**把它列进受限清单 ⇒ 不许拦。
  const notListed = protectedCommandViolation("echo x > /tmp/example-project/build/f.txt", SHELL_OPTIONS);
  assert.equal(notListed, null, "没列进去的路径不许拦");

  // 只是读：列出来、cat、grep 都必须放过（仓库既有口径：读是正常工作）。
  for (const command of [
    `ls -la ${PROTECTED}`,
    `cat ${PROTECTED}/f.txt`,
    `grep -rn "x" ${PROTECTED}`,
    `ls "${PROTECTED}" 2>/dev/null | head`,
    `head -c 40 ${PROTECTED}/f.txt`,
  ]) {
    assert.equal(
      protectedCommandViolation(command, SHELL_OPTIONS),
      null,
      `只读必须放过：${command}`,
    );
  }

  // 软链解析是**已知限制**（本轮不做）：受限目录的软链别名目前判不出来，报告里要写清。
});

test("拦下时给 agent 的提示：路径 + 原因 + 不要绕过 + 唯一正确做法", () => {
  const violation = protectedCommandViolation(
    `TARGET=${PROTECTED}; echo x > "$TARGET/f.txt"`,
    SHELL_OPTIONS,
  );
  assert.ok(violation, "先得真的拦下来");

  const zh = protectedAgentNotice(violation, "zh");
  assert.ok(zh.includes(violation.path), "要说清哪个路径被拒");
  assert.match(zh, /受限文件夹/, "要说明原因（在读者的受限文件夹列表里）");
  assert.match(zh, /不要绕过/, "要明确禁止绕过");
  assert.match(zh, /设置/, "要指出唯一正确做法是读者去设置里移除");
  assert.match(zh, /shell 变量|cd|别的工具/, "要点名别再换写法");

  const en = protectedAgentNotice(violation, "en");
  assert.ok(en.includes(violation.path), "英文也要说清路径");
  assert.match(en, /protected list/, "英文要说原因");
  assert.match(en, /Do not work around it/, "英文要禁止绕过");
  assert.match(en, /Settings/, "英文要指出读者去设置里处理");
});

test("给 agent 的提示与给读者的提示是两条（读者那条不变）", () => {
  const violation = protectedCommandViolation(`printf probe > ${PROTECTED}/f.txt`, SHELL_OPTIONS);
  const agentNotice = protectedAgentNotice(violation, "zh");
  // 读者侧那条的口径是"已拦截：这个目录在你的设置里被标记为…"（不动它）；
  // agent 侧这条必须**额外**告诉他别绕。
  assert.notEqual(agentNotice, "已拦截：这个目录在你的设置里被标记为「agent 不可改写」。");
  assert.match(agentNotice, /不要绕过/);
});

test("写入工具那条路（protectedWriteViolation）不受本次改动影响", () => {
  const violation = protectedWriteViolation(`${PROTECTED}/note.txt`, {
    roots: [],
    enforcedRoots: SHELL_OPTIONS.enforcedRoots,
    ownWorkspace: WORKSPACE,
  });
  assert.equal(violation?.label, USER_PROTECTED_FOLDER_LABEL);
  // 未列入的路径照旧放过。
  assert.equal(
    protectedWriteViolation(joinTmp("example-project", "build", "note.txt"), {
      roots: [],
      enforcedRoots: SHELL_OPTIONS.enforcedRoots,
      ownWorkspace: WORKSPACE,
    }),
    null,
  );
});

// 本轮（真机误伤 + 脚本藏写）补的两组口径：**只拦真写入、放行只读**。
test("只读命令提到受限路径、把输出写到别处，不该被拦（真机误伤回归）", () => {
  for (const command of [
    // 真机上就是这么被误拦的：变量持有受限路径 + 2>&1 之类的重定向。
    `R="${PROTECTED}"; ls -la "$R" 2>&1 | tail -5`,
    `R="${PROTECTED}"; ls -la "$R" 2>/dev/null`,
    `R="${PROTECTED}"; cat "$R/f.txt"`,
    `R="${PROTECTED}"; python3 -c "print(open('$R/f.txt').read())"`,
    `R="${PROTECTED}"; python3 -c "print(1)" > /tmp/example-out.txt`,
    `ls -la ${PROTECTED}`,
  ]) {
    assert.equal(
      protectedCommandViolation(command, SHELL_OPTIONS),
      null,
      `只读不该被拦：${command}`,
    );
  }
});

test("写在引号脚本里（sh -c / python -c）同样被拦", () => {
  for (const command of [
    `sh -c 'echo x > ${PROTECTED}/f.txt'`,
    `bash -c "printf probe > ${PROTECTED}/f.txt"`,
    `python3 -c "open('${PROTECTED}/f.txt','w').write('x')"`,
    `D=${PROTECTED}; bash -c 'echo x > $D/f.txt'`,
    `find ${PROTECTED} -name '*.log' | xargs rm`,
  ]) {
    assert.equal(
      protectedCommandViolation(command, SHELL_OPTIONS)?.label,
      USER_PROTECTED_FOLDER_LABEL,
      `脚本里的写也要拦：${command}`,
    );
  }
});

test("引号脚本里只读时仍然放行（别把脚本一律当写）", () => {
  for (const command of [
    `bash -c 'cat ${PROTECTED}/f.txt'`,
    `python3 -c "print(open('${PROTECTED}/f.txt').read())"`,
  ]) {
    assert.equal(
      protectedCommandViolation(command, SHELL_OPTIONS),
      null,
      `脚本里只读不该被拦：${command}`,
    );
  }
});

test("写目标解析不出来、命令又提到受限路径：宁严勿松，拦", () => {
  const command = `D=$(echo ${PROTECTED}); echo x > "$D/f.txt"`;
  assert.equal(
    protectedCommandViolation(command, SHELL_OPTIONS)?.label,
    USER_PROTECTED_FOLDER_LABEL,
    "无法解析的写目标 + 提到受限路径必须拦",
  );
});

function joinTmp(...parts) {
  return [tmpdir().replace(/[\\/]+$/, ""), ...parts].join("/");
}

// 读者反馈过：「我只在设置里加了一个测试用文件夹，为什么连 App 本体都拦我？」
// 因为 App 本体/运行数据是引擎下发的**内置保护**，跟读者的列表无关。文案必须说实话。
test("内置保护的提示不许谎称在读者的受限文件夹列表里", () => {
  const bundle = {
    path: "/Users/me/Applications/MilkSU Beta Test.app/Contents/Resources/app.asar",
    label: "app-bundle",
  };
  const zh = protectedAgentNotice(bundle, "zh");
  assert.match(zh, /应用本体/, "要说清是哪个内置位置");
  assert.match(zh, /内置保护/, "要说明这是内置保护");
  assert.match(zh, /不在.*受限文件夹.*列表里/, "要明确说清不在读者的列表里");
  assert.doesNotMatch(zh, /在读者的「受限文件夹」列表里/, "绝不能谎称在读者的列表里");
  assert.doesNotMatch(zh, /关掉总开关/, "内置保护不受总开关影响，不要误导读者去关开关");
  assert.match(zh, /读者本人/, "内置保护这类事要由读者本人做（agent 做不到）");
  assert.match(protectedAgentNotice(bundle, "en"), /not on the reader's protected list/, "英文同样说实话");

  const userItem = protectedAgentNotice({ path: "/Users/me/private", label: "protected" }, "zh");
  assert.match(userItem, /在读者的「受限文件夹」列表里/, "读者列表的说法保持不变");
  assert.match(userItem, /关掉总开关/, "读者列表项仍然可以引导去关开关");
});

// 读者为此来回传过话：agent 的 ~ 是隔离沙箱，它写「读者的项目目录」时文件其实落在沙箱里，
// 还会直接撞上 runtime-data 这把锁。所以拦截提示必须把这件事说清，并给出可照抄的完整路径。
test("被拦在沙箱里的写入：提示要把 ~ 换成真实目录并给出完整路径", (t) => {
  const sandbox = "/Users/me/data/agent-home";
  const real = "/Users/me";
  const previousHome = process.env.HOME;
  const previousReal = process.env.MILKSU_USER_HOME;
  process.env.HOME = sandbox; // 侧车的 HOME = 隔离沙箱
  process.env.MILKSU_USER_HOME = real; // 引擎下发的真实主目录
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousReal === undefined) delete process.env.MILKSU_USER_HOME;
    else process.env.MILKSU_USER_HOME = previousReal;
  });

  const violation = {
    path: sandbox + "/MilkSU/Coding/PR提交准备/工作约定.md",
    label: "runtime-data",
  };
  const zh = protectedAgentNotice(violation, "zh");
  assert.match(zh, /隔离沙箱/, "要说清 ~ 是隔离沙箱");
  assert.match(zh, /MILKSU_USER_HOME/, "要给出正确写法");
  assert.match(
    zh,
    new RegExp(real + "/MilkSU/Coding/PR提交准备/工作约定\\.md"),
    "要给出可以直接照抄的完整路径",
  );
  assert.match(protectedAgentNotice(violation, "en"), /isolated sandbox/, "英文同样要说明");

  // 反向：不在沙箱里的路径（例如读者自己设置的受限目录）不得附这条提示
  const outside = { path: "/Users/me/private/notes.md", label: "protected" };
  assert.doesNotMatch(protectedAgentNotice(outside, "zh"), /隔离沙箱/, "非沙箱路径不得附这条提示");
});
