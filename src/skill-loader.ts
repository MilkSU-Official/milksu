import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { LoadedSkill, MilkSUSkillManifest } from "./types.ts";

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { data: {}, body: content };

	const data: Record<string, unknown> = {};
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		let value: unknown = line.slice(colonIdx + 1).trim();
		if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
			value = value
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
		}
		data[key] = value;
	}
	return { data, body: match[2] };
}

function parseManifest(skillMdPath: string): MilkSUSkillManifest | null {
	try {
		const content = fs.readFileSync(skillMdPath, "utf-8");
		const { data } = parseFrontmatter(content);
		if (!data.name || !data.description) return null;

		return {
			name: data.name as string,
			description: data.description as string,
			triggerKeywords: Array.isArray(data.triggerKeywords)
				? (data.triggerKeywords as string[])
				: typeof data.triggerKeywords === "string"
					? [data.triggerKeywords]
					: [],
			policy: data.policy as MilkSUSkillManifest["policy"],
		};
	} catch {
		return null;
	}
}

function listFiles(dir: string, ext: string): string[] {
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(ext))
			.map((f) => path.join(dir, f));
	} catch {
		return [];
	}
}

function isToolDefinition(value: unknown): value is ToolDefinition {
	return value !== null && typeof value === "object" && "name" in value && "execute" in value;
}

async function loadSkillTools(toolsDir: string): Promise<ToolDefinition[]> {
	const toolFiles = listFiles(toolsDir, ".ts");
	const tools: ToolDefinition[] = [];

	for (const file of toolFiles) {
		try {
			const mod = await import(file);
			for (const exported of Object.values(mod)) {
				if (isToolDefinition(exported)) {
					tools.push(exported as ToolDefinition);
				}
			}
		} catch (err) {
			console.error(`[milksu] Failed to load tool ${file}:`, err);
		}
	}

	return tools;
}

export async function discoverSkills(skillsDir: string): Promise<LoadedSkill[]> {
	if (!fs.existsSync(skillsDir)) return [];

	const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
	const skills: LoadedSkill[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const basePath = path.join(skillsDir, entry.name);
		const skillMdPath = path.join(basePath, "SKILL.md");

		if (!fs.existsSync(skillMdPath)) continue;

		const manifest = parseManifest(skillMdPath);
		if (!manifest) continue;

		const toolsDir = path.join(basePath, "tools");
		const knowledgeDir = path.join(basePath, "knowledge");
		const promptsDir = path.join(basePath, "prompts");

		const tools = fs.existsSync(toolsDir) ? await loadSkillTools(toolsDir) : [];

		skills.push({
			manifest,
			basePath,
			skillMdPath,
			tools,
			knowledgePaths: listFiles(knowledgeDir, ".md"),
			promptPaths: listFiles(promptsDir, ".md"),
		});
	}

	return skills;
}

export function getSkillMdPaths(skills: LoadedSkill[]): string[] {
	return skills.map((s) => s.skillMdPath);
}
