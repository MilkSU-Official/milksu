import assert from "node:assert/strict";
import test from "node:test";

import { runtimeEnvironmentGuidance } from "./bridge-runtime-environment.js";

test("describes the real Pi Bash boundary on a Windows host", () => {
  const guidance = runtimeEnvironmentGuidance({
    platform: "win32",
    arch: "x64",
    environment: {},
    uiLocale: "zh",
  });

  assert.match(guidance, /界面语言：简体中文/);
  assert.match(guidance, /Windows（win32）/);
  assert.match(guidance, /x64/);
  assert.match(guidance, /已评审的 Bash 后端/);
  assert.match(guidance, /显式调用 powershell\.exe/);
  assert.match(guidance, /思考、过程旁白、进度、答复/);
  assert.doesNotMatch(guidance, /API|TOKEN|KEY/);
});

test("describes the selected POSIX shell without copying ambient environment", () => {
  const guidance = runtimeEnvironmentGuidance({
    platform: "darwin",
    arch: "arm64",
    environment: {
      SHELL: "/bin/zsh",
      SECRET_VALUE: "must-not-leak",
    },
    uiLocale: "en",
  });

  assert.match(guidance, /user-interface language: English/);
  assert.match(guidance, /macOS \(darwin\)/);
  assert.match(guidance, /arm64/);
  assert.match(guidance, /POSIX shell \(\/bin\/zsh\)/);
  assert.doesNotMatch(guidance, /must-not-leak|SECRET_VALUE/);
});

test("does not tell the model the runtime is text-only", () => {
  const guidance = runtimeEnvironmentGuidance({});

  assert.match(guidance, /附件图片按图片交给当前模型/);
  assert.match(guidance, /不要声称运行时只能处理文字/);
});

test("does not let failed live research fall back to unverified model memory", () => {
  const guidance = runtimeEnvironmentGuidance();

  assert.match(guidance, /空响应、超时、认证错误/);
  assert.match(guidance, /核实失败/);
  assert.match(guidance, /不要把模型记忆写成当前或已核实的事实/);
});
