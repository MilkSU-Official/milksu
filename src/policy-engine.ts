import type { LoadedSkill, SkillPolicy } from "./types.ts";

export interface PolicyCheckResult {
	blocked: boolean;
	reason?: string;
}

export function createPolicyEngine(skills: LoadedSkill[], globalPolicy?: SkillPolicy) {
	const allBlockedTools = new Set<string>();

	if (globalPolicy?.blockedTools) {
		for (const t of globalPolicy.blockedTools) allBlockedTools.add(t);
	}

	for (const skill of skills) {
		if (skill.manifest.policy?.blockedTools) {
			for (const t of skill.manifest.policy.blockedTools) allBlockedTools.add(t);
		}
	}

	return {
		check(toolName: string): PolicyCheckResult {
			if (allBlockedTools.has(toolName)) {
				return { blocked: true, reason: `Tool "${toolName}" is blocked by MilkSU policy` };
			}
			return { blocked: false };
		},
	};
}
