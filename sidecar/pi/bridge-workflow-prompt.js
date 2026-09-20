import { codingWorkspaceIdentityGuidance } from "./bridge-collaboration.js";
import {
  chineseUiLocale,
  runtimeEnvironmentGuidance,
} from "./bridge-runtime-environment.js";
import { quotedReferenceGuidance } from "./bridge-quoted-reference.js";
import { researchReportGuidance } from "./bridge-workspace.js";

export function roleGuidanceForSession(sessionRole, uiLocale) {
  const chinese = chineseUiLocale(uiLocale);
  if (sessionRole === "strategist") {
    return chinese
      ? "作为独立审阅者：质疑当前路线，给出有证据的建议。"
      : "Act as an independent reviewer: challenge the current route and return an evidence-backed recommendation.";
  }
  if (sessionRole === "tool-builder") {
    return chinese
      ? "把被要求的辅助能力当成软件交付物来做，并核验它。"
      : "Treat the requested helper as a software deliverable and verify it.";
  }
  if (sessionRole === "solver") {
    return chinese
      ? "一次只推进一个可证伪的 CTF 假设，并为学习者保留证据。"
      : "Advance one falsifiable CTF hypothesis at a time and preserve evidence for the learner.";
  }
  if (sessionRole === "cve-research" || sessionRole === "lab-job") {
    return researchReportGuidance(sessionRole, uiLocale);
  }
  return "";
}

// Product tools keep their when-to-use in the tool description / Skill catalog.
// This suffix only adds host facts Pi does not own: role, OS/cwd, and
// surfaces that are actually on for this session.
export function composeMilkSUWorkflowSystemPrompt(systemPrompt, {
  sessionRole = "",
  policy = {},
} = {}) {
  const uiLocale = policy?.uiLocale;
  const chinese = chineseUiLocale(uiLocale);
  const roleGuidance = roleGuidanceForSession(sessionRole, uiLocale);
  const workspaceIdentityGuidance = codingWorkspaceIdentityGuidance(
    policy?.workspace,
    policy?.codingCollaboration,
    uiLocale,
  );
  return `${systemPrompt ?? ""}`
    + (roleGuidance ? `\n\n${roleGuidance}` : "")
    + `\n\n${chinese ? "运行时上下文" : "Runtime context"}:\n${runtimeEnvironmentGuidance({
      uiLocale,
    })}`
    + (workspaceIdentityGuidance
      ? `\n\n${chinese ? "工作区身份" : "Workspace identity"}:\n${workspaceIdentityGuidance}`
      : "")
    + `

${quotedReferenceGuidance(uiLocale)}`;
}
