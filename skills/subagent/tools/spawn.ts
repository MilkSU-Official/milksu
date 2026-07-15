import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export default defineTool({
	name: "spawn_subagents",
	label: "Spawn Sub-agents",
	description:
		"Spawn up to 8 sub-agents to handle independent tasks. Each sub-agent runs in its own isolated session, with at most 4 running concurrently. Results are collected and returned.",
	parameters: Type.Object({
		tasks: Type.Array(
			Type.String({ description: "Task description for one sub-agent" }),
			{ description: "Array of task descriptions, one per sub-agent", minItems: 1, maxItems: 8 },
		),
	}),
	async execute(_toolCallId, params) {
		return {
			content: [{
				type: "text",
				text: "Sub-agent execution requires the MilkSU desktop bridge.",
			}],
			details: { tasks: params.tasks, status: "requires_desktop_bridge" },
		};
	},
});
