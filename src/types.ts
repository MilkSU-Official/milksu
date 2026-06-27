import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export interface MilkSUSkillManifest {
	name: string;
	description: string;
	triggerKeywords: string[];
	policy?: SkillPolicy;
}

export interface SkillPolicy {
	allowedTools?: string[];
	blockedTools?: string[];
}

export interface LoadedSkill {
	manifest: MilkSUSkillManifest;
	basePath: string;
	skillMdPath: string;
	tools: ToolDefinition[];
	knowledgePaths: string[];
	promptPaths: string[];
}

export interface MilkSUConfig {
	skillDirs?: string[];
	globalPolicy?: SkillPolicy;
}
