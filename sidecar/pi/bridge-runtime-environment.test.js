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

  assert.match(guidance, /Simplified Chinese/);
  assert.match(guidance, /Windows \(win32\)/);
  assert.match(guidance, /x64/);
  assert.match(guidance, /Bash backend on Windows/);
  assert.match(guidance, /invoke powershell\.exe explicitly/);
  assert.match(guidance, /every user-visible progress update, answer, label, diagram/);
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

  assert.match(guidance, /Attached images are sent to the current model as images/);
  assert.match(guidance, /Do not claim the runtime is text-only/);
});

test("does not let failed live research fall back to unverified model memory", () => {
  const guidance = runtimeEnvironmentGuidance();

  assert.match(guidance, /empty response, timeout, authentication error/);
  assert.match(guidance, /verification failed/);
  assert.match(guidance, /do not present model memory as current or verified fact/);
});
