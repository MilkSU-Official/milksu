import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSkills, getSkillMdPaths } from "./skill-loader.ts";
import { buildRoutingPrompt } from "./skill-router.ts";
import { createPolicyEngine } from "./policy-engine.ts";
import { setupInterruptionHandler } from "./interruption.ts";

const baseDir = dirname(fileURLToPath(import.meta.url));
const defaultSkillsDir = join(baseDir, "..", "skills");

export default async function milksu(pi: ExtensionAPI) {
	const skills = await discoverSkills(defaultSkillsDir);
	const policyEngine = createPolicyEngine(skills);

	setupInterruptionHandler(pi);

	for (const skill of skills) {
		for (const tool of skill.tools) {
			pi.registerTool(tool);
		}
	}

	pi.on("resources_discover", () => {
		return {
			skillPaths: getSkillMdPaths(skills),
		};
	});

	pi.on("before_agent_start", (event) => {
		const routingPrompt = buildRoutingPrompt(skills);
		if (!routingPrompt) return;
		return {
			systemPrompt: event.systemPrompt + "\n\n" + routingPrompt,
		};
	});

	pi.on("tool_call", (event) => {
		const result = policyEngine.check(event.toolName);
		if (result.blocked) {
			return { block: true, reason: result.reason };
		}
	});

	pi.registerCommand("milksu", {
		description: "List loaded MilkSU skills",
		handler: async (_args, ctx) => {
			if (skills.length === 0) {
				ctx.ui.notify("MilkSU: No skills loaded", "info");
				return;
			}
			const lines = skills.map((s) => {
				const toolCount = s.tools.length;
				return `  ${s.manifest.name} — ${s.manifest.description} (${toolCount} tool${toolCount !== 1 ? "s" : ""})`;
			});
			ctx.ui.notify(`MilkSU skills:\n${lines.join("\n")}`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.notify(`MilkSU loaded: ${skills.length} skill(s)`, "info");
	});
}
