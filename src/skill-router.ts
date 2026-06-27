import type { LoadedSkill } from "./types.ts";

export function buildRoutingPrompt(skills: LoadedSkill[]): string {
	if (skills.length === 0) return "";

	const entries = skills.map((s) => {
		const keywords = s.manifest.triggerKeywords.length > 0 ? ` (keywords: ${s.manifest.triggerKeywords.join(", ")})` : "";
		const toolNames = s.tools.map((t) => t.name).join(", ");
		const toolsLine = toolNames ? `\n  Tools: ${toolNames}` : "";
		return `- **${s.manifest.name}**: ${s.manifest.description}${keywords}${toolsLine}`;
	});

	return [
		"<milksu-skills>",
		"The following MilkSU skills are available:",
		"",
		...entries,
		"",
		"Use the appropriate skill tools when the user's request matches the skill's domain.",
		"</milksu-skills>",
	].join("\n");
}

export function matchSkills(input: string, skills: LoadedSkill[]): LoadedSkill[] {
	const lower = input.toLowerCase();
	return skills.filter((s) => s.manifest.triggerKeywords.some((kw) => lower.includes(kw.toLowerCase())));
}
