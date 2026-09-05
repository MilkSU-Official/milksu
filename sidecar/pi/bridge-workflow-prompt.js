import { codingBrowserGuidance } from "./bridge-browser-policy.js";
import {
  codingSubagentGuidance,
  codingWorkspaceIdentityGuidance,
} from "./bridge-collaboration.js";
import { runtimeEnvironmentGuidance } from "./bridge-runtime-environment.js";
import { researchReportGuidance } from "./bridge-workspace.js";

export function roleGuidanceForSession(sessionRole) {
  if (sessionRole === "strategist") {
    return "Act as an independent reviewer: challenge the current route and return an evidence-backed recommendation.";
  }
  if (sessionRole === "tool-builder") {
    return "Treat the requested helper as a software deliverable and verify it.";
  }
  if (sessionRole === "solver") {
    return "Advance one falsifiable CTF hypothesis at a time and preserve evidence for the learner.";
  }
  if (sessionRole === "cve-research" || sessionRole === "lab-job") {
    return researchReportGuidance(sessionRole);
  }
  return "";
}

// Product tools keep their when-to-use in the tool description / Skill catalog.
// This suffix only adds host facts Pi does not own: role, OS/cwd, and
// surfaces that are actually on for this session.
export function composeMilkSUWorkflowSystemPrompt(systemPrompt, {
  sessionRole = "",
  policy = {},
  modelInput,
} = {}) {
  const roleGuidance = roleGuidanceForSession(sessionRole);
  const workspaceIdentityGuidance = codingWorkspaceIdentityGuidance(
    policy?.workspace,
    policy?.codingCollaboration,
  );
  const subagentGuidance = policy?.activeTools?.includes("subagent")
    ? `\n\n${codingSubagentGuidance()}`
    : "";
  const browserGuidance = policy?.codingBrowser
    ? `\n\n${codingBrowserGuidance()}`
    : "";
  return `${systemPrompt ?? ""}`
    + (roleGuidance ? `\n\n${roleGuidance}` : "")
    + `\n\nRuntime context:\n${runtimeEnvironmentGuidance({
      uiLocale: policy?.uiLocale,
      modelInput,
    })}`
    + (workspaceIdentityGuidance
      ? `\n\nWorkspace identity:\n${workspaceIdentityGuidance}`
      : "")
    + subagentGuidance
    + browserGuidance;
}
